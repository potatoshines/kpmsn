import json
import unittest
from datetime import date

from profile_curator import curate, redact_known_identifiers

AS_OF = date(2026, 10, 15)

MARIA = {
    "id": "KP-100234", "name": "Maria Alvarez", "dob": "1978-04-12", "plan": "Silver 70 HMO",
    "tp": False, "pcp": "Dr. Priya Raman", "lang": "Spanish / English", "ph": "(555) 010-2231",
    "addr": "22 Elm St, Pasadena, CA", "due": 412.6, "dd": "2026-11-05",
    "meds": "Metformin 500 mg", "al": "Penicillin", "cond": "Type 2 diabetes",
    "ap": "2026-11-12 Primary care follow-up", "sx": "None scheduled",
    "hist": ["2026-09-20 Billing question about lab charge", "2026-06-03 Address update"],
}
JAMES = {
    "id": "KP-100871", "name": "James Okafor", "dob": "1951-09-03",
    "plan": "Senior Advantage (Medicare)", "tp": True, "pcp": "Dr. Lena Ortiz",
    "lang": "English", "ph": "(555) 010-8874", "addr": "8 Oak Ave, Altadena, CA",
    "due": 0, "dd": "", "meds": "Lisinopril 10 mg", "al": "None recorded",
    "cond": "Hypertension", "ap": "2026-11-09 Cardiology visit",
    "sx": "2026-12-02 Colonoscopy",
    "hist": ["2026-08-12 Refill question", "2026-05-30 Appointment reschedule"],
}
LINDA = {
    "id": "KP-100552", "name": "Linda Chen", "dob": "1965-02-27", "plan": "Gold 80 PPO",
    "tp": False, "pcp": "Dr. Samir Patel", "lang": "English / Mandarin",
    "ph": "(555) 010-4417", "addr": "140 Pine Rd, Glendale, CA", "due": 0, "dd": "",
    "meds": "Atorvastatin 20 mg", "al": "Latex", "cond": "High cholesterol",
    "ap": "2026-11-18 Annual checkup", "sx": "None scheduled",
    "hist": ["2026-09-02 Provider directory question"],
}
ALL = [MARIA, JAMES, LINDA]


class CuratorTests(unittest.TestCase):
    def test_agent_context_has_no_identifiers(self):
        for m in ALL:
            blob = json.dumps(curate(m, AS_OF).agent_context).lower()
            for key in ("id", "name", "dob", "ph", "addr", "pcp", "meds", "al", "cond"):
                value = str(m[key]).lower()
                if value in ("none recorded",):
                    continue
                self.assertNotIn(value, blob, f"{m['id']} leaked {key}")
            for part in m["name"].lower().split():
                self.assertNotIn(part, blob)

    def test_balance_is_relative_and_hides_amount(self):
        ctx = curate(MARIA, AS_OF).agent_context
        self.assertEqual(ctx["balance"], {"outstanding": True, "days_until_due": 21})
        self.assertNotIn("412", json.dumps(ctx))

    def test_no_balance(self):
        ctx = curate(JAMES, AS_OF).agent_context
        self.assertEqual(ctx["balance"], {"outstanding": False, "days_until_due": None})

    def test_age_band_and_plan_category(self):
        self.assertEqual(curate(MARIA, AS_OF).agent_context["age_band"], "40-49")
        self.assertEqual(curate(LINDA, AS_OF).agent_context["age_band"], "60-69")
        james = curate(JAMES, AS_OF).agent_context
        self.assertEqual(james["age_band"], "70-79")
        self.assertEqual(james["plan_category"], "medicare_advantage")
        self.assertEqual(curate(LINDA, AS_OF).agent_context["plan_category"], "ppo")

    def test_dated_items(self):
        ctx = curate(JAMES, AS_OF).agent_context
        self.assertEqual(ctx["upcoming_appointment"], {"what": "Cardiology visit", "days_from_now": 25})
        self.assertEqual(ctx["upcoming_procedure"], {"what": "Colonoscopy", "days_from_now": 48})
        self.assertIsNone(curate(LINDA, AS_OF).agent_context["upcoming_procedure"])

    def test_history_is_relative(self):
        hist = curate(MARIA, AS_OF).agent_context["recent_interactions"]
        self.assertEqual(hist[0], {"topic": "Billing question about lab charge", "days_ago": 25})

    def test_matcher_facts_stay_separate(self):
        james = curate(JAMES, AS_OF)
        self.assertTrue(james.matcher_facts["includes_transportation"])
        self.assertNotIn("includes_transportation", james.agent_context)
        self.assertEqual(curate(MARIA, AS_OF).matcher_facts["amount_due"], 412.6)
        self.assertEqual(curate(MARIA, AS_OF).matcher_facts["medications"], ["Metformin 500 mg"])

    def test_deterministic(self):
        self.assertEqual(curate(MARIA, AS_OF).agent_json(), curate(MARIA, AS_OF).agent_json())

    def test_missing_id_raises(self):
        with self.assertRaises(ValueError):
            curate({"name": "x"}, AS_OF)

    def test_redaction(self):
        text = "Hi, this is Maria Alvarez, ID kp-100234, call me at (555) 010-2231. Thanks, Maria."
        out = redact_known_identifiers(text, MARIA)
        for secret in ("Maria", "Alvarez", "100234", "010-2231"):
            self.assertNotIn(secret, out)
        self.assertIn("[MEMBER_NAME]", out)
        self.assertIn("[MEMBER_ID]", out)
        self.assertIn("[PHONE]", out)


if __name__ == "__main__":
    unittest.main()
