# Inference CLI Demo

## What it does
- Sends a request to the Gateway (`/infer`) which proxies to the Orchestrator (`/schedule`) and returns a planned dispatch response.

## Prerequisites
- Ensure the stack is running (`docker compose up -d`). The Gateway listens on `3000` by default.

## Install
```
npm --prefix examples/cli install
```

## Run
- Simple text input
```
npm --prefix examples/cli run infer -- "Hello world"
```

- JSON payload (uses payload as-is)
```
GATEWAY_URL=http://localhost:3000 npm --prefix examples/cli run infer -- '{"input":"Hello"}'
```

<!-- Firebase references removed -->