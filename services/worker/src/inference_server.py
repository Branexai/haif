"""
Inference Worker – Pilot Version

Minimal FastAPI server exposing /health and /infer endpoints. Structured to follow PEP-8 and production-ready patterns.
"""

from __future__ import annotations

from typing import Any, Dict
import os
from fastapi import FastAPI
from pydantic import BaseModel
import psutil

# Optional OpenAI integration for real inference
OPENAI_CLIENT = None
try:
    from openai import OpenAI  # type: ignore

    # Client reads OPENAI_API_KEY from environment
    OPENAI_CLIENT = OpenAI()
except Exception:
    OPENAI_CLIENT = None


app = FastAPI(title="Tether Worker", version="0.1.0")


class InferRequest(BaseModel):
    model: str
    prompt: str
    max_tokens: int = 128


@app.get("/health")
def health() -> Dict[str, Any]:
    """
    Basic health endpoint reporting CPU and memory usage.
    """
    return {
        "status": "ok",
        "cpu_percent": psutil.cpu_percent(interval=0.1),
        "memory": psutil.virtual_memory()._asdict(),
    }


@app.post("/infer")
def infer(req: InferRequest) -> Dict[str, Any]:
    """
    Pilot inference echo. Replace with real model execution (vLLM/PyTorch).
    """
    # If OpenAI client is configured, attempt real inference
    if OPENAI_CLIENT is not None and (os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_ACCESS_TOKEN")):
        try:
            model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
            # Use Chat Completions for broad compatibility
            resp = OPENAI_CLIENT.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": req.prompt}],
                max_tokens=req.max_tokens,
            )
            text = resp.choices[0].message.content if resp and resp.choices else ""
            return {
                "model": req.model,
                "output": text,
                "max_tokens": req.max_tokens,
                "provider": "openai",
            }
        except Exception as e:
            # Fallback to echo on any provider error
            return {
                "model": req.model,
                "output": f"Echo (provider error fallback): {req.prompt[:200]}",
                "max_tokens": req.max_tokens,
                "error": str(e),
            }

    # Default fallback: echo behavior
    return {
        "model": req.model,
        "output": f"Echo: {req.prompt[:200]}",
        "max_tokens": req.max_tokens,
        "provider": "echo",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=6000)