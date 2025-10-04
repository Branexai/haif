# Tether – C4 Model — Containers

Related layers: [Context](./c4-context.md) • [Components](./c4-components.md) • [Code](./c4-code.md)

## 2) C4 – Container Diagram

```plantuml
@startuml Container-Tether
!includeurl https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml

LAYOUT_WITH_LEGEND()
SHOW_LEGEND(true)
skinparam shadowing false
skinparam roundcorner 12

Person(client, "API Client / SDK")
Person(devops, "Tether Operator")

System_Boundary(tether, "Tether – AI Inference Network") {
  Container(gateway, "RPC Gateway", "Node.js/TypeScript", "Edge adapter: validates, normalizes, rate-limits, emits trace context")
  Container(orch, "Orchestrator/Scheduler", "Node.js/TypeScript", "Discovers workers, matches requests, retries, circuit-breakers")
  Container(reg, "Model Registry", "Node.js/TypeScript", "Catalog of models, versions, capabilities, policies")
  ContainerDb(meta, "Metadata Store", "PostgreSQL", "Jobs, quotas, tokens, indexes; strongly-consistent")
  ContainerQueue(dlq, "Error Queue / DLQ", "Node.js/Redis", "Failed jobs, poison messages for analysis")
  Container(obsagent, "Observability Exporters", "Node.js/TypeScript", "OTel traces, metrics, logs")

  Boundary(region, "Worker Fleet (by Region)") {
    Container(worker, "Inference Worker", "Python + Node.js", "Runs models locally (CPU/GPU), exposes infer()")
  }
}

System_Ext(artifact, "Model Artifact Store", "S3/Hypercore", "Content-addressed, signed")
System_Ext(observ, "Observability Stack", "Prometheus/Tempo/Loki or equivalents")
System_Ext(billing, "Billing/IAM Provider", "Tenant auth, quotas, usage export")

' Client paths
Rel(client, gateway, "Submit inference, stream result", "Hyperswarm RPC")
Rel(gateway, orch, "Route request, attach policy/tenant", "Hyperswarm RPC")
Rel(orch, worker, "Dispatch job; reserve capacity; stream chunks", "Hyperswarm RPC topics")

' Control/data paths
Rel(orch, reg, "Query model capabilities/policies", "RPC")
Rel(reg, meta, "Read/write model metadata", "SQL")
Rel(orch, meta, "Jobs, tokens, quotas, reservations", "SQL")
Rel(worker, artifact, "Fetch model weights/adapters (digest)", "HTTPS/P2P")
Rel(obsagent, observ, "Export traces/metrics/logs", "OTel / remote-write")
Rel(orch, dlq, "Push failed jobs/poison msgs", "Enqueue")
Rel(gateway, billing, "Validate token / report usage (async)", "HTTP/RPC")
Rel(orch, billing, "Periodic usage export", "Batch")

SHOW_LEGEND()
@enduml
```

### Technology Stack Specifications

* **Gateway**: Node.js/TypeScript with Express.js or Fastify for HTTP/RPC handling, rate limiting via `node-rate-limiter-flexible`
* **Orchestrator**: Node.js/TypeScript with clustering support, using `hyperswarm` for P2P discovery and `pg` for PostgreSQL access
* **Model Registry**: Node.js/TypeScript service with REST API, metadata validation using Joi or Zod
* **Metadata Store**: PostgreSQL with connection pooling, migrations via Knex.js or Prisma
* **DLQ**: Redis with Node.js client (`ioredis`) for queue management and retry logic
* **Observability**: Node.js/TypeScript with `@opentelemetry/api` and exporters for Prometheus/Jaeger
* **Workers**: Python for ML inference (PyTorch, Transformers, vLLM) + Node.js for RPC communication via `hyperswarm`

### Key Contracts & Topics (for labels in diagrams/readme)

* **Topics**

  * Presence: `tether/presence/<region>`
  * Models: `tether/models/<model>/<version>/<region>`
  * Control: `tether/control/<region>`
* **RPC Contracts** (high level)

  * `Infer.Request { tenantId, modelId, version, input, correlationId, retryToken, traceId }`
  * `Infer.Chunk { correlationId, seq, payload, done }`
  * `Health.Report { workerId, capacity, gpuClass, modelCache }`