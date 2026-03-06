"""Question bank for the LLM Parameter Explorer — backed by questions.json."""

import json
from pathlib import Path

_QUESTIONS_FILE = Path(__file__).parent / "questions.json"


def _load() -> dict[str, list[str]]:
    return json.loads(_QUESTIONS_FILE.read_text(encoding="utf-8"))


def _save(data: dict[str, list[str]]) -> None:
    _QUESTIONS_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def get_all_questions() -> dict[str, list[str]]:
    return _load()


def add_question(category: str, question: str) -> None:
    data = _load()
    if category not in data:
        data[category] = []
    if question not in data[category]:
        data[category].append(question)
    _save(data)


def delete_question(category: str, idx: int) -> None:
    data = _load()
    if category not in data:
        raise KeyError(f"Category '{category}' not found")
    qs = data[category]
    if idx < 0 or idx >= len(qs):
        raise IndexError(f"Index {idx} out of range for category '{category}'")
    qs.pop(idx)
    if not qs:
        del data[category]
    _save(data)


def add_category(category: str) -> None:
    data = _load()
    if category not in data:
        data[category] = []
        _save(data)


def delete_category(category: str) -> None:
    data = _load()
    if category in data:
        del data[category]
        _save(data)
