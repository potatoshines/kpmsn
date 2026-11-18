"""Profile curator for the KP Member Service Navigator.

Turns a raw member record (the shape used in src/data/members.js) into two parts:

  agent_context   Minimal, de-identified facts that are safe to send to the tagging agent.
  matcher_facts   Exact values the matcher script needs for eligibility checks.
                  Stays server-side and is never sent to the model.

Design rules
  - Minimum necessary: the agent never sees name, member ID, DOB, phone, address, PCP,
    medication names, allergies or conditions.
  - The agent only tags. Eligibility (plan flags, exact amounts) is decided by the matcher.
  - Dates become relative offsets, so the agent sees "due in 21 days", not a calendar date.
  - Deterministic: the same record and the same as_of date always give the same output.

Usage
  python profile_curator.py members.json KP-100234 --as-of 2026-10-15
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

_DATED = re.compile(r"^(\d{4}-\d{2}-\d{2})\s+(.+)$")
_EMPTY = {"", "none", "none scheduled", "none recorded", "n/a"}


def _to_date(value: str | None) -> date | None:
    try:
        return datetime.strptime(value or "", "%Y-%m-%d").date()
    except ValueError:
        return None


def _age_band(dob: str | None, as_of: date) -> str | None:
    born = _to_date(dob)
    if born is None:
        return None
    age = as_of.year - born.year - ((as_of.month, as_of.day) < (born.month, born.day))
    if age < 0:
        return None
    if age >= 80:
        return "80+"
    low = age // 10 * 10
    return f"{low}-{low + 9}"


def _plan_category(plan: str | None) -> str:
    p = (plan or "").lower()
    if "medicare" in p or "senior advantage" in p:
        return "medicare_advantage"
    for kind in ("hmo", "ppo"):
        if kind in p:
            return kind
    return "other"


def _dated_item(raw: str | None, as_of: date) -> dict[str, Any] | None:
    """'2026-11-12 Primary care follow-up' -> {'what': ..., 'days_from_now': 28}."""
    raw = (raw or "").strip()
    if raw.lower() in _EMPTY:
        return None
    match = _DATED.match(raw)
    if not match:
        return {"what": raw, "days_from_now": None}
    when = _to_date(match.group(1))
    return {
        "what": match.group(2),
        "days_from_now": (when - as_of).days if when else None,
    }


def _split_list(raw: str | None) -> list[str]:
    items = [s.strip() for s in re.split(r"[;,]", raw or "")]
    return [s for s in items if s and s.lower() not in _EMPTY]


@dataclass
class CuratedProfile:
    agent_context: dict[str, Any]
    matcher_facts: dict[str, Any]

    def agent_json(self) -> str:
        """Compact, stable JSON string to embed in the agent request."""
        return json.dumps(self.agent_context, sort_keys=True, ensure_ascii=False)


def curate(member: dict[str, Any], as_of: date | None = None) -> CuratedProfile:
    if not member.get("id"):
        raise ValueError("member record has no 'id'")
    as_of = as_of or date.today()

    due = float(member.get("due") or 0)
    due_date = _to_date(member.get("dd"))
    days_until_due = (due_date - as_of).days if (due > 0 and due_date) else None

    history = []
    for entry in (member.get("hist") or [])[:3]:
        item = _dated_item(entry, as_of)
        if item and item["days_from_now"] is not None:
            history.append({"topic": item["what"], "days_ago": -item["days_from_now"]})

    meds = _split_list(member.get("meds"))
    plan = member.get("plan") or ""

    agent_context = {
        "age_band": _age_band(member.get("dob"), as_of),
        "languages": [s.strip() for s in (member.get("lang") or "").split("/") if s.strip()],
        "plan_name": plan,
        "plan_category": _plan_category(plan),
        "balance": {"outstanding": due > 0, "days_until_due": days_until_due},
        "upcoming_appointment": _dated_item(member.get("ap"), as_of),
        "upcoming_procedure": _dated_item(member.get("sx"), as_of),
        "active_medication_count": len(meds),
        "recent_interactions": history,
    }

    matcher_facts = {
        "member_id": member["id"],
        "plan_name": plan,
        "plan_category": _plan_category(plan),
        "includes_transportation": bool(member.get("tp")),
        "amount_due": due,
        "due_date": member.get("dd") or None,
        "next_appointment": member.get("ap") or None,
        "next_procedure": member.get("sx") or None,
        "medications": meds,
    }
    return CuratedProfile(agent_context, matcher_facts)


def redact_known_identifiers(text: str, member: dict[str, Any]) -> str:
    """Replace this member's own identifiers in free text (for example a transcript).

    Exact, case-insensitive matches only. Use it before the transcript is sent to the
    agent, and keep a real PII detector (for example Sensitive Data Protection) for
    identifiers that are not in the member record.
    """
    pairs: list[tuple[str, str]] = []
    name = (member.get("name") or "").strip()
    if name:
        pairs.append((name, "[MEMBER_NAME]"))
        pairs += [(part, "[MEMBER_NAME]") for part in name.split() if len(part) > 2]
    for key, placeholder in (
        ("id", "[MEMBER_ID]"),
        ("ph", "[PHONE]"),
        ("addr", "[ADDRESS]"),
        ("dob", "[DOB]"),
    ):
        value = (member.get(key) or "").strip()
        if value:
            pairs.append((value, placeholder))
    for needle, placeholder in sorted(pairs, key=lambda p: len(p[0]), reverse=True):
        text = re.sub(re.escape(needle), placeholder, text, flags=re.IGNORECASE)
    return text


def _main() -> None:
    parser = argparse.ArgumentParser(description="Curate a member record for the agent.")
    parser.add_argument("members_json", help="JSON file: a list of member records")
    parser.add_argument("member_id", help="for example KP-100234")
    parser.add_argument("--as-of", help="YYYY-MM-DD (default: today)")
    args = parser.parse_args()

    with open(args.members_json, encoding="utf-8") as f:
        members = json.load(f)
    member = next((m for m in members if m.get("id") == args.member_id), None)
    if member is None:
        raise SystemExit(f"No member {args.member_id} in {args.members_json}")

    curated = curate(member, _to_date(args.as_of) if args.as_of else None)
    print(json.dumps({"agent_context": curated.agent_context,
                      "matcher_facts": curated.matcher_facts}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    _main()
