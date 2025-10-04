Node Worker (Transformers.js)

Overview
- Pure Node.js worker using Hugging Face Transformers.js for local inference.
- Exposes `/health` and `/infer` HTTP endpoints on port `6000`.
- Supports multi-turn chat by concatenating `messages` history.

Environment
- `MODEL_ID`: Hugging Face model id (default `Xenova/distilgpt2`).
- `WORKER_PORT`: Port to listen on (default `6000`).

Endpoints
- `GET /health`: Basic CPU and memory metrics.
- `POST /infer`: Body `{ prompt, max_tokens?, temperature?, messages? }`.

Example
```bash
curl -s http://localhost:6000/infer \
  -H 'content-type: application/json' \
  -d '{"prompt":"Hello from Node worker","max_tokens":64}'
```

Notas (PT-BR)
- Worker em Node.js usando Transformers.js para inferência local.
- Endpoints `/health` e `/infer` na porta `6000`.
- Suporte a chat multi-turno concatenando histórico (`messages`).
- Configure `MODEL_ID` para trocar o modelo facilmente.