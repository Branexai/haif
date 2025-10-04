import Fastify from 'fastify'
import { z } from 'zod'

const app = Fastify({ logger: true })
const PORT = Number(process.env.PORT || 5000)

const ModelSchema = z.object({
  name: z.string(),
  version: z.string(),
  capabilities: z.array(z.string()).optional()
})

app.get('/health', async () => ({ status: 'ok', service: 'registry' }))

app.post('/models', async (req, reply) => {
  const parse = ModelSchema.safeParse(await req.body)
  if (!parse.success) {
    reply.code(400)
    return { error: 'Invalid model metadata', details: parse.error.format() }
  }
  return { status: 'accepted', model: parse.data }
})

app.listen({ host: '0.0.0.0', port: PORT }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})