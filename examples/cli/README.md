# Inference CLI Demo

## What it does
- Sends a request to the HTTP Bridge (`/infer`), which translates the call to the RPC Gateway/Orchestrator and returns the scheduling/dispatch response.

## Prerequisites
- Ensure the stack is running (`docker compose up -d`). The HTTP Bridge listens on `8080` by default.

## Install
```
npm --prefix examples/cli install
```

## Run
- Simple text input
```
npm --prefix examples/cli run infer -- "Hello world"
```

-- JSON payload (uses payload as-is)
```
GATEWAY_URL=http://localhost:8080 npm --prefix examples/cli run infer -- '{"input":"Hello"}'
```

<!-- Firebase references removed -->