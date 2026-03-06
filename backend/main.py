"""
LLM Parameter Explorer — FastAPI backend.
Serves REST + SSE endpoints and (in production) the built React frontend.
"""
import html as _html
import json
import math
import os
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, AsyncIterator

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import db
import llm
from questions import get_all_questions, add_question, delete_question

load_dotenv(override=True)

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

# ── Auth config ────────────────────────────────────────────────────────────────

_JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me-in-production")
_JWT_ALGO   = "HS256"
_JWT_DAYS   = 30
_ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
_IS_PROD    = os.getenv("ENV") == "production"


def _make_token(username: str, is_admin: bool = False) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=_JWT_DAYS)
    return jwt.encode({"sub": username, "adm": is_admin, "exp": exp}, _JWT_SECRET, algorithm=_JWT_ALGO)


def _decode_token(token: str) -> dict | None:
    """Returns {"username": str, "is_admin": bool} or None if invalid/expired."""
    try:
        payload = jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGO])
        return {"username": payload.get("sub"), "is_admin": bool(payload.get("adm", False))}
    except jwt.PyJWTError:
        return None

# Reverse map: system_prompt → persona name
_PERSONAS_FILE = Path(__file__).parent.parent.parent / "llm_engineering" / "week2" / "all_personas_merged_deduped.json"
_PERSONA_MAP: dict[str, str] = {}

def _reload_persona_map() -> None:
    global _PERSONA_MAP
    if _PERSONAS_FILE.exists():
        _raw = json.loads(_PERSONAS_FILE.read_text(encoding="utf-8"))
        _PERSONA_MAP = {p["system_prompt"]: p["persona"] for p in _raw if "system_prompt" in p}

_reload_persona_map()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await db.init_db()
    # Auto-promote users listed in ADMIN_USERS env var (comma-separated)
    admin_users_env = os.getenv("ADMIN_USERS", "")
    if admin_users_env:
        for u in [x.strip().lower() for x in admin_users_env.split(",") if x.strip()]:
            await db.update_user(u, is_admin=True)
    yield


app = FastAPI(title="LLM Parameter Explorer", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    # Skip auth for non-API routes (static files, frontend) and OPTIONS preflight
    if request.method == "OPTIONS" or not path.startswith("/api/"):
        return await call_next(request)
    # Auth endpoints and admin handle their own auth
    if path.startswith("/api/auth/") or path.startswith("/api/admin/"):
        return await call_next(request)
    token = request.cookies.get("token")
    if not token:
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    info = _decode_token(token)
    if not info:
        return JSONResponse({"detail": "Invalid or expired session"}, status_code=401)
    request.state.username = info["username"]
    return await call_next(request)


# ── Pydantic models ────────────────────────────────────────────────────────────

class CreateConversationBody(BaseModel):
    title: str = "New Conversation"
    system_prompt: str = ""
    provider: str = "Groq (free cloud)"
    model: str = "llama-3.3-70b-versatile"
    params: dict = {}


class UpdateConversationBody(BaseModel):
    title: str | None = None
    system_prompt: str | None = None
    provider: str | None = None
    model: str | None = None
    params: dict | None = None


class ChatBody(BaseModel):
    user_message: str
    num_runs: int = 1
    show_logprobs: bool = False


class SweepBody(BaseModel):
    provider: str
    model: str
    system_prompt: str
    user_message: str
    sweep_param: str
    values: list[float]
    base_params: dict


class ReasoningBody(BaseModel):
    conversation_id: str
    provider: str
    model: str
    user_message: str
    reasoning_effort: str = "medium"
    budget_tokens: int = 8000
    max_tokens: int = 4096


class ThrowdownAgent(BaseModel):
    persona: str
    system_prompt: str
    provider: str
    model: str


class ThrowdownSessionBody(BaseModel):
    judge: ThrowdownAgent
    contestants: list[ThrowdownAgent]   # exactly 3
    num_rounds: int = 5


class ThrowdownRoundBody(BaseModel):
    session_id: int
    round_num: int
    prompt: str


class RoundtableAgent(BaseModel):
    persona: str
    system_prompt: str
    provider: str
    model: str


class RoundtableBody(BaseModel):
    agents: list[RoundtableAgent]   # 2–4
    topic: str
    num_turns: int = 8
    mood: int = 50          # 0 = gloomy,  100 = cheerful
    seriousness: int = 50   # 0 = serious, 100 = hilarious
    conv_id: str | None = None          # continue existing conversation
    follow_up: str | None = None        # user follow-up message
    history: list[dict] | None = None   # [{"persona": str, "content": str}]


# ── Roundtable helpers ────────────────────────────────────────────────────────

def _build_tone_modifier(mood: int, seriousness: int) -> str:
    parts = []
    if mood < 30:
        parts.append("melancholic and pessimistic")
    elif mood > 70:
        parts.append("upbeat and cheerful")
    if seriousness < 30:
        parts.append("earnest and grave")
    elif seriousness > 70:
        parts.append("comedic and absurd")
    if not parts:
        return ""
    return "\n\n[Tone guidance: keep this conversation " + " and ".join(parts) + ".]"


def _pick_speaker(recency: dict, n: int) -> int:
    import random
    weights = []
    for i in range(n):
        r = recency.get(i, 999)
        if r == 0:
            weights.append(0.0)
        elif r == 1:
            weights.append(0.3)
        else:
            weights.append(1.0)
    # If all weights are 0 (only 1 agent), fall back
    if sum(weights) == 0:
        weights = [1.0] * n
    return random.choices(range(n), weights=weights)[0]


# ── Helper: build LLM message list from conversation ──────────────────────────

def _build_messages(conv: dict, new_user_msg: str) -> tuple[str, list[dict]]:
    """Returns (system_prompt, openai-style messages list).

    For OpenAI-compatible providers the system prompt is prepended as a
    {"role": "system"} message.  Anthropic receives it via the separate
    top-level `system` param, so its messages list must NOT include it.
    """
    system = conv.get("system_prompt", "")
    history = [
        {"role": m["role"], "content": m["content"]}
        for m in conv.get("messages", [])
    ]
    history.append({"role": "user", "content": new_user_msg})
    # Prepend system message for non-Anthropic providers
    if system and conv.get("provider") != "Anthropic (paid)":
        history = [{"role": "system", "content": system}] + history
    return system, history


# ── SSE helpers ────────────────────────────────────────────────────────────────

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _stream_response(
    conv: dict,
    user_msg: str,
    show_logprobs: bool,
) -> AsyncIterator[str]:
    """Core streaming generator for the chat endpoint."""
    params   = conv["params"]
    provider = conv["provider"]
    model    = conv["model"]
    system, messages = _build_messages(conv, user_msg)

    temperature  = float(params.get("temperature", 0.7))
    top_p        = float(params.get("top_p", 1.0))
    top_k        = int(params.get("top_k", 0))
    max_tokens   = int(params.get("max_tokens", 512))
    freq_penalty = float(params.get("freq_penalty", 0.0))
    pres_penalty = float(params.get("pres_penalty", 0.0))
    use_seed     = bool(params.get("use_seed", False))
    seed_val     = int(params.get("seed", 42))
    stop_text    = str(params.get("stop_sequences", ""))
    stops        = [s.strip() for s in stop_text.split(",") if s.strip()] if stop_text else []
    seed         = seed_val if use_seed and llm.PARAM_SUPPORT.get(provider, {}).get("seed") else None
    do_logprobs  = show_logprobs and llm.PARAM_SUPPORT.get(provider, {}).get("logprobs", False)

    if do_logprobs:
        yield _sse({"type": "status", "content": "Fetching token probabilities…"})
        text, meta, tokens = llm.call_openai_with_logprobs(
            provider, model, messages, temperature, top_p, max_tokens,
            freq_penalty, pres_penalty, seed, stops,
        )
        meta["logprobs_tokens"] = tokens
        yield _sse({"type": "token", "content": text})
        yield _sse({"type": "meta", **meta})
    else:
        accumulated = ""
        meta: dict = {}

        if provider == "Anthropic (paid)":
            stream_iter = llm.stream_anthropic(
                model, system, messages,
                temperature, top_p, top_k, max_tokens, stops,
            )
        else:
            stream_iter = llm.stream_openai_compat(
                provider, model, messages,
                temperature, top_p, max_tokens,
                freq_penalty, pres_penalty, seed, stops,
            )

        try:
            for chunk, chunk_meta in stream_iter:
                if chunk_meta is not None:
                    meta = chunk_meta
                else:
                    accumulated += chunk
                    yield _sse({"type": "token", "content": chunk})
        except Exception as exc:
            import traceback
            print(f"\n[LLM ERROR] {provider}/{model}: {exc}", flush=True)
            traceback.print_exc()
            yield _sse({"type": "error", "content": str(exc)})
            yield "data: [DONE]\n\n"
            return

        yield _sse({"type": "meta", **meta})

    yield "data: [DONE]\n\n"


# ── Auth routes ────────────────────────────────────────────────────────────────

class LoginBody(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
async def login(body: LoginBody, response: Response):
    user = await db.get_user(body.username.strip().lower())
    if not user or not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        raise HTTPException(401, "Invalid username or password")
    is_admin = bool(user.get("is_admin", 0))
    token = _make_token(user["username"], is_admin=is_admin)
    response.set_cookie(
        "token", token,
        httponly=True,
        samesite="lax",
        secure=_IS_PROD,
        max_age=_JWT_DAYS * 86400,
        path="/",
    )
    return {"username": user["username"], "is_admin": is_admin}


@app.post("/api/auth/logout")
async def logout(response: Response):
    response.delete_cookie("token", path="/")
    return {"ok": True}


@app.get("/api/auth/me")
async def me(request: Request):
    token = request.cookies.get("token")
    if not token:
        raise HTTPException(401, "Not authenticated")
    info = _decode_token(token)
    if not info:
        raise HTTPException(401, "Invalid or expired session")
    return {"username": info["username"], "is_admin": info["is_admin"]}


# ── Admin routes ───────────────────────────────────────────────────────────────

async def _require_admin(request: Request) -> dict:
    """Returns the user dict if the caller is an authenticated admin; raises otherwise.
    Accepts either a valid admin JWT cookie OR the legacy ADMIN_TOKEN header."""
    token = request.cookies.get("token")
    if token:
        info = _decode_token(token)
        if info and info.get("is_admin"):
            return info
    # Legacy bootstrap fallback: ADMIN_TOKEN header
    provided = request.headers.get("X-Admin-Token", "")
    if _ADMIN_TOKEN and provided == _ADMIN_TOKEN:
        return {"username": "__admin_token__", "is_admin": True}
    raise HTTPException(403, "Admin access required")


class CreateUserBody(BaseModel):
    username: str
    password: str
    is_admin: bool = False


class UpdateUserBody(BaseModel):
    password: str | None = None
    is_admin: bool | None = None


@app.get("/api/admin/users")
async def admin_list_users(request: Request):
    await _require_admin(request)
    return await db.list_users()


@app.post("/api/admin/users", status_code=201)
async def admin_create_user(body: CreateUserBody, request: Request):
    await _require_admin(request)
    username = body.username.strip().lower()
    if not username or not body.password:
        raise HTTPException(400, "username and password are required")
    existing = await db.get_user(username)
    if existing:
        raise HTTPException(400, f"User '{username}' already exists")
    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user = await db.create_user(username, hashed, is_admin=body.is_admin)
    return {"username": user["username"], "is_admin": user["is_admin"], "created_at": user["created_at"]}


@app.put("/api/admin/users/{username}")
async def admin_update_user(username: str, body: UpdateUserBody, request: Request):
    caller = await _require_admin(request)
    existing = await db.get_user(username)
    if not existing:
        raise HTTPException(404, f"User '{username}' not found")
    # Prevent removing own admin status
    if body.is_admin is False and caller.get("username") == username:
        raise HTTPException(400, "Cannot remove your own admin status")
    password_hash = None
    if body.password:
        password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    await db.update_user(username, password_hash=password_hash, is_admin=body.is_admin)
    return {"ok": True}


@app.delete("/api/admin/users/{username}", status_code=204)
async def admin_delete_user(username: str, request: Request):
    caller = await _require_admin(request)
    if caller.get("username") == username:
        raise HTTPException(400, "Cannot delete your own account")
    existing = await db.get_user(username)
    if not existing:
        raise HTTPException(404, f"User '{username}' not found")
    await db.delete_user(username)
    return None


# ── API routes ─────────────────────────────────────────────────────────────────

@app.get("/api/conversations")
async def list_conversations():
    return await db.list_conversations()


@app.post("/api/conversations", status_code=201)
async def create_conversation(body: CreateConversationBody):
    default_params = {
        "temperature": 0.7, "top_p": 1.0, "top_k": 0,
        "max_tokens": 512, "freq_penalty": 0.0, "pres_penalty": 0.0,
        "use_seed": False, "seed": 42, "stop_sequences": "",
    }
    params = {**default_params, **body.params}
    return await db.create_conversation(
        body.title, body.system_prompt, body.provider, body.model, params
    )


@app.get("/api/conversations/{conv_id}")
async def get_conversation(conv_id: str):
    conv = await db.get_conversation(conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    return conv


@app.patch("/api/conversations/{conv_id}")
async def update_conversation(conv_id: str, body: UpdateConversationBody):
    conv = await db.get_conversation(conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    updates = body.model_dump(exclude_none=True)
    if updates:
        await db.update_conversation(conv_id, **updates)
    return {"ok": True}


@app.delete("/api/conversations/{conv_id}")
async def delete_conversation(conv_id: str):
    await db.delete_conversation(conv_id)
    return {"ok": True}


@app.post("/api/conversations/{conv_id}/chat")
async def chat(conv_id: str, body: ChatBody):
    conv = await db.get_conversation(conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if not body.user_message.strip():
        raise HTTPException(400, "Empty message")

    # Persist user message immediately
    await db.add_message(conv_id, "user", body.user_message.strip())

    # Re-fetch with updated messages
    conv = await db.get_conversation(conv_id)

    collected_text = []
    collected_meta: list[dict] = []

    async def generate():
        async for event in _stream_response(conv, body.user_message.strip(), body.show_logprobs):
            # Also collect for DB persistence
            if event.startswith("data: {"):
                try:
                    d = json.loads(event[6:].strip())
                    if d.get("type") == "token":
                        collected_text.append(d["content"])
                    elif d.get("type") == "meta":
                        collected_meta.append(d)
                except Exception:
                    pass
            yield event
        # After stream ends, persist assistant message
        full_text = "".join(collected_text)
        meta = collected_meta[0] if collected_meta else {}
        meta["system_prompt"] = conv.get("system_prompt", "")
        if full_text:
            await db.add_message(conv_id, "assistant", full_text, meta)

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/api/sweep")
async def sweep(body: SweepBody):
    results = []
    system = body.system_prompt
    p      = body.base_params
    stops  = [s.strip() for s in str(p.get("stop_sequences", "")).split(",") if s.strip()]

    for val in body.values:
        t  = float(p.get("temperature", 0.7))
        tp = float(p.get("top_p", 1.0))
        tk = int(p.get("top_k", 0))
        mt = int(p.get("max_tokens", 256))
        fp = float(p.get("freq_penalty", 0.0))
        pp = float(p.get("pres_penalty", 0.0))

        if   body.sweep_param == "Temperature":       t  = float(val)
        elif body.sweep_param == "Top P":             tp = float(val)
        elif body.sweep_param == "Frequency Penalty": fp = float(val)
        elif body.sweep_param == "Presence Penalty":  pp = float(val)
        elif body.sweep_param == "Max Tokens":        mt = int(val)

        messages = [
            {"role": "system", "content": system},
            {"role": "user",   "content": body.user_message},
        ] if body.provider != "Anthropic (paid)" else [
            {"role": "user", "content": body.user_message},
        ]

        try:
            text, meta = llm.dispatch(
                body.provider, body.model, system, messages,
                t, tp, tk, mt, fp, pp, None, stops,
            )
            results.append({
                "value": val,
                "text": text,
                "latency_s": meta.get("latency_s"),
                "tokens": meta.get("total_tokens") or meta.get("output_tokens"),
            })
        except Exception as exc:
            results.append({"value": val, "error": str(exc)})

    return results


@app.post("/api/reasoning")
async def reasoning(body: ReasoningBody):
    conv = await db.get_conversation(body.conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")

    await db.add_message(body.conversation_id, "user", body.user_message.strip())
    conv = await db.get_conversation(body.conversation_id)
    system, messages = _build_messages(
        {**conv, "messages": conv["messages"][:-1]},  # exclude just-added user msg
        body.user_message,
    )

    collected_text: list[str] = []
    collected_meta: list[dict] = []

    async def generate():
        if body.provider == "OpenAI (paid)":
            stream_iter = llm.stream_reasoning_openai(
                body.model, messages,
                body.reasoning_effort, body.max_tokens,
            )
        else:
            stream_iter = llm.stream_reasoning_anthropic(
                body.model, system, messages,
                body.budget_tokens, body.max_tokens,
            )

        for chunk, chunk_meta in stream_iter:
            if chunk_meta is not None:
                collected_meta.append(chunk_meta)
                yield _sse({"type": "meta", **chunk_meta})
            else:
                collected_text.append(chunk)
                yield _sse({"type": "token", "content": chunk})

        yield "data: [DONE]\n\n"

        full_text = "".join(collected_text)
        meta = collected_meta[0] if collected_meta else {}
        meta["system_prompt"] = conv.get("system_prompt", "")
        if full_text:
            await db.add_message(body.conversation_id, "assistant", full_text, meta)

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/api/roundtable")
async def roundtable(body: RoundtableBody):
    if not body.agents or not body.topic.strip():
        raise HTTPException(400, "agents and topic are required")

    tone = _build_tone_modifier(body.mood, body.seriousness)
    first = body.agents[0]
    default_params = {
        "temperature": 0.7, "top_p": 1.0, "top_k": 0,
        "max_tokens": 512, "freq_penalty": 0.0, "pres_penalty": 0.0,
        "use_seed": False, "seed": 42, "stop_sequences": "",
    }

    # Resume existing conversation or start a new one
    if body.conv_id:
        conv_id = body.conv_id
    else:
        conv = await db.create_conversation(
            body.topic.strip()[:60], "__roundtable__", first.provider, first.model, default_params
        )
        conv_id = conv["id"]
        await db.add_message(conv_id, "user", body.topic.strip())

    # If a follow-up was provided, save it as a user message
    if body.follow_up:
        await db.add_message(conv_id, "user", body.follow_up.strip())

    async def generate():
        n = len(body.agents)
        # Seed history from prior turns if continuing
        history: list[dict] = list(body.history or [])
        if body.follow_up:
            history.append({"persona": "User", "content": body.follow_up.strip()})
        recency: dict[int, int] = {i: 999 for i in range(n)}

        yield _sse({"type": "conv_id", "conv_id": conv_id})

        for _turn in range(body.num_turns):
            idx = _pick_speaker(recency, n)
            for i in range(n):
                recency[i] = 0 if i == idx else recency[i] + 1

            agent = body.agents[idx]
            yield _sse({"type": "speaker", "persona": agent.persona,
                        "model": agent.model, "provider": agent.provider, "idx": idx})

            # Build prompt
            system = agent.system_prompt + tone
            if history:
                hist_text = "\n\n".join(f"{e['persona']}: {e['content']}" for e in history)
                follow_note = (
                    f"\n\nA new question was just asked: \"{body.follow_up}\"\nRespond to it as {agent.persona}."
                    if body.follow_up else
                    f"\n\nNow respond as {agent.persona}. Stay in character. 2-3 sentences."
                )
                user_content = (
                    f"Topic: {body.topic}\n\n"
                    f"The conversation so far:\n{hist_text}"
                    f"{follow_note}"
                )
            else:
                user_content = (
                    f"Topic: {body.topic}\n\n"
                    f"Open the conversation as {agent.persona}. Stay in character. 2-3 sentences."
                )

            messages = [{"role": "user", "content": user_content}]
            if agent.provider != "Anthropic (paid)":
                messages = [{"role": "system", "content": system}] + messages

            accumulated = ""
            try:
                if agent.provider == "Anthropic (paid)":
                    stream_iter = llm.stream_anthropic(
                        agent.model, system, messages,
                        0.7, 1.0, 0, 512, [],
                    )
                else:
                    stream_iter = llm.stream_openai_compat(
                        agent.provider, agent.model, messages,
                        0.7, 1.0, 512, 0.0, 0.0, None, [],
                    )
                for chunk, _ in stream_iter:
                    accumulated += chunk
                    yield _sse({"type": "token", "content": chunk})
            except Exception as exc:
                yield _sse({"type": "error", "content": str(exc)})

            msg_meta = {"model": agent.model, "system_prompt": agent.system_prompt, "persona": agent.persona}
            if accumulated:
                history.append({"persona": agent.persona, "content": accumulated})
                await db.add_message(conv_id, "assistant", accumulated, msg_meta)

            yield _sse({"type": "turn_end"})

        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/api/throwdown/session", status_code=201)
async def create_throwdown_session(body: ThrowdownSessionBody):
    if len(body.contestants) != 3:
        raise HTTPException(400, "Exactly 3 contestants required")
    session = await db.create_throwdown_session(
        judge_persona=body.judge.persona,
        judge_system_prompt=body.judge.system_prompt,
        judge_provider=body.judge.provider,
        judge_model=body.judge.model,
        contestants=[c.model_dump() for c in body.contestants],
        num_rounds=body.num_rounds,
    )
    return {"session_id": session["id"]}


@app.post("/api/throwdown/round")
async def throwdown_round(body: ThrowdownRoundBody):
    import re
    session = await db.get_throwdown_session(body.session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    contestants = session["contestants"]
    judge_system_prompt = session["judge_system_prompt"]
    judge_provider = session["judge_provider"]
    judge_model = session["judge_model"]
    scores: dict = dict(session["scores"])
    num_rounds = session["num_rounds"]

    async def generate():
        responses: list[dict] = []

        # Build display labels — append short model name when personas clash
        persona_counts: dict[str, int] = {}
        for c in contestants:
            persona_counts[c["persona"]] = persona_counts.get(c["persona"], 0) + 1

        def _short_model(m: str) -> str:
            parts = m.replace("-", " ").split()
            return " ".join(parts[:3]) if len(parts) > 3 else m

        display_labels = [
            f"{c['persona']} ({_short_model(c['model'])})" if persona_counts[c["persona"]] > 1 else c["persona"]
            for c in contestants
        ]
        # Unambiguous slot labels for judge prompt (always unique)
        slot_labels = ["Contestant A", "Contestant B", "Contestant C"]

        # ── Stream each contestant ──────────────────────────────
        for i, c in enumerate(contestants):
            yield _sse({"type": "contestant_start", "persona": c["persona"],
                        "display_label": display_labels[i], "idx": i})
            system = c["system_prompt"]
            user_content = (
                f"You've been asked: {body.prompt}\n\n"
                f"Respond as {c['persona']}. 2-3 sentences. Stay in character."
            )
            messages = [{"role": "user", "content": user_content}]
            if c["provider"] != "Anthropic (paid)":
                messages = [{"role": "system", "content": system}] + messages

            accumulated = ""
            try:
                if c["provider"] == "Anthropic (paid)":
                    stream_iter = llm.stream_anthropic(c["model"], system, messages, 0.7, 1.0, 0, 512, [])
                else:
                    stream_iter = llm.stream_openai_compat(c["provider"], c["model"], messages, 0.7, 1.0, 512, 0.0, 0.0, None, [])
                for chunk, _ in stream_iter:
                    accumulated += chunk
                    yield _sse({"type": "token", "content": chunk})
            except Exception as exc:
                yield _sse({"type": "error", "content": str(exc)})

            responses.append({"persona": c["persona"], "display_label": display_labels[i], "content": accumulated})
            yield _sse({"type": "contestant_end", "persona": c["persona"]})

        # ── Stream judge verdict ────────────────────────────────
        judge_system = (
            judge_system_prompt +
            "\n\nYou are the judge of a competition. Three contestants have responded to the same prompt. "
            "Your task: decide which response is best and explain why in 2-3 sentences. "
            "Begin your verdict with exactly one of these: 'Winner: Contestant A', "
            "'Winner: Contestant B', or 'Winner: Contestant C'. Then explain your reasoning."
        )
        resp_block = "\n\n".join(
            f"{slot_labels[i]} — {display_labels[i]}:\n{r['content']}"
            for i, r in enumerate(responses)
        )
        judge_user = f"Prompt: {body.prompt}\n\n{resp_block}"
        judge_messages = [{"role": "user", "content": judge_user}]
        if judge_provider != "Anthropic (paid)":
            judge_messages = [{"role": "system", "content": judge_system}] + judge_messages

        yield _sse({"type": "judge_start"})
        judge_text = ""
        try:
            if judge_provider == "Anthropic (paid)":
                stream_iter = llm.stream_anthropic(judge_model, judge_system, judge_messages, 0.7, 1.0, 0, 512, [])
            else:
                stream_iter = llm.stream_openai_compat(judge_provider, judge_model, judge_messages, 0.7, 1.0, 512, 0.0, 0.0, None, [])
            for chunk, _ in stream_iter:
                judge_text += chunk
                yield _sse({"type": "token", "content": chunk})
        except Exception as exc:
            yield _sse({"type": "error", "content": str(exc)})
        yield _sse({"type": "judge_end"})

        # ── Parse winner by slot label (always unambiguous) ─────
        winner_idx = None
        m = re.search(r"Winner:\s*Contestant\s*([ABC])", judge_text, re.IGNORECASE)
        if m:
            winner_idx = {"A": 0, "B": 1, "C": 2}[m.group(1).upper()]

        if winner_idx is not None:
            scores[str(winner_idx)] = scores.get(str(winner_idx), 0) + 1

        winner_label = display_labels[winner_idx] if winner_idx is not None else None
        is_last = body.round_num >= num_rounds
        new_status = "complete" if is_last else "active"
        await db.update_throwdown_session(body.session_id, scores, new_status)
        await db.add_throwdown_round(
            body.session_id, body.round_num, body.prompt,
            responses, winner_label or "", judge_text,
        )

        yield _sse({"type": "result", "winner_idx": winner_idx, "winner": winner_label, "scores": scores})

        if is_last:
            champion_idx = max(scores, key=lambda k: scores[k]) if scores else None
            champion_label = display_labels[int(champion_idx)] if champion_idx is not None else None
            yield _sse({"type": "session_complete", "final_scores": scores, "champion": champion_label})

        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/openai-models")
async def openai_models():
    """Return the list of models your OpenAI API key can actually access."""
    from openai import OpenAI
    key = os.getenv("OPENAI_API_KEY", "")
    if not key:
        raise HTTPException(400, "OPENAI_API_KEY not set")
    client = OpenAI(api_key=key)
    models = sorted([m.id for m in client.models.list() if "gpt" in m.id.lower()])
    return {"models": models}


@app.get("/api/questions")
async def get_questions_endpoint():
    return get_all_questions()


class QuestionBody(BaseModel):
    category: str
    question: str


@app.post("/api/questions", status_code=201)
async def add_question_endpoint(body: QuestionBody):
    if not body.category.strip() or not body.question.strip():
        raise HTTPException(400, "category and question are required")
    add_question(body.category.strip(), body.question.strip())
    return {"category": body.category.strip(), "question": body.question.strip()}


@app.delete("/api/questions/{category}/{idx}")
async def delete_question_endpoint(category: str, idx: int):
    try:
        delete_question(category, idx)
    except (KeyError, IndexError) as e:
        raise HTTPException(404, str(e))
    return {"deleted": True}


@app.get("/api/personas")
async def get_personas():
    if not _PERSONAS_FILE.exists():
        return []
    with open(_PERSONAS_FILE, encoding="utf-8") as f:
        return json.load(f)


class PersonaBody(BaseModel):
    persona: str
    system_prompt: str
    book: str = ""
    author: str = ""
    show: str = ""


@app.post("/api/personas", status_code=201)
async def create_persona(body: PersonaBody):
    data = json.loads(_PERSONAS_FILE.read_text(encoding="utf-8"))
    if any(p["persona"] == body.persona for p in data):
        raise HTTPException(400, f"Persona '{body.persona}' already exists")
    entry: dict = {"persona": body.persona, "system_prompt": body.system_prompt}
    if body.book:   entry["book"]   = body.book
    if body.author: entry["author"] = body.author
    if body.show:   entry["show"]   = body.show
    data.append(entry)
    data.sort(key=lambda p: p["persona"].lower())
    _PERSONAS_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    _reload_persona_map()
    return entry


@app.delete("/api/personas/{persona_name}")
async def delete_persona(persona_name: str):
    data = json.loads(_PERSONAS_FILE.read_text(encoding="utf-8"))
    new_data = [p for p in data if p["persona"] != persona_name]
    if len(new_data) == len(data):
        raise HTTPException(404, f"Persona '{persona_name}' not found")
    _PERSONAS_FILE.write_text(json.dumps(new_data, indent=2, ensure_ascii=False), encoding="utf-8")
    _reload_persona_map()
    return {"deleted": persona_name}


@app.get("/api/meta")
async def meta():
    return {
        "providers": llm.PROVIDERS,
        "model_lists": llm.MODEL_LISTS,
        "param_support": llm.PARAM_SUPPORT,
        "reasoning_providers": llm.REASONING_PROVIDERS,
        "reasoning_model_lists": llm.REASONING_MODEL_LISTS,
        "sweep_params": llm.SWEEP_PARAMS,
    }


# ── Export ─────────────────────────────────────────────────────────────────────

@app.get("/api/conversations/{conv_id}/export/json")
async def export_json(conv_id: str):
    conv = await db.get_conversation(conv_id)
    if not conv:
        raise HTTPException(404)
    ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = Path(tempfile.gettempdir()) / f"llm_conv_{ts}.json"
    path.write_text(json.dumps(conv, indent=2, ensure_ascii=False), encoding="utf-8")
    return FileResponse(path, filename=f"conversation_{conv_id[:8]}_{ts}.json",
                        media_type="application/json")


@app.get("/api/conversations/{conv_id}/export/pdf")
async def export_pdf(conv_id: str):
    conv = await db.get_conversation(conv_id)
    if not conv:
        raise HTTPException(404)

    try:
        import fitz
    except ImportError:
        raise HTTPException(500, "PyMuPDF not installed")

    css = """
    body     { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; color: #1a1a1a; margin: 0; }
    h1       { font-size: 14pt; margin-bottom: 4pt; }
    .sub     { font-size: 8pt; color: #555; margin-bottom: 6pt; }
    .persona { font-size: 8.5pt; color: #4338ca; font-style: italic; margin-bottom: 14pt; }
    .sysprompt { font-size: 7.5pt; color: #666; background: #f0f0f8; border-left: 3pt solid #a5b4fc;
                 padding: 6pt 8pt; margin-bottom: 14pt; white-space: pre-wrap; }
    .msg     { border: 1pt solid #ccc; border-radius: 4pt; padding: 10pt; margin-bottom: 10pt; }
    .user    { background: #e8eaf6; }
    .asst    { background: #fff; }
    .role    { font-size: 8pt; font-weight: bold; color: #444; margin-bottom: 5pt; }
    .persona-tag { font-size: 7.5pt; color: #4338ca; font-weight: normal; }
    .text    { font-size: 9pt; line-height: 1.6; white-space: pre-wrap; }
    .meta    { font-size: 7.5pt; color: #777; margin-top: 5pt; }
    """

    # Conversation-level persona (for the header)
    conv_persona = _PERSONA_MAP.get(conv.get("system_prompt", ""), "")

    msgs_html = ""
    for m in conv.get("messages", []):
        if m["role"] == "user":
            role_label = "You"
            persona_tag = ""
            css_cls = "user"
        else:
            msg_sp    = (m.get("meta") or {}).get("system_prompt", conv.get("system_prompt", ""))
            persona   = _PERSONA_MAP.get(msg_sp, "")
            model_lbl = (m.get("meta") or {}).get("model", conv["model"])
            if persona:
                role_label  = model_lbl
                persona_tag = f' <span class="persona-tag">({_html.escape(persona)})</span>'
            else:
                role_label  = model_lbl
                persona_tag = ""
            css_cls = "asst"

        safe_text = _html.escape(m["content"])
        meta_str  = ""
        if m.get("meta") and m["role"] == "assistant":
            mt = m["meta"]
            parts = []
            if mt.get("latency_s"):
                parts.append(f"⏱ {mt['latency_s']}s")
            in_t  = mt.get("prompt_tokens") or mt.get("input_tokens", 0)
            out_t = mt.get("completion_tokens") or mt.get("output_tokens", 0)
            if in_t or out_t:
                parts.append(f"{in_t} in / {out_t} out tokens")
            meta_str = f'<div class="meta">{" · ".join(parts)}</div>' if parts else ""

        msgs_html += f"""
        <div class="msg {css_cls}">
          <div class="role">{_html.escape(role_label)}{persona_tag}</div>
          <div class="text">{safe_text}</div>
          {meta_str}
        </div>"""

    # Header: persona block if conversation has one
    persona_html = ""
    if conv_persona:
        persona_html = f'<div class="persona">Persona: {_html.escape(conv_persona)}</div>'
        sys_text = conv.get("system_prompt", "")
        if sys_text:
            persona_html += f'<div class="sysprompt">{_html.escape(sys_text)}</div>'

    full_html = f"""<html><head><style>{css}</style></head><body>
    <h1>{_html.escape(conv["title"])}</h1>
    <div class="sub">Provider: {_html.escape(conv["provider"])} · Model: {_html.escape(conv["model"])} ·
    Exported {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}</div>
    {persona_html}
    {msgs_html}
    </body></html>"""

    ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = Path(tempfile.gettempdir()) / f"llm_conv_{ts}.pdf"

    story    = fitz.Story(html=full_html)
    writer   = fitz.DocumentWriter(str(path))
    mediabox = fitz.paper_rect("letter")
    margin   = 54
    where    = fitz.Rect(margin, margin, mediabox.width - margin, mediabox.height - margin)
    more = True
    while more:
        device = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(device)
        writer.end_page()
    writer.close()

    return FileResponse(path, filename=f"conversation_{conv_id[:8]}_{ts}.pdf",
                        media_type="application/pdf")


# ── Serve built React frontend (production) ────────────────────────────────────

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        index = FRONTEND_DIST / "index.html"
        return FileResponse(index)


if __name__ == "__main__":
    import uvicorn
    _backend_dir = str(Path(__file__).parent)
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True,
                reload_dirs=[_backend_dir])
