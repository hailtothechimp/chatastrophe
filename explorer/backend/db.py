"""SQLite database helpers using aiosqlite."""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

DB_PATH = Path(__file__).parent / "explorer.db"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uuid() -> str:
    return str(uuid.uuid4())


def _connect():
    """Open a connection with WAL mode timeout to handle concurrent Arena requests."""
    return aiosqlite.connect(DB_PATH, timeout=30)


async def init_db() -> None:
    async with _connect() as db:
        await db.execute("PRAGMA journal_mode=WAL")   # concurrent readers during writes
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                is_admin      INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL
            )
        """)
        # Migrate: add is_admin to existing DBs that lack it
        try:
            await db.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        except Exception:
            pass  # column already exists
        await db.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id            TEXT PRIMARY KEY,
                title         TEXT NOT NULL,
                system_prompt TEXT NOT NULL DEFAULT '',
                provider      TEXT NOT NULL,
                model         TEXT NOT NULL,
                params        TEXT NOT NULL,
                created_at    TEXT NOT NULL,
                updated_at    TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id               TEXT PRIMARY KEY,
                conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role             TEXT NOT NULL,
                content          TEXT NOT NULL,
                meta             TEXT,
                created_at       TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_conv
            ON messages(conversation_id, created_at)
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS throwdown_sessions (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at           TEXT NOT NULL,
                judge_persona        TEXT NOT NULL,
                judge_system_prompt  TEXT NOT NULL,
                judge_provider       TEXT NOT NULL,
                judge_model          TEXT NOT NULL,
                contestants          TEXT NOT NULL,
                num_rounds           INTEGER NOT NULL,
                scores               TEXT NOT NULL DEFAULT '{}',
                status               TEXT NOT NULL DEFAULT 'active'
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS throwdown_rounds (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id       INTEGER NOT NULL REFERENCES throwdown_sessions(id),
                round_num        INTEGER NOT NULL,
                prompt           TEXT NOT NULL,
                responses        TEXT NOT NULL,
                winner_persona   TEXT NOT NULL,
                judge_reasoning  TEXT NOT NULL,
                created_at       TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.commit()


# ── Conversations ─────────────────────────────────────────────────────────────

async def list_conversations() -> list[dict]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, title, provider, model, system_prompt, updated_at FROM conversations ORDER BY updated_at DESC"
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def create_conversation(
    title: str, system_prompt: str, provider: str, model: str, params: dict
) -> dict:
    conv = {
        "id": _uuid(),
        "title": title,
        "system_prompt": system_prompt,
        "provider": provider,
        "model": model,
        "params": json.dumps(params),
        "created_at": _now(),
        "updated_at": _now(),
    }
    async with _connect() as db:
        await db.execute("""
            INSERT INTO conversations (id, title, system_prompt, provider, model, params, created_at, updated_at)
            VALUES (:id, :title, :system_prompt, :provider, :model, :params, :created_at, :updated_at)
        """, conv)
        await db.commit()
    conv["params"] = params
    conv["messages"] = []
    return conv


async def get_conversation(conv_id: str) -> dict | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM conversations WHERE id = ?", (conv_id,)
        ) as cur:
            row = await cur.fetchone()
        if not row:
            return None
        conv = dict(row)
        conv["params"] = json.loads(conv["params"])
        async with db.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
            (conv_id,),
        ) as cur:
            msgs = await cur.fetchall()
        conv["messages"] = [
            {**dict(m), "meta": json.loads(m["meta"]) if m["meta"] else None}
            for m in msgs
        ]
    return conv


async def update_conversation(conv_id: str, **fields) -> None:
    """Update arbitrary conversation fields (title, system_prompt, provider, model, params)."""
    if "params" in fields and isinstance(fields["params"], dict):
        fields["params"] = json.dumps(fields["params"])
    fields["updated_at"] = _now()
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    fields["id"] = conv_id
    async with _connect() as db:
        await db.execute(f"UPDATE conversations SET {sets} WHERE id = :id", fields)
        await db.commit()


async def delete_conversation(conv_id: str) -> None:
    async with _connect() as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
        await db.commit()


# ── Messages ─────────────────────────────────────────────────────────────────

# ── Throwdown ─────────────────────────────────────────────────────────────────

async def create_throwdown_session(
    judge_persona: str, judge_system_prompt: str,
    judge_provider: str, judge_model: str,
    contestants: list[dict], num_rounds: int,
) -> dict:
    now = _now()
    async with _connect() as db:
        cur = await db.execute("""
            INSERT INTO throwdown_sessions
              (created_at, judge_persona, judge_system_prompt, judge_provider, judge_model,
               contestants, num_rounds, scores, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'active')
        """, (now, judge_persona, judge_system_prompt, judge_provider, judge_model,
              json.dumps(contestants), num_rounds))
        session_id = cur.lastrowid
        await db.commit()
    return {"id": session_id, "created_at": now, "scores": {}, "status": "active"}


async def get_throwdown_session(session_id: int) -> dict | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM throwdown_sessions WHERE id = ?", (session_id,)
        ) as cur:
            row = await cur.fetchone()
    if not row:
        return None
    d = dict(row)
    d["contestants"] = json.loads(d["contestants"])
    d["scores"] = json.loads(d["scores"])
    return d


async def update_throwdown_session(session_id: int, scores: dict, status: str = "active") -> None:
    async with _connect() as db:
        await db.execute(
            "UPDATE throwdown_sessions SET scores = ?, status = ? WHERE id = ?",
            (json.dumps(scores), status, session_id),
        )
        await db.commit()


async def add_throwdown_round(
    session_id: int, round_num: int, prompt: str,
    responses: list[dict], winner_persona: str, judge_reasoning: str,
) -> None:
    async with _connect() as db:
        await db.execute("""
            INSERT INTO throwdown_rounds
              (session_id, round_num, prompt, responses, winner_persona, judge_reasoning)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (session_id, round_num, prompt, json.dumps(responses), winner_persona, judge_reasoning))
        await db.commit()


# ── Messages ─────────────────────────────────────────────────────────────────

# ── Users ────────────────────────────────────────────────────────────────────

async def get_user(username: str) -> dict | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def create_user(username: str, password_hash: str, is_admin: bool = False) -> dict:
    now = _now()
    async with _connect() as db:
        await db.execute(
            "INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)",
            (username, password_hash, 1 if is_admin else 0, now),
        )
        await db.commit()
    return {"username": username, "is_admin": is_admin, "created_at": now}


async def list_users() -> list[dict]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT username, is_admin, created_at FROM users ORDER BY created_at ASC"
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def update_user(username: str, password_hash: str | None = None, is_admin: bool | None = None) -> None:
    fields: dict = {}
    if password_hash is not None:
        fields["password_hash"] = password_hash
    if is_admin is not None:
        fields["is_admin"] = 1 if is_admin else 0
    if not fields:
        return
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    fields["username"] = username
    async with _connect() as db:
        await db.execute(f"UPDATE users SET {sets} WHERE username = :username", fields)
        await db.commit()


async def delete_user(username: str) -> None:
    async with _connect() as db:
        await db.execute("DELETE FROM users WHERE username = ?", (username,))
        await db.commit()


async def add_message(
    conversation_id: str, role: str, content: str, meta: dict | None = None
) -> dict:
    msg = {
        "id": _uuid(),
        "conversation_id": conversation_id,
        "role": role,
        "content": content,
        "meta": json.dumps(meta) if meta else None,
        "created_at": _now(),
    }
    async with _connect() as db:
        await db.execute("""
            INSERT INTO messages (id, conversation_id, role, content, meta, created_at)
            VALUES (:id, :conversation_id, :role, :content, :meta, :created_at)
        """, msg)
        await db.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?",
            (_now(), conversation_id),
        )
        await db.commit()
    msg["meta"] = meta
    return msg
