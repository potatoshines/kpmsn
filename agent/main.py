"""Tagging agent service: transcript + curated profile in, closed-vocabulary tags out.
The model never sees the catalog and never decides eligibility; it only returns tags with evidence."""
import json, logging, os, pathlib, re
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

VOCAB = json.loads((pathlib.Path(__file__).parent / "vocabulary.json").read_text())
MODEL = os.environ.get("MODEL", "gemini-3.8-flash")  # check the exact ID in the console model list
SECRET = os.environ.get("APP_SECRET", "")
ORIGINS = [o for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o]
MAX_TURNS, MAX_CHARS = 60, 600

SYSTEM = f"""You tag a health-plan member's call so a separate program can look up support resources.
Return tags ONLY from this list: {", ".join(VOCAB)}.
Rules:
- source "transcript": only when the MEMBER says or clearly implies the need. Representative lines are never evidence.
- source "profile": only when the profile data directly shows it.
- Every item needs a short evidence quote (member's words or the profile field). No evidence, no tag.
- Do not guess eligibility. Do not infer conditions the data does not state. Return [] if nothing applies."""

SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "tag": {"type": "string"},  # a 143-value enum is rejected by the API; VOCAB is enforced below
            "source": {"type": "string", "enum": ["transcript", "profile"]},
            "turn": {"type": "integer"},
            "evidence": {"type": "string"},
        },
        "required": ["tag", "source", "evidence"]}}},
    "required": ["items"],
}

class Turn(BaseModel):
    turn: int
    speaker: str
    text: str = Field(max_length=MAX_CHARS)

class Req(BaseModel):
    transcript: list[Turn] = Field(max_length=MAX_TURNS)
    profile: dict = {}

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["POST"], allow_headers=["*"])
_client = None

_THINK = [dict(thinking_level="MINIMAL"), dict(thinking_level="LOW"), dict(thinking_budget=0), None]
_think_ok = None  # index of the first thinking setting the model accepted

_THINK = [dict(thinking_level="MINIMAL"), dict(thinking_level="LOW"), dict(thinking_budget=0), None]
_think_ok = None  # index of the first thinking setting the model accepted

_THINK = [dict(thinking_level="MINIMAL"), dict(thinking_level="LOW"), dict(thinking_budget=0), None]
_think_ok = None  # index of the first thinking setting the model accepted

def call_model(prompt: str) -> str:
    """The only function that talks to Google. Tests replace it."""
    global _client, _think_ok
    from google import genai
    from google.genai import types
    from google.genai.errors import ClientError
    if _client is None:
        _client = genai.Client(enterprise=True)  # reads project/location from env vars
    order = [_think_ok] if _think_ok is not None else range(len(_THINK))
    last = None
    for i in order:
        kw = dict(system_instruction=SYSTEM, temperature=0, response_mime_type="application/json",
                  response_json_schema=SCHEMA, max_output_tokens=1500)
        if _THINK[i]:
            kw["thinking_config"] = types.ThinkingConfig(**_THINK[i])
        try:
            r = _client.models.generate_content(model=MODEL, contents=prompt,
                                                config=types.GenerateContentConfig(**kw))
        except ClientError as e:
            if e.code != 400:
                raise
            logging.warning("thinking option %s rejected: %s", _THINK[i], e)
            last = e
            continue
        if _think_ok is None:
            _think_ok = i
            logging.warning("using thinking option %s", _THINK[i])
        return r.text
    raise last

@app.get("/health")
def healthz(): return {"ok": True, "tags": len(VOCAB)}

@app.post("/tag")
def tag(req: Req, x_app_secret: str = Header(default="")):
    if SECRET and x_app_secret != SECRET:
        raise HTTPException(401, "bad secret")
    prompt = json.dumps({"transcript": [t.model_dump() for t in req.transcript], "profile": req.profile})
    try:
        data = json.loads(call_model(prompt))
    except Exception as e:  # never leak model errors to the browser
        logging.exception("model call failed")
        raise HTTPException(502, "tagging failed") from e
    ok, items = set(VOCAB), []
    for i in data.get("items", []):
        t = re.sub(r"[\s-]+", "_", str(i.get("tag", "")).strip().lower())
        if t in ok and i.get("evidence"):
            items.append({**i, "tag": t})
        else:
            logging.warning("dropped tag %r", i.get("tag"))
    return {"items": items}
