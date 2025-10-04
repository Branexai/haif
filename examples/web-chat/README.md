# Inference Web Chat

Simple web UI that simulates a chat with the inference cluster via the HTTP Bridge.

## Features
- Send a message and view the Orchestrator scheduling response.
- Configure Gateway URL.

## Run
```
npm --prefix examples/web-chat install
 npm --prefix examples/web-chat run dev
```

Open the printed local URL (usually `http://localhost:5173/`). Ensure the backend is running:
```
docker compose up -d
```

Gateway URL (HTTP Bridge) defaults to `http://localhost:8080`. Update the field in the UI if different.