"""Orchestrator: plan -> run sub-tasks (dependencies respected, at most 3 at once) -> critic ->
at most one revision -> final result. Plain code, no model call of its own.

Every state change is emitted as an event at the moment it happens.
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass

from backend.agents import AGENTS, WORKERS
from backend.events import EventBus
from backend.llm import ConfigError, LimitExceeded, LLMError, LLMGateway, LLMResult, RunBudget
from backend.texts import t

MAX_SUBTASKS = 6
MAX_PARALLEL = 3
CONTEXT_CHARS = 6000   # each earlier result is cut to this length before it goes into a prompt


@dataclass(frozen=True, slots=True)
class Subtask:
    id: str
    agent: str
    task: str
    depends_on: tuple[str, ...]


class PlanError(ValueError):
    """The planner's answer is not a usable plan."""


class AgentFailure(Exception):
    """An agent could not finish; the run stops with a fatal `error` event for that agent."""

    def __init__(self, agent: str, message: str) -> None:
        super().__init__(message)
        self.agent = agent


def parse_plan(text: str) -> list[Subtask]:
    """Extract and validate the plan from the planner's answer (tolerates text around the JSON)."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise PlanError("nessun oggetto JSON nella risposta")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise PlanError(f"JSON non valido ({exc.msg})") from None
    items = data.get("subtasks") if isinstance(data, dict) else None
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_SUBTASKS:
        raise PlanError(f"'subtasks' deve essere una lista da 1 a {MAX_SUBTASKS} elementi")

    plan: list[Subtask] = []
    ids: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            raise PlanError("ogni sotto-compito deve essere un oggetto")
        tid, agent, task, deps = item.get("id"), item.get("agent"), item.get("task"), item.get("depends_on", [])
        if not isinstance(tid, str) or not tid.strip() or tid in ids:
            raise PlanError(f"id mancante o duplicato: {tid!r}")
        if agent not in WORKERS:
            raise PlanError(f"agente non ammesso per {tid}: {agent!r} (ammessi: {', '.join(WORKERS)})")
        if not isinstance(task, str) or not task.strip():
            raise PlanError(f"descrizione mancante per {tid}")
        if not isinstance(deps, list) or not all(isinstance(d, str) for d in deps):
            raise PlanError(f"depends_on di {tid} deve essere una lista di id")
        ids.add(tid)
        plan.append(Subtask(tid, agent, task.strip(), tuple(dict.fromkeys(deps))))

    for sub in plan:
        for dep in sub.depends_on:
            if dep not in ids or dep == sub.id:
                raise PlanError(f"dipendenza non valida in {sub.id}: {dep!r}")
    # Cycle check: keep removing sub-tasks whose dependencies are all resolved.
    resolved: set[str] = set()
    while len(resolved) < len(plan):
        ready = [s.id for s in plan if s.id not in resolved and set(s.depends_on) <= resolved]
        if not ready:
            raise PlanError("dipendenze circolari")
        resolved.update(ready)
    if not any(s.agent == "executor" for s in plan):
        raise PlanError("manca un sotto-compito dell'executor che produca il risultato")
    return plan


def _clip(text: str, lang: str) -> str:
    return text if len(text) <= CONTEXT_CHARS else text[:CONTEXT_CHARS] + "\n" + t(lang, "clipped")


class Orchestrator:
    def __init__(self, gateway: LLMGateway, bus: EventBus) -> None:
        self._gateway = gateway
        self._bus = bus

    async def run(self, goal: str, lang: str = "it") -> None:
        """Run one goal to the end. Never raises for agent or provider failures: they become events.

        `lang` is the language of the page that asked: it sets the labels, not the agents' answers.
        """
        emit = self._bus.emit
        budget = self._gateway.new_budget(lang)
        emit("task_started", "orchestrator", t(lang, "goal", goal=goal), payload={"goal": goal, "simulated": False})
        try:
            plan = await self._plan(goal, budget)
            results = await self._execute(goal, plan, budget)
            text, verdict, revised = await self._review(goal, plan, results, budget)
        except AgentFailure as failure:
            emit(
                "error", failure.agent, str(failure),
                payload={"fatal": True, "calls": budget.calls, "tokens": budget.total_tokens},
            )
            return
        emit(
            "final", "orchestrator", t(lang, "final_ready"),
            payload={
                "result": text + t(lang, "footer"), "simulated": False, "verdict": verdict, "revised": revised,
                "calls": budget.calls, "tokens": budget.total_tokens,
            },
        )

    async def _call(self, agent: str, messages: list[dict[str, str]], budget: RunBudget, purpose: str) -> LLMResult:
        try:
            return await self._gateway.complete(
                agent, [{"role": "system", "content": AGENTS[agent].prompt(budget.lang)}, *messages], budget, purpose=purpose
            )
        except (LLMError, LimitExceeded, ConfigError) as exc:
            raise AgentFailure(agent, str(exc)) from exc

    # ---------- 1. plan ----------

    async def _plan(self, goal: str, budget: RunBudget) -> list[Subtask]:
        emit, lang = self._bus.emit, budget.lang
        emit("message", "orchestrator", t(lang, "ask_plan"), target="planner")
        emit("task_started", "planner", t(lang, "planning"))
        messages = [{"role": "user", "content": t(lang, "u_goal", goal=goal)}]
        answer = await self._call("planner", messages, budget, t(lang, "p_plan"))
        try:
            plan = parse_plan(answer.text)
        except PlanError as first:
            # One second chance, showing the planner what was wrong.
            emit("error", "planner", t(lang, "plan_retry", reason=first), payload={"fatal": False})
            messages += [
                {"role": "assistant", "content": answer.text},
                {"role": "user", "content": t(lang, "u_plan_fix", reason=first)},
            ]
            answer = await self._call("planner", messages, budget, t(lang, "p_plan_fix"))
            try:
                plan = parse_plan(answer.text)
            except PlanError as second:
                raise AgentFailure("planner", t(lang, "plan_failed", reason=second)) from None
        emit(
            "task_done", "planner", t(lang, "plan_ready", n=len(plan)),
            payload={"plan": [{"id": s.id, "agent": s.agent, "task": s.task, "depends_on": list(s.depends_on)} for s in plan]},
        )
        emit("message", "planner", t(lang, "plan_sent"), target="orchestrator")
        return plan

    # ---------- 2. sub-tasks ----------

    async def _execute(self, goal: str, plan: list[Subtask], budget: RunBudget) -> dict[str, str]:
        emit, lang = self._bus.emit, budget.lang
        by_id = {s.id: s for s in plan}
        results: dict[str, str] = {}
        shared: list[str] = []  # what the memory agent wrote: given to every later sub-task
        finished = {s.id: asyncio.Event() for s in plan}
        slots = asyncio.Semaphore(MAX_PARALLEL)

        async def one(sub: Subtask) -> None:
            for dep in sub.depends_on:
                await finished[dep].wait()
            async with slots:
                emit("message", "orchestrator", t(lang, "assign", id=sub.id, task=sub.task), target=sub.agent, payload={"task": sub.id})
                parts = [t(lang, "u_overall", goal=goal), t(lang, "u_subtask", id=sub.id, task=sub.task)]
                if shared and sub.agent != "memory":
                    parts.append(t(lang, "u_shared") + "\n" + _clip("\n\n".join(shared), lang))
                for dep in sub.depends_on:
                    source = by_id[dep].agent
                    if source != sub.agent:
                        emit("message", source, t(lang, "pass", id=dep), target=sub.agent, payload={"task": dep})
                    parts.append(t(lang, "u_result_of", id=dep, agent=source) + "\n" + _clip(results[dep], lang))
                emit("task_started", sub.agent, f"{sub.id} · {sub.task}", payload={"task": sub.id})
                answer = await self._call(sub.agent, [{"role": "user", "content": "\n\n".join(parts)}], budget, sub.task)
                results[sub.id] = answer.text
                if sub.agent == "memory":
                    shared.append(answer.text)
                emit(
                    "task_done", sub.agent, t(lang, "done", id=sub.id) + (t(lang, "truncated") if answer.truncated else ""),
                    payload={"task": sub.id, "chars": len(answer.text), "truncated": answer.truncated},
                )
                emit("message", sub.agent, t(lang, "result", id=sub.id), target="orchestrator", payload={"task": sub.id})
            finished[sub.id].set()

        tasks = [asyncio.create_task(one(sub)) for sub in plan]
        try:
            await asyncio.gather(*tasks)
        except BaseException:
            # One sub-task failed (or the run was cancelled): stop the others before leaving.
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
        return results

    # ---------- 3. critic and one revision ----------

    async def _review(
        self, goal: str, plan: list[Subtask], results: dict[str, str], budget: RunBudget
    ) -> tuple[str, str, bool]:
        """Return (final text, critic verdict, whether a revision was made)."""
        emit, lang = self._bus.emit, budget.lang
        draft_id = [s.id for s in plan if s.agent == "executor"][-1]
        draft = results[draft_id]

        emit("message", "executor", t(lang, "to_check"), target="critic", payload={"task": draft_id})
        emit("task_started", "critic", t(lang, "checking"))
        user = f"{t(lang, 'u_goal', goal=goal)}\n\n{t(lang, 'u_draft')}\n{_clip(draft, lang)}"
        review = await self._call("critic", [{"role": "user", "content": user}], budget, t(lang, "p_check"))
        first_line = next((line for line in review.text.splitlines() if line.strip()), "").upper()
        revise = "RIVEDERE" in first_line or "REVISE" in first_line   # Italian or English prompt
        verdict = "RIVEDERE" if revise else "OK"   # payload value, the same in both languages
        emit("task_done", "critic", t(lang, "verdict_revise" if revise else "verdict_ok"), payload={"verdict": verdict})
        if not revise:
            emit("message", "critic", t(lang, "approved"), target="orchestrator")
            return draft, verdict, False

        emit("message", "critic", t(lang, "revise_asked"), target="executor")
        emit("task_started", "executor", t(lang, "revising"))
        user = (
            f"{t(lang, 'u_goal', goal=goal)}\n\n{t(lang, 'u_draft')}\n{_clip(draft, lang)}"
            f"\n\n{t(lang, 'u_notes')}\n{_clip(review.text, lang)}"
        )
        revised = await self._call("executor", [{"role": "user", "content": user}], budget, t(lang, "p_revision"))
        emit("task_done", "executor", t(lang, "revised") + (t(lang, "truncated") if revised.truncated else ""))
        emit("message", "executor", t(lang, "final_version"), target="orchestrator")
        return revised.text, verdict, True
