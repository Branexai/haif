import Fastify from 'fastify'
import { setupHttpMetrics } from './observability.js'
import fetch from 'node-fetch'
const app = Fastify({ logger: true })
setupHttpMetrics(app)

const PORT = Number(process.env.PORT || 4000)

app.get('/health', async () => ({ status: 'ok', service: 'orchestrator' }))

// Schedule and dispatch to worker (or OpenAI): maps request and calls worker /infer
app.post('/schedule', async (req) => {
  const body = (await req.body) as any
  const WORKER_URL = process.env.WORKER_URL || 'http://tether-worker:6000'

  // Map incoming payload to worker schema { model, prompt, max_tokens }
  const payload: any = {
    model: body?.model ?? 'demo',
    prompt: body?.prompt ?? body?.input ?? '',
    max_tokens: typeof body?.max_tokens === 'number' ? body.max_tokens : 128
  }

  if (!payload.prompt || typeof payload.prompt !== 'string') {
    return { status: 'failed', error: 'Missing prompt/input', request: body }
  }

  // Dispatch exclusively to the Node worker using Hugging Face models
  try {
    const res = await fetch(`${WORKER_URL}/infer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const workerResult = await res.json()
    return {
      plannedWorker: WORKER_URL,
      status: 'completed',
      result: workerResult
    }
  } catch (err: any) {
    return {
      plannedWorker: WORKER_URL,
      status: 'failed',
      error: 'Worker invocation failed',
      details: String(err)
    }
  }
})

app.listen({ host: '0.0.0.0', port: PORT }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})