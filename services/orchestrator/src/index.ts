import RPC from '@hyperswarm/rpc'
import Bottleneck from 'bottleneck'
import pRetry from 'p-retry'
import CircuitBreaker from 'opossum'
import fs from 'fs'
import path from 'path'
import Fastify from 'fastify'
import client from 'prom-client'
import http from 'http'

const MAX_CONCURRENT_SCHEDULE = Number(process.env.MAX_CONCURRENT_SCHEDULE || 10)
const MIN_TIME_MS = Number(process.env.MIN_TIME_MS || 20)
const scheduleLimiter = new Bottleneck({ maxConcurrent: MAX_CONCURRENT_SCHEDULE, minTime: MIN_TIME_MS })
const breakerOptions = {
  timeout: Number(process.env.BREAKER_TIMEOUT_MS || 15000), // Reduced from 30s
  errorThresholdPercentage: Number(process.env.BREAKER_ERROR_THRESHOLD || 90), // Increased from 80%
  resetTimeout: Number(process.env.BREAKER_RESET_TIMEOUT_MS || 10000), // Reduced from 30s
  // Add circuit breaker event logging
  onOpen: () => console.log('Circuit breaker opened - too many failures'),
  onHalfOpen: () => console.log('Circuit breaker half-open - testing recovery'),
  onClose: () => console.log('Circuit breaker closed - service recovered')
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

// Persist orchestrator public key to a shared file for other services to read
// This avoids mismatches when deterministic keys are not configured via env
try {
  const pkFile = process.env.ORCHESTRATOR_PK_FILE || '/shared/orchestrator_pk.txt'
  const dir = path.dirname(pkFile)
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  fs.writeFileSync(pkFile, (server as any).publicKey.toString('hex'))
  // eslint-disable-next-line no-console
  console.log('Orchestrator public key written to', pkFile)
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn('Failed to write orchestrator public key file:', err)
}

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

// Lightweight HTTP endpoint for worker registration (fallback path)
const app = Fastify({ logger: true })
const HTTP_PORT = Number(process.env.PORT || 4000)

// Prometheus metrics: expose schedule path selection
const registry = new client.Registry()
client.collectDefaultMetrics({ register: registry })
const schedulePathCounter = new client.Counter({
  name: 'orchestrator_schedule_path_total',
  help: 'Orchestrator schedule path count',
  labelNames: ['path']
})
registry.registerMetric(schedulePathCounter)
app.get('/metrics', async (req, reply) => {
  reply.header('Content-Type', registry.contentType)
  return await registry.metrics()
})

app.post('/register-worker', async (req, reply) => {
  try {
    const body = (await req.body) as any
    const publicKeyHex: string = body?.publicKeyHex
    const model: string = body?.model
    const capabilities: string[] | undefined = Array.isArray(body?.capabilities) ? body.capabilities : undefined
    if (!publicKeyHex || !model) {
      reply.code(400)
      return { error: 'Missing worker info' }
    }
    const pk = Buffer.from(publicKeyHex, 'hex')
    workers.set(publicKeyHex, { publicKey: pk, model, capabilities })
    
    // Log successful registration
    app.log.info(`Worker registered: ${publicKeyHex.slice(0, 8)}... (model: ${model})`)
    
    return { status: 'ok', registered_workers: workers.size }
  } catch (err: any) {
    app.log.error(`Worker registration failed: ${err.message}`)
    reply.code(400)
    return { error: 'Invalid payload', details: String(err) }
  }
})

app.post('/schedule', async (req, reply) => {
  try {
    const body = (await req.body) as any
    const modelPref: string | undefined = (typeof body?.model === 'string' && body.model.trim()) ? body.model.trim() : undefined

    const worker = pickWorker(modelPref)
    if (!worker) {
      reply.code(503)
      return { status: 'failed', error: 'No workers available' }
    }

    app.log.info(`Attempting to schedule request to worker: ${worker.publicKey.toString('hex').slice(0, 8)}...`)

    // For scheduling, try RPC first, then fallback to worker HTTP
    const callWorker = async () => {
      const client = rpc.connect(worker.publicKey)
      try {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Worker connection timeout')), 10000)
        })

        if (typeof (client as any).fullyOpened === 'function') {
          await Promise.race([
            (client as any).fullyOpened(),
            timeoutPromise
          ])
        }

        if ((client as any).closed) {
          throw new Error('Worker RPC channel closed before request')
        }

        const resBuf = await Promise.race([
          client.request('infer', Buffer.from(JSON.stringify(body))),
          timeoutPromise
        ])
        const json = Buffer.isBuffer(resBuf) ? resBuf.toString('utf8') : String(resBuf)
        app.log.info('Orchestrator→Worker path=rpc')
        schedulePathCounter.inc({ path: 'rpc' })
        return JSON.parse(json)
      } catch (rpcErr: any) {
        const msg = String(rpcErr?.message || rpcErr)
        const isClosed = msg.toLowerCase().includes('channel closed')
        const isTimeout = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('timed out')
        if (isClosed || isTimeout) {
          const urlStr = process.env.WORKER_HTTP_URL || 'http://worker:6000/infer'
          const u = new URL(urlStr)
          const payload = JSON.stringify(body)
          const data = await new Promise<any>((resolve, reject) => {
            const req = http.request({
              hostname: u.hostname,
              port: Number(u.port || 80),
              path: u.pathname,
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload)
              }
            }, (res) => {
              const chunks: Buffer[] = []
              res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))))
              res.on('end', () => {
                try {
                  const txt = Buffer.concat(chunks).toString('utf8')
                  resolve(JSON.parse(txt))
                } catch (e) {
                  reject(e)
                }
              })
            })
            req.on('error', reject)
            req.write(payload)
            req.end()
          })
          app.log.info('Orchestrator→Worker path=http')
          schedulePathCounter.inc({ path: 'http' })
          return data
        }
        throw rpcErr
      } finally {
        try {
          if (typeof (client as any).end === 'function') {
            await (client as any).end()
          } else {
            (client as any).destroy?.()
          }
        } catch {}
      }
    }

    const data = await scheduleLimiter.schedule(() => pRetry(() => callWorker(), retryOpts))
    
    app.log.info('Scheduling request completed successfully')
    return data
  } catch (err: any) {
    const errorMsg = `Scheduling failed: ${err.message}`
    app.log.error(errorMsg)
    
    // Provide more specific error responses
    // If circuit breaker error messages are present from previous versions, translate them to 503
    if (err.message && err.message.toLowerCase().includes('breaker is open')) {
      reply.code(503)
      return { status: 'failed', error: 'Service temporarily unavailable', details: 'Worker connections are failing, please try again later' }
    }
    
    reply.code(500)
    return { status: 'failed', error: 'Internal server error', details: String(err) }
  }
})

app.get('/health', async () => ({ 
  status: 'ok', 
  service: 'orchestrator',
  registered_workers: workers.size,
  rpc_public_key: (server as any).publicKey.toString('hex').slice(0, 16) + '...'
}))

app.listen({ host: '0.0.0.0', port: HTTP_PORT }).catch((err) => {
  try { (rpc as any).destroy?.() } catch {}
  // eslint-disable-next-line no-console
  console.error('Orchestrator HTTP server failed to start', err)
  process.exit(1)
})