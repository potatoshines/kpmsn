# KP Member Service Navigator

A UC Berkeley Fung Fellowship Project | Fall 2026

Developed by _The A Team_: Shin Aung, Aditya Sudarshan, Ash Htet, and Ayumi Hermosillo.

Industry Partner: Kaiser Permanente

A prototype call-support dashboard for health-plan customer-service representatives, paired with a text-style follow-up chat for members. A representative looks up a member, follows a call transcript as it plays, reviews suggested resources, and sends only the items they approve to the member.

> **Prototype.** All members, records, billing and transcripts are fictional, and the analysis is simulated with keyword rules. Not affiliated with or connected to Kaiser Permanente or any live system.

## Features

- Member lookup by ID, name or date of birth, with one-click sample members
- Simulated real-time transcript playback with keyword highlighting
- Detected concerns and recorded history in a shared layout
- Resource suggestions in their own section under the concerns, each tagged **Call transcript** or **Member profile** (or both) with the reason, eligibility note and verification label
- Member summary with a “More details” directory that jumps to sections of the member profile
- Source filter on the suggestions (All, Call transcript, Member profile) with counts
- Representative-controlled sharing: nothing reaches the member unless selected and sent. **Preview** opens a temporary window showing the member chat as it will look, **Review** toggles a floating editor for the follow-up text, and **Send** delivers it
- Member chat limited to preset questions (no free typing); answers stay grounded in what was shared and route clinical questions to the care team
- Member profile page with coverage, billing, transactions, appointments, care and support flags, and history
- Keyboard and screen-reader friendly controls, light and dark themes

## Run locally

No build step. The app uses ES modules, so serve it over HTTP:

```bash
npm start          # or: python3 -m http.server 5173
```

Then open http://localhost:5173. Run `npm install && npm run format` to format with Prettier.

## Project structure

```
index.html              Page markup (three views: workspace, profile, member chat)
src/app.js              State, rendering and event handling
src/data/resources.js   Resource knowledge base and trigger rules
src/data/members.js     Mock members, transcripts and scenarios
src/styles/base.css     Tokens, layout skeleton, core components
src/styles/theme.css    Visual theme layer (loaded after base)
docs/ARCHITECTURE.md    Data flow and extension points
```

## Extending

- **Add a resource:** add an entry to `R` in `src/data/resources.js` (name, description, trigger regex `k`, eligibility `e`, next action `a`) and a label in `CL`. Add an optional profile rule `p(member)` that returns a reason string to suggest the resource from the member record alone.
- **Add a member or call:** add an object to `M` in `src/data/members.js`, with its transcript in `tr`, care gaps in `cg`, any social-needs result in `sn`, and a line in `SC`.
- **Use a real model:** replace the keyword matching in `line()` and the replies in `ans()` and `mq()` in `src/app.js`. See `docs/ARCHITECTURE.md`.

## Deploying

Push to `main` and enable Pages (Settings, Pages, Source: GitHub Actions). `.github/workflows/pages.yml` publishes the site.

## Known limitations

- `app.js` is a single module; splitting it into transcript, assistant, profile and chat modules is the natural next refactor.
- `theme.css` is a layer of overrides on `base.css` and could be consolidated into one stylesheet.
- No automated tests yet.

## License

MIT
