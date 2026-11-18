"""Tagging agent service: transcript + curated profile in, closed-vocabulary tags out.
The model never sees the catalog and never decides eligibility; it only returns tags with evidence."""
import hmac, json, logging, os, pathlib, re, time
from datetime import datetime, timezone
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

VOCAB = json.loads((pathlib.Path(__file__).parent / "vocabulary.json").read_text())
MODEL = os.environ.get("MODEL", "gemini-3.8-flash")  # check the exact ID in the console model list
# Access control. /tag costs money, so it is closed unless ADMIN_CODE is set (fail closed) and every call
# must present it. The public website never calls this service; only the team's admin panel does.
ADMIN_CODE = os.environ.get("ADMIN_CODE", "").strip()  # the site trims what you type, so trim this too
DAILY_LIMIT = int(os.environ.get("DAILY_LIMIT", "300"))  # model calls per UTC day, per running instance
LOCK_AFTER, LOCK_SECONDS = 8, 600  # wrong codes allowed per client before it is locked out for a while
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

# In-memory counters: best effort. They reset when the instance restarts (it scales to zero when idle),
# so they are a second layer. The first layer is the admin code; the hard limits are the Cloud Run
# max-instances setting and the Google Cloud budget and quotas.
_used = {"day": "", "n": 0}
_fails: dict[str, list[float]] = {}

def _client_id(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    # the last entry is the address Google's front end saw; earlier entries can be faked by the caller
    return (fwd.split(",")[-1].strip() or (request.client.host if request.client else "?"))[:64]

def _remaining() -> int:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if _used["day"] != today:
        _used.update(day=today, n=0)
    return max(0, DAILY_LIMIT - _used["n"])

def check_admin(request: Request, code: str) -> None:
    if not ADMIN_CODE:
        raise HTTPException(503, "agent is not configured")
    who, now = _client_id(request), time.time()
    recent = [t for t in _fails.get(who, []) if now - t < LOCK_SECONDS]
    if len(recent) >= LOCK_AFTER:
        _fails[who] = recent
        raise HTTPException(429, "too many wrong codes, try again later")
    if not hmac.compare_digest(code.strip().encode("utf-8"), ADMIN_CODE.encode("utf-8")):
        if len(_fails) > 1000:
            _fails.clear()
        _fails[who] = recent + [now]
        raise HTTPException(401, "wrong admin code")
    _fails.pop(who, None)

@app.post("/auth")
def auth(request: Request, x_admin_code: str = Header(default="")):
    """Checks the code without spending anything; the admin panel uses it to unlock."""
    check_admin(request, x_admin_code)
    return {"ok": True, "remaining": _remaining(), "limit": DAILY_LIMIT, "model": MODEL}

@app.get("/health")
def healthz(): return {"ok": True, "tags": len(VOCAB)}

@app.post("/tag")
def tag(req: Req, request: Request, x_admin_code: str = Header(default="")):
    check_admin(request, x_admin_code)
    if _remaining() <= 0:
        raise HTTPException(429, "daily limit reached")
    _used["n"] += 1
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
    return {"items": items, "remaining": _remaining(), "limit": DAILY_LIMIT, "model": MODEL}
