import RPC from '@hyperswarm/rpc'
import Bottleneck from 'bottleneck'
import pRetry from 'p-retry'
import CircuitBreaker from 'opossum'
import fs from 'fs'

const rpc = new (RPC as any)()
const server = rpc.createServer()
await server.listen()

function readPkFromFile(): string | undefined {
  const pkFile = process.env.ORCHESTRATOR_PK_FILE || '/shared/orchestrator_pk.txt'
  try {
    const s = fs.readFileSync(pkFile, 'utf8').trim()
    if (s && /^[0-9a-fA-F]+$/.test(s)) return s
  } catch {}
  return undefined
}

const orchestratorPkHex = process.env.ORCHESTRATOR_PUBLIC_KEY || process.env.ORCH_PK || readPkFromFile() || ''
if (!orchestratorPkHex) {
  // eslint-disable-next-line no-console
  console.warn('Gateway: ORCHESTRATOR_PUBLIC_KEY not set and pk file missing. RPC proxy will not work.')
}

const TENANT_RATE_LIMIT_RPS = Number(process.env.TENANT_RATE_LIMIT_RPS || 5)
const TENANT_MAX_CONCURRENT = Number(process.env.TENANT_MAX_CONCURRENT || 2)
const tenantLimiters = new Map<string, Bottleneck>()

server.respond('health', async () => {
  return Buffer.from(JSON.stringify({ status: 'ok', service: 'gateway' }))
})

server.respond('schedule', async (req: any) => {
  const body = JSON.parse(Buffer.isBuffer(req) ? req.toString('utf8') : String(req))
  const tenantId = (typeof body?.tenant_id === 'string' && body.tenant_id.trim()) ? body.tenant_id.trim() : 'default'

  let limiter = tenantLimiters.get(tenantId)
  if (!limiter) {
    limiter = new Bottleneck({
      reservoir: TENANT_RATE_LIMIT_RPS,
      reservoirRefreshInterval: 1000,
      reservoirRefreshAmount: TENANT_RATE_LIMIT_RPS,
      maxConcurrent: TENANT_MAX_CONCURRENT
    })
    tenantLimiters.set(tenantId, limiter)
  }

  const callOrchestrator = async () => {
    const client = rpc.connect(Buffer.from(orchestratorPkHex, 'hex'))
    const resBuf = await client.request('schedule', Buffer.from(JSON.stringify(body)))
    const json = Buffer.isBuffer(resBuf) ? resBuf.toString('utf8') : String(resBuf)
    return JSON.parse(json)
  }

  const breaker = new CircuitBreaker(callOrchestrator, {
    timeout: Number(process.env.GW_BREAKER_TIMEOUT_MS || 15000),
    errorThresholdPercentage: Number(process.env.GW_BREAKER_ERROR_THRESHOLD || 80),
    resetTimeout: Number(process.env.GW_BREAKER_RESET_TIMEOUT_MS || 30000)
  })

  try {
    const data = await limiter.schedule(() => pRetry(() => breaker.fire(), {
      retries: Number(process.env.GW_RETRY_ATTEMPTS || 2),
      factor: 2,
      minTimeout: Number(process.env.GW_RETRY_MIN_MS || 200),
      maxTimeout: Number(process.env.GW_RETRY_MAX_MS || 1500),
      randomize: true
    }))
    return Buffer.from(JSON.stringify(data))
  } catch (err) {
    const details = String(err ?? '')
    const isCircuitOpen = details.includes('Breaker is open')
    const isTimeout = details.toLowerCase().includes('timeout') || details.toLowerCase().includes('timed out')
    const body = isCircuitOpen || isTimeout
      ? { error: 'Service Unavailable', details: isCircuitOpen ? 'Upstream circuit open' : 'Upstream timeout' }
      : { error: 'Bad Gateway', details }
    return Buffer.from(JSON.stringify(body))
  }
})

console.log('Gateway RPC public key:', (server as any).publicKey.toString('hex'))