# Member Service Navigator

A prototype call-support dashboard for health-plan customer-service representatives, paired with a text-style follow-up chat for members. A representative looks up a member, follows a call transcript as it plays, reviews suggested resources, and sends only the items they approve to the member.

> **Prototype.** All members, records, billing and transcripts are fictional, and the analysis is simulated with keyword rules. Not affiliated with or connected to Kaiser Permanente or any live system.

## Features

- Member lookup by ID, name or date of birth, with one-click sample members
- Simulated real-time transcript playback with keyword highlighting
- Detected concerns and recorded history in a shared layout
- Resource suggestions with relevance reasons, eligibility notes and verification labels
- Representative-controlled sharing: nothing reaches the member unless selected and sent
- Member chat with sample questions; answers stay grounded in what was shared and route clinical questions to the care team
- Member profile page with billing, transactions, medications, appointments and history
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

- **Add a resource:** add an entry to `R` in `src/data/resources.js` (name, description, trigger regex `k`, eligibility `e`, next action `a`) and a label in `CL`.
- **Add a member or call:** add an object to `M` in `src/data/members.js`, with its transcript in `tr`, and a line in `SC`.
- **Use a real model:** replace the keyword matching in `line()` and the replies in `ans()` and `mq()` in `src/app.js`. See `docs/ARCHITECTURE.md`.

## Deploying

Push to `main` and enable Pages (Settings, Pages, Source: GitHub Actions). `.github/workflows/pages.yml` publishes the site.

## Known limitations

- `app.js` is a single module; splitting it into transcript, assistant, profile and chat modules is the natural next refactor.
- `theme.css` is a layer of overrides on `base.css` and could be consolidated into one stylesheet.
- No automated tests yet.

## License

MIT
