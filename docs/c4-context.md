# Tether – C4 Model — Context

Related layers: [Containers](./c4-containers.md) • [Components](./c4-components.md) • [Code](./c4-code.md)

## 1) C4 – Context Diagram

```plantuml
@startuml Context-Tether
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Context.puml

LAYOUT_WITH_LEGEND()
SHOW_LEGEND(true)

skinparam shadowing false
skinparam rectangle {
  roundCorner 12
}

' People
Person(client, "API Client / SDK", "Product teams integrating inference APIs")
Person(devops, "Tether Operator", "Runs/observes the platform; manages rollouts and quotas")

' System under design
System_Boundary(tether, "Tether – AI Inference Network") {
  System(tethplat, "Tether Platform", "P2P orchestration + model execution at the edge/workers")
}

' External systems
System_Ext(artifact, "Model Artifact Store", "Object storage (e.g., S3/Hypercore)")
System_Ext(observ, "Observability Stack", "OTel traces, metrics TSDB, logs")
System_Ext(billing, "Billing/IAM Provider", "Tenants, authN/Z, usage reporting")

Rel(client, tethplat, "Submit inference request / stream result", "RPC via Gateway (Hyperswarm topic)")
Rel(devops, tethplat, "Operate, configure, rollout", "CLI/UI over RPC topics")
Rel(tethplat, artifact, "Pull model weights/adapters", "Content-addressed, signed")
Rel(tethplat, observ, "Export traces/metrics/logs", "OTel exporters / remote-write")
Rel(tethplat, billing, "Usage & quota checks", "Async usage export / token validation")

SHOW_LEGEND()
@enduml
```

### Notes

* **Transport**: Core inter-service communication runs over **Hyperswarm RPC topics** (no central HTTP mesh for the critical path).
* **Execution**: **Workers** (edge nodes) load models locally and execute inference; the **Orchestrator** matches requests to healthy workers.