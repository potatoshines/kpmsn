import json, main
from fastapi.testclient import TestClient
c = TestClient(main.app)
body = {"transcript": [{"turn": 1, "speaker": "member", "text": "I can't afford this bill"}], "profile": {}}
def test_filters_and_shapes(monkeypatch):
    fake = {"items": [{"tag": "payment_difficulty", "source": "transcript", "turn": 1, "evidence": "can't afford"},
                      {"tag": "NOT_A_TAG", "source": "transcript", "evidence": "x"},
                      {"tag": "medical_bills", "source": "transcript", "evidence": ""}]}
    monkeypatch.setattr(main, "call_model", lambda p: json.dumps(fake))
    r = c.post("/tag", json=body); assert r.status_code == 200
    assert [i["tag"] for i in r.json()["items"]] == ["payment_difficulty"]
def test_model_failure_is_502(monkeypatch):
    monkeypatch.setattr(main, "call_model", lambda p: (_ for _ in ()).throw(RuntimeError("boom")))
    assert c.post("/tag", json=body).status_code == 502
def test_secret_and_limits(monkeypatch):
    monkeypatch.setattr(main, "SECRET", "s")
    assert c.post("/tag", json=body).status_code == 401
    big = {"transcript": [{"turn": 1, "speaker": "member", "text": "x" * 601}]}
    assert c.post("/tag", json=big, headers={"x-app-secret": "s"}).status_code == 422
