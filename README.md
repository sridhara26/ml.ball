# ml.ball

Static GitHub Pages site (zero build step) publishing daily MLB win
probabilities from a machine-learning model. Data files under `data/` are
pushed by a separate pipeline; every prediction is graded against final
scores and the cumulative record is published alongside.

- `index.html` — the day's win probabilities + all-time graded record
- `game.html` — per-game detail (`?date=YYYY-MM-DD&g=AWAY-HOME-DH`): lineups,
  team stats, starting-pitcher detail, and recent form for one game
- `data/predictions/YYYY-MM-DD.json` — one frozen file per slate;
  `data/latest.json` points at the newest one
- `data/details/YYYY-MM-DD.json` — optional richer per-game payload backing
  `game.html`; `index.html` only links to `game.html` when it's present
- `data/record.json` — cumulative graded record
- `data/index.json` — published-date index; optional top-level `preview` key
  (`{date, n_games}`) points at the one upcoming, not-yet-predicted slate,
  backed by `data/preview.json` (a single rolling file)

Win probabilities are model output for research/entertainment — not betting
advice. They are published before first pitch and never edited afterward.

## Local preview

```bash
python3 -m http.server 8017
# → http://localhost:8017
```

## Cache-busting assets

`index.html`/`game.html` cache independently from `assets/app.js`
and `assets/site.css` — a returning visitor can end up running old JS against
new markup. After changing anything under `assets/`, run:

```bash
./stamp_assets.sh
```

It stamps a short content-hash `?v=` query onto every HTML file's reference to
those two assets. Idempotent (no-op if the assets didn't change) — safe to run
any time, but required after an `assets/*` edit for the fix to actually take
effect for cached visitors.

**Stamping must be the last step before committing an assets change.** If you
edit `assets/app.js` or `assets/site.css` again after running the script, the
stamps go stale silently — the HTML still parses, still 200s, still *looks*
stamped — while a returning visitor keeps serving the old cached JS against
the new HTML. That's the exact bug this script exists to prevent, just moved
one edit later, so re-run `./stamp_assets.sh` (and re-stage) after any further
`assets/*` edit, right before you commit.

```bash
./stamp_assets.sh --check
```

Verifies every `?v=` reference already matches the current content hash,
without writing anything. Exits `0` when everything's current; exits non-zero
and prints each drifted/missing reference (file + asset + stale vs. expected
hash) otherwise. Use it as a pre-commit gate for any change touching
`assets/*`.

### Pre-commit hook (opt-in)

A tracked `.githooks/pre-commit` runs `./stamp_assets.sh --check` and blocks
the commit (printing the fix command) if any stamp is stale or missing. It's
**not** enabled by default — git only runs hooks from `.git/hooks` unless you
point it elsewhere. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

This is a safety net, not a guarantee: it's a local, per-clone opt-in (a
fresh clone or a commit made with `--no-verify` skips it), and the
underlying check hashes the **worktree**, not the git index — so it can't
catch every possible mismatch between what's staged and what's on disk (e.g.
an `assets/*` edit staged in one commit and reverted in the worktree only
after `git add`). Re-running `./stamp_assets.sh` right before you commit, as
described above, remains the actual fix.
