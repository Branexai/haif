# Gateway Service

Fastify-based HTTP gateway that validates requests and proxies to the orchestrator. Optional Firebase Auth integration via environment variables.

## Run
- `npm install && npm run dev`
- Env: `PORT=3000`, `ORCHESTRATOR_URL=http://localhost:4000`, `FIREBASE_PROJECT_ID` (optional)