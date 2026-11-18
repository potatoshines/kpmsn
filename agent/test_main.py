import json, main
from fastapi.testclient import TestClient

c = TestClient(main.app)
body = {"transcript": [{"turn": 1, "speaker": "member", "text": "I can't afford this bill"}], "profile": {}}
GOOD = {"x-admin-code": "letmein"}


def setup_function(_):
    main.ADMIN_CODE, main.DAILY_LIMIT = "letmein", 3
    main._used.update(day="", n=0)
    main._fails.clear()


def stub(monkeypatch, items):
    monkeypatch.setattr(main, "call_model", lambda p: json.dumps({"items": items}))


def test_filters_and_shapes(monkeypatch):
    stub(monkeypatch, [{"tag": "Payment Difficulty", "source": "transcript", "turn": 1, "evidence": "can't afford"},
                       {"tag": "NOT_A_TAG", "source": "transcript", "evidence": "x"},
                       {"tag": "medical_bills", "source": "transcript", "evidence": ""}])
    r = c.post("/tag", json=body, headers=GOOD)
    assert r.status_code == 200
    j = r.json()
    assert [i["tag"] for i in j["items"]] == ["payment_difficulty"]
    assert j["remaining"] == 2 and j["limit"] == 3 and j["model"] == main.MODEL


def test_model_failure_is_502(monkeypatch):
    monkeypatch.setattr(main, "call_model", lambda p: (_ for _ in ()).throw(RuntimeError("boom")))
    assert c.post("/tag", json=body, headers=GOOD).status_code == 502


def test_closed_without_a_code_and_when_unconfigured(monkeypatch):
    stub(monkeypatch, [])
    assert c.post("/tag", json=body).status_code == 401
    assert c.post("/tag", json=body, headers={"x-admin-code": "nope"}).status_code == 401
    main.ADMIN_CODE = ""  # not configured: even an empty code must not get in
    assert c.post("/tag", json=body).status_code == 503
    assert c.post("/tag", json=body, headers={"x-admin-code": ""}).status_code == 503
    assert c.post("/auth").status_code == 503


def test_wrong_code_never_spends_a_call(monkeypatch):
    calls = []
    monkeypatch.setattr(main, "call_model", lambda p: (calls.append(1), '{"items": []}')[1])
    c.post("/tag", json=body, headers={"x-admin-code": "bad"})
    assert calls == [] and main._used["n"] == 0


def test_daily_limit(monkeypatch):
    stub(monkeypatch, [])
    for _ in range(3):
        assert c.post("/tag", json=body, headers=GOOD).status_code == 200
    r = c.post("/tag", json=body, headers=GOOD)
    assert r.status_code == 429 and "daily" in r.json()["detail"]
    assert c.post("/auth", headers=GOOD).json()["remaining"] == 0  # /auth is free and still works


def test_lockout_after_repeated_wrong_codes(monkeypatch):
    stub(monkeypatch, [])
    for _ in range(main.LOCK_AFTER):
        assert c.post("/auth", headers={"x-admin-code": "bad"}).status_code == 401
    assert c.post("/auth", headers={"x-admin-code": "bad"}).status_code == 429
    assert c.post("/auth", headers=GOOD).status_code == 429  # locked out even with the right code


def test_auth_ok_and_resets_failures(monkeypatch):
    c.post("/auth", headers={"x-admin-code": "bad"})
    r = c.post("/auth", headers=GOOD)
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["limit"] == 3
    assert main._fails == {}


def test_input_limits(monkeypatch):
    stub(monkeypatch, [])
    big = {"transcript": [{"turn": 1, "speaker": "member", "text": "x" * 601}]}
    assert c.post("/tag", json=big, headers=GOOD).status_code == 422
    many = {"transcript": [{"turn": k, "speaker": "member", "text": "x"} for k in range(61)]}
    assert c.post("/tag", json=many, headers=GOOD).status_code == 422


def test_whitespace_around_the_code_does_not_matter(monkeypatch):
    import importlib
    monkeypatch.setenv("ADMIN_CODE", "  abc123\n")
    m = importlib.reload(main)
    try:
        assert m.ADMIN_CODE == "abc123"
        cl = TestClient(m.app)
        assert cl.post("/auth", headers={"x-admin-code": "abc123"}).status_code == 200
        assert cl.post("/auth", headers={"x-admin-code": " abc123 "}).status_code == 200
        assert cl.post("/auth", headers={"x-admin-code": "abc12"}).status_code == 401
    finally:
        monkeypatch.delenv("ADMIN_CODE")
        importlib.reload(main)
