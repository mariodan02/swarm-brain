"""FastAPI app: POST /task starts a run, GET /events streams its events (SSE), / serves the frontend.

Run from the project root:
    uvicorn backend.main:app --port 5173 --timeout-graceful-shutdown 2
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import AsyncIterator, Coroutine
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.events import EventBus
from backend.llm import CONFIG_PATH, ConfigError, LLMGateway, load_settings
from backend.orchestrator import Orchestrator
from backend.simulator import run_simulation

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

MODE = os.getenv("MODE", "live").strip().lower()
if MODE not in {"live", "simulated"}:
    raise RuntimeError(f"MODE must be 'live' or 'simulated', got {MODE!r}")
# SWARM_CONFIG points to another config file (used by tests); default is backend/config.yaml.
CONFIG = Path(os.getenv("SWARM_CONFIG") or CONFIG_PATH)

KEEPALIVE_SECONDS = 15.0

log = logging.getLogger("swarm-brain")
app = FastAPI(title="Swarm Brain")
bus = EventBus()
_run: asyncio.Task[None] | None = None
_gateway: LLMGateway | None = None  # one per process: its limiters are global


class TaskRequest(BaseModel):
    goal: str = Field(min_length=3, max_length=400)


def _running() -> bool:
    return _run is not None and not _run.done()


def _live_gateway() -> LLMGateway:
    """Build the gateway on first use and check that every agent can really call its model."""
    global _gateway
    if _gateway is None:
        _gateway = LLMGateway(load_settings(CONFIG), bus.emit)
    _gateway.settings.check_live()
    return _gateway


async def _guard(run: Coroutine[Any, Any, None]) -> None:
    """Run one task; any failure becomes a fatal `error` event instead of killing the stream."""
    try:
        await run
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 - last line of defence for the run
        log.exception("run failed")
        bus.emit("error", "orchestrator", f"Errore interno: {type(exc).__name__}", payload={"fatal": True})


@app.get("/status")
async def status() -> dict[str, Any]:
    return {"mode": MODE, "running": _running(), "now": time.time()}


@app.post("/task", status_code=202)
async def start_task(req: TaskRequest) -> dict[str, str]:
    global _run
    goal = req.goal.strip()
    if len(goal) < 3:
        raise HTTPException(422, "Obiettivo troppo corto")
    if _running():
        raise HTTPException(409, "Un compito è già in corso")
    if MODE == "simulated":
        run = run_simulation(goal, bus)
    else:
        try:
            run = Orchestrator(_live_gateway(), bus).run(goal)
        except ConfigError as exc:
            # Not ready for real calls: say why, never fall back to fake output.
            raise HTTPException(503, str(exc)) from None
    bus.start_run()
    _run = asyncio.create_task(_guard(run))
    return {"status": "started", "mode": MODE}


@app.get("/events")
async def events() -> StreamingResponse:
    async def stream() -> AsyncIterator[str]:
        queue = bus.subscribe()
        try:
            yield "retry: 2000\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), KEEPALIVE_SECONDS)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"  # keeps proxies from closing an idle stream
                    continue
                yield f"data: {event.to_json()}\n\n"
        finally:
            bus.unsubscribe(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# Last: everything not matched above is a frontend file.
app.mount("/", StaticFiles(directory=ROOT / "frontend", html=True), name="frontend")
