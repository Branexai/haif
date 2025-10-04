import RPC from '@hyperswarm/rpc'
import Bottleneck from 'bottleneck'
import pRetry from 'p-retry'
import CircuitBreaker from 'opossum'

const MAX_CONCURRENT_SCHEDULE = Number(process.env.MAX_CONCURRENT_SCHEDULE || 10)
const MIN_TIME_MS = Number(process.env.MIN_TIME_MS || 20)
const scheduleLimiter = new Bottleneck({ maxConcurrent: MAX_CONCURRENT_SCHEDULE, minTime: MIN_TIME_MS })
const breakerOptions = {
  timeout: Number(process.env.BREAKER_TIMEOUT_MS || 30000),
  errorThresholdPercentage: Number(process.env.BREAKER_ERROR_THRESHOLD || 80),
  resetTimeout: Number(process.env.BREAKER_RESET_TIMEOUT_MS || 30000)
}
const retryOpts = {
  retries: Number(process.env.RETRY_ATTEMPTS || 3),
  factor: 2,
  minTimeout: Number(process.env.RETRY_MIN_MS || 250),
  maxTimeout: Number(process.env.RETRY_MAX_MS || 2000),
  randomize: true
}

type WorkerInfo = { publicKey: Buffer, model: string, capabilities?: string[] }
// Configure a deterministic Noise keypair for RPC if provided
const orchPubHex = process.env.ORCHESTRATOR_PUBLIC_KEY
const orchSecHex = process.env.ORCHESTRATOR_SECRET_KEY
const orchSeedHex = process.env.ORCHESTRATOR_SEED
const rpcOpts: any = {}
if (orchPubHex && orchSecHex) {
  try {
    rpcOpts.keyPair = { publicKey: Buffer.from(orchPubHex, 'hex'), secretKey: Buffer.from(orchSecHex, 'hex') }
  } catch {}
} else if (orchSeedHex) {
  try { rpcOpts.seed = Buffer.from(orchSeedHex, 'hex') } catch {}
}
const rpc = new (RPC as any)(rpcOpts)
const server = rpc.createServer()
await server.listen()

const workers = new Map<string, WorkerInfo>()

server.respond('health', async () => {
  return Buffer.from(JSON.stringify({ status: 'ok', service: 'orchestrator' }))
})

server.respond('register-worker', async (req: any) => {
  const payload = JSON.parse(Buffer.isBuffer(req) ? req.toString('utf8') : String(req))
  const { publicKeyHex, model, capabilities } = payload || {}
  if (!publicKeyHex || !model) throw new Error('Missing worker info')
  const pk = Buffer.from(publicKeyHex, 'hex')
  workers.set(publicKeyHex, { publicKey: pk, model, capabilities })
  return Buffer.from(JSON.stringify({ status: 'ok' }))
})

server.respond('schedule', async (req: any) => {
  const body = JSON.parse(Buffer.isBuffer(req) ? req.toString('utf8') : String(req))
  const modelPref: string | undefined = (typeof body?.model === 'string' && body.model.trim()) ? body.model.trim() : undefined

  const worker = pickWorker(modelPref)
  if (!worker) {
    return Buffer.from(JSON.stringify({ status: 'failed', error: 'No workers available' }))
  }

  const callWorker = async () => {
    const client = rpc.connect(worker.publicKey)
    const resBuf = await client.request('infer', Buffer.from(JSON.stringify(body)))
    const json = Buffer.isBuffer(resBuf) ? resBuf.toString('utf8') : String(resBuf)
    return JSON.parse(json)
  }

  const breaker = new CircuitBreaker(callWorker, breakerOptions)
  const data = await scheduleLimiter.schedule(() => pRetry(() => breaker.fire(), retryOpts))
  return Buffer.from(JSON.stringify(data))
})

function pickWorker(model?: string): WorkerInfo | null {
  if (model) {
    for (const w of workers.values()) if (w.model === model) return w
  }
  const first = workers.values().next().value
  return first ?? null
}

process.on('SIGINT', () => {
  try { (rpc as any).destroy?.() } catch {}
  process.exit(0)
})

console.log('Orchestrator RPC public key:', (server as any).publicKey.toString('hex'))