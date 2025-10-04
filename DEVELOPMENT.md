# Development Guide

## Overview
- This pilot implements gateway, orchestrator, registry (Node.js/TypeScript) and a Python worker, aligning with the C4 architecture. CI pipelines and Dockerfiles reside under `CI/`.

## Quick Start
- `docker compose up -d` to start all services
- Gateway: `http://localhost:3000`
- Orchestrator: `http://localhost:4000`
- Registry: `http://localhost:5000`
- Worker: `http://localhost:6000/health`

## Observability
- The stack includes Prometheus, Grafana, Loki (with Promtail), and Jaeger.
- Added Alertmanager for routing Prometheus alerts and OpenTelemetry Collector for trace fan-out.
- Metrics are exposed via OpenTelemetry Prometheus exporter on port `9464` in each service.
- Prometheus UI: `http://localhost:9090` (scrapes `gateway`, `orchestrator`, `registry`, `worker`).
- Grafana UI: `http://localhost:3001` (pre-provisioned datasources for Prometheus, Loki, Jaeger).
- Jaeger UI: `http://localhost:16686` (receives OTLP traces from services).
- Logs: Promtail scrapes Docker container logs and ships to Loki.

Additional UIs
- Alertmanager: `http://localhost:9093`

Trace Routing
- Services export traces to `otel-collector` (`http://tether-otel-collector:4318/v1/traces`), which forwards to Jaeger.

Environment
- `SERVICE_NAME`: Sets OpenTelemetry service name per container.
- `OTEL_PROMETHEUS_PORT` and `OTEL_PROMETHEUS_ENDPOINT`: Control metrics endpoint.
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`: OTLP HTTP endpoint for traces (default `http://jaeger:4318/v1/traces`).

## Linting
- Node services use ESLint with StandardJS rules; Python uses Flake8.

<!-- Firebase references removed -->

## Translation
- Documentation is English-only. Translation workflows may be added if needed.