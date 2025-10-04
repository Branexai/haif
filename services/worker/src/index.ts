import Fastify from 'fastify'
import { setupHttpMetrics, getWorkerMetrics } from './observability.js'
import os from 'os'
import { getTextGen, MODEL_ID } from './model.js'
import { startSwarm } from './swarm.js'

const app = Fastify({ logger: true })
setupHttpMetrics(app)
const PORT = Number(process.env.WORKER_PORT || 6000)
app.log.info({ model: MODEL_ID }, 'Worker starting with Transformers.js')
const { inferRequestsTotal, inferFailuresTotal, inferDurationSeconds } = getWorkerMetrics()

app.get('/health', async () => ({
  status: 'ok',
  service: 'worker',
  cpu_percent: os.loadavg()[0],
  memory: { total: os.totalmem(), free: os.freemem() }
}))

app.post('/infer', async (req, reply) => {
  try {
    const body = (await req.body) as any
    const prompt: string = body?.prompt ?? body?.input ?? ''
    const modelId: string = (typeof body?.model === 'string' && body.model.trim()) ? body.model.trim() : MODEL_ID
    const max_tokens: number = typeof body?.max_tokens === 'number' ? body.max_tokens : 128
    const temperature: number = typeof body?.temperature === 'number' ? body.temperature : 0.2
    const top_p: number = typeof body?.top_p === 'number' ? body.top_p : 0.9
    const top_k: number = typeof body?.top_k === 'number' ? body.top_k : 50
    const repetition_penalty: number = typeof body?.repetition_penalty === 'number' ? body.repetition_penalty : 1.1
    const modeRaw: string | undefined = typeof body?.mode === 'string' ? body.mode : undefined
    const mode: 'direct' | 'chat' = (modeRaw && modeRaw.toLowerCase().trim() === 'chat') ? 'chat' : 'direct'

    if (!prompt || typeof prompt !== 'string') {
      reply.code(400)
      return { error: 'Missing prompt/input' }
    }

    const messages = Array.isArray(body?.messages) ? body.messages : null
    const history = messages
      ? (mode === 'chat'
          ? messages.map((m: any) => `${(m.role ?? 'user').toUpperCase()}: ${m.content ?? ''}`).join('\n')
          : messages.map((m: any) => String(m.content ?? '')).filter(Boolean).join('\n'))
      : ''
    const chatPrompt = (mode === 'chat'
      ? [history, `USER: ${prompt}`, 'ASSISTANT:']
      : [history, prompt])
      .filter(Boolean)
      .join('\n')

    inferRequestsTotal.add(1, { model: modelId, mode })
    const start = process.hrtime.bigint()
    const pipe = await getTextGen(modelId)
    const out = await pipe(chatPrompt, {
      max_new_tokens: max_tokens,
      temperature,
      top_p,
      top_k,
      repetition_penalty,
      do_sample: temperature > 0,
      return_full_text: false
    })
    const durationNs = Number(process.hrtime.bigint() - start)
    inferDurationSeconds.record(durationNs / 1e9, { model: modelId, mode })
    let text = Array.isArray(out) ? (out[0]?.generated_text ?? '') : String(out)
    if (text.startsWith(chatPrompt)) {
      text = text.slice(chatPrompt.length)
    }
    text = text.replace(/\s+/g, ' ').trim()

    return {
      model: modelId,
      output: text,
      max_tokens,
      mode,
      provider: 'huggingface-transformers'
    }
  } catch (err: any) {
    req.log.error({ err, model: MODEL_ID }, 'Inference error')
    inferFailuresTotal.add(1, { model: MODEL_ID })
    reply.code(500)
    return { error: 'Inference failed', details: String(err) }
  }
})

app.listen({ host: '0.0.0.0', port: PORT }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})

// Start Hyperswarm presence and message routing
startSwarm(getTextGen, MODEL_ID, PORT).catch((err) => {
  app.log.warn({ err }, 'Hyperswarm initialization failed')
})