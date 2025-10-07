import Fastify from 'fastify'
import cors from '@fastify/cors'
import RPC from '@hyperswarm/rpc'
import pRetry from 'p-retry'
import Bottleneck from 'bottleneck'
import fs from 'fs'
import client from 'prom-client'
import http from 'http'
// Circuit breaker disabled per request

const app = Fastify({ logger: true })
// Allow browser calls from Vite dev server and any origin in dev
await app.register(cors, { origin: true })
const PORT = Number(process.env.PORT || 8080)

function readPkFromFile(): string | undefined {
  const pkFile = process.env.ORCHESTRATOR_PK_FILE || '/shared/orchestrator_pk.txt'
  try {
    const s = fs.readFileSync(pkFile, 'utf8').trim()
    if (s && /^[0-9a-fA-F]+$/.test(s)) return s
  } catch {}
  return undefined
}

function getOrchestratorPk(): string {
  return process.env.ORCHESTRATOR_PUBLIC_KEY || readPkFromFile() || ''
}

if (!getOrchestratorPk()) {
  app.log.warn('ORCHESTRATOR_PUBLIC_KEY not set and pk file missing; bridge cannot forward requests')
}

// Prometheus metrics
const registry = new client.Registry()
client.collectDefaultMetrics({ register: registry })
const orchPathCounter = new client.Counter({
  name: 'http_bridge_orchestrator_path_total',
  help: 'Bridge to orchestrator path count',
  labelNames: ['path']
})
registry.registerMetric(orchPathCounter)
app.get('/metrics', async (req, reply) => {
  reply.header('Content-Type', registry.contentType)
  return registry.metrics()
})

// Startup readiness gating: wait for orchestrator health
let orchestratorReady = false
async function waitForOrchestrator() {
  const url = process.env.ORCHESTRATOR_HTTP_URL || 'http://orchestrator:4000/health'
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) { orchestratorReady = true; app.log.info('Bridge: orchestrator is healthy'); return }
    } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  app.log.warn('Bridge: orchestrator not healthy after wait; will continue but may return 503')
}
waitForOrchestrator().catch(() => {})

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

    app.log.info(`Processing inference request for tenant: ${tenantId}`)

    if (!orchestratorReady) {
      app.log.warn('Bridge: orchestrator not ready; returning 503')
      reply.code(503)
      return { error: 'Service Unavailable', details: 'Orchestrator not healthy yet' }
    }

    const callOrchestrator = async () => {
      // First try RPC
      const client = rpc.connect(Buffer.from(orchPk, 'hex'))
      try {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Orchestrator connection timeout')), 15000)
        })

        if (typeof (client as any).fullyOpened === 'function') {
          await Promise.race([
            (client as any).fullyOpened(),
            timeoutPromise
          ])
        }

        if ((client as any).closed) {
          throw new Error('Orchestrator RPC channel closed before request')
        }

        const resBuf = await Promise.race([
          client.request('schedule', Buffer.from(JSON.stringify(body))),
          timeoutPromise
        ])

        const json = Buffer.isBuffer(resBuf) ? resBuf.toString('utf8') : String(resBuf)
        app.log.info('Bridge→Orchestrator path=rpc')
        orchPathCounter.inc({ path: 'rpc' })
        return JSON.parse(json)
      } catch (rpcErr: any) {
        const msg = String(rpcErr?.message || rpcErr)
        const isClosed = msg.toLowerCase().includes('channel closed')
        const isTimeout = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('timed out')
        if (isClosed || isTimeout) {
          // Fallback to HTTP call to orchestrator
          const urlStr = process.env.ORCHESTRATOR_HTTP_URL || 'http://orchestrator:4000/schedule'
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
                  const out = JSON.parse(txt)
                  app.log.info('Bridge→Orchestrator path=http')
                  orchPathCounter.inc({ path: 'http' })
                  resolve(out)
                } catch (e) {
                  reject(e)
                }
              })
            })
            req.on('error', reject)
            req.write(payload)
            req.end()
          })
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

    // Direct call with retry; no circuit breaker
    const data = await limiter.schedule(() => pRetry(() => callOrchestrator(), {
      retries: Number(process.env.RETRY_ATTEMPTS || 2),
      factor: 2,
      minTimeout: Number(process.env.RETRY_MIN_MS || 200),
      maxTimeout: Number(process.env.RETRY_MAX_MS || 1500),
      randomize: true
    }))
    
    if (data && typeof data === 'object' && (data as any).status === 'failed' && String((data as any).error || '').includes('No workers available')) {
      reply.code(503)
    }
    
    app.log.info('Inference request completed successfully')
    return data
  } catch (err) {
    const details = String(err ?? '')
    app.log.error({ err: details }, 'Bridge error')
    const isTimeout = details.toLowerCase().includes('timeout') || details.toLowerCase().includes('timed out')
    const isChannelClosed = details.toLowerCase().includes('channel closed')
    
    if (isTimeout || isChannelClosed) {
      reply.header('Retry-After', '5')
      reply.code(503)
      return { error: 'Service Unavailable', details: isTimeout ? 'Upstream timeout' : 'Connection lost to orchestrator' }
    }
    reply.code(502)
    return { error: 'Bad Gateway', details }
  }
})

app.listen({ host: '0.0.0.0', port: PORT }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})