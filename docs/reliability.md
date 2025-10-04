Reliability Hardening for Prompt Inference

- Upstream circuit-open or timeout conditions now return `503 Service Unavailable` with `Retry-After: 5` from `http-bridge` to clearly signal temporary overload.
- Circuit breaker defaults were increased to better fit inference workloads:
  - Orchestrator: `BREAKER_TIMEOUT_MS=30000`, `BREAKER_ERROR_THRESHOLD=80`, `BREAKER_RESET_TIMEOUT_MS=30000`.
  - Gateway/Bridge: `*_BREAKER_TIMEOUT_MS=15000`, `*_BREAKER_ERROR_THRESHOLD=80`, `*_BREAKER_RESET_TIMEOUT_MS=30000`.
- Tenant-level rate limiting and request scheduling remain in place to prevent overload.
- Orchestrator returns `status:"failed"` with `error:"No workers available"` when no worker is registered; the bridge maps this to HTTP `503`.

Operational Guidance

- Tune breaker timeouts to match your average inference latency. For large models, 20–60s may be appropriate.
- If you consistently see `503` during load, scale workers horizontally or reduce `TENANT_RATE_LIMIT_RPS`/`TENANT_MAX_CONCURRENT`.
- Use Prometheus metrics exposed by each service (see `observability` configs) to monitor breaker open/close events and request durations.

References

- Circuit breaker behavior and options: nodeshift/opossum documentation.