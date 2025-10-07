import Hyperswarm from 'hyperswarm'
import crypto from 'crypto'
// Removed unused import

function topicHash(name: string): Buffer {
  return crypto.createHash('sha256').update(name).digest()
}

type GetPipe = () => Promise<any>

export async function startSwarm(getPipe: GetPipe, modelId: string, port: number) {
  const presenceTopicName = process.env.HYPERSWARM_PRESENCE_TOPIC || 'haif-presence'
  const modelTopicName = process.env.HYPERSWARM_MODEL_TOPIC || `haif-model-${modelId}`

  const swarm = new Hyperswarm()

  const presenceTopic = topicHash(presenceTopicName)
  const modelTopic = topicHash(modelTopicName)

  swarm.join(presenceTopic, { announce: true, lookup: true })
  swarm.join(modelTopic, { announce: true, lookup: true })

  swarm.on('connection', (conn: any, info: any) => {
    try {
      const announce = {
        type: 'presence',
        service: 'worker',
        model: modelId,
        port,
        peer: info.publicKey?.toString('hex')
      }
      conn.write(Buffer.from(JSON.stringify(announce) + '\n'))
    } catch {}

    let buffer = ''
    conn.on('data', async (data: Buffer) => {
      try {
        buffer += data.toString('utf8')
        let idx
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 1)
          if (!line.trim()) continue
          const msg = JSON.parse(line)
          if (msg?.type === 'infer.start') {
            const prompt: string = msg?.prompt ?? ''
            const maxTokens: number = typeof msg?.max_tokens === 'number' ? msg.max_tokens : 128
            const temperature: number = typeof msg?.temperature === 'number' ? msg.temperature : 0.7
            const modeRaw: string | undefined = typeof msg?.mode === 'string' ? msg.mode : undefined
            const mode: 'direct' | 'chat' = (modeRaw && modeRaw.toLowerCase().trim() === 'chat') ? 'chat' : 'direct'
            const messages = Array.isArray(msg?.messages) ? msg.messages : null

            const chatPrompt = (() => {
              if (mode === 'chat') {
                const parts = messages
                  ? messages.map((m: any) => `${(m.role ?? 'user').toUpperCase()}: ${m.content ?? ''}`)
                  : []
                return [...parts, `USER: ${prompt}`, 'ASSISTANT:'].join('\n')
              }
              // direct
              const history = messages
                ? messages.map((m: any) => String(m.content ?? '')).filter(Boolean).join('\n')
                : ''
              return [history, prompt].filter(Boolean).join('\n')
            })()

            const pipe = await getPipe()
            const out = await pipe(chatPrompt, { max_new_tokens: maxTokens, temperature })
            const text = Array.isArray(out) ? (out[0]?.generated_text ?? '') : String(out)

            const result = {
              type: 'infer.result',
              correlationId: msg?.correlationId,
              model: modelId,
              output: text,
              max_tokens: maxTokens
            }
            conn.write(Buffer.from(JSON.stringify(result) + '\n'))
          }
        }
      } catch (err) {
        try {
          conn.write(Buffer.from(JSON.stringify({ type: 'error', error: String(err) }) + '\n'))
        } catch {}
      }
    })
  })
}