import Fastify from 'fastify'
import fetch from 'node-fetch'
import OpenAI from 'openai'
const app = Fastify({ logger: true })

const PORT = Number(process.env.PORT || 4000)

app.get('/health', async () => ({ status: 'ok', service: 'orchestrator' }))

// Schedule and dispatch to worker (or OpenAI): maps request and calls worker /infer
app.post('/schedule', async (req) => {
  const body = (await req.body) as any
  const WORKER_URL = process.env.WORKER_URL || 'http://tether-worker:6000'
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  // Map incoming payload to worker schema { model, prompt, max_tokens }
  const payload: any = {
    model: body?.model ?? 'demo',
    prompt: body?.prompt ?? body?.input ?? '',
    max_tokens: typeof body?.max_tokens === 'number' ? body.max_tokens : 128
  }

  if (!payload.prompt || typeof payload.prompt !== 'string') {
    return { status: 'failed', error: 'Missing prompt/input', request: body }
  }

  // If OpenAI is configured, prefer direct model execution
  if (OPENAI_API_KEY) {
    try {
      const client = new OpenAI({ apiKey: OPENAI_API_KEY })
      const resp = await client.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: payload.prompt }],
        max_tokens: payload.max_tokens
      })
      const text = resp.choices?.[0]?.message?.content ?? ''
      return {
        plannedWorker: 'openai',
        status: 'completed',
        result: { model: payload.model, output: text, provider: 'openai', max_tokens: payload.max_tokens }
      }
    } catch (err: any) {
      // If OpenAI fails, fallback to worker
      app.log.warn({ err }, 'OpenAI invocation failed; falling back to worker')
    }
  }

  // Default path: call the Python worker
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