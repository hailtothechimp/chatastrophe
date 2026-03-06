"""
LLM streaming/calling layer.
Ported from param_explorer.py with multi-turn support (accepts messages list).
OpenRouter removed.
"""
import os
import time
from typing import Any, Iterator

# ── Model catalogues ──────────────────────────────────────────────────────────

GROQ_MODELS = [
    # Production
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "groq/compound",
    "groq/compound-mini",
    # Preview
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "qwen/qwen3-32b",
]

OLLAMA_MODELS = [
    "llama3.2",
    "llama3.1",
    "mistral",
    "gemma2",
    "phi3",
]

OPENAI_MODELS = [
    # GPT-5 family
    "gpt-5.2",        # flagship
    "gpt-5-mini",     # cheaper
    "gpt-5-nano",     # cheapest
    # GPT-4.1 family (still available)
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o",
    "gpt-4o-mini",
]

ANTHROPIC_MODELS = [
    "claude-haiku-4-5-20251001",   # cheapest ($1/$5 per MTok)
    "claude-sonnet-4-6",           # balanced ($3/$15)
    "claude-opus-4-6",             # most capable ($5/$25)
]

OPENAI_REASONING_MODELS = [
    # GPT-5 family (native reasoning)
    "gpt-5.2",
    "gpt-5-mini",
    "gpt-5-nano",
    # o-series
    "o4-mini",
    "o3",
    "o3-mini",
    "o1",
    "o1-mini",
]

ANTHROPIC_REASONING_MODELS = [
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-5-20251101",
    "claude-sonnet-4-5-20250929",
]

PROVIDERS = [
    "Groq (free cloud)",
    "Ollama (local)",
    "OpenAI (paid)",
    "Anthropic (paid)",
]

MODEL_LISTS: dict[str, list[str]] = {
    "Groq (free cloud)": GROQ_MODELS,
    "Ollama (local)":    OLLAMA_MODELS,
    "OpenAI (paid)":     OPENAI_MODELS,
    "Anthropic (paid)":  ANTHROPIC_MODELS,
}

REASONING_PROVIDERS = ["OpenAI (paid)", "Anthropic (paid)"]
REASONING_MODEL_LISTS: dict[str, list[str]] = {
    "OpenAI (paid)":    OPENAI_REASONING_MODELS,
    "Anthropic (paid)": ANTHROPIC_REASONING_MODELS,
}

PARAM_SUPPORT: dict[str, dict[str, bool]] = {
    "Groq (free cloud)": dict(temperature=True, top_p=True, top_k=False, max_tokens=True, freq_penalty=True,  pres_penalty=True,  seed=False, logprobs=False),
    "Ollama (local)":    dict(temperature=True, top_p=True, top_k=False, max_tokens=True, freq_penalty=True,  pres_penalty=True,  seed=False, logprobs=False),
    "OpenAI (paid)":     dict(temperature=True, top_p=True, top_k=False, max_tokens=True, freq_penalty=True,  pres_penalty=True,  seed=True,  logprobs=True),
    "Anthropic (paid)":  dict(temperature=True, top_p=True, top_k=True,  max_tokens=True, freq_penalty=False, pres_penalty=False, seed=False, logprobs=False),
}

SWEEP_PARAMS: dict[str, dict] = {
    "Temperature":       dict(minimum=0.0,  maximum=2.0,  step=0.01, defaults=[0.0,  0.5,  1.0,  1.5]),
    "Top P":             dict(minimum=0.0,  maximum=1.0,  step=0.01, defaults=[0.1,  0.4,  0.7,  1.0]),
    "Frequency Penalty": dict(minimum=-2.0, maximum=2.0,  step=0.01, defaults=[-1.0, 0.0,  1.0,  2.0]),
    "Presence Penalty":  dict(minimum=-2.0, maximum=2.0,  step=0.01, defaults=[-1.0, 0.0,  1.0,  2.0]),
    "Max Tokens":        dict(minimum=50,   maximum=2048, step=50,   defaults=[50,   256,  512,  1024]),
}


# ── Client factory ─────────────────────────────────────────────────────────────

def _make_openai_client(provider: str):
    from openai import OpenAI
    if provider == "Groq (free cloud)":
        key = os.getenv("GROQ_API_KEY", "")
        if not key:
            raise ValueError("GROQ_API_KEY not set — get a free key at https://console.groq.com/keys")
        return OpenAI(api_key=key, base_url="https://api.groq.com/openai/v1")
    if provider == "Ollama (local)":
        return OpenAI(api_key="ollama", base_url="http://localhost:11434/v1")
    if provider == "OpenAI (paid)":
        key = os.getenv("OPENAI_API_KEY", "")
        if not key:
            raise ValueError("OPENAI_API_KEY not set — get a key at https://platform.openai.com/api-keys")
        return OpenAI(api_key=key)
    raise ValueError(f"Unknown provider: {provider!r}")


# ── OpenAI kwargs builder ──────────────────────────────────────────────────────

def _build_openai_kw(
    provider: str, model: str,
    messages: list[dict],
    temperature: float, top_p: float, max_tokens: int,
    freq_penalty: float, pres_penalty: float,
    seed: int | None, stops: list[str],
) -> tuple[dict, str]:
    support = PARAM_SUPPORT[provider]
    use_top_p = float(top_p) < 1.0

    # GPT-4.1+, GPT-5.x require max_completion_tokens; older models use max_tokens
    # gpt-5-nano and gpt-5-mini use internal reasoning tokens that consume
    # max_completion_tokens, leaving nothing for visible output — omit the limit.
    _new_style = any(model.startswith(p) for p in ("gpt-5", "gpt-4.1", "o1", "o3", "o4"))
    _tokens_key = "max_completion_tokens" if _new_style else "max_tokens"
    kw: dict[str, Any] = {"model": model, "messages": messages}
    if model not in {"gpt-5-nano", "gpt-5-mini"}:
        kw[_tokens_key] = int(max_tokens)
    # Some models (gpt-5-mini, gpt-5-nano) only accept temperature=1 (the default)
    _temp_locked = model in {"gpt-5-mini", "gpt-5-nano"}
    if _temp_locked:
        sampling_note = "temperature=1 (fixed by model)"
    elif use_top_p:
        kw["top_p"] = float(top_p)
        sampling_note = f"top_p={top_p:.2f} (temperature omitted)"
    else:
        kw["temperature"] = float(temperature)
        sampling_note = f"temperature={temperature:.2f}"

    if support.get("freq_penalty"):
        kw["frequency_penalty"] = float(freq_penalty)
    if support.get("pres_penalty"):
        kw["presence_penalty"] = float(pres_penalty)
    if support.get("seed") and seed is not None:
        kw["seed"] = int(seed)
    if stops:
        kw["stop"] = stops[:4]

    return kw, sampling_note


# ── Streaming callers ──────────────────────────────────────────────────────────

def stream_openai_compat(
    provider: str, model: str,
    messages: list[dict],
    temperature: float, top_p: float, max_tokens: int,
    freq_penalty: float, pres_penalty: float,
    seed: int | None, stops: list[str],
) -> Iterator[tuple[str, dict | None]]:
    """Yields (token_text, None) per chunk, then ('', meta_dict) at end."""
    client = _make_openai_client(provider)
    kw, sampling_note = _build_openai_kw(
        provider, model, messages, temperature, top_p, max_tokens,
        freq_penalty, pres_penalty, seed, stops,
    )
    kw["stream"] = True
    if provider in ("OpenAI (paid)", "Groq (free cloud)"):
        kw["stream_options"] = {"include_usage": True}

    t0 = time.perf_counter()
    usage: dict[str, Any] = {}
    finish_reason = "unknown"

    for chunk in client.chat.completions.create(**kw):
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content, None
        if chunk.choices and chunk.choices[0].finish_reason:
            finish_reason = chunk.choices[0].finish_reason
        if getattr(chunk, "usage", None) and chunk.usage:
            u = chunk.usage
            usage = {
                "prompt_tokens":     u.prompt_tokens,
                "completion_tokens": u.completion_tokens,
                "total_tokens":      u.total_tokens,
            }

    elapsed = time.perf_counter() - t0
    yield "", {
        "provider": provider, "model": model,
        "finish_reason": finish_reason,
        "latency_s": round(elapsed, 3),
        "sampling": sampling_note,
        **usage,
    }


def stream_anthropic(
    model: str,
    system: str,
    messages: list[dict],
    temperature: float, top_p: float, top_k: int, max_tokens: int,
    stops: list[str],
) -> Iterator[tuple[str, dict | None]]:
    """Yields (token_text, None) per chunk, then ('', meta_dict) at end."""
    import anthropic
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        raise ValueError("ANTHROPIC_API_KEY not set — get a key at https://console.anthropic.com/settings/keys")
    client = anthropic.Anthropic(api_key=key)

    use_top_p = float(top_p) < 1.0
    kw: dict[str, Any] = dict(
        model=model,
        max_tokens=int(max_tokens),
        system=system,
        messages=messages,
    )
    if use_top_p:
        kw["top_p"] = float(top_p)
        sampling_note = f"top_p={top_p:.2f} (temperature omitted — Anthropic forbids both)"
    else:
        clamped = min(float(temperature), 1.0)
        kw["temperature"] = clamped
        sampling_note = f"temperature={clamped:.2f}" + (
            f" (clamped from {temperature:.2f})" if float(temperature) > 1.0 else ""
        )
    if int(top_k) > 0:
        kw["top_k"] = int(top_k)
    if stops:
        kw["stop_sequences"] = stops

    t0 = time.perf_counter()
    with client.messages.stream(**kw) as stream:
        for text in stream.text_stream:
            yield text, None
        msg = stream.get_final_message()
    elapsed = time.perf_counter() - t0

    yield "", {
        "provider": "Anthropic (paid)", "model": model,
        "stop_reason":   msg.stop_reason,
        "input_tokens":  msg.usage.input_tokens,
        "output_tokens": msg.usage.output_tokens,
        "latency_s":     round(elapsed, 3),
        "sampling":      sampling_note,
    }


def call_openai_with_logprobs(
    provider: str, model: str,
    messages: list[dict],
    temperature: float, top_p: float, max_tokens: int,
    freq_penalty: float, pres_penalty: float,
    seed: int | None, stops: list[str],
) -> tuple[str, dict, list[dict]]:
    """Non-streaming call with per-token logprobs. Returns (text, meta, tokens)."""
    client = _make_openai_client(provider)
    kw, sampling_note = _build_openai_kw(
        provider, model, messages, temperature, top_p, max_tokens,
        freq_penalty, pres_penalty, seed, stops,
    )
    kw["logprobs"] = True

    t0 = time.perf_counter()
    r = client.chat.completions.create(**kw)
    elapsed = time.perf_counter() - t0

    text = r.choices[0].message.content or ""
    meta: dict[str, Any] = {
        "provider": provider, "model": model,
        "finish_reason": r.choices[0].finish_reason,
        "latency_s": round(elapsed, 3),
        "sampling": sampling_note,
    }
    if r.usage:
        meta["prompt_tokens"]     = r.usage.prompt_tokens
        meta["completion_tokens"] = r.usage.completion_tokens
        meta["total_tokens"]      = r.usage.total_tokens

    tokens: list[dict] = []
    if r.choices[0].logprobs and r.choices[0].logprobs.content:
        for t in r.choices[0].logprobs.content:
            tokens.append({"token": t.token, "logprob": t.logprob})

    return text, meta, tokens


def _collect_stream(gen: Iterator[tuple[str, dict | None]]) -> tuple[str, dict]:
    text = ""
    meta: dict = {}
    for chunk, m in gen:
        text += chunk
        if m is not None:
            meta = m
    return text, meta


def dispatch(
    provider: str, model: str,
    system: str,
    messages: list[dict],
    temperature: float, top_p: float, top_k: int, max_tokens: int,
    freq_penalty: float, pres_penalty: float,
    seed: int | None, stops: list[str],
) -> tuple[str, dict]:
    """Non-streaming dispatch — used by the sweep endpoint."""
    if provider == "Anthropic (paid)":
        return _collect_stream(
            stream_anthropic(model, system, messages, temperature, top_p, int(top_k), max_tokens, stops)
        )
    return _collect_stream(
        stream_openai_compat(
            provider, model, messages, temperature, top_p, int(max_tokens),
            float(freq_penalty), float(pres_penalty), seed, stops,
        )
    )


# ── Reasoning callers ─────────────────────────────────────────────────────────

def stream_reasoning_openai(
    model: str,
    messages: list[dict],
    reasoning_effort: str, max_completion_tokens: int,
) -> Iterator[tuple[str, dict | None]]:
    key = os.getenv("OPENAI_API_KEY", "")
    if not key:
        raise ValueError("OPENAI_API_KEY not set")
    from openai import OpenAI
    client = OpenAI(api_key=key)

    t0 = time.perf_counter()
    usage: dict[str, Any] = {}
    finish_reason = "unknown"

    for chunk in client.chat.completions.create(
        model=model,
        messages=messages,
        reasoning_effort=reasoning_effort,
        max_completion_tokens=int(max_completion_tokens),
        stream=True,
        stream_options={"include_usage": True},
    ):
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content, None
        if chunk.choices and chunk.choices[0].finish_reason:
            finish_reason = chunk.choices[0].finish_reason
        if getattr(chunk, "usage", None) and chunk.usage:
            u = chunk.usage
            usage = {
                "prompt_tokens":     u.prompt_tokens,
                "completion_tokens": u.completion_tokens,
                "total_tokens":      u.total_tokens,
            }
            det = getattr(u, "completion_tokens_details", None)
            if det and getattr(det, "reasoning_tokens", None):
                usage["reasoning_tokens"] = det.reasoning_tokens

    elapsed = time.perf_counter() - t0
    yield "", {
        "provider":         "OpenAI (paid)",
        "model":            model,
        "reasoning_effort": reasoning_effort,
        "finish_reason":    finish_reason,
        "latency_s":        round(elapsed, 3),
        **usage,
    }


def stream_reasoning_anthropic(
    model: str,
    system: str,
    messages: list[dict],
    budget_tokens: int, max_tokens: int,
) -> Iterator[tuple[str, dict | None]]:
    import anthropic
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        raise ValueError("ANTHROPIC_API_KEY not set")
    client = anthropic.Anthropic(api_key=key)

    actual_max = max(int(max_tokens), int(budget_tokens) + 1024)

    t0 = time.perf_counter()
    with client.messages.stream(
        model=model,
        max_tokens=actual_max,
        system=system,
        messages=messages,
        thinking={"type": "enabled", "budget_tokens": int(budget_tokens)},
    ) as stream:
        for text in stream.text_stream:
            yield text, None
        msg = stream.get_final_message()

    elapsed = time.perf_counter() - t0
    yield "", {
        "provider":      "Anthropic (paid)",
        "model":         model,
        "budget_tokens": int(budget_tokens),
        "stop_reason":   msg.stop_reason,
        "input_tokens":  msg.usage.input_tokens,
        "output_tokens": msg.usage.output_tokens,
        "latency_s":     round(elapsed, 3),
    }
