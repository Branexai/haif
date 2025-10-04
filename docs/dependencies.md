# Dependencies and Integrations (Declared Versions)

This document lists the declared dependency versions and how they integrate within each service of the project. Versions reflect `package.json` declarations and may resolve to newer patch releases via semver.

## Gateway (`services/gateway`)

- Transport & orchestration
  - `@hyperswarm/rpc` ^3.0.0 — RPC server/client
  - `bottleneck` ^2.19.5 — Per‑tenant rate limiting
  - `p-retry` ^5.1.2 — Jittered retries
  - `opossum` ^6.3.0 — Circuit breaker
  - `node-fetch` ^3.3.2 — Utility HTTP client (ancillary)
- Observability
  - `@opentelemetry/api` ^1.8.0
  - `@opentelemetry/sdk-node` ^0.50.0
  - `@opentelemetry/auto-instrumentations-node` ^0.50.0
  - `@opentelemetry/exporter-trace-otlp-http` ^0.50.0
  - `@opentelemetry/exporter-prometheus` ^0.50.0

## Orchestrator (`services/orchestrator`)

- Runtime
  - `@hyperswarm/rpc` ^3.0.0 — RPC server/client
  - `pg` ^8.11.3 — PostgreSQL access (metadata/jobs)
  - `ioredis` ^5.3.2 — DLQ/queue (future usage)
  - `opossum` ^6.3.0 — Circuit breaker around worker calls
  - `p-retry` ^5.1.2 — Jittered retries
  - `bottleneck` ^2.19.5 — Scheduling throughput limiting
  - `fastify` ^4.25.0 — Optional HTTP utilities
- Observability
  - `@opentelemetry/api` ^1.8.0
  - `@opentelemetry/sdk-node` ^0.50.0
  - `@opentelemetry/auto-instrumentations-node` ^0.50.0
  - `@opentelemetry/exporter-trace-otlp-http` ^0.50.0
  - `@opentelemetry/exporter-prometheus` ^0.50.0

## Registry (`services/registry`)

- Runtime
  - `@hyperswarm/rpc` ^3.0.0 — RPC server/client
  - `pg` ^8.11.3 — PostgreSQL access
  - `zod` ^3.22.2 — Request and schema validation
- Observability
  - `@opentelemetry/api` ^1.8.0
  - `@opentelemetry/sdk-node` ^0.50.0
  - `@opentelemetry/auto-instrumentations-node` ^0.50.0
  - `@opentelemetry/exporter-trace-otlp-http` ^0.50.0
  - `@opentelemetry/exporter-prometheus` ^0.50.0

## Worker (`services/worker`)

- Runtime
  - `@hyperswarm/rpc` ^3.0.0 — RPC server
  - `hyperswarm` ^4.0.2 — Peer discovery/topics
  - `@huggingface/transformers` ^3.0.0 — Local inference
- Observability
  - `@opentelemetry/api` ^1.8.0
  - `@opentelemetry/sdk-node` ^0.50.0
  - `@opentelemetry/auto-instrumentations-node` ^0.50.0
  - `@opentelemetry/exporter-trace-otlp-http` ^0.50.0
  - `@opentelemetry/exporter-prometheus` ^0.50.0

## HTTP Bridge (`services/http-bridge`)

- Runtime
  - `fastify` ^4.25.0 — HTTP server
  - `@fastify/cors` ^8.3.0 — CORS
  - `@hyperswarm/rpc` ^3.0.0 — RPC client to Orchestrator
  - `bottleneck` ^2.19.5 — Per‑tenant rate limiting
  - `opossum` ^6.3.0 — Circuit breaker
  - `p-retry` ^5.1.2 — Jittered retries

## Example Apps

- Web Chat (`examples/web-chat`)
  - `vite` ^5.0.0 — Dev server and bundler

## Observability Stack (Compose images)

- Prometheus `prom/prometheus:latest` — `:9090`
- Loki `grafana/loki:2.9.0` — `:3100`
- Promtail `grafana/promtail:2.9.0`
- Jaeger `jaegertracing/all-in-one:1.46` — UI `:16686`, OTLP `:4318`
- PlantUML server `plantuml/plantuml-server:jetty` — exposed at `:8085`

## Notes

- Communication: **Hyperswarm RPC** between internal services (Gateway ↔ Orchestrator ↔ Worker). **HTTP** is exposed via the **HTTP Bridge** for external clients.
- TLS: OTLP traces endpoint configurable; secure reverse proxy recommended for the HTTP Bridge in production.
- Semver: Declared versions use caret ranges; resolved versions may differ based on lockfiles.