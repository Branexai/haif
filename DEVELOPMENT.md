# Development Guide

## Overview
- This pilot implements gateway, orchestrator, registry (Node.js/TypeScript) and a Python worker, aligning with the C4 architecture. CI pipelines and Dockerfiles reside under `CI/`.

## Quick Start
- `docker compose up -d` to start all services
- Gateway: `http://localhost:3000`
- Orchestrator: `http://localhost:4000`
- Registry: `http://localhost:5000`
- Worker: `http://localhost:6000/health`

## Linting
- Node services use ESLint with StandardJS rules; Python uses Flake8.

## Firebase (Optional)
- Token validation can integrate with Firebase Auth. Configure `FIREBASE_PROJECT_ID` via environment variables. Do not commit secrets.

## Translation
- Documentation is English-only. Translation workflows may be added if needed.