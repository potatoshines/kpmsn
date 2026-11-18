# KP Member Service Navigator

A UC Berkeley Fung Fellowship Project | Fall 2026

Developed by _The A Team_: Shin Aung, Aditya Sudarshan, Ash Htet, and Ayumi Hermosillo.

Industry Partner: Kaiser Permanente

A prototype call-support dashboard for health-plan customer-service representatives, paired with a one-way follow-up message for members. A representative looks up a member, follows a call transcript as it plays, reviews suggested resources, and sends only the items they approve to the member.

> **Prototype.** All members, records, billing and transcripts are fictional, and call analysis uses an AI tagging agent (Gemini on Cloud Run). The public site only replays recorded agent runs; live agent calls need an admin code. Not affiliated with or connected to Kaiser Permanente or any live system.

## Features

- Member lookup by ID, name or date of birth, with one-click sample members
- **One public control: Recording.** Visitors press **Recording** to simulate a call. It replays a recorded run of the real AI agent (a saved file, see below), shows a **Simulating a call** badge while it plays, and sends nothing anywhere, so it costs nothing and cannot be abused. Member search only finds the three fictional members
- **Admin console** (the 🔒 Admin button): unlock with an admin code that the server checks. It reveals Step, Reset, the sample/upload controls and a run-mode switch: **Recorded replay** (free) or **Live agent** (costs credits). It shows an agent-call meter and a **Save this run** button, and it locks itself if the server stops accepting the code
- **AI tagging agent.** In Live agent mode each Member line is sent to a Gemini agent (Cloud Run service in `agent/`) that returns tags from the catalog's closed tag list, each with the member's words as evidence. A regular matcher turns tags into catalog resources, so the agent never sees the catalog and never decides eligibility
- **Tagger status line** under the transcript says what produced the cards: "recorded agent run (model, date)", "Gemini agent", "simulated keyword rules", or why the keyword rules covered for the agent (call failed, code refused, limit reached)
- **Privacy and safety:** the member's name, ID, phone, date of birth and address are redacted before any text leaves the browser; only Member lines are sent; profile tags (balance, social needs, conditions) are computed locally and never sent; calls fall back to the keyword rules on any failure, are cached, and are capped per page load and per day on the server
- Resource suggestions in their own section under the concerns, each tagged **Call transcript** or **Member profile** (or both). Cards show the catalog's resource name, description, eligibility, program link and region; empty optional fields are left out, and a missing name or link is flagged
- Member summary with a “More details” directory that jumps to sections of the member profile
- Source filter on the suggestions (All, Call transcript, Member profile) with counts
- Representative-controlled sharing: nothing reaches the member unless selected and sent. **Preview** opens a temporary window showing the member message as it will look, **Review** toggles a floating editor for the follow-up text, and **Send** delivers it
- The member follow-up is a one-way message: each approved item shows its name, description and program link, and members cannot reply or ask questions
- Member profile page with coverage, billing, transactions, appointments, care and support flags, and history
- Keyboard and screen-reader friendly controls, light and dark themes

## Run locally

No build step. The app uses ES modules, so serve it over HTTP:

```bash
npm start          # or: python3 -m http.server 5173
```

Then open http://localhost:5173. Run `npm install && npm run format` to format with Prettier, `node --test` for the site tests, and `pytest agent` for the agent service tests (needs `pip install -r agent/requirements.txt pytest`). To test against the deployed agent from localhost, add `http://localhost:5173` to the service's `ALLOWED_ORIGINS`. The resource catalog is loaded from a CSV file, so opening `index.html` directly from disk will not work.

## Project structure

```
index.html              Page markup (three views: workspace, profile, member chat)
src/app.js              State, rendering and event handling
src/card.js             Suggestion card rendering (optional fields, flags, escaping)
src/data/kp_resource_opportunity_catalog.csv   Resource catalog (source of truth for resources)
src/data/catalog.js     Loads and validates the catalog; matches tags to resources
src/agent-client.js     Calls the tagging agent with the admin code, redacts identifiers, falls back to keyword rules
src/admin.js            Admin console: server-checked unlock, run mode, call meter, save run
src/recorded.js         Recorded-run file format, validation, loading
src/data/recorded/      Recorded agent runs, one file per member (created from the admin console)
src/config.js           Agent URL and limits (no secret; empty URL = keyword rules only)
src/data/tag-rules.js   Keyword tagger: fallback for transcript lines, and the profile tags
src/data/members.js     Mock members, transcripts and scenarios
agent/                  Tagging service (FastAPI on Cloud Run) and the Python profile curator
tests/                  Catalog, card and tag-rule tests (node --test)
src/styles/base.css     Tokens, layout skeleton, core components
src/styles/theme.css    Visual theme layer (loaded after base)
docs/ARCHITECTURE.md    Data flow and extension points
```

## Extending

- **Add or change a resource:** edit `src/data/kp_resource_opportunity_catalog.csv`. Columns: `resource_id`, `resource_name`, `description`, `matching_tags`, `eligibility_description`, `resource_url`, `region`. `resource_name` and `resource_url` are required (a card with either missing is flagged and cannot be added to a follow-up); `description`, `eligibility_description` and `region` may be empty. Tags in `matching_tags` are what the tagging agent's tags are matched against.
- **Add a member or call:** add an object to `M` in `src/data/members.js`, with its transcript in `tr`, care gaps in `cg`, any social-needs result in `sn`, and a line in `SC`.
- **Turn on the tagging agent:** deploy `agent/` to Cloud Run, then set `url` in `src/config.js`. See `docs/ARCHITECTURE.md`. The replies in `ans()` in `src/app.js` are still scripted.

## Deploying

Push to `main` and enable Pages (Settings, Pages, Source: GitHub Actions). `.github/workflows/pages.yml` publishes the site.

## Tagging agent: setup, access and cost

**Who can spend money.** Serving the site is free (GitHub Pages). Only live agent calls cost, roughly a fraction of a cent each (one per Member line). The public site never makes them: **Recording** replays a saved run. Live calls need the admin code, which the **service** checks on every request (`ADMIN_CODE`); the code is not in this repo or the website. A service with no `ADMIN_CODE` refuses everything.

**Layers of protection**, strongest first: the Cloud Run max-instances setting and the Google Cloud budget and quotas (hard limits); the admin code, with a lockout after repeated wrong codes; `DAILY_LIMIT` calls per UTC day, per running instance; and a per-page-load call cap in the browser. The in-memory counters reset when an instance restarts (it scales to zero when idle), so treat them as a second layer. Budget alerts only email; they do not stop spending.

**Deploy** (Cloud Shell, from the `agent/` folder; `openssl rand -hex 24` makes a good code, and avoid commas in it):

```bash
gcloud run deploy tag-agent --source . --region us-central1 \
  --service-account tag-agent@YOUR_PROJECT.iam.gserviceaccount.com \
  --min-instances 0 --max-instances 1 --concurrency 4 --timeout 60 --allow-unauthenticated \
  --set-env-vars GOOGLE_GENAI_USE_ENTERPRISE=true,GOOGLE_CLOUD_PROJECT=YOUR_PROJECT,GOOGLE_CLOUD_LOCATION=global,MODEL=gemini-3.5-flash-lite,ADMIN_CODE=YOUR_CODE,DAILY_LIMIT=300,ALLOWED_ORIGINS=https://potatoshines.github.io
```

`--allow-unauthenticated` only lets the browser reach the service; every endpoint that costs money still needs the admin code. To change the code later: `gcloud run services update tag-agent --region us-central1 --update-env-vars ADMIN_CODE=NEW_CODE`. To test from localhost, add `http://localhost:5173` to `ALLOWED_ORIGINS` (use `^@^ALLOWED_ORIGINS=a,b` syntax for a comma list). Run `python3 agent/make_vocab.py` and redeploy whenever the CSV's tags change. `pytest agent` tests the service with a stubbed model.

**Recording a run** (this is the only way new data reaches the public site):

1. Open the site, click **🔒 Admin**, enter the code, choose **Live agent**.
2. Look up a member and press **Play (live agent)**; let the whole call finish. Every Member line must be tagged by the agent itself, not the fallback rules.
3. Click **Save this run**. It downloads `KP-xxxxxx.json`. Put it in `src/data/recorded/` and commit it.

A recorded file is `{ version: 1, member, recordedAt, model, transcript: [["Rep"|"Member", text], ...], tags: { "<line number of each Member line>": [tags] } }`. Cards are recomputed from the tags and the current catalog, so catalog edits show up without re-recording. A missing, malformed or mismatched file shows a clear message instead of cards. Until a member has a recorded run, the public button says so.

**Demo data only:** the agent path must only ever receive fictional data. Real member data would need private endpoints, real authentication and a compliance review.

## Known limitations

- Planned next, behind the admin code: transcript upload and editing with validation (plain `Rep:`/`Member:` lines, test transcripts as files in the repo), then speech-to-text with a Rep/Member speaker toggle.
- The admin console hides controls in the page; the real gate is the server checking the code on every `/tag` call.

- `app.js` is a single module; splitting it into transcript, assistant, profile and chat modules is the natural next refactor.
- `theme.css` is a layer of overrides on `base.css` and could be consolidated into one stylesheet.
- Tests cover the catalog, card rendering and tag rules; the page itself is not covered by automated browser tests.

## License

MIT
