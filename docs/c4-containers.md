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
  Container(gateway, "RPC Gateway", "Node.js/TypeScript", "Edge adapter: validates, normalizes, rate-limits, emits trace context; Hyperswarm RPC")
  Container(orch, "Orchestrator/Scheduler", "Node.js/TypeScript", "Discovers workers, matches requests, retries, circuit-breakers")
  Container(reg, "Model Registry", "Node.js/TypeScript", "Catalog of models, versions, capabilities, policies")
  ContainerDb(meta, "Metadata Store", "PostgreSQL", "Jobs, quotas, tokens, indexes; strongly-consistent")
  ContainerQueue(dlq, "Error Queue / DLQ", "Node.js/Redis", "Failed jobs, poison messages for analysis")
  Container(obsagent, "Observability Exporters", "Node.js/TypeScript", "OTel traces, metrics, logs")

  Boundary(region, "Worker Fleet (by Region)") {
    Container(worker, "Inference Worker", "Python + Node.js", "Runs models locally (CPU/GPU), exposes infer()")
  }

  Container(httpbridge, "HTTP Bridge", "Node.js/TypeScript", "REST adapter that forwards to RPC Gateway")
}

System_Ext(artifact, "Model Artifact Store", "S3/Hypercore", "Content-addressed, signed")
System_Ext(observ, "Observability Stack", "Prometheus/Grafana/Loki/Alertmanager/OTel Collector/Promtail")
System_Ext(otel, "OTel Collector", "Aggregation/Processing")
System_Ext(prom, "Prometheus", "Metrics TSDB")
System_Ext(graf, "Grafana", "Dashboards/Visualization")
System_Ext(loki, "Loki", "Logs TSDB")
System_Ext(alert, "Alertmanager", "Alerting/On-call")
System_Ext(promtail, "Promtail", "Log Shipping")
System_Ext(billing, "Billing/IAM Provider", "Tenant auth, quotas, usage export")

' Client paths
Rel(client, httpbridge, "Submit inference, receive result", "HTTP (REST/JSON)")
Rel(httpbridge, gateway, "Forward request", "RPC (@hyperswarm/rpc)")
Rel(gateway, orch, "Route request, attach policy/tenant", "RPC (@hyperswarm/rpc)")
Rel(orch, worker, "Dispatch job; reserve capacity; process request", "RPC (@hyperswarm/rpc)")

' Control/data paths
Rel(orch, reg, "Query model capabilities/policies", "RPC")
Rel(reg, meta, "Read/write model metadata", "SQL")
Rel(orch, meta, "Jobs, tokens, quotas, reservations", "SQL")
Rel(worker, artifact, "Fetch model weights/adapters (digest)", "HTTPS/P2P")
Rel(obsagent, otel, "Export traces/metrics/logs", "OTel / remote-write")
Rel(otel, prom, "Remote write metrics", "OTel metrics pipeline")
Rel(otel, loki, "Remote write logs", "OTel logs pipeline")
Rel(gateway, promtail, "Ship logs", "Promtail")
Rel(orch, promtail, "Ship logs", "Promtail")
Rel(worker, promtail, "Ship logs", "Promtail")
Rel(prom, graf, "Visualize metrics", "Dashboards")
Rel(loki, graf, "Visualize logs", "Dashboards")
Rel(prom, alert, "Alert rules", "Alerting")
Rel(alert, devops, "Notify incidents", "On-call")
Rel(orch, dlq, "Push failed jobs/poison msgs", "Enqueue")
Rel(gateway, billing, "Validate token / report usage (async)", "HTTP/RPC")
Rel(orch, billing, "Periodic usage export", "Batch")

SHOW_LEGEND()
@enduml
```

### Technology Stack Specifications

* **HTTP Bridge**: Node.js/TypeScript with Fastify + CORS; translates HTTP requests to RPC calls
* **Gateway**: Node.js/TypeScript with `@hyperswarm/rpc`; rate limiting via `bottleneck`; retries via `p-retry`; circuit breaking via `opossum`
* **Orchestrator**: Node.js/TypeScript with `@hyperswarm/rpc`; persistence via `pg` to PostgreSQL; optional Fastify utilities
* **Model Registry**: Node.js/TypeScript with `@hyperswarm/rpc`; validation with `zod`
* **Metadata Store**: PostgreSQL with `pg` and connection pooling
* **DLQ**: Redis with Node.js client (`ioredis`) for queue management and retry logic
* **Observability**: OpenTelemetry SDK (`@opentelemetry/api`, `@opentelemetry/sdk-node`), exporters for Prometheus and OTLP traces
* **Workers**: Hyperswarm RPC server for inference; local AI via `@huggingface/transformers`

### Key Contracts & Topics (for labels in diagrams/readme)

* (Planned) Hyperswarm Topics

  * Presence: `tether/presence/<region>`
  * Models: `tether/models/<model>/<version>/<region>`
  * Control: `tether/control/<region>`
* **RPC Contracts** (high level)

  * `Infer.Request { tenantId, modelId, version, input, correlationId, retryToken, traceId }`
  * `Infer.Chunk { correlationId, seq, payload, done }`
  * `Health.Report { workerId, capacity, gpuClass, modelCache }`

---

### Service Discovery & Communication

Gateways and Orchestrators communicate over Hyperswarm RPC topics. Workers announce presence and model capabilities; Orchestrators maintain a regional snapshot and dispatch requests to Workers over per‑request topics with backpressure and streaming. Transport is encrypted and announcements are signed.

### Data Storage & Replication

PostgreSQL (Metadata Store) is deployed per region: primary with read replicas; asynchronous cross‑region replication for disaster recovery. The Model Registry persists validated metadata and policies in the same store. Model artifacts are content‑addressed (digest) in S3/Hypercore with ≥3 replicas and signed; Workers verify and cache locally (LRU + size budget). DLQ uses Redis or a queue service for failed jobs.

### Scalability & Robustness

Horizontal scale with multiple Gateways/Orchestrators per region and elastic Worker pools. Fault tolerance via circuit‑breakers, jittered exponential retries, idempotent reservations, and DLQ. Sharding by model/tenant/region, plus warm caches on Workers, reduces tail latency and isolates hotspots.

### Local AI Execution

Workers run models locally using PyTorch/vLLM, leveraging available GPU/CPU. Artifacts are pulled and verified before loading; streaming results flow back to Gateway via Orchestrator under policy.