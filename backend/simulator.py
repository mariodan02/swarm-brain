"""MODE=simulated: a realistic sequence of events with random timings. No LLM is called."""
from __future__ import annotations

import asyncio
import random
from typing import TypedDict

from backend.events import EventBus
from backend.texts import t


class SimTask(TypedDict):
    id: str
    agent: str
    deps: list[str]
    title: str


MAX_PARALLEL = 3


def make_plan(lang: str) -> list[SimTask]:
    return [
        {"id": "t1", "agent": "researcher", "deps": [], "title": t(lang, "sim_t1")},
        {"id": "t2", "agent": "researcher", "deps": [], "title": t(lang, "sim_t2")},
        {"id": "t3", "agent": "memory", "deps": ["t1", "t2"], "title": t(lang, "sim_t3")},
        {"id": "t4", "agent": "executor", "deps": ["t3"], "title": t(lang, "sim_t4")},
        {"id": "t5", "agent": "critic", "deps": ["t4"], "title": t(lang, "sim_t5")},
    ]


async def run_simulation(goal: str, bus: EventBus, lang: str = "it") -> None:
    """Emit the events of one fake run. Every payload that could be mistaken for real is marked."""
    with_error = random.random() < 0.5
    plan = make_plan(lang)

    async def llm(agent: str, what: str, *, retry_once: bool = False) -> None:
        bus.emit("tool_call", agent, f"LLM ▸ {what}", payload={"tool": "llm", "phase": "start", "simulated": True})
        if retry_once:
            await asyncio.sleep(random.uniform(0.5, 0.9))
            bus.emit(
                "error", agent, t(lang, "sim_429"),
                payload={"fatal": False, "status": 429, "simulated": True},
            )
            await asyncio.sleep(2.0)
        await asyncio.sleep(random.uniform(1.2, 3.2))
        prompt, completion = random.randint(250, 900), random.randint(120, 650)
        bus.emit(
            "tool_call", agent, t(lang, "llm_tokens", n=prompt + completion),
            payload={
                "tool": "llm", "phase": "end", "simulated": True,
                "tokens": {"prompt": prompt, "completion": completion, "total": prompt + completion},
            },
        )

    async def subtask(task: SimTask) -> None:
        tid, agent, title = task["id"], task["agent"], task["title"]
        bus.emit("message", "orchestrator", t(lang, "assign", id=tid, task=title), target=agent, payload={"task": tid})
        await asyncio.sleep(random.uniform(0.3, 0.6))
        for dep in task["deps"]:
            source = next(p["agent"] for p in plan if p["id"] == dep)
            if source != agent:
                bus.emit("message", source, t(lang, "pass", id=dep), target=agent, payload={"task": dep})
        bus.emit("task_started", agent, f"{tid} · {title}", payload={"task": tid})
        await llm(agent, title, retry_once=with_error and tid == "t2")
        bus.emit("task_done", agent, t(lang, "done", id=tid), payload={"task": tid})
        bus.emit("message", agent, t(lang, "result", id=tid), target="orchestrator", payload={"task": tid})

    bus.emit("task_started", "orchestrator", t(lang, "goal", goal=goal), payload={"goal": goal, "simulated": True})
    await asyncio.sleep(0.6)
    bus.emit("message", "orchestrator", t(lang, "ask_plan"), target="planner")
    await asyncio.sleep(0.4)
    bus.emit("task_started", "planner", t(lang, "planning"))
    await llm("planner", t(lang, "p_plan"))
    bus.emit("task_done", "planner", t(lang, "plan_ready", n=len(plan)), payload={"plan": plan})
    bus.emit("message", "planner", t(lang, "plan_sent"), target="orchestrator")
    await asyncio.sleep(0.5)

    # Same rule the real orchestrator will follow: wait for dependencies, at most 3 at once.
    done = {task["id"]: asyncio.Event() for task in plan}
    slots = asyncio.Semaphore(MAX_PARALLEL)

    async def schedule(task: SimTask) -> None:
        for dep in task["deps"]:
            await done[dep].wait()
        async with slots:
            await subtask(task)
        done[task["id"]].set()

    await asyncio.gather(*(schedule(task) for task in plan))

    # One revision round asked by the critic.
    await asyncio.sleep(0.4)
    bus.emit("message", "critic", t(lang, "revise_asked"), target="executor")
    await asyncio.sleep(0.4)
    bus.emit("task_started", "executor", t(lang, "revising"))
    await llm("executor", t(lang, "p_revision"))
    bus.emit("task_done", "executor", t(lang, "revised"))
    bus.emit("message", "executor", t(lang, "final_version"), target="orchestrator")
    await asyncio.sleep(0.7)

    plan_lines = "\n".join(f"  {p['id']}  {p['agent']:<11} {p['title']}" for p in plan)
    bus.emit(
        "final", "orchestrator", t(lang, "final_ready"),
        payload={"simulated": True, "result": t(lang, "sim_result", goal=goal, plan=plan_lines)},
    )
