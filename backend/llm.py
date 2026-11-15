"""LLM layer: per-agent provider config, global concurrency cap, requests-per-minute limiter,
retry with exponential backoff, and per-run safety limits.

Smoke test with a real key (one call, from the project root):
    python -m backend.llm "Rispondi con una parola: ciao"
"""
from __future__ import annotations

import asyncio
import os
import random
import time
from collections import deque
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Any, Protocol

import openai
import yaml
from openai import AsyncOpenAI
from tenacity import AsyncRetrying, RetryCallState, retry_if_exception, stop_after_attempt

CONFIG_PATH = Path(__file__).with_name("config.yaml")
RETRY_AFTER_CAP_SECONDS = 120.0


class ConfigError(Exception):
    """config.yaml or the environment is not usable."""


class LimitExceeded(Exception):
    """A per-run safety limit was hit; the run must stop."""


class LLMError(Exception):
    """The provider call failed for good (after retries, or with a non-retryable error)."""


# ---------- configuration ----------


@dataclass(frozen=True, slots=True)
class AgentConfig:
    provider: str
    base_url: str
    api_key_env: str
    model: str
    temperature: float
    max_tokens: int


@dataclass(frozen=True, slots=True)
class Limits:
    max_concurrency: int = 3
    requests_per_minute: int = 30
    max_calls_per_run: int = 25
    max_tokens_per_call: int = 1024
    max_retries: int = 5
    retry_base_seconds: float = 2.0
    retry_max_seconds: float = 30.0
    request_timeout_seconds: float = 90.0


@dataclass(frozen=True, slots=True)
class Settings:
    limits: Limits
    agents: dict[str, AgentConfig]

    def check_live(self) -> None:
        """Raise ConfigError unless every agent can really call its model."""
        for name, cfg in self.agents.items():
            if not cfg.model.strip():
                raise ConfigError(f"Modello non impostato per '{name}': esegui list_models.py e compila config.yaml")
            if not os.getenv(cfg.api_key_env):
                raise ConfigError(f"Variabile d'ambiente {cfg.api_key_env} non impostata (agente '{name}')")
            if cfg.max_tokens > self.limits.max_tokens_per_call:
                raise ConfigError(
                    f"max_tokens di '{name}' ({cfg.max_tokens}) supera max_tokens_per_call ({self.limits.max_tokens_per_call})"
                )


def _build(cls: type, raw: dict[str, Any], where: str) -> Any:
    """Build a config dataclass from a YAML mapping, rejecting unknown keys and wrong types."""
    known = {f.name: f for f in fields(cls)}
    unknown = set(raw) - set(known)
    if unknown:
        raise ConfigError(f"{where}: chiavi sconosciute {sorted(unknown)}")
    values: dict[str, Any] = {}
    for key, value in raw.items():
        kind = known[key].type
        try:
            if kind == "str":
                if not isinstance(value, str):
                    raise TypeError
                values[key] = value
            elif kind == "int":
                if isinstance(value, bool) or not isinstance(value, int):
                    raise TypeError
                values[key] = value
            else:  # float
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise TypeError
                values[key] = float(value)
        except TypeError:
            raise ConfigError(f"{where}.{key}: valore non valido {value!r}") from None
    try:
        return cls(**values)
    except TypeError as exc:
        raise ConfigError(f"{where}: {exc}") from None


def load_settings(path: Path = CONFIG_PATH) -> Settings:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigError(f"Impossibile leggere {path.name}: {exc}") from None
    if not isinstance(raw, dict):
        raise ConfigError(f"{path.name}: atteso un dizionario al primo livello")

    limits: Limits = _build(Limits, raw.get("limits") or {}, "limits")
    for f in fields(Limits):
        if getattr(limits, f.name) <= 0 and f.name != "max_retries":
            raise ConfigError(f"limits.{f.name} deve essere maggiore di zero")
    if limits.max_retries < 0:
        raise ConfigError("limits.max_retries non può essere negativo")

    defaults = raw.get("defaults") or {}
    agents_raw = raw.get("agents") or {}
    if not isinstance(defaults, dict) or not isinstance(agents_raw, dict) or not agents_raw:
        raise ConfigError(f"{path.name}: 'defaults' e 'agents' devono essere dizionari, 'agents' non vuoto")
    agents = {
        str(name): _build(AgentConfig, {**defaults, **(override or {})}, f"agents.{name}")
        for name, override in agents_raw.items()
    }
    return Settings(limits=limits, agents=agents)


# ---------- limiters ----------


class RateLimiter:
    """At most `max_calls` acquisitions in any sliding window of `period` seconds."""

    def __init__(self, max_calls: int, period: float = 60.0) -> None:
        self._max = max_calls
        self._period = period
        self._stamps: deque[float] = deque()
        self._lock = asyncio.Lock()  # waiters queue here, in arrival order

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                while self._stamps and now - self._stamps[0] >= self._period:
                    self._stamps.popleft()
                if len(self._stamps) < self._max:
                    self._stamps.append(now)
                    return
                await asyncio.sleep(self._period - (now - self._stamps[0]))


@dataclass(slots=True)
class RunBudget:
    """Per-run counters. `take()` is the hard stop on the number of LLM calls."""

    max_calls: int
    calls: int = 0
    total_tokens: int = 0

    def take(self) -> int:
        if self.calls >= self.max_calls:
            raise LimitExceeded(f"Limite di {self.max_calls} chiamate LLM per esecuzione raggiunto")
        self.calls += 1
        return self.calls


# ---------- gateway ----------


class Emit(Protocol):
    def __call__(
        self, type: Any, agent: str, label: str, *, target: str | None = None, payload: dict[str, Any] | None = None
    ) -> Any: ...


@dataclass(frozen=True, slots=True)
class LLMResult:
    text: str
    prompt_tokens: int | None      # None = the provider sent no usage data
    completion_tokens: int | None
    total_tokens: int | None
    truncated: bool                # the model stopped because it hit max_tokens


def _retryable(exc: BaseException) -> bool:
    # 429, network errors and timeouts (APITimeoutError is an APIConnectionError), 5xx.
    return isinstance(exc, (openai.RateLimitError, openai.APIConnectionError, openai.InternalServerError))


def _reason(exc: BaseException | None) -> tuple[str, int | None]:
    if isinstance(exc, openai.RateLimitError):
        return "429 rate limit", 429
    if isinstance(exc, openai.APITimeoutError):
        return "timeout", None
    if isinstance(exc, openai.APIConnectionError):
        return "errore di rete", None
    if isinstance(exc, openai.APIStatusError):
        return f"errore HTTP {exc.status_code}", exc.status_code
    return type(exc).__name__, None


def _retry_after(exc: BaseException | None) -> float:
    """Seconds asked by the server through Retry-After, or 0."""
    if isinstance(exc, openai.APIStatusError):
        try:
            return max(0.0, float(exc.response.headers.get("retry-after", "")))
        except ValueError:
            return 0.0
    return 0.0


class LLMGateway:
    """Single door to every model. One instance per process: its limiters are global."""

    def __init__(self, settings: Settings, emit: Emit, *, rate_period: float = 60.0) -> None:
        self.settings = settings
        self._emit = emit
        self._slots = asyncio.Semaphore(settings.limits.max_concurrency)
        self._rate = RateLimiter(settings.limits.requests_per_minute, rate_period)
        self._clients: dict[tuple[str, str], AsyncOpenAI] = {}

    def new_budget(self) -> RunBudget:
        return RunBudget(max_calls=self.settings.limits.max_calls_per_run)

    def _client(self, cfg: AgentConfig) -> AsyncOpenAI:
        key = (cfg.base_url, cfg.api_key_env)
        if key not in self._clients:
            api_key = os.getenv(cfg.api_key_env)
            if not api_key:
                raise ConfigError(f"Variabile d'ambiente {cfg.api_key_env} non impostata")
            # max_retries=0: the SDK's own retries are off, so every attempt goes through
            # our limiters and shows up as an event.
            self._clients[key] = AsyncOpenAI(
                base_url=cfg.base_url,
                api_key=api_key,
                max_retries=0,
                timeout=self.settings.limits.request_timeout_seconds,
            )
        return self._clients[key]

    def _wait(self, state: RetryCallState) -> float:
        limits = self.settings.limits
        backoff = min(limits.retry_max_seconds, limits.retry_base_seconds * 2 ** (state.attempt_number - 1))
        backoff += random.uniform(0, backoff * 0.25)  # jitter: parallel agents do not retry in step
        exc = state.outcome.exception() if state.outcome else None
        return min(max(backoff, _retry_after(exc)), RETRY_AFTER_CAP_SECONDS)

    async def complete(
        self,
        agent: str,
        messages: list[dict[str, str]],
        budget: RunBudget,
        *,
        purpose: str,
        max_tokens: int | None = None,
    ) -> LLMResult:
        """One chat completion for `agent`. Emits `tool_call` start/end and an `error` per retry.

        Raises LimitExceeded, ConfigError or LLMError; the caller decides how the run ends.
        """
        cfg = self.settings.agents.get(agent)
        if cfg is None:
            raise ConfigError(f"Agente '{agent}' non presente in config.yaml")
        if not cfg.model.strip():
            raise ConfigError(f"Modello non impostato per '{agent}'")
        limits = self.settings.limits
        wanted = cfg.max_tokens if max_tokens is None else max_tokens
        if wanted > limits.max_tokens_per_call:
            raise LimitExceeded(f"max_tokens {wanted} oltre il limite di {limits.max_tokens_per_call} per chiamata")
        client = self._client(cfg)
        call_no = budget.take()

        def before_sleep(state: RetryCallState) -> None:
            reason, status = _reason(state.outcome.exception() if state.outcome else None)
            delay = state.next_action.sleep if state.next_action else 0.0
            self._emit(
                "error", agent, f"{reason} · tentativo {state.attempt_number}/{limits.max_retries + 1} · riprovo tra {delay:.0f} s",
                payload={"fatal": False, "status": status, "attempt": state.attempt_number, "retry_in": round(delay, 2)},
            )

        self._emit(
            "tool_call", agent, f"LLM ▸ {purpose}",
            payload={"tool": "llm", "phase": "start", "model": cfg.model, "call": call_no},
        )
        started = time.monotonic()
        try:
            async for attempt in AsyncRetrying(
                retry=retry_if_exception(_retryable),
                stop=stop_after_attempt(limits.max_retries + 1),
                wait=self._wait,
                before_sleep=before_sleep,
                reraise=True,
            ):
                with attempt:
                    # The slot is held only while a request is in flight, not during backoff.
                    async with self._slots:
                        await self._rate.acquire()
                        response = await client.chat.completions.create(
                            model=cfg.model,
                            messages=messages,  # type: ignore[arg-type]
                            temperature=cfg.temperature,
                            max_tokens=wanted,
                        )
        except openai.OpenAIError as exc:
            reason, status = _reason(exc)
            self._emit(
                "tool_call", agent, f"LLM ✕ {reason}",
                payload={"tool": "llm", "phase": "failed", "status": status, "call": call_no},
            )
            raise LLMError(f"Chiamata LLM fallita ({reason})") from exc

        choice = response.choices[0] if response.choices else None
        text = (choice.message.content or "").strip() if choice else ""
        usage = response.usage
        tokens = (
            {"prompt": usage.prompt_tokens, "completion": usage.completion_tokens, "total": usage.total_tokens}
            if usage is not None
            else None
        )
        if tokens:
            budget.total_tokens += tokens["total"]
        self._emit(
            "tool_call", agent, f"LLM ◂ {tokens['total']} token" if tokens else "LLM ◂ risposta (token n/d)",
            payload={
                "tool": "llm", "phase": "end", "call": call_no, "tokens": tokens,
                "ms": round((time.monotonic() - started) * 1000),
            },
        )
        if not text:
            raise LLMError("Il modello ha restituito una risposta vuota")
        return LLMResult(
            text=text,
            prompt_tokens=tokens["prompt"] if tokens else None,
            completion_tokens=tokens["completion"] if tokens else None,
            total_tokens=tokens["total"] if tokens else None,
            truncated=bool(choice and choice.finish_reason == "length"),
        )


# ---------- smoke test ----------


async def _smoke(prompt: str, agent: str) -> None:
    def show(type: Any, agent: str, label: str, *, target: str | None = None, payload: dict[str, Any] | None = None) -> None:
        print(f"[{type}] {agent}: {label}")

    settings = load_settings()
    settings.check_live()
    gateway = LLMGateway(settings, show)
    result = await gateway.complete(agent, [{"role": "user", "content": prompt}], gateway.new_budget(), purpose="smoke test")
    print(f"--- {settings.agents[agent].model} · token: {result.total_tokens} · troncata: {result.truncated}")
    print(result.text)


if __name__ == "__main__":
    import sys

    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    try:
        asyncio.run(_smoke(sys.argv[1] if len(sys.argv) > 1 else "Rispondi con una parola: ciao", "planner"))
    except (ConfigError, LimitExceeded, LLMError) as exc:
        sys.exit(f"Errore: {exc}")
