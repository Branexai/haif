import fetch from 'node-fetch'

const arg = process.argv[2]
if (!arg) {
  console.error([
    'Usage:',
    '  npm run infer -- "Hi! give the answer to the question: What is the capital of France?"',
    '  npm run infer -- "{\\"input\\":\\"Text\\"}" (JSON payload)'
  ].join('\n'))
  process.exit(1)
}

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000'
const endpoint = `${GATEWAY_URL.replace(/\/$/, '')}/infer`

// If the argument looks like JSON, use it directly; otherwise wrap in { input }
let payload
try {
  payload = JSON.parse(arg)
} catch (_) {
  payload = { input: arg }
}

const headers = { 'content-type': 'application/json' }
// Optional: include Firebase ID token if available (Gateway may validate in future)
if (process.env.FIREBASE_ID_TOKEN) {
  headers.Authorization = `Bearer ${process.env.FIREBASE_ID_TOKEN}`
}

console.log(`Posting to: ${endpoint}`)
console.log('Payload:', payload)

try {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  })
  const data = await res.json()
  console.log('\nResponse:')
  console.log(data)
} catch (err) {
  console.error('\nError calling Gateway /infer:', err)
  process.exit(1)
}