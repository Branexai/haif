# Architecture at a Glance

This overview summarizes the Tether AI inference network and ties together the C4 Context, Container, Component, and Code (Deployment & Sequence) views in the `docs/` folder.

## Overview

Tether is a decentralized inference network built on Hyperswarm. It includes an RPC Gateway, Orchestrator/Scheduler, Model Registry, Metadata Store, DLQ, Observability exporters, and regional Worker fleets.

- Clients submit inference requests to the Gateway.
- The Gateway routes to the Orchestrator over Hyperswarm topics.
- The Orchestrator handles discovery, scheduling, quota checks, and dispatches jobs to Workers.
- Workers run models locally, fetch signed artifacts from a content‑addressed store, and report health/capacity.

## Key Concepts

- Hyperswarm topics: presence `tether/presence/<region>`, models `tether/models/<model>/<version>/<region>`, control `tether/control/<region>`.
- Service discovery: Workers publish signed heartbeats every 5 s; expire after 15 s. Orchestrator subscribes to presence/model topics to maintain fleet state.
- Scheduling & backpressure: Affinity score considers model match, region proximity, GPU class, queue depth, warm‑cache bonus. Token‑bucket at Gateway; queue‑depth thresholds at Workers.
- Security: Node keypairs sign announcements; transport encryption via Hyperswarm. Optional tenant end‑to‑end payload encryption.
- Artifacts: S3‑compatible store, addressed by digest and signed; Workers verify and maintain warm caches.
- Observability: Correlation IDs and trace IDs on all requests; export via OpenTelemetry to external aggregators.

## Components

- Orchestrator: DiscoverySub, Scheduler, Policy Engine, Circuit Breaker, Retry Manager, Reservation Manager.
- Worker: BaseWorker, ModelLoader, ExecutionEngine, HealthReporter, QuotaGuard.

## Deployment

Regional Gateways and Orchestrators; region‑scoped Metadata Stores with replication; Workers across GPU/CPU classes.

## Diagrams

- Context: see [docs/c4-context.md](./c4-context.md).
- Containers: see [docs/c4-containers.md](./c4-containers.md).
- Components: see [docs/c4-components.md](./c4-components.md).
- Code (Deployment & Sequence): see [docs/c4-code.md](./c4-code.md).

Use PlantUML to render the PlantUML blocks found in the documents.