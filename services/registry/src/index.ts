import RPC from '@hyperswarm/rpc'

const rpc = new RPC()
const server = rpc.createServer()
await server.listen()

type Model = { name: string, version: string, capabilities?: string[] }
const models = new Map<string, Model>()

server.respond('health', async () => {
  return Buffer.from(JSON.stringify({ status: 'ok', service: 'registry' }))
})

server.respond('register-model', async (req: any) => {
  try {
    const body = JSON.parse(Buffer.isBuffer(req) ? req.toString('utf8') : String(req))
    const name: string = body?.name
    const version: string = body?.version
    const capabilities: string[] | undefined = Array.isArray(body?.capabilities) ? body.capabilities : undefined
    if (!name || !version) throw new Error('Missing name/version')
    models.set(name, { name, version, capabilities })
    return Buffer.from(JSON.stringify({ status: 'ok', model: { name, version, capabilities } }))
  } catch (err: any) {
    return Buffer.from(JSON.stringify({ error: 'Invalid model payload', details: String(err) }))
  }
})

server.respond('list-models', async () => {
  return Buffer.from(JSON.stringify({ models: Array.from(models.values()) }))
})

console.log('Registry RPC public key:', server.publicKey.toString('hex'))