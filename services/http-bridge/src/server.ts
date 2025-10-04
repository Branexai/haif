import Fastify from 'fastify'
import cors from '@fastify/cors'
import RPC from '@hyperswarm/rpc'
import pRetry from 'p-retry'
import Bottleneck from 'bottleneck'
import CircuitBreaker from 'opossum'

const app = Fastify({ logger: true })
// Allow browser calls from Vite dev server and any origin in dev
await app.register(cors, { origin: true })
const PORT = Number(process.env.PORT || 8080)
function getOrchestratorPk(): string {
  return process.env.ORCHESTRATOR_PUBLIC_KEY || ''
}

if (!getOrchestratorPk()) {
  app.log.warn('ORCHESTRATOR_PUBLIC_KEY not set; bridge cannot forward requests')
}

const rpc = new (RPC as any)()
const TENANT_RATE_LIMIT_RPS = Number(process.env.TENANT_RATE_LIMIT_RPS || 5)
const TENANT_MAX_CONCURRENT = Number(process.env.TENANT_MAX_CONCURRENT || 2)
const tenantLimiters = new Map<string, Bottleneck>()

function getLimiter(tenantId: string) {
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
  return limiter
}

app.get('/health', async () => ({ status: 'ok', service: 'http-bridge', orchestrator_key_present: Boolean(getOrchestratorPk()) }))

app.post('/infer', async (req, reply) => {
  try {
    const body = (await req.body) as any
    const tenantId = String(body?.tenant_id || req.headers['x-tenant-id'] || 'anonymous')
    const limiter = getLimiter(tenantId)
    const orchPk = getOrchestratorPk()

    // If the orchestrator key is missing, return a clear 503 without engaging the breaker
    if (!orchPk) {
      app.log.warn('Orchestrator public key missing; returning 503 Service Unavailable')
      reply.code(503)
      return { error: 'Service Unavailable', details: 'Orchestrator public key not configured' }
    }

    const callOrchestrator = async () => {
      const client = rpc.connect(Buffer.from(orchPk, 'hex'))
      const resBuf = await client.request('schedule', Buffer.from(JSON.stringify(body)))
      const json = Buffer.isBuffer(resBuf) ? resBuf.toString('utf8') : String(resBuf)
      return JSON.parse(json)
    }

    const breaker = new CircuitBreaker(callOrchestrator, {
      timeout: Number(process.env.BREAKER_TIMEOUT_MS || 15000),
      errorThresholdPercentage: Number(process.env.BREAKER_ERROR_THRESHOLD || 80),
      resetTimeout: Number(process.env.BREAKER_RESET_TIMEOUT_MS || 30000)
    })

    const data = await limiter.schedule(() => pRetry(() => breaker.fire(), {
      retries: Number(process.env.RETRY_ATTEMPTS || 2),
      factor: 2,
      minTimeout: Number(process.env.RETRY_MIN_MS || 200),
      maxTimeout: Number(process.env.RETRY_MAX_MS || 1500),
      randomize: true
    }))
    if (data && typeof data === 'object' && (data as any).status === 'failed' && String((data as any).error || '').includes('No workers available')) {
      reply.code(503)
    }
    return data
  } catch (err) {
    const details = String(err ?? '')
    app.log.error({ err: details }, 'Bridge error')
    const isCircuitOpen = details.includes('Breaker is open')
    const isTimeout = details.toLowerCase().includes('timeout') || details.toLowerCase().includes('timed out')
    if (isCircuitOpen || isTimeout) {
      reply.header('Retry-After', '5')
      reply.code(503)
      return { error: 'Service Unavailable', details: isCircuitOpen ? 'Upstream circuit open' : 'Upstream timeout' }
    }
    reply.code(502)
    return { error: 'Bad Gateway', details }
  }
})

app.listen({ host: '0.0.0.0', port: PORT }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})