# Architecture

## Data flow

1. **Lookup** (`find`) selects a member from `M` and loads that member's transcript into state.
2. **Playback** (`line`) reveals one transcript line at a time. For each member line, every resource in `R` whose `k` regex matches is added to `sug` with the triggering quote.
3. **Rendering** (`draw`) turns `sug` into suggestion cards, detected concerns and the pending list. Status labels come from `st`.
4. **Approval** is the `sel` set. Only items in `sel` are copied into `sent` when the representative sends the follow-up.
5. **Member chat** (`mq`) answers from `sent` only, so unapproved items cannot appear.

## State (module scope in `app.js`)

| Name       | Purpose                                                             |
| ---------- | ------------------------------------------------------------------- |
| `m`        | Active member                                                       |
| `txt`, `i` | Loaded transcript and playback index                                |
| `sug`      | Detected resources, keyed by id, with the quote that triggered each |
| `sel`      | Resources the representative selected                               |
| `sent`     | Resources delivered to the member chat                              |

## Replacing the simulation

Keep the same shapes and swap the producers:

- Suggestions: instead of regex matching in `line()`, call a model with the member record and transcript so far, and return `{ resourceId: quote }` entries for `sug`.
- Assistant replies: replace `ans()` (representative) and the branch logic in `mq()` (member) with model calls. Ground the member chat in `sent` only and keep clinical questions routed to the care team.
- Keep representatives in the loop: suggestions should never write to `sent` directly.
