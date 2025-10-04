import Fastify from 'fastify'
import { setupHttpMetrics } from './observability.js'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import fetch from 'node-fetch'
// Firebase removed

const app = Fastify({ logger: true })
// Observability: metrics and log correlation
setupHttpMetrics(app)
const PORT = Number(process.env.PORT || 3000)
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://tether-orchestrator:4000'

// Firebase Admin initialization removed

app.register(cors)
app.register(helmet)

app.get('/health', async () => ({ status: 'ok', service: 'gateway' }))

app.post('/infer', async (req, reply) => {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/schedule`, { method: 'POST', body: JSON.stringify(await req.body), headers: { 'content-type': 'application/json' } })
    const data = await res.json()
    return data
  } catch (err) {
    app.log.error({ err }, 'Error proxying to orchestrator')
    reply.code(502)
    return { error: 'Bad Gateway' }
  }
})

app.listen({ host: '0.0.0.0', port: PORT }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})