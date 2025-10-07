# HAIF – C4 Model — Context

Related layers: [Containers](./c4-containers.md) • [Components](./c4-components.md) • [Code](./c4-code.md)

## 1) C4 – Context Diagram

```plantuml
@startuml Context-HAIF
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Context.puml

LAYOUT_WITH_LEGEND()
SHOW_LEGEND(true)

skinparam shadowing false
skinparam rectangle {
  roundCorner 12
}

' People
Person(client, "API Client / SDK", "Product teams integrating inference APIs")
Person(devops, "HAIF Operator", "Runs/observes the platform; manages rollouts and quotas")

' System under design
System_Boundary(haif, "HAIF – AI Inference Network") {
System(haifplat, "HAIF Platform", "P2P orchestration + model execution at the edge/workers")
}

' External systems
System_Ext(artifact, "Model Artifact Store", "Object storage (e.g., S3/Hypercore)")
System_Ext(observ, "Observability Stack", "OTel traces, metrics TSDB, logs")
System_Ext(billing, "Billing/IAM Provider", "Tenants, authN/Z, usage reporting")

Rel(client, tethplat, "Submit inference request / receive result", "HTTP via HTTP Bridge or RPC via Gateway")
Rel(devops, tethplat, "Operate, configure, rollout", "HTTP/CLI")
Rel(tethplat, artifact, "Pull model weights/adapters", "Content-addressed, signed")
Rel(tethplat, observ, "Export traces/metrics/logs", "OTel exporters / remote-write")
Rel(tethplat, billing, "Usage & quota checks", "Async usage export / token validation")

SHOW_LEGEND()
@enduml
```

### Notes

* **Transport (current)**: Inter-service communication uses **Hyperswarm RPC (@hyperswarm/rpc)** between **Gateway ↔ Orchestrator ↔ Worker**. External clients interact over **HTTP** via the dedicated **HTTP Bridge**.
* **Execution**: **Workers** load models locally and execute inference; the **Orchestrator** maps and dispatches RPC requests to Workers.

---

### Service Discovery & Communication (current)

Gateway forwards requests to the Orchestrator over **Hyperswarm RPC**. The Orchestrator calls Workers over **Hyperswarm RPC**. Correlation IDs and traces propagate via **OpenTelemetry** across services. The **HTTP Bridge** exposes a simple REST surface that translates to RPC for browser and external clients.

### Data Storage & Replication

Metadata (jobs, quotas, tokens) resides in a region‑scoped PostgreSQL cluster with read replicas and asynchronous cross‑region replication. Model artifacts live in a content‑addressed object store (e.g., S3/Hypercore) with ≥3 replicas and signature verification at Workers. Error/poison messages go to a DLQ (Redis/Queue) for analysis.

### Scalability & Robustness

Horizontal scalability via multiple Gateways/Orchestrators per region and elastic Worker fleets across GPU/CPU classes. Robustness through circuit‑breakers, retries with exponential backoff, idempotent reservations, and regional failover. Sharding by model/tenant/region keeps hot paths isolated and enables targeted scaling.

### Local AI Execution

AI models are executed locally on the selected Worker. Artifacts are fetched, verified, and loaded into the Worker’s runtime (PyTorch/vLLM), leveraging local GPU/CPU; warm caches minimize cold‑start latency.