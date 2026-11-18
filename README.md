# KP Member Service Navigator

A UC Berkeley Fung Fellowship Project | Fall 2026

Developed by _The A Team_: Shin Aung, Aditya Sudarshan, Ash Htet, and Ayumi Hermosillo.

Industry Partner: Kaiser Permanente

A prototype call-support dashboard for health-plan customer-service representatives, paired with a one-way follow-up message for members. A representative looks up a member, follows a call transcript as it plays, reviews suggested resources, and sends only the items they approve to the member.

> **Prototype.** All members, records, billing and transcripts are fictional, and call analysis uses a tagging agent (Gemini on Cloud Run) when configured, or simulated keyword rules otherwise. Not affiliated with or connected to Kaiser Permanente or any live system.

## Features

- Member lookup by ID, name or date of birth, with one-click sample members
- Simulated real-time transcript playback with keyword highlighting
- Detected concerns and recorded history in a shared layout
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

Then open http://localhost:5173. Run `npm install && npm run format` to format with Prettier, and `node --test` to run the tests. The resource catalog is loaded from a CSV file, so opening `index.html` directly from disk will not work.

## Project structure

```
index.html              Page markup (three views: workspace, profile, member chat)
src/app.js              State, rendering and event handling
src/card.js             Suggestion card rendering (optional fields, flags, escaping)
src/data/kp_resource_opportunity_catalog.csv   Resource catalog (source of truth for resources)
src/data/catalog.js     Loads and validates the catalog; matches tags to resources
src/agent-client.js     Calls the tagging agent, redacts identifiers, falls back to keyword rules
src/config.js           Agent URL and limits (empty URL = keyword rules only)
src/data/tag-rules.js   Keyword tagger: fallback for transcript lines, and the profile tags
src/data/members.js     Mock members, transcripts and scenarios
tests/                  Catalog, card and tag-rule tests (node --test)
src/styles/base.css     Tokens, layout skeleton, core components
src/styles/theme.css    Visual theme layer (loaded after base)
docs/ARCHITECTURE.md    Data flow and extension points
```

## Extending

- **Add or change a resource:** edit `src/data/kp_resource_opportunity_catalog.csv`. Columns: `resource_id`, `resource_name`, `description`, `matching_tags`, `eligibility_description`, `resource_url`, `region`. `resource_name` and `resource_url` are required (a card with either missing is flagged and cannot be added to a follow-up); `description`, `eligibility_description` and `region` may be empty. Tags in `matching_tags` are what the tagging agent's tags are matched against.
- **Add a member or call:** add an object to `M` in `src/data/members.js`, with its transcript in `tr`, care gaps in `cg`, any social-needs result in `sn`, and a line in `SC`.
- **Turn on the tagging agent:** deploy `agent/` to Cloud Run, then set `url` and `secret` in `src/config.js`. See `docs/ARCHITECTURE.md`. The replies in `ans()` in `src/app.js` are still scripted.

## Deploying

Push to `main` and enable Pages (Settings, Pages, Source: GitHub Actions). `.github/workflows/pages.yml` publishes the site.

## Known limitations

- `app.js` is a single module; splitting it into transcript, assistant, profile and chat modules is the natural next refactor.
- `theme.css` is a layer of overrides on `base.css` and could be consolidated into one stylesheet.
- Tests cover the catalog, card rendering and tag rules; the page itself is not covered by automated browser tests.

## License

MIT
