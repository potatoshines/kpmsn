"""Build agent-ready input files from the exported member data.

For each member in members.json it writes two files into agent/out/:

  <member_id>.agent_input.json     transcript + curated profile. This is the ONLY file
                                   that is ever sent to the model.
  <member_id>.matcher_facts.json   exact values for the matcher script. Server-side only.

The member records are NOT copied into agent/. src/data/members.js stays the single source
of truth; `npm run export:members` writes a generated copy to agent/out/members.export.json.

Run from the repo root:
  npm run export:members
  python agent/build_agent_inputs.py --as-of 2026-10-15
  python agent/build_agent_inputs.py --transcripts-dir agent/transcripts   # optional .txt overrides
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import date
from pathlib import Path
from typing import Any

from profile_curator import curate, redact_known_identifiers

HERE = Path(__file__).resolve().parent
_LINE = re.compile(r"^(Rep|Member):\s*(.+)$", re.IGNORECASE)


def read_txt_transcript(path: Path) -> list[list[str]]:
    """Same format as the app's file loader: one 'Rep: ...' or 'Member: ...' per line."""
    turns = []
    for line in path.read_text(encoding="utf-8").splitlines():
        match = _LINE.match(line.strip())
        if match:
            turns.append([match.group(1).capitalize(), match.group(2)])
    return turns


def clean_turns(turns: list[list[str]], member: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize speakers and whitespace, redact known identifiers, number the turns."""
    cleaned = []
    for speaker, text in turns:
        speaker = "Rep" if str(speaker).strip().lower().startswith("r") else "Member"
        text = re.sub(r"\s+", " ", str(text)).strip()
        text = redact_known_identifiers(text, member)
        if text:
            cleaned.append({"turn": len(cleaned) + 1, "speaker": speaker, "text": text})
    return cleaned


def assert_no_identifiers(payload: dict[str, Any], member: dict[str, Any]) -> None:
    """Fail closed: refuse to write a model-bound file that still contains an identifier."""
    blob = json.dumps(payload, ensure_ascii=False).lower()
    secrets = [member.get(k) for k in ("id", "name", "dob", "ph", "addr")]
    secrets += (member.get("name") or "").split()
    for secret in secrets:
        secret = (secret or "").strip().lower()
        if len(secret) > 2 and secret in blob:
            raise ValueError(f"{member.get('id')}: identifier still present in agent input")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build agent input files.")
    parser.add_argument("--members", default=str(HERE / "out" / "members.export.json"))
    parser.add_argument("--out", default=str(HERE / "out"))
    parser.add_argument("--as-of", help="YYYY-MM-DD (default: today)")
    parser.add_argument("--transcripts-dir", help="optional folder of <member_id>.txt files")
    args = parser.parse_args()

    as_of = date.fromisoformat(args.as_of) if args.as_of else date.today()
    members = json.loads(Path(args.members).read_text(encoding="utf-8"))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    for member in members:
        override = Path(args.transcripts_dir or "") / f"{member['id']}.txt"
        turns = read_txt_transcript(override) if args.transcripts_dir and override.exists() \
            else member.get("tr", [])

        curated = curate(member, as_of)
        payload = {"transcript": clean_turns(turns, member), "profile": curated.agent_context}
        assert_no_identifiers(payload, member)

        (out_dir / f"{member['id']}.agent_input.json").write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        (out_dir / f"{member['id']}.matcher_facts.json").write_text(
            json.dumps(curated.matcher_facts, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{member['id']}: {len(payload['transcript'])} turns -> {out_dir}")


if __name__ == "__main__":
    main()
