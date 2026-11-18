# Architecture

## Data flow

1. **Lookup** (`find`) selects a member from `M`, loads that member's transcript, and calls `clr`, which tags the member record (`tagProfile`) and applies the result.
2. **Playback** (`line`) reveals one transcript line at a time. For each member line, `tagLine` returns tags with the line as evidence.
3. **Applying tags** (`applyTags`) matches tags to catalog rows (`matchTags`) and records them on `sug`, keyed by `resource_id`. This is the seam: it accepts exactly what the real agent will return (see below).
4. **Rendering** (`draw`) turns `sug` into suggestion cards (`cardParts` in `src/card.js`), detected concerns (one per member line that produced a suggestion) and the pending list. Each card is tagged by source.
5. **Approval** is the `sel` set. **Review** toggles a floating editor (`review`, `closeRev`) over the draft in `dr`; the representative can edit the opening message, each description, and the closing note, or remove items. **Preview** renders the same markup the member will get (`fuHtml(final())`) in a temporary dialog and sends nothing.
6. **Send** (`sendFollowUp`) renders the edited text, not the original resource text, as a one-way message in the member view. It works whether or not the editor was opened. The member side has no input, buttons or replies.

## State (module scope in `app.js`)

| Name       | Purpose                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `m`        | Active member                                                                                            |
| `txt`, `i` | Loaded transcript and playback index                                                                     |
| `catalog`  | Resource catalog loaded from the CSV (`src/data/catalog.js`)                                             |
| `sug`      | Suggestions by `resource_id`: `{ tr?, at?, tt?, pf? }` (quote, line, that line's tags, profile evidence) |
| `sel`      | Resources the representative selected                                                                    |
| `flt`      | Suggestion source filter: `all`, `tr` or `pf`                                                            |
| `dr`       | Editable draft: `{ intro, items: { id: { d } }, note }`                                                  |

## Resource catalog

`src/data/kp_resource_opportunity_catalog.csv` is the single source of truth for resources. `loadCatalog` fetches it at startup (so the site must be served over HTTP) and `buildCatalog` validates it:

| Column                    | Required | On the card                                                          |
| ------------------------- | -------- | -------------------------------------------------------------------- |
| `resource_id`             | yes      | Key. Rows without one, or duplicates, are skipped with a note        |
| `resource_name`           | yes      | Card title. If empty: "Resource name not available", flagged         |
| `description`             | no       | Description. Left out when empty                                     |
| `matching_tags`           | yes      | Not shown. What agent tags are matched against                       |
| `eligibility_description` | no       | Eligibility. Left out when empty                                     |
| `resource_url`            | yes      | Program link. If empty or not http(s): "Link not available", flagged |
| `region`                  | no       | Region. Left out when empty                                          |

Cells that are blank, `N/A`, `null`, `nan` or `none` count as empty. A flagged card cannot be added to a follow-up. Row problems are listed in the browser console; a file that cannot be loaded or has no `resource_id` or `matching_tags` column shows an error in the suggestions area and the rest of the app keeps working. Eligibility is shown only on the representative's cards ("good to know" when present). The member's message and chat carry just the resource name, description and link.

## The tagging agent

Member lines are tagged by the agent service in `agent/` (Cloud Run, Gemini). `src/agent-client.js` calls it; settings live in `src/config.js` (`url`, `secret`, `timeoutMs`, `maxCalls`, `contextLines`). With `url` empty the keyword rules in `src/data/tag-rules.js` are used, so a fresh clone and the tests run with no cloud setup.

- **What is sent:** each new Member line plus up to `contextLines` earlier lines, as `{ turn, speaker, text }`, with the member's name, ID, phone, date of birth and address (and any phone number or email in the words) replaced by `[removed]` first. Representative lines are never tagged.
- **What comes back:** `{ items: [{ tag, source, turn, evidence }] }`. The client keeps only tags for the new line, normalizes them (`normTag`), and uses the real line as the evidence. The service itself drops any tag outside the catalog vocabulary.
- **Profile tags** (`tagProfile`) always come from local rules: they read structured fields, so they need no model and no member data leaves the browser.
- **Failure handling:** a network error, non-200 reply, bad reply, timeout or `maxCalls` reached falls back to the keyword rules for that line, and a status line under the transcript says which tagger is in use. Identical lines are cached for the page load.
- **Order:** calls run one at a time so cards keep the first line that produced them; answers for a transcript that has since been reset are dropped.

Tags use this shape either way:

```js
{ tag: "payment_difficulty", source: "transcript", turn: 2, evidence: "the member's words" }
{ tag: "outstanding_balance", source: "profile", evidence: "Balance on record: ..." }
```

Tags must come from the catalog's `matching_tags` vocabulary (`catalog.vocabulary`; `agent/make_vocab.py` writes it to `agent/vocabulary.json` for the service, so rerun it and redeploy when the CSV's tags change). The service cannot take the full list as a schema enum (the API rejects 143 values), so it lists the tags in the prompt and filters the reply.

1. The matching rule is `matchTags`: a resource is selected when it shares at least one tag; more shared tags rank first; ties keep catalog order. The Python matcher should apply the same rule to the same CSV, or return `resource_id`s and let the page look the rows up.
2. Add a confidence threshold in `applyTags` if the agent returns one.

Other replacements keep the same shapes:

- Assistant replies: replace `ans()` (representative) with a model call.
- Keep representatives in the loop: suggestions should never reach the member message without being selected and sent.
