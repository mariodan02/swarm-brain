"""MODE=simulated: a realistic sequence of events with random timings. No LLM is called."""
from __future__ import annotations

import asyncio
import random
from typing import TypedDict

from backend.events import EventBus


class SimTask(TypedDict):
    id: str
    agent: str
    deps: list[str]
    title: str


PLAN: list[SimTask] = [
    {"id": "t1", "agent": "researcher", "deps": [], "title": "Raccogli le informazioni di base"},
    {"id": "t2", "agent": "researcher", "deps": [], "title": "Approfondisci un secondo aspetto"},
    {"id": "t3", "agent": "memory", "deps": ["t1", "t2"], "title": "Sintetizza il contesto condiviso"},
    {"id": "t4", "agent": "executor", "deps": ["t3"], "title": "Scrivi la bozza della risposta"},
    {"id": "t5", "agent": "critic", "deps": ["t4"], "title": "Controlla qualità e coerenza"},
]
MAX_PARALLEL = 3


async def run_simulation(goal: str, bus: EventBus) -> None:
    """Emit the events of one fake run. Every payload that could be mistaken for real is marked."""
    with_error = random.random() < 0.5

    async def llm(agent: str, what: str, *, retry_once: bool = False) -> None:
        bus.emit("tool_call", agent, f"LLM ▸ {what}", payload={"tool": "llm", "phase": "start", "simulated": True})
        if retry_once:
            await asyncio.sleep(random.uniform(0.5, 0.9))
            bus.emit(
                "error", agent, "429 rate limit · nuovo tentativo tra 2 s",
                payload={"fatal": False, "status": 429, "simulated": True},
            )
            await asyncio.sleep(2.0)
        await asyncio.sleep(random.uniform(1.2, 3.2))
        prompt, completion = random.randint(250, 900), random.randint(120, 650)
        bus.emit(
            "tool_call", agent, f"LLM ◂ {prompt + completion} token",
            payload={
                "tool": "llm", "phase": "end", "simulated": True,
                "tokens": {"prompt": prompt, "completion": completion, "total": prompt + completion},
            },
        )

    async def subtask(task: SimTask) -> None:
        tid, agent, title = task["id"], task["agent"], task["title"]
        bus.emit("message", "orchestrator", f"Assegna {tid}: {title}", target=agent, payload={"task": tid})
        await asyncio.sleep(random.uniform(0.3, 0.6))
        for dep in task["deps"]:
            source = next(t["agent"] for t in PLAN if t["id"] == dep)
            if source != agent:
                bus.emit("message", source, f"Passa il risultato di {dep}", target=agent, payload={"task": dep})
        bus.emit("task_started", agent, f"{tid} · {title}", payload={"task": tid})
        await llm(agent, title, retry_once=with_error and tid == "t2")
        bus.emit("task_done", agent, f"{tid} completato", payload={"task": tid})
        bus.emit("message", agent, f"Risultato {tid}", target="orchestrator", payload={"task": tid})

    bus.emit("task_started", "orchestrator", f"Obiettivo: {goal}", payload={"goal": goal, "simulated": True})
    await asyncio.sleep(0.6)
    bus.emit("message", "orchestrator", "Richiesta piano", target="planner")
    await asyncio.sleep(0.4)
    bus.emit("task_started", "planner", "Scomposizione in sotto-compiti")
    await llm("planner", "piano JSON")
    bus.emit("task_done", "planner", f"Piano pronto: {len(PLAN)} sotto-compiti", payload={"plan": PLAN})
    bus.emit("message", "planner", "Piano consegnato", target="orchestrator")
    await asyncio.sleep(0.5)

    # Same rule the real orchestrator will follow: wait for dependencies, at most 3 at once.
    done = {task["id"]: asyncio.Event() for task in PLAN}
    slots = asyncio.Semaphore(MAX_PARALLEL)

    async def schedule(task: SimTask) -> None:
        for dep in task["deps"]:
            await done[dep].wait()
        async with slots:
            await subtask(task)
        done[task["id"]].set()

    await asyncio.gather(*(schedule(task) for task in PLAN))

    # One revision round asked by the critic.
    await asyncio.sleep(0.4)
    bus.emit("message", "critic", "Revisione richiesta", target="executor")
    await asyncio.sleep(0.4)
    bus.emit("task_started", "executor", "Revisione della bozza")
    await llm("executor", "revisione")
    bus.emit("task_done", "executor", "Bozza rivista")
    bus.emit("message", "executor", "Versione finale", target="orchestrator")
    await asyncio.sleep(0.7)

    plan_lines = "\n".join(f"  {t['id']}  {t['agent']:<11} {t['title']}" for t in PLAN)
    bus.emit(
        "final", "orchestrator", "Risultato finale pronto",
        payload={
            "simulated": True,
            "result": (
                "[SIMULATO] Nessun modello è stato chiamato.\n\n"
                f"Obiettivo: {goal}\n\n"
                "Questa sequenza di eventi è generata dal simulatore del backend (MODE=simulated). "
                "Il testo che leggi è un segnaposto, non un risultato.\n\n"
                f"Piano simulato:\n{plan_lines}"
            ),
        },
    )
