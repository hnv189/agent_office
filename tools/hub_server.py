#!/usr/bin/env python3
"""
Hub server — HuggingFace search, download, and status endpoints for
the Agent Playground Model Hub tab.

Run alongside lora-finetune (which stays on 8000):
    pip install fastapi uvicorn requests huggingface_hub
    python tools/hub_server.py             # default: 127.0.0.1:8001
    python tools/hub_server.py --port 8001 --host 0.0.0.0

Then set Model Hub → Configuration → Hub Server URL to http://localhost:8001
"""
import argparse
import os
import threading
from pathlib import Path

try:
    import requests
    from fastapi import BackgroundTasks, FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
except ImportError:
    raise SystemExit("Missing deps — run:  pip install fastapi uvicorn requests huggingface_hub")

app = FastAPI(title="Agent Playground Hub Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── download state ─────────────────────────────────────────────────────────────
_dl_lock = threading.Lock()
_dl_status: dict = {"status": "idle", "model": None, "progress": None, "speed": None}


# ── endpoints ──────────────────────────────────────────────────────────────────
@app.post("/api/hub/search")
async def hub_search(body: dict):
    """Relay HuggingFace model search through the configured HTTP proxy."""
    proxies = _make_proxies(body.get("http_proxy"))
    hf_base = (body.get("hf_endpoint") or "https://huggingface.co").rstrip("/")
    try:
        r = requests.get(
            f"{hf_base}/api/models",
            params={
                "search": body.get("query", ""),
                "limit": int(body.get("limit", 24)),
                "sort": "downloads",
                "direction": -1,
                "full": False,
            },
            proxies=proxies,
            timeout=15,
        )
        r.raise_for_status()
        return JSONResponse(r.json())
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)


@app.post("/api/hub/download")
async def hub_download(body: dict, background_tasks: BackgroundTasks):
    """Queue a background snapshot_download from HuggingFace."""
    repo_id = (body.get("repo_id") or "").strip()
    if not repo_id:
        return JSONResponse({"error": "repo_id required"}, status_code=400)
    with _dl_lock:
        if _dl_status.get("status") == "downloading":
            return JSONResponse({"error": "A download is already in progress"}, status_code=409)
        _dl_status.update({"status": "downloading", "model": repo_id, "progress": None, "speed": None})
    background_tasks.add_task(_do_download, repo_id, body)
    return {"status": "started", "repo_id": repo_id}


@app.get("/api/hub/download/status")
async def hub_download_status():
    return dict(_dl_status)


# ── download worker ────────────────────────────────────────────────────────────
def _make_proxies(proxy_url: str | None) -> dict | None:
    if not proxy_url:
        return None
    return {"http": proxy_url, "https": proxy_url}


def _do_download(repo_id: str, body: dict) -> None:
    try:
        from huggingface_hub import snapshot_download

        proxy_url = body.get("http_proxy") or ""
        hf_endpoint = body.get("hf_endpoint") or ""
        proxies = _make_proxies(proxy_url)

        # patch env so huggingface_hub internals also respect the proxy
        env_patch: dict = {}
        if proxy_url:
            env_patch["HTTP_PROXY"] = proxy_url
            env_patch["HTTPS_PROXY"] = proxy_url
        if hf_endpoint:
            env_patch["HF_ENDPOINT"] = hf_endpoint

        saved = {k: os.environ.get(k) for k in env_patch}
        os.environ.update(env_patch)

        local_dir = Path("models") / repo_id.replace("/", "--")
        local_dir.mkdir(parents=True, exist_ok=True)

        try:
            snapshot_download(
                repo_id=repo_id,
                local_dir=str(local_dir),
                proxies=proxies,
            )
            with _dl_lock:
                _dl_status.update({"status": "done", "model": repo_id, "progress": 1.0, "speed": None})
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    except Exception as exc:
        with _dl_lock:
            _dl_status.update({"status": "error", "model": repo_id, "error": str(exc)})


# ── entry point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description="Agent Playground Hub Server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8001, help="Bind port (default 8001)")
    args = parser.parse_args()

    print(f"Hub server → http://{args.host}:{args.port}")
    print("Set Model Hub → Configuration → Hub Server URL to this address.")
    uvicorn.run(app, host=args.host, port=args.port)
