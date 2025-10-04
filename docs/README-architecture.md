# Architecture at a Glance

This overview summarizes the Tether AI inference network and ties together the C4 Context, Container, Component, and Code (Deployment & Sequence) views in the `docs/` folder.

## Technology Stack

**Tether** is built using a modern, polyglot architecture optimized for AI inference workloads:

### Core Technologies (current)
- **Node.js/TypeScript**: Primary runtime for Gateway, Orchestrator, Registry, Worker
- **Hyperswarm RPC (`@hyperswarm/rpc`)**: Inter‑service communication between **Gateway ↔ Orchestrator ↔ Worker**
- **HTTP Bridge (Fastify + CORS)**: Public HTTP surface translating to RPC for browsers/clients
- **JavaScript Transformers**: Local inference via `@huggingface/transformers` in Worker
- **PostgreSQL**: Metadata persistence and job state management (Registry/Orchestrator)
- **Redis**: DLQ / queuing (planned)

### Key Libraries & Frameworks (current)
- **Orchestrator**: `opossum` (circuit breaker), `p-retry`, `bottleneck` (rate limiting), `node-fetch`
- **Gateway**: `fastify`, `@fastify/cors`, `@fastify/helmet`, `p-retry`, `bottleneck`, `node-fetch`
- **Registry**: `fastify`, `pg`, `zod`
- **Worker**: `Hyperswarm RPC`, `@huggingface/transformers`
- **Observability**: `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-prometheus`
- **Optional (Firebase)**: Firebase Auth for tenant identity and Firestore for lightweight metadata/quotas in small deployments

## Overview

Tether currently uses **Hyperswarm RPC** between services (Gateway, Orchestrator, Worker), with **OpenTelemetry** for observability. It includes an HTTP Bridge, RPC Gateway, Orchestrator/Scheduler, Model Registry, Metadata Store, and regional Worker endpoints.

- Clients submit inference requests to the Gateway.
- The Gateway routes to the Orchestrator over RPC.
- The Orchestrator handles discovery, scheduling, quota checks, and dispatches jobs to Workers.
- Workers run models locally, fetch signed artifacts from a content‑addressed store, and report health/capacity.

---

## Summary

**Service Discovery & Communication**
- Services communicate over **Hyperswarm RPC**. The HTTP Bridge forwards requests to Gateway; Orchestrator invokes Workers over RPC.

**Data Storage & Replication**
- PostgreSQL serves as the regional Metadata Store with read replicas and cross‑region replication for DR. Model artifacts are content‑addressed, signed, and replicated (≥3). DLQ captures poison messages in Redis/Queue for analysis.

**Scalability & Robustness**
- Horizontal scale across Gateways/Orchestrators and elastic Worker fleets. Robustness via circuit‑breakers, jittered retries, idempotent reservations, and sharding by model/tenant/region.

**Local AI Execution**
- AI models run locally on Workers (PyTorch/vLLM), using local GPU/CPU; warm caches reduce cold‑start latency.

## Key Concepts

- Communication: Hyperswarm RPC between services; streaming via RPC topics.
- Scheduling & backpressure: Per-tenant rate limits at Gateway (Bottleneck); retries with jitter at Gateway/Orchestrator (p-retry); circuit breaking at Orchestrator (opossum).
- Security: HTTPS/TLS where configured; optional end-to-end payload encryption planned.
- Artifacts: Content-addressed model artifacts verified and cached at Workers (where applicable).
- Observability: Correlation IDs and traces via OpenTelemetry; metrics exposed via Prometheus exporters.

## Components

- Orchestrator: DiscoverySub, Scheduler, Policy Engine, Circuit Breaker, Retry Manager, Reservation Manager.
- Worker: BaseWorker, ModelLoader, ExecutionEngine, HealthReporter, QuotaGuard.

## Deployment

Regional Gateways and Orchestrators; region‑scoped Metadata Stores with replication; Workers across GPU/CPU classes.

Observability per region includes OTel Collector, Prometheus (metrics), Loki (logs), Grafana (dashboards), and Alertmanager (alerts), with Promtail shipping logs from services.

## Diagrams

- Context: see [docs/c4-context.md](./c4-context.md).
- Containers: see [docs/c4-containers.md](./c4-containers.md).
- Components: see [docs/c4-components.md](./c4-components.md).
- Code (Deployment & Sequence): see [docs/c4-code.md](./c4-code.md).

Use PlantUML to render the PlantUML blocks found in the documents.