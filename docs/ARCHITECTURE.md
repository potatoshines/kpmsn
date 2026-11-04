# Architecture

## Data flow

1. **Lookup** (`find`) selects a member from `M`, loads that member's transcript, and calls `clr`, which seeds `sug` with every resource whose profile rule `p(member)` returns a reason.
2. **Playback** (`line`) reveals one transcript line at a time. For each member line, every resource in `R` whose `k` regex matches gets the triggering quote recorded on its `sug` entry (creating the entry if the profile did not).
3. **Rendering** (`draw`) turns `sug` into suggestion cards, detected concerns (transcript-sourced entries only) and the pending list. Each card is tagged by source. Status labels come from `st`.
4. **Approval** is the `sel` set. **Review** toggles a floating editor (`review`, `closeRev`) over the draft in `dr`; the representative can edit the opening message, each description and eligibility note, and the closing note, or remove items. **Preview** renders the same markup the member will get (`fuHtml(final())`) in a temporary dialog and sends nothing.
5. **Send** (`sendFollowUp`) copies the edited text, not the original resource text, into `sent`. It works whether or not the editor was opened.
6. **Member chat** (`mq`) answers preset questions from `sent` only, so unapproved or unedited text cannot appear. There is no free-text input.

## State (module scope in `app.js`)

| Name       | Purpose                                                              |
| ---------- | -------------------------------------------------------------------- |
| `m`        | Active member                                                        |
| `txt`, `i` | Loaded transcript and playback index                                 |
| `sug`      | Suggested resources by id: `{ tr?: quote, at?: line, pf?: reason }`  |
| `sel`      | Resources the representative selected                                |
| `flt`      | Suggestion source filter: `all`, `tr` or `pf`                        |
| `dr`       | Editable draft: `{ intro, items: { id: { d, e } }, note }`           |
| `sent`     | Items delivered to the member chat: `[{ k, n, d, e }]` (edited text) |

## Replacing the simulation

Keep the same shapes and swap the producers:

- Suggestions: instead of regex matching in `line()`, call a model with the member record and transcript so far, and return `{ resourceId: { tr: quote } }` entries for `sug`. Profile-based entries (`{ pf: reason }`) can come from a model reading the member record in the same way.
- Assistant replies: replace `ans()` (representative) and the branch logic in `mq()` (member) with model calls. Ground the member chat in `sent` only and keep clinical questions routed to the care team.
- Keep representatives in the loop: suggestions should never write to `sent` directly.
