# Tether – C4 Model — Components

Related layers: [Context](./c4-context.md) • [Containers](./c4-containers.md) • [Code](./c4-code.md)

## 3) Service Discovery over Hyperswarm (design write‑up)

**Goals**: zero single‑point‑of‑failure, fast worker discovery, and resilient routing under churn.

### 3.1 Announce & Discover

* **Workers** announce presence on `tether/presence/<region>` with:

  * `workerId`, `pubKey`, `gpuClass`, `capacity`, `supported {modelId, version}`, `latencyHops`.
  * Signed heartbeat every *T=5s*; expiry window *3×T*.
* **Model availability**: Workers also subscribe/announce on model‑specific topics `tether/models/<model>/<version>/<region>` to simplify targeted discovery.
* **Orchestrator** maintains an **eventually‑consistent view** of fleet health from topic messages; **strong decisions** (quotas, reservations) are written to **Metadata Store**.

### 3.2 Scheduling & Backpressure

* **Affinity score** per request: `(model match) + (region proximity) + (gpuClass match) + (queueDepth inverse) + (warmCache bonus)`.
* **Backpressure**: token‑bucket at **Gateway** (per tenant) + **queue depth thresholds** at workers → if exceeded, **shed** or **degrade** (return lower‑latency model/params when policy allows).
* **Retries**: exponential backoff with **retryToken** (idempotency) and **circuit‑breaker** trips per model/region.

### 3.3 Security

* Node **keypairs**; presence and model announcements are **signed** and **nonce‑protected** to mitigate replay.
* Transport encryption via Hyperswarm’s crypto; optional end‑to‑end payload encryption per tenant policy.

### 3.4 Model Artifacts

* **Content‑addressed** (digest) with signatures; **N≥3** replicas.
* Workers **verify signatures** before load; support **warm pools** & **on‑the‑fly adapter merges** (e.g., LoRA) with cache eviction by LRU + size budget.

### 3.5 Observability & SLOs

* **Trace every request** (correlationId, traceId) via Gateway → Orchestrator → Worker.
* SLIs: P50/P95 latency by model, success rate, throttle rate, stale‑cache rate.
* **Error budgets** gate rollouts (progressive canary on workers via control topic).

---

## 6) C4 – Component Diagram: Orchestrator/Scheduler

```plantuml
@startuml Component-Orchestrator
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Component.puml

LAYOUT_WITH_LEGEND()
SHOW_LEGEND(true)

Container_Boundary(orch, "Orchestrator/Scheduler") {
  Component(discSub, "DiscoverySub", "Node.js/TypeScript", "Hyperswarm DHT peer discovery and health checks")
  Component(scheduler, "Scheduler", "Node.js/TypeScript", "Model capability matching and load balancing")
  Component(policy, "Policy Engine", "Node.js/TypeScript", "Quota, rate limit, model routing policies")
  Component(cb, "Circuit Breaker", "Node.js/TypeScript", "Failure detection using opossum library")
  Component(retry, "Retry Manager", "Node.js/TypeScript", "Exponential backoff with p-retry")
  Component(resv, "Reservation Manager", "Node.js/TypeScript", "Reserves capacity; writes job state to Metadata Store")
}

Container_Ext(gateway, "RPC Gateway", "Edge Adapter")
Container_Ext(worker, "Inference Worker", "ModelRuntime")
ContainerDb_Ext(meta, "Metadata Store", "Postgres/SQLite-cluster")
ContainerQueue_Ext(dlq, "Error Queue / DLQ", "Queue")

Rel(gateway, scheduler, "Dispatch request", "RPC over Hyperswarm")
Rel(discSub, scheduler, "Fleet snapshot (in‑memory cache)")
Rel(scheduler, policy, "Evaluate policy/quotas")
Rel(scheduler, cb, "Check breaker state")
Rel(scheduler, retry, "Plan retries/backoff")
Rel(scheduler, resv, "Reserve capacity; persist job", "SQL")
Rel(resv, meta, "Write job + reservation", "SQL")
Rel(scheduler, worker, "Assign job / stream chunks", "RPC topics")
Rel(scheduler, dlq, "Poison/failed jobs → enqueue")

SHOW_LEGEND()
@enduml
```

**Notes**

* `DiscoverySub` subscribes to `tether/presence/<region>` and `tether/models/<model>/<version>/<region>`.
* `Scheduler` ranks candidates using: region proximity, gpuClass, warmCache, queueDepth, breaker state, tenant policy.
* `Reservation Manager` ensures idempotency via `(correlationId, retryToken)` and persists state before dispatch.

---

## 7) C4 – Component Diagram: Inference Worker

```plantuml
@startuml Component-Worker
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Component.puml

LAYOUT_WITH_LEGEND()
SHOW_LEGEND(true)

Container_Boundary(worker, "Inference Worker") {
  Component(base, "BaseWorker", "Node.js/TypeScript", "Hyperswarm RPC endpoint handler")
  Component(loader, "ModelLoader", "Python", "Dynamic model loading with transformers/torch")
  Component(exec, "ExecutionEngine", "Python", "GPU/CPU inference with vLLM or PyTorch")
  Component(health, "HealthReporter", "Python", "GPU memory and CPU usage tracking")
  Component(quota, "QuotaGuard", "Node.js/TypeScript", "Per‑tenant limits; local backpressure")
}

Container_Ext(orch, "Orchestrator/Scheduler")
Container_Ext(artifact, "Model Artifact Store", "S3/Hypercore")

Rel(orch, base, "infer() RPC", "Hyperswarm topic")
Rel(loader, artifact, "Fetch by digest; verify sig", "HTTPS/P2P")
Rel(health, orch, "Announce on presence + model topics")
Rel(exec, base, "Stream chunks → Gateway via Orchestrator")
Rel(quota, base, "Check local tokens / shed if needed")

SHOW_LEGEND()
@enduml
```

**Notes**

* `HealthReporter` publishes every **5s**; worker expires after **15s** silence.
* `ModelLoader` pins hot models; eviction policy **LRU + VRAM budget**; adapters can be merged on load.
* `ExecutionEngine` supports **graceful stop** on shutdown; in‑flight jobs finalize or reroute.

### Node.js/TypeScript Implementation Details

#### Orchestrator Components
* **DiscoverySub**: Uses `hyperswarm` DHT for peer discovery, maintains worker registry in memory with periodic health checks
* **Scheduler**: Implements weighted round-robin and capability-based routing using custom scoring algorithms
* **Policy Engine**: Rule-based system with JSON configuration, supports rate limiting via `bottleneck` library
* **Circuit Breaker**: Implements the circuit breaker pattern using `opossum` with configurable thresholds
* **Retry Manager**: Exponential backoff retry logic using `p-retry` with jitter and maximum attempts
* **Reservation Manager**: PostgreSQL integration via `pg` for job state persistence and capacity tracking

#### Worker Components  
* **BaseWorker**: HTTP/RPC server using `hyperswarm` for P2P communication, handles authentication and routing
* **QuotaGuard**: Token bucket rate limiting per tenant, integrates with Redis for distributed quotas

#### Python ML Components
* **ModelLoader**: Dynamic model loading using `transformers`, `torch`, and `accelerate` libraries
* **ExecutionEngine**: Inference execution with `vLLM` for LLMs or direct PyTorch for other models
* **HealthReporter**: System monitoring using `psutil` and `pynvml` for GPU metrics

### Key Interactions