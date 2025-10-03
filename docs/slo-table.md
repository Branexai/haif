# Service Level Objectives

The table below defines initial SLOs per model tier, focusing on latency and availability targets. These numbers are illustrative and should be refined with real metrics. Service‑level indicators (SLIs) include P50/P95 latency, success rate, throttle rate, and stale‑cache rate.

| Model class     | Description                                                     | P50 latency (ms) | P95 latency (ms) | Availability target |
|-----------------|-----------------------------------------------------------------|------------------|------------------|---------------------|
| Small           | Embedding/classification; CPU‑only or low‑end GPU              | 200              | 500              | ≥99.5%              |
| Medium          | ~7B models; mid‑range GPU                                       | 800              | 1500             | ≥99.0%              |
| Large           | 13B+ models; high‑end GPU (A100/3090)                           | 2000             | 3000             | ≥98.5%              |
| Token streaming | Long‑running generation; latency measured per 1 k tokens        | 50/tok           | 100/tok          | ≥99.0%              |

These SLOs act as starting points; adjust them based on empirical performance data and user expectations. The orchestrator should enforce error budgets and throttle or shed requests when SLOs risk being breached.