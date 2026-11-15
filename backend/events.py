"""Event schema and in-process event bus feeding the SSE stream."""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

EventType = Literal["task_started", "message", "tool_call", "task_done", "error", "final"]

LABEL_MAX = 80
HISTORY_MAX = 500      # events of the current run kept for clients that connect late
QUEUE_MAX = 1000       # per-client buffer; a client that falls this far behind loses events


@dataclass(frozen=True, slots=True)
class Event:
    type: EventType
    agent: str
    label: str
    target: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    ts: float = field(default_factory=time.time)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, default=str)


class EventBus:
    """Fan-out of events to every connected SSE client. Single event loop, no locking needed."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[Event]] = set()
        self._history: list[Event] = []

    def start_run(self) -> None:
        """Forget the previous run: late clients only get the current one replayed."""
        self._history.clear()

    def emit(
        self,
        type: EventType,
        agent: str,
        label: str,
        *,
        target: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> Event:
        """Publish one event now. Never raises and never blocks the caller."""
        event = Event(type=type, agent=agent, label=label[:LABEL_MAX], target=target, payload=payload or {})
        if len(self._history) < HISTORY_MAX:
            self._history.append(event)
        for queue in self._subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                pass  # slow client: drop for that client only
        return event

    def subscribe(self) -> asyncio.Queue[Event]:
        """New client queue, pre-filled with the current run so a page reload shows it."""
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=QUEUE_MAX)
        for event in self._history:
            queue.put_nowait(event)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[Event]) -> None:
        self._subscribers.discard(queue)
