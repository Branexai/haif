import RPC from '@hyperswarm/rpc'
import pRetry from 'p-retry'
import os from 'os'
import fs from 'fs'
import Fastify from 'fastify'
import fetch from 'node-fetch'
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

// Minimal HTTP server to allow orchestrator fallback when RPC is unstable
const http = Fastify({ logger: true })
const HTTP_PORT = Number(process.env.WORKER_HTTP_PORT || process.env.WORKER_PORT || 6000)
http.post('/infer', async (req, reply) => {
  try {
    const body: any = await req.body
    const prompt: string = body?.prompt ?? body?.input ?? ''
    const modelId: string = (typeof body?.model === 'string' && body.model.trim()) ? body.model.trim() : MODEL_ID
    const max_tokens: number = typeof body?.max_tokens === 'number' ? body.max_tokens : 128
    const temperature: number = typeof body?.temperature === 'number' ? body.temperature : 0.2
    const messages = Array.isArray(body?.messages) ? body.messages : null
    const modeRaw: string | undefined = typeof body?.mode === 'string' ? body.mode : undefined
    const mode: 'direct' | 'chat' = (modeRaw && modeRaw.toLowerCase().trim() === 'chat') ? 'chat' : 'direct'

    if (!prompt || typeof prompt !== 'string') {
      reply.code(400)
      return { error: 'Missing prompt/input' }
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
    return result
  } catch (err: any) {
    reply.code(500)
    return { error: 'Inference failed', details: String(err) }
  }
})
http.get('/health', async () => ({ status: 'ok', service: 'worker-http' }))
http.listen({ host: '0.0.0.0', port: HTTP_PORT }).catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Worker HTTP server failed to start', err)
  process.exit(1)
})

function readPkFromFile(): string | undefined {
  const pkFile = process.env.ORCHESTRATOR_PK_FILE || '/shared/orchestrator_pk.txt'
  try {
    const s = fs.readFileSync(pkFile, 'utf8').trim()
    if (s && /^[0-9a-fA-F]+$/.test(s)) return s
  } catch {}
  return undefined
}

async function registerWithOrchestrator(orchestratorPkHex: string) {
  const pk = orchestratorPkHex?.trim()
  if (!pk) return

  // Validate that provided key is a hex-encoded 32-byte public key
  try {
    const buf = Buffer.from(pk, 'hex')
    if (buf.length !== 32) {
      // eslint-disable-next-line no-console
      console.warn('Invalid ORCHESTRATOR_PUBLIC_KEY length; expected 32 bytes')
      return
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Invalid ORCHESTRATOR_PUBLIC_KEY (not hex?)')
    return
  }

  const selfPkHex = (server as any).publicKey.toString('hex')
  const payload = Buffer.from(JSON.stringify({
    publicKeyHex: selfPkHex,
    model: MODEL_ID,
    capabilities: ['text-generation']
  }))

  const retries = Number(process.env.WORKER_REG_RETRIES || 3)
  const minMs = Number(process.env.WORKER_REG_MIN_MS || 1000)
  const maxMs = Number(process.env.WORKER_REG_MAX_MS || 8000)

  // First attempt HTTP registration (more reliable)
  try {
    const url = process.env.ORCHESTRATOR_HTTP_URL || 'http://orchestrator:4000/register-worker'
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        publicKeyHex: selfPkHex,
        model: MODEL_ID,
        capabilities: ['text-generation']
      })
    })
    const data: any = await res.json()
    if (data?.status === 'ok') {
      // eslint-disable-next-line no-console
      console.log('Worker registered with orchestrator via HTTP')
      return // Success, no need for RPC fallback
    }
  } catch (httpErr) {
    // eslint-disable-next-line no-console
    console.warn('HTTP registration failed, trying RPC:', httpErr)
  }

  // Fallback to RPC with enhanced error handling
  await pRetry(async () => {
    const client = rpc.connect(Buffer.from(pk, 'hex'))
    try {
      // Add connection timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout')), 10000)
      })

      // Wait for channel to be ready with timeout
      if (typeof (client as any).fullyOpened === 'function') {
        await Promise.race([
          (client as any).fullyOpened(),
          timeoutPromise
        ])
      }
      
      if ((client as any).closed) throw new Error('RPC channel closed before request')
      
      const resBuf = await Promise.race([
        client.request('register-worker', payload),
        timeoutPromise
      ])
      
      const json = Buffer.isBuffer(resBuf) ? resBuf.toString('utf8') : String(resBuf)
      const out = JSON.parse(json)
      if (!out || out.status !== 'ok') {
        throw new Error('Registration failed')
      }
      // eslint-disable-next-line no-console
      console.log('Worker registered with orchestrator via RPC (pk:', pk.slice(0, 8), '...)')
    } finally {
      try { 
        if (typeof (client as any).end === 'function') {
          await (client as any).end()
        } else {
          (client as any).destroy?.()
        }
      } catch {}
    }
  }, {
    retries,
    factor: 2,
    minTimeout: minMs,
    maxTimeout: maxMs,
    randomize: true,
    onFailedAttempt: (err: any) => {
      const msg = String(err?.message || err)
      const code = (err as any)?.code || ''
      // eslint-disable-next-line no-console
      console.warn(`RPC registration attempt failed (${code || 'no-code'}): ${msg}`)
    }
  })
}

const orchestratorPkEnv = process.env.ORCHESTRATOR_PUBLIC_KEY
const orchestratorPk = (orchestratorPkEnv && orchestratorPkEnv.trim()) ? orchestratorPkEnv.trim() : (readPkFromFile() || '')
if (orchestratorPk) {
  registerWithOrchestrator(orchestratorPk).catch(async (err) => {
    // eslint-disable-next-line no-console
    console.warn('Worker registration failed completely:', err)
    
    // Set up periodic retry for registration
    const retryInterval = setInterval(async () => {
      try {
        await registerWithOrchestrator(orchestratorPk)
        clearInterval(retryInterval)
        // eslint-disable-next-line no-console
        console.log('Worker registration retry succeeded')
      } catch (retryErr) {
        // eslint-disable-next-line no-console
        console.warn('Registration retry failed, will try again in 30s')
      }
    }, 30000) // Retry every 30 seconds
  })
  // Periodically re-register to recover from orchestrator restarts
  setInterval(() => {
    registerWithOrchestrator(orchestratorPk).catch(() => {})
  }, Number(process.env.WORKER_REREG_INTERVAL_MS || 60000))
} else {
  // eslint-disable-next-line no-console
  console.warn('Worker: Orchestrator public key not set and pk file missing; skipping registration')
}

console.log('Worker RPC public key:', (server as any).publicKey.toString('hex'))