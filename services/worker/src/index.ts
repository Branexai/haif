import RPC from '@hyperswarm/rpc'
import os from 'os'
import { getTextGen, MODEL_ID } from './model.js'

const rpc = new (RPC as any)()
const server = rpc.createServer()
await server.listen()

server.respond('health', async () => {
  return Buffer.from(JSON.stringify({
    status: 'ok',
    service: 'worker',
    cpu_percent: os.loadavg()[0],
    memory: { total: os.totalmem(), free: os.freemem() }
  }))
})

server.respond('infer', async (req: any) => {
  try {
    const body = JSON.parse(Buffer.isBuffer(req) ? req.toString('utf8') : String(req))
    const prompt: string = body?.prompt ?? body?.input ?? ''
    const modelId: string = (typeof body?.model === 'string' && body.model.trim()) ? body.model.trim() : MODEL_ID
    const max_tokens: number = typeof body?.max_tokens === 'number' ? body.max_tokens : 128
    const temperature: number = typeof body?.temperature === 'number' ? body.temperature : 0.2
    const messages = Array.isArray(body?.messages) ? body.messages : null
    const modeRaw: string | undefined = typeof body?.mode === 'string' ? body.mode : undefined
    const mode: 'direct' | 'chat' = (modeRaw && modeRaw.toLowerCase().trim() === 'chat') ? 'chat' : 'direct'

    if (!prompt || typeof prompt !== 'string') {
      return Buffer.from(JSON.stringify({ error: 'Missing prompt/input' }))
    }

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

    const pipe = await getTextGen(modelId)
    const out = await pipe(chatPrompt, {
      max_new_tokens: max_tokens,
      temperature,
      return_full_text: false
    })
    let text = Array.isArray(out) ? (out[0]?.generated_text ?? '') : String(out)
    if (text.startsWith(chatPrompt)) {
      text = text.slice(chatPrompt.length)
    }
    text = text.replace(/\s+/g, ' ').trim()

    const result = {
      model: modelId,
      output: text,
      max_tokens,
      mode,
      provider: 'huggingface-transformers'
    }
    return Buffer.from(JSON.stringify(result))
  } catch (err: any) {
    return Buffer.from(JSON.stringify({ error: 'Inference failed', details: String(err) }))
  }
})

const orchestratorPkHex = process.env.ORCHESTRATOR_PUBLIC_KEY
if (orchestratorPkHex) {
  try {
    const client = rpc.connect(Buffer.from(orchestratorPkHex, 'hex'))
    await client.request('register-worker', Buffer.from(JSON.stringify({
      publicKeyHex: (server as any).publicKey.toString('hex'),
      model: MODEL_ID,
      capabilities: ['text-generation']
    })))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Worker failed to register with orchestrator:', err)
  }
}

console.log('Worker RPC public key:', (server as any).publicKey.toString('hex'))