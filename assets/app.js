/* ml.ball — shared site JS: predictions dashboard + game detail rendering */

try { localStorage.removeItem("mlball-theme"); } catch {}

/* ---------- shared helpers ---------- */

const REPO_ROOT = document.currentScript?.dataset?.root ?? ".";
const DASHBOARD_DEFAULT_TITLE = document.title;

async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function pct(p) {
  return (p * 100).toFixed(1) + "%";
}

function isFiniteNum(v) { return typeof v === "number" && Number.isFinite(v); }

function fmt0(v) { return escapeHtml(String(v)); }
// fmt1/fmt2/fmtPctVal/fmtRate feed on per-field data crossing a repo boundary
// (game-details / preview JSON written by a separate pipeline) — a
// non-number where a number is expected (e.g. a stat serialized as a string)
// must degrade to "—", not throw and blank the whole section.
function fmt1(v) { return isFiniteNum(v) ? v.toFixed(1) : "—"; }
function fmt2(v) { return isFiniteNum(v) ? v.toFixed(2) : "—"; }
function fmtPctVal(v) { return isFiniteNum(v) ? (v * 100).toFixed(1) + "%" : "—"; }
function fmtRate(v) { return isFiniteNum(v) ? v.toFixed(3).replace(/^(-?)0\./, "$1.") : "—"; }
function fmtOrDash(v, fmtFn) { return v == null ? "—" : fmtFn(v); }
function fmtSigned1(v) { return isFiniteNum(v) ? (v > 0 ? "+" : "") + v.toFixed(1) : "—"; }

/* "contested": the 10-model ensemble's seed spread around 0.5 is wide enough
   that it straddles a coin flip — the favorite/underdog split itself isn't
   reliable. Pure predicate shared by the chip and the legend gate below. */
function isContestedGame(g) {
  return isFiniteNum(g?.seed_std) && isFiniteNum(g?.prob_home_win)
    && Math.abs(g.prob_home_win - 0.5) <= g.seed_std;
}

function contestedTagHtml(g) {
  if (!isContestedGame(g)) return "";
  return `<span class="contested-chip">toss-up</span>`;
}

/* index.html's minimal column-header row (#slate-head) sits above the games
   list and must track #slate-note's own visibility exactly — hidden on
   every empty/no-slate/preview state, shown whenever the slate itself is
   shown. */
function setSlateHeadVisible(visible) {
  const el = document.getElementById("slate-head");
  if (el) el.hidden = !visible;
}

/* index.html's collapsible chip-legend disclosure — same visibility contract
   as setSlateHeadVisible: hidden on every empty/no-slate/preview state,
   shown whenever the slate itself is shown. #legend-jump (the "What do the
   labels mean?" jump link) tracks the same visibility so it never appears
   without the legend it points to. */
function setChipLegendVisible(visible) {
  const el = document.getElementById("chip-legend");
  if (el) el.hidden = !visible;
  const jumpEl = document.getElementById("legend-jump");
  if (jumpEl) jumpEl.hidden = !visible;
}

const TEAM_META = Object.assign(Object.create(null), {
  ARI: { name: "Arizona Diamondbacks", color: "#E3484D" },
  ATL: { name: "Atlanta Braves", color: "#E25D6C" },
  BAL: { name: "Baltimore Orioles", color: "#F25C1F" },
  BOS: { name: "Boston Red Sox", color: "#E4565E" },
  CHC: { name: "Chicago Cubs", color: "#4E7FDD" },
  CHW: { name: "Chicago White Sox", color: "#C4CED4" },
  CIN: { name: "Cincinnati Reds", color: "#E4515F" },
  CLE: { name: "Cleveland Guardians", color: "#E84A5F" },
  COL: { name: "Colorado Rockies", color: "#9E7FDE" },
  DET: { name: "Detroit Tigers", color: "#FA4616" },
  HOU: { name: "Houston Astros", color: "#EB6E1F" },
  KCR: { name: "Kansas City Royals", color: "#5E9BE6" },
  LAA: { name: "Los Angeles Angels", color: "#E4485C" },
  LAD: { name: "Los Angeles Dodgers", color: "#4C9CE8" },
  MIA: { name: "Miami Marlins", color: "#00A3E0" },
  MIL: { name: "Milwaukee Brewers", color: "#FFC52F" },
  MIN: { name: "Minnesota Twins", color: "#6AA1E4" },
  NYM: { name: "New York Mets", color: "#FF5910" },
  NYY: { name: "New York Yankees", color: "#7B9BDE" },
  OAK: { name: "Oakland Athletics", color: "#EFB21E" },
  PHI: { name: "Philadelphia Phillies", color: "#F2545B" },
  PIT: { name: "Pittsburgh Pirates", color: "#FDB827" },
  SDP: { name: "San Diego Padres", color: "#FFC425" },
  SEA: { name: "Seattle Mariners", color: "#3BA8A5" },
  SFG: { name: "San Francisco Giants", color: "#FD5A1E" },
  STL: { name: "St. Louis Cardinals", color: "#E4586B" },
  TBR: { name: "Tampa Bay Rays", color: "#8FBCE6" },
  TEX: { name: "Texas Rangers", color: "#5B8FD8" },
  TOR: { name: "Toronto Blue Jays", color: "#5B93DB" },
  WSN: { name: "Washington Nationals", color: "#E4504F" },
});

const TEAM_ALIASES = Object.assign(Object.create(null), {
  ATH: "OAK", FLA: "MIA", MON: "WSN", TBD: "TBR", ANA: "LAA",
});

/* Accuracy page "By team" division panels — BR codes, matching record.json.
   Every code below is a division-mapped canonical code; TEAM_ALIASES resolves
   older/alternate raw codes (e.g. ATH) onto one of these before bucketing. */
const ACC_DIVISIONS = [
  { label: "AL East", teams: ["BAL", "BOS", "NYY", "TBR", "TOR"] },
  { label: "AL Central", teams: ["CHW", "CLE", "DET", "KCR", "MIN"] },
  { label: "AL West", teams: ["HOU", "LAA", "OAK", "SEA", "TEX"] },
  { label: "NL East", teams: ["ATL", "MIA", "NYM", "PHI", "WSN"] },
  { label: "NL Central", teams: ["CHC", "CIN", "MIL", "PIT", "STL"] },
  { label: "NL West", teams: ["ARI", "COL", "LAD", "SDP", "SFG"] },
];

const ACC_DIVISION_CODE_SET = new Set(ACC_DIVISIONS.flatMap((d) => d.teams));

function teamColor(code) {
  const meta = TEAM_META[code] ?? TEAM_META[TEAM_ALIASES[code]];
  return meta ? meta.color : "var(--accent)";
}

function teamTagHtml(code) {
  return `<span class="team-tag" style="--team-color:${teamColor(code)}">${escapeHtml(code)}</span>`;
}

const LINEUP_LABELS = {
  announced: { cls: "ok", text: "announced" },
  projected_last_game: { cls: "warn", text: "projected" },
  league_avg: { cls: "warn", text: "unavailable" },
};

const SP_LABELS = {
  previews_fallback: { cls: "", text: "SP: single-source" },
  cross_check_mismatch: { cls: "warn", text: "SP: sources disagree" },
  tbd: { cls: "warn", text: "SP: TBD" },
};

/* Normalizes a status field to {home, away}: string input -> same value both
   sides, missing/null -> {}. Real payloads already use {home, away} dicts;
   this also covers legacy flat-string demo data. */
function normalizeStatus(val) {
  if (val == null) return {};
  if (typeof val === "string") return { home: val, away: val };
  return val;
}

function lineupFlags(g) {
  const status = normalizeStatus(g.lineup_status);
  const home = status.home, away = status.away;
  if (home == null && away == null) return [];
  if (home === away) {
    const label = LINEUP_LABELS[home];
    return label ? [`<span class="flag ${label.cls}">lineups: ${label.text}</span>`] : [];
  }
  const parts = [];
  if (away != null && LINEUP_LABELS[away]) parts.push(`${escapeHtml(g.away)} ${LINEUP_LABELS[away].text}`);
  if (home != null && LINEUP_LABELS[home]) parts.push(`${escapeHtml(g.home)} ${LINEUP_LABELS[home].text}`);
  if (parts.length === 0) return [];
  let worstCls;
  if ([home, away].some((s) => LINEUP_LABELS[s]?.cls === "warn")) {
    worstCls = "warn";
  } else if ([home, away].every((s) => LINEUP_LABELS[s]?.cls === "ok")) {
    worstCls = "ok";
  } else {
    worstCls = "quiet";
  }
  return [`<span class="flag ${worstCls}">lineups: ${parts.join(" · ")}</span>`];
}

function spFlags(g) {
  const status = normalizeStatus(g.sp_status);
  const home = status.home, away = status.away;
  if (home == null && away == null) return [];
  if (home === away) {
    const label = SP_LABELS[home];
    return label ? [`<span class="flag ${label.cls}">${label.text}</span>`] : [];
  }
  const parts = [];
  if (away != null && SP_LABELS[away]) parts.push(`${escapeHtml(g.away)} ${SP_LABELS[away].text}`);
  if (home != null && SP_LABELS[home]) parts.push(`${escapeHtml(g.home)} ${SP_LABELS[home].text}`);
  if (parts.length === 0) return [];
  const worstCls = [home, away].some((s) => SP_LABELS[s]?.cls === "warn") ? "warn" : "";
  return [`<span class="flag ${worstCls}">${parts.join(" · ")}</span>`];
}

function resultFlagHtml(result, pHome) {
  if (!result) return "";
  if (result.status === "no_result") {
    return "";
  }
  if (typeof result.home_won === "boolean") {
    const won = result.home_won === (pHome >= 0.5);
    return `<span class="flag ${won ? "result-win" : "result-loss"}">${won ? "✓ correct" : "✗ missed"} — final ${result.away_score ?? ""}${result.away_score != null ? "–" : ""}${result.home_score ?? ""}</span>`;
  }
  const hasScores = result.home_score != null && result.away_score != null;
  return `<span class="flag">final (tie)${hasScores ? ` — ${result.away_score}–${result.home_score}` : ""}</span>`;
}

/* ---------- predictions dashboard (index.html) ---------- */

/* First flags-row chip of a ledger row: the ✓/✗ correctness verdict,
   mirroring resultFlagHtml's home_won === (pHome >= 0.5) check but as a bare
   "correct"/"missed" chip (no inline score — the per-team FINAL columns
   carry the score now). resultFlagHtml itself stays untouched — it still
   backs the game-detail header's flags line. */
function verdictChipHtml(result, pHome) {
  if (!result) return "";
  if (result.status === "no_result") {
    return "";
  }
  if (typeof result.home_won === "boolean") {
    const won = result.home_won === (pHome >= 0.5);
    return `<span class="flag ${won ? "win" : "loss"}">${won ? "✓ correct" : "✗ missed"}</span>`;
  }
  return `<span class="flag">final (tie)</span>`;
}

/* One team's FINAL-column cell. Always renders the cell div (even with no
   score) so the runs column keeps reading as a column down the whole slate
   list — see .runs-cell's min-width in site.css. `result.home_won ===
   isHome` doubles as the tie case (home_won null never strictly equals a
   boolean), so a tie renders both sides muted for free. */
function runsCellHtml(result, isHome, extraCls) {
  const cls = extraCls ? `runs-cell ${extraCls}` : "runs-cell";
  const score = result ? (isHome ? result.home_score : result.away_score) : null;
  if (!isFiniteNum(score)) return `<div class="${cls}"></div>`;
  const isWinner = result.home_won === isHome;
  return `<div class="${cls}${isWinner ? "" : " muted"}">${fmt0(score)}</div>`;
}

/* True once a game actually has a final score to show (decisive result OR a
   completed tie) — the gate for "show runs" vs. "show start time" in the
   FINAL column. Deliberately NOT the same as the detail page's isGraded
   (home_won strictly boolean): a completed tie has home_won: null but DOES
   have real scores, and must keep showing them, not a start time. */
function gameHasFinalScore(result) {
  return !!result && (isFiniteNum(result.home_score) || isFiniteNum(result.away_score));
}

/* A team-cell's code line: just the team code (mcode) plus, for the home
   team only, a sr-only " (home)" hint — the visual "@" home-team marker now
   lives in the mid-line separator between the away/home rows (see
   gameRowInnerHtml) instead of a fixed-width prefix slot here, so both
   teams' codes start flush at the cell's left edge. Shared by the ledger
   row (gameRowInnerHtml) and the next-day preview card (previewGameCard);
   `mcodeAttrs` carries call-site-specific attributes (previewGameCard's
   --team-color inline style) that go on the <span class="mcode"> itself. */
function codeLineHtml(code, isHome, mcodeAttrs = "") {
  const srHint = isHome ? '<span class="sr-only"> (home)</span>' : "";
  return `<span class="code-line"><span class="mcode"${mcodeAttrs}>${code}</span>${srHint}</span>`;
}

/* The same "AWAY-HOME-DH" key the dashboard uses for game.html links and
   game-details lookups (details JSON's games map, live_meta, etc.) —
   shared here so the FINAL-column time lookup and the link-href key can
   never drift apart from each other. */
function gameDetailsKey(g) {
  return `${g.away}-${g.home}-${g.dh_game_number ?? 0}`;
}

/* Mirrors game.html's fmtLocalDateTime: parse the ISO UTC instant with
   Date, then let Intl do the timezone conversion (never hand-rolled offset
   math). Like fmtLocalDateTime, shows each visitor's own local wall-clock
   time (no timeZone option = the browser's own zone) with no zone-name
   suffix — every viewer sees their own local time, same as any other
   sports site, and the detail page's fmtLocalDateTime already shows local
   time in full there. */
function fmtShortGameTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  return escapeHtml(time);
}

/* Looks up a game's first_pitch_utc in the (already-fetched) details JSON's
   games map and formats it — null when the details file is absent, the
   game isn't in it, or it carries no first_pitch_utc, so callers can fall
   back to the plain empty-runs-cell rendering with no layout shift. */
function gameStartTimeShort(detailsGames, g) {
  if (!detailsGames) return null;
  const iso = detailsGames[gameDetailsKey(g)]?.header?.first_pitch_utc;
  return typeof iso === "string" ? fmtShortGameTime(iso) : null;
}

/* Same first_pitch_utc lookup as gameStartTimeShort, but returns the raw
   epoch ms (or null) for the upcoming/finished/in-progress bucketing sort in
   buildSlateGamesHtml below, instead of a formatted display string. */
function gameStartEpoch(detailsGames, g) {
  if (!detailsGames) return null;
  const iso = detailsGames[gameDetailsKey(g)]?.header?.first_pitch_utc;
  if (typeof iso !== "string") return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function gameRowInnerHtml(g, shortTime = null) {
  const pHome = g.prob_home_win;
  const pAway = 1 - pHome;
  const homeFav = pHome >= 0.5;

  const rowFlags = [];
  rowFlags.push(verdictChipHtml(g.result, pHome));
  rowFlags.push(...lineupFlags(g));
  rowFlags.push(...spFlags(g));
  if (g.low_confidence) rowFlags.push('<span class="flag warn">low confidence</span>');
  if (g.dh_game_number > 0) rowFlags.push(`<span class="flag">DH game ${g.dh_game_number}</span>`);
  rowFlags.push(contestedTagHtml(g));
  const flagsHtml = rowFlags.filter(Boolean).join("");

  const awayCode = escapeHtml(g.away);
  const homeCode = escapeHtml(g.home);
  const awaySp = escapeHtml(g.away_sp ?? "TBD");
  const homeSp = escapeHtml(g.home_sp ?? "TBD");

  // Shown whenever the start time is known, regardless of whether the game
  // is graded — the FINAL column already carries the runs once a result is
  // in, so the mid-line "@ + time" stays as a stable reference line even
  // after publication.
  const timeHtml = shortTime ? `<span class="game-time">${shortTime}</span>` : "";
  const awayRunsHtml = runsCellHtml(g.result, false);
  const homeRunsHtml = runsCellHtml(g.result, true, "home");

  // DOM order follows reading order (each team's score right after that
  // team's own cells) so screen readers associate them correctly; the CSS
  // grid-template-areas handle the actual visual placement independently.
  return `
    <div class="team-cell away">${codeLineHtml(awayCode, false)}<span class="sp" title="${awaySp}">${awaySp}</span></div>
    <div class="pct-cell${homeFav ? "" : " fav"}">${pct(pAway)}</div>
    ${awayRunsHtml}
    <div class="mid-line"><span class="at-sep" aria-hidden="true">@</span>${timeHtml}</div>
    <div class="team-cell home">${codeLineHtml(homeCode, true)}<span class="sp" title="${homeSp}">${homeSp}</span></div>
    <div class="pct-cell home${homeFav ? " fav" : ""}">${pct(pHome)}</div>
    ${homeRunsHtml}
    ${flagsHtml ? `<div class="row-flags">${flagsHtml}</div>` : ""}`;
}

/* Three-section slate ordering (index.html's games list only):
     - finished    = gameHasFinalScore(g.result)
     - upcoming    = not finished AND (epoch unknown OR now < epoch)
     - inProgress  = not finished AND epoch known AND now >= epoch
   Rendered in the order upcoming, finished, inProgress — readers care most
   about games they can still watch the prediction for (upcoming), then
   about resolved games (was the model right? — finished), and least about
   in-progress ones (prediction frozen, no live score shown here). upcoming
   and finished sort ascending by first-pitch epoch, with unknown-time games
   (Infinity key) stably sorted to the end of their bucket in published
   order — the comparator explicitly tiebreaks on array index whenever
   sortKeys are equal (including two Infinity keys, where a plain
   subtraction would silently yield NaN and only work by falling through a
   truthiness check), making the sort stable regardless of Array#sort's
   engine-specific stability guarantees. inProgress instead sorts DESCENDING
   by epoch — the game that just started is the one a reader might still
   care to check, while one that started hours ago is nearly over — via a
   dedicated comparator (byEpochDescThenPublishedOrder): unknown epochs
   still sort LAST, never first (sorting ascending and then reversing only
   the known-epoch portion would get the null handling backwards), known
   epochs descending, ties (including two Infinity keys) by idx ascending.
   Small section-label divider rows (labeling every non-empty bucket) are
   inserted only when at least TWO of the three buckets are non-empty; a
   single-bucket slate (the common case) renders as a flat, unlabeled list
   in that bucket's own sort order (ascending for upcoming/finished,
   descending for inProgress), and when detailsGames is absent entirely (no
   times known for anything) this falls back to a flat, unsorted,
   published-order list — the pre-existing behavior. Called fresh on every
   render (including auto-refresh ticks), so a game crossing buckets
   naturally changes cardsHtml and trips the _lastGamesHtml repaint guard in
   renderDashboard. Known accepted edge: a postponed past game (no final
   score, but its known first-pitch epoch has passed) sits under "in
   progress" — rare, already a noted display nit, not special-cased. */
function buildSlateGamesHtml(games, detailsGames, detailsAvailable, date) {
  const rowHtml = (g) => {
    const inner = gameRowInnerHtml(g, gameStartTimeShort(detailsGames, g));
    if (!detailsAvailable) return `<div class="slate-row">${inner}</div>`;
    const href = `game.html?date=${encodeURIComponent(date)}&g=${encodeURIComponent(gameDetailsKey(g))}`;
    return `<a class="slate-row" href="${href}">${inner}</a>`;
  };

  if (!detailsGames) return games.map(rowHtml).join("");

  const now = Date.now();
  const upcoming = [];
  const finished = [];
  const inProgress = [];
  games.forEach((g, idx) => {
    const epoch = gameStartEpoch(detailsGames, g);
    const entry = { g, sortKey: epoch ?? Infinity, idx };
    if (gameHasFinalScore(g.result)) {
      finished.push(entry);
    } else if (epoch == null || now < epoch) {
      upcoming.push(entry);
    } else {
      inProgress.push(entry);
    }
  });
  const byEpochThenPublishedOrder = (a, b) => (a.sortKey === b.sortKey ? a.idx - b.idx : a.sortKey - b.sortKey);
  // inProgress reads most-recently-started first (see doc comment above):
  // unknown epochs (Infinity sortKey) still sort last, known epochs
  // descending, ties by idx ascending.
  const byEpochDescThenPublishedOrder = (a, b) => {
    if (a.sortKey === b.sortKey) return a.idx - b.idx;
    if (a.sortKey === Infinity) return 1;
    if (b.sortKey === Infinity) return -1;
    return b.sortKey - a.sortKey;
  };
  upcoming.sort(byEpochThenPublishedOrder);
  finished.sort(byEpochThenPublishedOrder);
  inProgress.sort(byEpochDescThenPublishedOrder);

  const buckets = [
    { label: "upcoming", entries: upcoming },
    { label: "finished", entries: finished },
    { label: "in progress", entries: inProgress },
  ];
  const nonEmpty = buckets.filter((b) => b.entries.length > 0);
  if (nonEmpty.length < 2) {
    return nonEmpty.flatMap((b) => b.entries).map((e) => rowHtml(e.g)).join("");
  }
  return nonEmpty
    .map((b) => `<div class="slate-section-label">${b.label}</div>` + b.entries.map((e) => rowHtml(e.g)).join(""))
    .join("");
}

function fmtDate(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function fmtShortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "");
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtTitleDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "");
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ---------- published-date index + prev/next navigation ---------- */

/* index.json's `dates` array is documented ascending-by-date (oldest
   first), but that's an undocumented contract across a repo boundary (the
   daily pipeline publisher) — sort defensively rather than trust it, and
   drop any malformed entries so one bad row can't break navigation. */
function sortedDateEntries(indexData) {
  const raw = indexData && Array.isArray(indexData.dates) ? indexData.dates : [];
  return raw
    .filter((d) => d && typeof d === "object" && isValidDateParam(d.date))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

let _dateIndexCache; // memoized for the page session; undefined = no successful fetch yet

/* index.json's top-level `preview` key is optional and never an entry in
   `dates[]` — it points at the one upcoming, not-yet-predicted slate.
   Validates shape defensively — same spirit as sortedDateEntries — so a
   malformed preview object degrades to "no preview" rather than corrupting
   nav state. */
function validPreviewInfo(preview, dates) {
  if (!preview || typeof preview !== "object") return null;
  if (!isValidDateParam(preview.date)) return null;
  if (dates.some((d) => d.date === preview.date)) return null;
  // must be strictly after the latest published date — a stale/past preview.date
  // (e.g. predictions published but the preview-copy pipeline step failed)
  // would otherwise let the `›` arrow step backwards into a past date
  // still captioned as "not predicted yet".
  if (dates.length > 0 && preview.date <= dates[dates.length - 1].date) return null;
  const nGames = typeof preview.n_games === "number" && Number.isFinite(preview.n_games) ? preview.n_games : null;
  return { date: preview.date, n_games: nGames };
}

async function fetchDateIndex() {
  if (_dateIndexCache !== undefined) return _dateIndexCache;
  try {
    const idx = await fetchJSON(`${REPO_ROOT}/data/index.json`);
    const dates = idx && typeof idx.latest_date === "string" ? sortedDateEntries(idx) : [];
    if (dates.length > 0) {
      _dateIndexCache = { latest_date: idx.latest_date, dates, preview: validPreviewInfo(idx.preview, dates) };
      return _dateIndexCache;
    }
  } catch {
    /* index.json absent, unparseable, or a transient network error — degrade
       to legacy (no nav) behavior for THIS render only. Deliberately not
       memoized: a later navigation should retry rather than staying
       permanently degraded for the rest of the page session. */
  }
  return null;
}

/* scans a sorted (ascending) array of date strings for the nearest date
   strictly before / strictly after `pickedDate` — used by the prev/next
   arrows when `targetDate` itself isn't published (setupDateNav). Returns
   null for a direction with nothing published. */
function nearestPublishedNeighbors(dates, pickedDate) {
  let earlier = null, later = null;
  for (const d of dates) {
    if (d < pickedDate) earlier = d;
    else if (d > pickedDate) { later = d; break; }
  }
  return { earlier, later };
}

function navigateToDate(date, latestDate) {
  const search = date === latestDate ? "" : `?date=${encodeURIComponent(date)}`;
  const url = `${location.pathname}${search}${location.hash}`;
  if (url !== `${location.pathname}${location.search}${location.hash}`) {
    history.pushState({}, "", url);
  }
  renderDashboard();
}

const DAY_RECORD_NOTE = "one day is mostly noise — see the all-time record above";

/* #day-record wraps two persistent child spans (.day-record-count /
   .day-record-note) rather than a single text node, so the caveat can be
   shown/hidden in lockstep with the count without a `title` tooltip (which
   is invisible on touch). */
function clearRecordEl(recordEl) {
  if (!recordEl) return;
  recordEl.style.display = "none";
  const countEl = recordEl.querySelector(".day-record-count");
  const noteEl = recordEl.querySelector(".day-record-note");
  if (countEl) countEl.textContent = "";
  if (noteEl) noteEl.textContent = "";
}

function showRecordEl(recordEl, countText) {
  if (!recordEl) return;
  recordEl.style.display = "";
  const countEl = recordEl.querySelector(".day-record-count");
  const noteEl = recordEl.querySelector(".day-record-note");
  if (countEl) countEl.textContent = countText;
  if (noteEl) noteEl.textContent = DAY_RECORD_NOTE;
}

function setupDateNav({ navEl, prevBtn, nextBtn, backEl, recordEl, indexData, targetDate, latestDate, isLatest, suppressRecord = false, previewInfo = null }) {
  if (!navEl) return;
  const dates = indexData ? sortedDateEntries(indexData) : [];
  if (dates.length === 0) {
    if (prevBtn) prevBtn.style.display = "none";
    if (nextBtn) nextBtn.style.display = "none";
    if (backEl) backEl.style.display = "none";
    clearRecordEl(recordEl);
    return;
  }

  // targetDate === the preview date is a third nav "position" past the
  // published dates array: prev always returns to the latest published
  // date, next is always disabled (preview is the end of the line).
  const isPreviewTarget = !!(previewInfo && targetDate === previewInfo.date);

  // works whether or not targetDate is itself published: if it is, this
  // returns its array-adjacent neighbors; if it isn't (an off-index date),
  // it still finds the nearest published date in each direction instead of
  // leaving both arrows disabled.
  let prevDate, nextDate;
  if (isPreviewTarget) {
    prevDate = latestDate;
    nextDate = null;
  } else {
    ({ earlier: prevDate, later: nextDate } = nearestPublishedNeighbors(dates.map((d) => d.date), targetDate));
    // next from the latest published date opens the preview, when one exists,
    // instead of staying disabled.
    if (!nextDate && previewInfo && targetDate === latestDate) nextDate = previewInfo.date;
  }

  if (prevBtn) {
    prevBtn.style.display = "";
    prevBtn.disabled = !prevDate;
    prevBtn.setAttribute("aria-disabled", String(!prevDate));
    prevBtn.onclick = prevDate ? () => navigateToDate(prevDate, latestDate) : null;
  }
  if (nextBtn) {
    nextBtn.style.display = "";
    nextBtn.disabled = !nextDate;
    nextBtn.setAttribute("aria-disabled", String(!nextDate));
    const nextIsPreview = !!(nextDate && previewInfo && nextDate === previewInfo.date);
    nextBtn.setAttribute("aria-label", nextIsPreview ? "Next day preview" : "Next published date");
    nextBtn.onclick = nextDate ? () => navigateToDate(nextDate, latestDate) : null;
  }
  if (backEl) backEl.style.display = isLatest ? "none" : "";
  if (recordEl) {
    const entry = suppressRecord ? null : (dates.find((d) => d.date === targetDate) ?? null);
    const fullyGraded = entry
      && typeof entry.n_graded === "number" && typeof entry.n_games === "number"
      && typeof entry.n_correct === "number"
      && entry.n_games > 0 && entry.n_graded === entry.n_games;
    if (fullyGraded) {
      showRecordEl(recordEl, `${entry.n_correct} of ${entry.n_graded} correct`);
    } else {
      clearRecordEl(recordEl);
    }
  }
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName ? el.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "select" || tag === "textarea") return true;
  return !!el.isContentEditable;
}

function handleDashboardKeydown(e) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
  if (isTypingTarget(e.target)) return;
  if (e.key === "ArrowLeft") {
    document.getElementById("nav-prev")?.click();
  } else if (e.key === "ArrowRight") {
    document.getElementById("nav-next")?.click();
  }
}

function setDashboardHeader({ headingEl, dateEl, recordEl, statusEl }, heading, title, dateText, statusText = "") {
  if (headingEl) headingEl.textContent = heading;
  document.title = title;
  if (dateEl) dateEl.textContent = dateText;
  clearRecordEl(recordEl);
  if (statusEl) statusEl.textContent = statusText;
}

function renderPublishStateEmpty(gamesEl, header) {
  gamesEl.innerHTML = `<div class="empty-state"><div class="box">
    <p><strong>No predictions published yet.</strong></p>
    <p>Check back soon.</p>
  </div></div>`;
  if (header) setDashboardHeader(header, "Win probabilities", DASHBOARD_DEFAULT_TITLE, "", "No predictions published yet");
  document.getElementById("slate-note")?.style.setProperty("display", "none");
  setSlateHeadVisible(false);
  setChipLegendVisible(false);
  _lastGamesHtml = null;
}

/* `implicit` distinguishes "we were trying to load the latest/today slate and
   it isn't there yet" (targetDate === latestDate, however we got there — the
   home page, or an explicit ?date=<latestDate> — since either way "back to
   the latest slate" would just point at this same date) from "you asked for
   a specific date that was never published". `hasOtherDates` gates the
   "browse a previous day above" clause: with a single-date index, the arrows
   have nothing else to navigate to, so that clause would promise
   navigation that doesn't exist. */
function renderNoSlateForDate(gamesEl, date, header, { implicit = false, hasOtherDates = false } = {}) {
  const valid = isValidDateParam(date);
  const escapedLabel = valid ? fmtDate(date) : escapeHtml(String(date ?? ""));
  const bodyHtml = implicit
    ? `<p><strong>Today's slate isn't published yet.</strong></p>
    <p>Check back soon${hasOtherDates ? " — or browse a previous day above." : "."}</p>`
    : `<p><strong>No slate was published for ${escapedLabel}.</strong></p>
    <p><a href="./">Back to the latest slate →</a></p>`;
  gamesEl.innerHTML = `<div class="empty-state"><div class="box">${bodyHtml}</div></div>`;
  if (header) {
    const dateText = valid ? fmtDate(date) : String(date ?? "");
    const heading = "Win probabilities";
    const title = implicit ? DASHBOARD_DEFAULT_TITLE : (valid ? `${fmtTitleDate(date)} — ml.ball` : DASHBOARD_DEFAULT_TITLE);
    const rawLabel = valid ? fmtShortDate(date) : String(date ?? "");
    const statusText = implicit ? "Today's slate isn't published yet" : `No slate published for ${rawLabel}`;
    setDashboardHeader(header, heading, title, dateText, statusText);
  }
  document.getElementById("slate-note")?.style.setProperty("display", "none");
  setSlateHeadVisible(false);
  setChipLegendVisible(false);
  _lastGamesHtml = null;
}

let _dashboardRenderToken = 0;

let _autoRefreshEligible = false;
let _hiddenAt = 0;
let _lastGamesHtml = null;

/* mirrors setupDateNav's own fullyGraded check (n_correct isn't needed
   here) — no index entry for the date means "unknown", which stays
   eligible for refresh rather than assuming it's done. */
function entryFullyGraded(indexData, targetDate) {
  const dates = indexData ? sortedDateEntries(indexData) : [];
  const entry = dates.find((d) => d.date === targetDate) ?? null;
  return !!(
    entry
    && typeof entry.n_games === "number"
    && typeof entry.n_graded === "number"
    && entry.n_games > 0
    && entry.n_graded === entry.n_games
  );
}

async function renderDashboard() {
  // renderDashboard is re-entrant (arrow presses, popstate, keyboard arrows
  // can all trigger it while a prior call is still awaiting a fetch). Every
  // await below re-checks this token and bails before touching the DOM if a
  // newer invocation has since started, so a slow/superseded response can
  // never paint over what a later, faster one already rendered.
  const myToken = ++_dashboardRenderToken;
  const isCurrent = () => myToken === _dashboardRenderToken;

  const gamesEl = document.getElementById("games");
  const dateEl = document.getElementById("slate-date");
  const headingEl = document.getElementById("slate-heading");
  const navEl = document.getElementById("date-nav");
  const prevBtn = document.getElementById("nav-prev");
  const nextBtn = document.getElementById("nav-next");
  const backEl = document.getElementById("back-today");
  const recordEl = document.getElementById("day-record");
  const statusEl = document.getElementById("slate-status");
  if (!gamesEl) return;

  const header = { headingEl, dateEl, recordEl, statusEl };
  const navRefs = { navEl, prevBtn, nextBtn, backEl, recordEl };

  const rawDateParam = new URLSearchParams(location.search).get("date");
  if (rawDateParam != null && !isValidDateParam(rawDateParam)) {
    renderNoSlateForDate(gamesEl, rawDateParam, header);
    try {
      setupDateNav({ ...navRefs, indexData: null, targetDate: null, latestDate: null, isLatest: false });
    } catch {
      /* defensive: nav cluster must never block the empty-state message */
    }
    _autoRefreshEligible = false;
    return;
  }

  const indexData = await fetchDateIndex();
  if (!isCurrent()) return;

  let latestDate;
  try {
    latestDate = indexData ? indexData.latest_date : (await fetchJSON(`${REPO_ROOT}/data/latest.json`)).latest_date;
    if (!isCurrent()) return;
  } catch {
    if (!isCurrent()) return;
    renderPublishStateEmpty(gamesEl, header);
    try {
      setupDateNav({ ...navRefs, indexData, targetDate: null, latestDate: null, isLatest: false });
    } catch {
      /* defensive: nav cluster must never block the empty-state message */
    }
    _autoRefreshEligible = true;
    return;
  }

  const previewInfo = indexData ? indexData.preview : null;
  if (rawDateParam != null && previewInfo && rawDateParam === previewInfo.date) {
    await renderPreviewSlate({ gamesEl, header, navRefs, indexData, previewInfo, latestDate, isCurrent });
    if (isCurrent()) _autoRefreshEligible = true;
    return;
  }

  const targetDate = rawDateParam ?? latestDate;

  if (indexData && !indexData.dates.some((d) => d.date === targetDate)) {
    const hasOtherDates = sortedDateEntries(indexData).some((d) => d.date !== targetDate);
    renderNoSlateForDate(gamesEl, targetDate, header, { implicit: targetDate === latestDate, hasOtherDates });
    try {
      setupDateNav({ ...navRefs, indexData, targetDate, latestDate, isLatest: targetDate === latestDate, previewInfo });
    } catch {
      /* defensive: nav cluster must never block the empty-state message */
    }
    _autoRefreshEligible = targetDate === latestDate;
    return;
  }

  let day;
  try {
    day = await fetchJSON(`${REPO_ROOT}/data/predictions/${targetDate}.json`);
    if (!isCurrent()) return;
  } catch {
    if (!isCurrent()) return;
    // history known (an index exists) means the arrows are live and an
    // archive demonstrably exists, so a 404 here is "this slate" missing, not
    // "nothing has ever been published" — see renderNoSlateForDate's implicit
    // flag (true when targetDate is the latest slate, so it never claims a
    // "back to the latest slate" destination other than itself) and
    // suppressRecord below so a stale index-listed record can't be shown
    // beside a slate that failed to load.
    if (rawDateParam != null || indexData) {
      const hasOtherDates = sortedDateEntries(indexData).some((d) => d.date !== targetDate);
      renderNoSlateForDate(gamesEl, targetDate, header, { implicit: targetDate === latestDate, hasOtherDates });
      _autoRefreshEligible = targetDate === latestDate;
    } else {
      renderPublishStateEmpty(gamesEl, header);
      _autoRefreshEligible = true;
    }
    try {
      setupDateNav({ ...navRefs, indexData, targetDate, latestDate, isLatest: targetDate === latestDate, suppressRecord: true, previewInfo });
    } catch {
      /* defensive: nav cluster must never block the empty-state message */
    }
    return;
  }

  // Full GET (not just a HEAD probe) so the FINAL-column start time can be
  // read out of the same fetch that gates the game.html link — one round
  // trip serving both purposes. detailsAvailable mostly mirrors the old HEAD
  // semantics (fetch succeeded => links stay enabled), but deliberately
  // differs in one case: a 200 response with corrupt JSON now throws in
  // fetchJSON's res.json() and disables links (safer), where a HEAD probe
  // would only have checked res.ok and left them enabled. detailsGames
  // is a separate, defensively-typed view of the body used only for the
  // per-game time lookup, so a details file that fetches OK but lacks a
  // `games` object still gates links the same as before while simply
  // yielding no times.
  let detailsData = null;
  try {
    detailsData = await fetchJSON(`${REPO_ROOT}/data/details/${targetDate}.json`);
    if (!isCurrent()) return;
  } catch {
    if (!isCurrent()) return;
    detailsData = null;
  }
  const detailsAvailable = detailsData !== null;
  const detailsGames = detailsData && typeof detailsData.games === "object" ? detailsData.games : null;
  // rows render as <a class="slate-row"> only when detailsAvailable — the tap
  // hint must say so only when it's actually true, known as of right here.
  const tapHintEl = document.getElementById("slate-note-tap");
  if (tapHintEl) tapHintEl.hidden = !detailsAvailable;

  const isLatest = targetDate === latestDate;
  _autoRefreshEligible = isLatest || !entryFullyGraded(indexData, targetDate);
  if (headingEl) headingEl.textContent = "Win probabilities";
  document.title = isLatest ? DASHBOARD_DEFAULT_TITLE : `${fmtTitleDate(targetDate)} — ml.ball`;
  if (dateEl) dateEl.textContent = fmtDate(day.date);
  document.getElementById("slate-note")?.style.setProperty("display", "");
  setSlateHeadVisible(true);
  setChipLegendVisible(true);

  try {
    setupDateNav({ navEl, prevBtn, nextBtn, backEl, recordEl, indexData, targetDate, latestDate, isLatest, previewInfo });
  } catch {
    /* defensive: nav cluster must never block the slate itself from rendering */
  }

  if (!day.games || day.games.length === 0) {
    gamesEl.innerHTML = `<div class="empty-state"><div class="box">No games on the slate for ${fmtDate(day.date)}.</div></div>`;
    _lastGamesHtml = null;
    document.getElementById("slate-note")?.style.setProperty("display", "none");
    setSlateHeadVisible(false);
    setChipLegendVisible(false);
    if (statusEl) statusEl.textContent = `No games for ${fmtShortDate(day.date)}`;
    return;
  }
  const cardsHtml = buildSlateGamesHtml(day.games, detailsGames, detailsAvailable, day.date);
  // set/removed unconditionally on every render (not just when cardsHtml
  // actually changes below) — an auto-refresh tick can flip a slate from
  // all-ungraded to partially-graded without the row markup itself changing
  // shape enough to matter, and the class must track that regardless of the
  // _lastGamesHtml guard.
  const hasFinals = day.games.some((g) => gameHasFinalScore(g.result));
  gamesEl.classList.toggle("no-finals", !hasFinals);
  document.getElementById("slate-head")?.classList.toggle("no-finals", !hasFinals);
  if (cardsHtml !== _lastGamesHtml) {
    gamesEl.innerHTML = cardsHtml;
    _lastGamesHtml = cardsHtml;
  }
  if (statusEl) {
    statusEl.textContent = `Predictions for ${fmtShortDate(day.date)} — ${day.games.length} game${day.games.length === 1 ? "" : "s"}`;
  }

  // record strip (all-time / 30d — intentionally not per-date)
  await refreshRecordStrip(isCurrent);
}

/* Polled by the interval/visibilitychange listeners wired in
   DOMContentLoaded. Skips entirely while the visitor is mid-interaction
   with a focused input control (isTypingTarget) or the current view has nothing
   left to change (_autoRefreshEligible). Resets the index.json memo so a
   newly-published date/preview/grading update is actually picked up —
   renderDashboard's own _dashboardRenderToken re-entrancy guard handles a
   refresh landing while a user-triggered render is still in flight. */
function refreshDashboard() {
  if (!_autoRefreshEligible) return;
  if (isTypingTarget(document.activeElement)) return;
  _dateIndexCache = undefined;
  renderDashboard();
}

function setStat(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function hideRecordLine() {
  const el = document.getElementById("record-line");
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

async function refreshRecordStrip(isCurrent) {
  const el = document.getElementById("record-line");
  if (!el) return;
  try {
    const rec = await fetchJSON(`${REPO_ROOT}/data/record.json`);
    if (!isCurrent()) return;
    const acc = rec.overall?.accuracy;
    const n = rec.overall?.n_graded;
    if (!isFiniteNum(acc) || !isFiniteNum(n)) {
      hideRecordLine();
      return;
    }
    el.innerHTML = `<span class="record-line-num">${escapeHtml((acc * 100).toFixed(1))}%</span> accurate over <span class="record-line-num">${escapeHtml(String(n))}</span> graded games · <a href="accuracy.html">full breakdown →</a>`;
    el.hidden = false;
  } catch {
    if (!isCurrent()) return;
    hideRecordLine();
  }
}

/* ---------- next-day preview (index.html?date=<preview_date>) ---------- */

const PREVIEW_COPY = "Preview, not a prediction — no model output yet. Matchups and probable starters can change until win probabilities are published before first pitch.";

function previewBannerHtml(generatedAtUtc) {
  const updatedHtml = typeof generatedAtUtc === "string"
    ? `<span class="preview-banner-updated">Updated ${fmtLocalDateTime(generatedAtUtc)}</span>`
    : "";
  return `<div class="preview-banner" role="note">
    <span class="preview-banner-tag">PREVIEW</span>
    <span class="preview-banner-copy">${PREVIEW_COPY}</span>
    ${updatedHtml}
  </div>`;
}

function isValidPreviewGame(g) {
  return !!g && typeof g === "object"
    && typeof g.away === "string" && g.away.length > 0
    && typeof g.home === "string" && g.home.length > 0;
}

function previewSpHtml(sp) {
  if (!sp || typeof sp !== "object" || !sp.name) {
    return `<p class="stale-note">TBD</p>`;
  }
  const nameHtml = `<p class="sp-name">${escapeHtml(sp.name)}</p>`;
  const s = sp.season && typeof sp.season === "object" ? sp.season : null;
  if (!s) return `${nameHtml}<p class="stale-note">no starts yet this season</p>`;
  const workload = spWorkloadLineHtml(s);
  return `${nameHtml}${spSeasonTableHtml(s)}${workload ? `<p class="stale-note">${workload}</p>` : ""}`;
}

function previewGameCard(g) {
  const awayCode = escapeHtml(g.away);
  const homeCode = escapeHtml(g.home);
  const dh = Number.isInteger(g.dh_game_number) ? g.dh_game_number : 0;

  const flags = [];
  flags.push(...spFlags(g));
  if (dh > 0) flags.push(`<span class="flag">DH game ${dh}</span>`);
  if (Number.isInteger(g.series_game) && Number.isInteger(g.series_of) && g.series_of > 0) {
    flags.push(`<span class="flag">Game ${g.series_game} of ${g.series_of}</span>`);
  }

  const metaRows = [];
  const recs = recordsHtml(g.away, g.home, g.away_record, g.home_record);
  if (recs) metaRows.push(`<div class="meta-row">${recs}</div>`);
  if (g.venue) metaRows.push(`<div class="meta-row">${escapeHtml(String(g.venue))}</div>`);
  const dn = g.day_night ? ` · ${escapeHtml(String(g.day_night))}` : "";
  const timeText = !g.start_time_tbd && typeof g.first_pitch_utc === "string"
    ? fmtLocalDateTime(g.first_pitch_utc)
    : "time TBD";
  metaRows.push(`<div class="meta-row">${timeText}${dn}</div>`);

  const awaySpName = escapeHtml(g.away_sp?.name ?? "TBD");
  const homeSpName = escapeHtml(g.home_sp?.name ?? "TBD");

  return `
  <div class="game-card preview-card">
    <div class="matchup">
      <div class="team-cell away">
        ${codeLineHtml(awayCode, false, ` style="--team-color:${teamColor(g.away)}"`)}
        <span class="sp" title="${awaySpName}">${awaySpName}</span>
      </div>
      <div class="at-sep" aria-hidden="true">@</div>
      <div class="team-cell home">
        ${codeLineHtml(homeCode, true, ` style="--team-color:${teamColor(g.home)}"`)}
        <span class="sp" title="${homeSpName}">${homeSpName}</span>
      </div>
    </div>
    <div class="game-meta">${metaRows.join("")}</div>
    <div class="flags">${flags.join("")}</div>
    <div class="preview-sp-grid">
      <div class="preview-sp"><h4>${teamTagHtml(g.away)} SP</h4>${previewSpHtml(g.away_sp)}</div>
      <div class="preview-sp"><h4>${teamTagHtml(g.home)} SP</h4>${previewSpHtml(g.home_sp)}</div>
    </div>
  </div>`;
}

async function renderPreviewSlate({ gamesEl, header, navRefs, indexData, previewInfo, latestDate, isCurrent }) {
  setDashboardHeader(
    header,
    "Preview",
    `Preview: ${fmtTitleDate(previewInfo.date)} — ml.ball`,
    fmtDate(previewInfo.date),
    `Preview for ${fmtShortDate(previewInfo.date)} — no prediction until tomorrow morning`
  );
  document.getElementById("slate-note")?.style.setProperty("display", "none");
  setSlateHeadVisible(false);
  setChipLegendVisible(false);
  _lastGamesHtml = null;

  try {
    setupDateNav({ ...navRefs, indexData, targetDate: previewInfo.date, latestDate, isLatest: false, previewInfo });
  } catch {
    /* defensive: nav cluster must never block the preview from rendering */
  }

  let previewData;
  try {
    previewData = await fetchJSON(`${REPO_ROOT}/data/preview.json`);
    if (!isCurrent()) return;
  } catch {
    if (!isCurrent()) return;
    gamesEl.innerHTML = `<div class="empty-state"><div class="box">
      <p><strong>Preview unavailable.</strong></p>
      <p><a href="./">Back to the latest slate →</a></p>
    </div></div>`;
    if (header.statusEl) header.statusEl.textContent = `Preview unavailable for ${fmtShortDate(previewInfo.date)}`;
    return;
  }

  const games = Array.isArray(previewData?.games) ? previewData.games.filter(isValidPreviewGame) : [];
  if (games.length === 0) {
    gamesEl.innerHTML = `<div class="empty-state"><div class="box">No preview games for ${fmtDate(previewInfo.date)} yet.</div></div>`;
    if (header.statusEl) header.statusEl.textContent = `No preview games for ${fmtShortDate(previewInfo.date)}`;
    return;
  }

  // structural validity (isValidPreviewGame) doesn't guarantee field TYPES —
  // this crosses a repo boundary (a separate pipeline writes preview.json),
  // so a single malformed field anywhere in the slate must never blank the
  // whole page.
  let cardsHtml;
  try {
    cardsHtml = previewBannerHtml(previewData?.generated_at_utc) + games.map(previewGameCard).join("");
  } catch {
    if (!isCurrent()) return;
    gamesEl.innerHTML = `<div class="empty-state"><div class="box">
      <p><strong>Preview unavailable.</strong></p>
      <p><a href="./">Back to the latest slate →</a></p>
    </div></div>`;
    if (header.statusEl) header.statusEl.textContent = `Preview unavailable for ${fmtShortDate(previewInfo.date)}`;
    return;
  }

  gamesEl.innerHTML = cardsHtml;
  if (header.statusEl) {
    header.statusEl.textContent =
      `Preview for ${fmtShortDate(previewInfo.date)} — ${games.length} game${games.length === 1 ? "" : "s"}, no prediction until tomorrow morning`;
  }

  await refreshRecordStrip(isCurrent);
}

/* ---------- game detail page (game.html) ---------- */

function parseGameKey(g) {
  if (typeof g !== "string") return null;
  const parts = g.split("-");
  if (parts.length !== 3) return null;
  const [away, home, dhStr] = parts;
  if (!away || !home || dhStr === "") return null;
  const dh = Number(dhStr);
  if (!Number.isInteger(dh) || dh < 0) return null;
  return { away, home, dh };
}

function isValidDateParam(date) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function findGameInPredictions(day, away, home, dh) {
  if (!day || !Array.isArray(day.games)) return null;
  return day.games.find((g) => g.away === away && g.home === home && (g.dh_game_number ?? 0) === dh) ?? null;
}

function fmtLocalDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return escapeHtml(String(iso));
  return escapeHtml(d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }));
}

function recordsHtml(away, home, awayRec, homeRec) {
  const parts = [];
  if (awayRec) parts.push(`${escapeHtml(away)} ${escapeHtml(String(awayRec.wins))}-${escapeHtml(String(awayRec.losses))}`);
  if (homeRec) parts.push(`${escapeHtml(home)} ${escapeHtml(String(homeRec.wins))}-${escapeHtml(String(homeRec.losses))}`);
  return parts.join(" · ");
}

function weatherHtml(w) {
  if (!w) return "";
  const parts = [];
  if (w.condition) parts.push(escapeHtml(w.condition));
  if (w.temp != null) parts.push(`${escapeHtml(String(w.temp))}°F`);
  if (w.wind != null) parts.push(`wind ${escapeHtml(String(w.wind))}`);
  return parts.join(", ");
}

function spLineHtml(label, sp) {
  if (!sp || !sp.name || sp.status === "tbd") {
    return `<div class="meta-row">${escapeHtml(label)}: Starter TBD</div>`;
  }
  const hand = sp.hand ? ` (${escapeHtml(sp.hand)})` : "";
  const status = sp.status ? ` — ${escapeHtml(sp.status)}` : "";
  return `<div class="meta-row">${escapeHtml(label)}: ${escapeHtml(sp.name)}${hand}${status}</div>`;
}

function renderGameHeaderHtml({ away, home, dh }, matchGame, detailsHeader) {
  const awayCode = escapeHtml(away);
  const homeCode = escapeHtml(home);

  let matchupHtml;
  const flags = [];
  if (matchGame) {
    const pHome = matchGame.prob_home_win;
    const pAway = 1 - pHome;
    const homeFav = pHome >= 0.5;
    matchupHtml = `
      <div class="micro-label">Model win probability</div>
      <div class="matchup">
        <div class="team away">
          <span class="code" style="--team-color:${teamColor(away)}">${awayCode}</span>
          <span class="pct ${homeFav ? "dog" : "fav"}">${pct(pAway)}</span>
        </div>
        <span class="at">@</span>
        <div class="team home">
          <span class="code" style="--team-color:${teamColor(home)}">${homeCode}</span>
          <span class="pct ${homeFav ? "fav" : "dog"}">${pct(pHome)}</span>
        </div>
      </div>
      ${contestedTagHtml(matchGame)}`;

    const rf = resultFlagHtml(matchGame.result, pHome);
    if (rf) flags.push(rf);
    flags.push(...lineupFlags(matchGame));
    flags.push(...spFlags(matchGame));
    if (matchGame.low_confidence) flags.push('<span class="flag warn">low confidence</span>');
  } else {
    matchupHtml = `
      <div class="matchup">
        <div class="team away"><span class="code" style="--team-color:${teamColor(away)}">${awayCode}</span><span class="pct">—</span></div>
        <span class="at">@</span>
        <div class="team home"><span class="code" style="--team-color:${teamColor(home)}">${homeCode}</span><span class="pct">—</span></div>
      </div>`;
  }
  if (dh > 0) flags.push(`<span class="flag">DH game ${dh}</span>`);
  const flagsHtml = flags.length ? `<div class="flags">${flags.join("")}</div>` : "";

  const h = detailsHeader || {};
  const metaRows = [];
  const recs = recordsHtml(away, home, h.away_record, h.home_record);
  if (recs) metaRows.push(`<div class="meta-row">${recs}</div>`);
  if (h.venue) metaRows.push(`<div class="meta-row">${escapeHtml(h.venue)}</div>`);
  if (h.first_pitch_utc) {
    const dn = h.day_night ? ` · ${escapeHtml(h.day_night)}` : "";
    metaRows.push(`<div class="meta-row">${fmtLocalDateTime(h.first_pitch_utc)}${dn}</div>`);
  }
  const wx = weatherHtml(h.weather);
  if (wx) metaRows.push(`<div class="meta-row">${wx}</div>`);
  const awaySp = h.away_sp || (matchGame?.away_sp ? { name: matchGame.away_sp } : null);
  const homeSp = h.home_sp || (matchGame?.home_sp ? { name: matchGame.home_sp } : null);
  metaRows.push(spLineHtml(`${away} SP`, awaySp));
  metaRows.push(spLineHtml(`${home} SP`, homeSp));

  return `
    ${matchupHtml}
    ${flagsHtml}
    <div class="game-meta">${metaRows.join("")}</div>`;
}

/* Returns { label, value } for the detail panel's stat-row layout, or null
   when the underlying data is absent — `value` carries every stat exactly
   as before, just without the old inline label prefix. */
function lineupRowSeasonLineHtml(seasonYear, st, rates) {
  if (!st) return null;
  const year = escapeHtml(String(seasonYear));
  const g = fmtOrDash(st.g, fmt0);
  const pa = fmtOrDash(st.pa, fmt0);
  const h = fmtOrDash(st.h, fmt0);
  const ab = fmtOrDash(st.ab, fmt0);
  const hr = fmtOrDash(st.hr, fmt0);
  const bb = fmtOrDash(st.bb, fmt0);
  const so = fmtOrDash(st.so, fmt0);
  const rateBits = [];
  if (rates?.avg != null) rateBits.push(`AVG ${fmtRate(rates.avg)}`);
  if (rates?.obp != null) rateBits.push(`OBP ${fmtRate(rates.obp)}`);
  if (rates?.slg != null) rateBits.push(`SLG ${fmtRate(rates.slg)}`);
  const rateSuffix = rateBits.length ? ` · ${rateBits.join("/")}` : "";
  return { label: `${year} season`, value: `${g} G, ${pa} PA — ${h}/${ab}, ${hr} HR, ${bb} BB, ${so} SO${rateSuffix}` };
}

function lineupRowCareerLineHtml(car) {
  if (!car) return null;
  const avg = car.avg != null ? fmtRate(car.avg) : "—";
  const obp = car.obp != null ? fmtRate(car.obp) : "—";
  const slg = car.slg != null ? fmtRate(car.slg) : "—";
  const h = fmtOrDash(car.h, fmt0);
  const ab = fmtOrDash(car.ab, fmt0);
  const hr = fmtOrDash(car.hr, fmt0);
  const pa = fmtOrDash(car.pa, fmt0);
  return { label: "Career", value: `${avg}/${obp}/${slg} — ${h}/${ab}, ${hr} HR (${pa} PA)` };
}

function lineupRowVsSpLineHtml(vsSp, oppSpName) {
  if (!vsSp) return null;
  const name = oppSpName ? escapeHtml(oppSpName) : "TBD";
  const h = fmtOrDash(vsSp.h, fmt0);
  const ab = fmtOrDash(vsSp.ab, fmt0);
  const hr = fmtOrDash(vsSp.hr, fmt0);
  const bb = fmtOrDash(vsSp.bb, fmt0);
  const so = fmtOrDash(vsSp.so, fmt0);
  const avg = vsSp.avg != null ? fmtRate(vsSp.avg) : "—";
  return { label: `vs ${name}`, value: `${h}/${ab}, ${hr} HR, ${bb} BB, ${so} SO (AVG ${avg})` };
}

function lineupRowDetailHtml(row, seasonYear, oppSpName) {
  const stats = [
    lineupRowSeasonLineHtml(seasonYear, row.season_totals, row),
    lineupRowCareerLineHtml(row.career),
    lineupRowVsSpLineHtml(row.vs_sp, oppSpName),
  ].filter(Boolean);
  if (stats.length === 0) return "";
  const statsHtml = stats
    .map(({ label, value }) => `<div class="detail-stat"><span class="detail-stat-label">${label}</span><span class="detail-stat-val">${value}</span></div>`)
    .join("");
  return `<div class="row-detail-wrap">${statsHtml}</div>`;
}

/* Whether at least one row in `rows` actually has a detail panel — mirrors
   lineupPanelHtml's own per-row `hasDetail` check, used to gate the
   "Tap a player for..." hint above both lineup tables. */
function anyLineupRowHasDetail(rows, seasonYear, oppSpName) {
  return (rows || []).some((r) => !!lineupRowDetailHtml(r, seasonYear, oppSpName));
}

function lineupPanelHtml(code, rows, status, seasonYear, oppSpName) {
  if (!rows) {
    return `<div class="lineup-panel">
      <h3>${teamTagHtml(code)}</h3>
      <p class="stale-note">Lineup unavailable — model used league-average priors.</p>
    </div>`;
  }
  const caption = status === "projected_last_game"
    ? `<p class="stale-note">projected from last played game</p>` : "";
  const rowsHtml = rows.map((r, idx) => {
    const dim = r.source === "league_avg";
    const cellCls = dim ? ' class="lg-avg"' : "";
    const badge = dim
      ? `<sup class="lg-avg-mark" title="no player-level data matched (call-up or name mismatch); league-average rates shown">*</sup>`
      : "";
    const detailHtml = lineupRowDetailHtml(r, seasonYear, oppSpName);
    const hasDetail = !!detailHtml;
    const rowId = `lineup-row-${escapeHtml(code)}-${idx}`;
    const rowOpenTag = hasDetail
      ? `<tr class="lineup-row has-detail" tabindex="0" aria-expanded="false" data-detail-target="${rowId}-detail">`
      : `<tr class="lineup-row">`;
    const caret = hasDetail ? `<span class="expand-caret" aria-hidden="true">▸</span>` : "";
    const mainRow = `${rowOpenTag}
      <td>${escapeHtml(r.slot ?? "")}</td>
      <td><span class="player-name" title="${escapeHtml(r.name ?? "")}">${escapeHtml(r.name ?? "")}</span>${badge}${caret}</td>
      <td>${escapeHtml(r.pos ?? "")}</td>
      <td${cellCls}>${r.avg != null ? fmtRate(r.avg) : "—"}</td>
      <td${cellCls}>${r.obp != null ? fmtRate(r.obp) : "—"}</td>
      <td${cellCls}>${r.slg != null ? fmtRate(r.slg) : "—"}</td>
      <td${cellCls}>${r.k_pct != null ? fmtPctVal(r.k_pct) : "—"}</td>
      <td${cellCls}>${r.bb_pct != null ? fmtPctVal(r.bb_pct) : "—"}</td>
    </tr>`;
    const detailRow = hasDetail
      ? `<tr class="row-detail" id="${rowId}-detail" hidden><td colspan="8">${detailHtml}</td></tr>`
      : "";
    return mainRow + detailRow;
  }).join("");
  return `<div class="lineup-panel">
    <h3>${teamTagHtml(code)}</h3>
    ${caption}
    <div class="table-scroll">
    <table class="lineup-table">
      <thead><tr><th>#</th><th>Name</th><th>Pos</th><th>AVG</th><th>OBP</th><th>SLG</th><th>K%</th><th>BB%</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    </div>
  </div>`;
}

function renderLineupsHtml(lineups, lineupStatus, awayCode, homeCode, seasonYear, header) {
  if (!lineups) {
    return `<h2>Lineups</h2><p class="stale-note">Lineup data unavailable.</p>`;
  }
  const status = lineupStatus || {};
  const h = header || {};
  const footer = lineups.stats_as_of
    ? `<p class="stale-note">player rates as of ${escapeHtml(lineups.stats_as_of)}</p>` : "";
  const hasLgAvg = [...(lineups.away || []), ...(lineups.home || [])].some((r) => r.source === "league_avg");
  const legend = hasLgAvg
    ? `<p class="stale-note lg-avg-legend">* — no player-level data matched (call-up or name mismatch); league-average rates shown.</p>`
    : "";
  const hasAnyDetail = anyLineupRowHasDetail(lineups.away, seasonYear, h.home_sp?.name)
    || anyLineupRowHasDetail(lineups.home, seasonYear, h.away_sp?.name);
  const hint = hasAnyDetail
    ? `<p class="stale-note lineup-hint">Tap a player for season, career, and vs-starter detail.</p>`
    : "";
  return `<h2>Lineups</h2>
    ${hint}
    <div class="detail-grid">
      ${lineupPanelHtml(awayCode, lineups.away, status.away, seasonYear, h.home_sp?.name)}
      ${lineupPanelHtml(homeCode, lineups.home, status.home, seasonYear, h.away_sp?.name)}
    </div>
    ${footer}
    ${legend}`;
}

function wireExpandableRows(container) {
  if (!container || typeof container.querySelectorAll !== "function") return;
  container.querySelectorAll("tr.lineup-row.has-detail").forEach((row) => {
    const targetId = row.dataset.detailTarget;
    const detailRow = targetId ? document.getElementById(targetId) : null;
    if (!detailRow) return;
    const caret = row.querySelector(".expand-caret");
    const toggle = () => {
      const expanded = row.getAttribute("aria-expanded") === "true";
      row.setAttribute("aria-expanded", String(!expanded));
      detailRow.hidden = expanded;
      if (caret) caret.textContent = expanded ? "▸" : "▾";
    };
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });
}

function compareRowHtml(label, awayVal, homeVal, opts = {}) {
  const { lowerIsBetter = false, fmt = (v) => String(v), highlight = true } = opts;
  const awayNum = typeof awayVal === "number" && Number.isFinite(awayVal);
  const homeNum = typeof homeVal === "number" && Number.isFinite(homeVal);
  const awayDisplay = awayVal == null ? "—" : escapeHtml(awayNum ? fmt(awayVal) : String(awayVal));
  const homeDisplay = homeVal == null ? "—" : escapeHtml(homeNum ? fmt(homeVal) : String(homeVal));

  let awayBetter = false, homeBetter = false;
  if (highlight && awayNum && homeNum && awayVal !== homeVal) {
    awayBetter = lowerIsBetter ? awayVal < homeVal : awayVal > homeVal;
    homeBetter = !awayBetter;
  }

  return `<div class="compare-row">
    <div class="compare-label">${escapeHtml(label)}</div>
    <div class="compare-val away${awayBetter ? " better" : ""}">${awayDisplay}</div>
    <div class="compare-val home${homeBetter ? " better" : ""}">${homeDisplay}</div>
  </div>`;
}

function statRows(rowsConfig, obj) {
  return rowsConfig.map(([key, label, opts]) => {
    const leaf = obj?.[key] ?? {};
    return compareRowHtml(label, leaf.away ?? null, leaf.home ?? null, opts);
  }).join("");
}

const BATTING_ROWS = [
  ["avg", "AVG", { fmt: fmtRate }],
  ["obp", "OBP", { fmt: fmtRate }],
  ["slg", "SLG", { fmt: fmtRate }],
  ["runs_per_game", "Runs/game", { fmt: fmt1 }],
  ["hr_per_game", "HR/game", { fmt: fmt1 }],
  ["bb_per_game", "BB/game", { fmt: fmt1 }],
  ["so_pct", "K%", { fmt: fmtPctVal, lowerIsBetter: true }],
];
const PITCHING_ROWS = [
  ["era", "ERA", { fmt: fmt2, lowerIsBetter: true }],
  ["whip", "WHIP", { fmt: fmt2, lowerIsBetter: true }],
  ["k_per_9", "K/9", { fmt: fmt1 }],
  ["bb_per_9", "BB/9", { fmt: fmt1, lowerIsBetter: true }],
  ["hr_per_9", "HR/9", { fmt: fmt1, lowerIsBetter: true }],
  ["bullpen_era", "Bullpen ERA", { fmt: fmt2, lowerIsBetter: true }],
  ["bullpen_whip", "Bullpen WHIP", { fmt: fmt2, lowerIsBetter: true }],
];
const FORM_ROWS = [
  ["wins", "Wins", { fmt: fmt0 }],
  ["losses", "Losses", { fmt: fmt0, highlight: false }],
  ["win_pct", "Win %", { fmt: fmtPctVal }],
  ["streak", "Streak", { fmt: (v) => String(v), highlight: false }],
  ["run_diff_per_game", "Run diff/game", { fmt: fmt2 }],
  // payload sign convention: positive = games up, the pipeline's
  // parse_games_behind negates Baseball Reference's GB (e.g. "1.5 GB"
  // becomes -1.5, "up 0.5" becomes +0.5) — so higher is better here, the
  // default direction (no lowerIsBetter).
  ["games_behind", "Games up", { fmt: fmtSigned1 }],
  ["days_rest", "Days rest", { fmt: fmt0, highlight: false }],
];
const H2H_ROWS = [
  ["games", "Games", { fmt: fmt0, highlight: false }],
  ["win_pct", "Win %", { fmt: fmtPctVal }],
  ["avg", "AVG", { fmt: fmtRate }],
  ["obp", "OBP", { fmt: fmtRate }],
  ["slg", "SLG", { fmt: fmtRate }],
  ["runs_per_game", "Runs/game", { fmt: fmt1 }],
];

function gameStickyHtml(awayCode, homeCode, matchGame) {
  const away = escapeHtml(awayCode);
  const home = escapeHtml(homeCode);
  const hasProb = matchGame && Number.isFinite(matchGame.prob_home_win);
  const hp = hasProb ? Math.round(matchGame.prob_home_win * 100) : null;
  const awayText = hasProb ? `${away} ${100 - hp}%` : away;
  const homeText = hasProb ? `${hp}% ${home}` : home;
  const sep = hasProb ? "win prob" : "vs";
  return `<div class="game-sticky">
    <span class="side away" style="--team-color:${teamColor(awayCode)}">AWAY · ${awayText}</span>
    <span class="sticky-sep">${sep}</span>
    <span class="side home" style="--team-color:${teamColor(homeCode)}">${homeText} · HOME</span>
  </div>`;
}

function renderTeamStatsHtml(stats, awayCode, homeCode) {
  if (!stats) return `<h2>Team stats</h2><p class="stale-note">Team stats unavailable.</p>`;
  const away = escapeHtml(awayCode);
  const home = escapeHtml(homeCode);
  const groups = [
    ["Batting", BATTING_ROWS, stats.batting],
    ["Pitching", PITCHING_ROWS, stats.pitching],
    ["Recent form", FORM_ROWS, stats.form],
    ["Head-to-head", H2H_ROWS, stats.head_to_head],
  ];
  const codesRow = `<div class="compare-row compare-codes"><div class="compare-label"></div><div class="compare-val away">${away}</div><div class="compare-val home">${home}</div></div>`;
  const body = groups
    .filter(([, , obj]) => obj)
    .map(([title, rowsCfg, obj]) => `<div class="compare-group"><h3>${title}</h3>${codesRow}${statRows(rowsCfg, obj)}</div>`)
    .join("");
  if (!body) return `<h2>Team stats</h2><p class="stale-note">Team stats unavailable.</p>`;
  return `<h2>Team stats</h2><div class="compare-cols">${body}</div>`;
}

function spSeasonTableHtml(s) {
  return `<div class="table-scroll"><table class="lineup-table sp-season-table">
    <thead><tr><th>GS</th><th>IP</th><th>ERA</th><th>K/9</th><th>BB/9</th><th>HR/9</th></tr></thead>
    <tbody><tr>
      <td>${fmtOrDash(s.starts, fmt0)}</td>
      <td>${fmtOrDash(s.ip, fmt1)}</td>
      <td>${fmtOrDash(s.era, fmt2)}</td>
      <td>${fmtOrDash(s.k9, fmt1)}</td>
      <td>${fmtOrDash(s.bb9, fmt1)}</td>
      <td>${fmtOrDash(s.hr9, fmt1)}</td>
    </tr></tbody>
  </table></div>`;
}

function spWorkloadLineHtml(s) {
  const bits = [];
  if (s.days_rest != null) bits.push(`rest ${fmtOrDash(s.days_rest, fmt0)}d`);
  if (s.starts_last_30 != null) bits.push(`${fmtOrDash(s.starts_last_30, fmt0)} starts/30d`);
  return bits.join(" · ");
}

function spPanelHtml(code, sp, oppCode) {
  if (!sp) {
    return `<div class="sp-panel"><h3>${teamTagHtml(code)}</h3><p class="stale-note">No starter info available.</p></div>`;
  }
  const s = sp.season || {};
  const seasonTable = spSeasonTableHtml(s);
  const workload = spWorkloadLineHtml(s);
  const starts = sp.last_starts || [];
  const isDebut = (s.starts == null || s.starts === 0) && starts.length === 0;

  const nameLine = `<p>${escapeHtml(sp.name ?? "TBD")}</p>`;
  const workloadLine = workload ? `<p class="stale-note">${workload}</p>` : "";
  const debutNote = isDebut ? `<p class="stale-note">first MLB start of the season</p>` : "";

  const startsHtml = starts.length === 0
    ? `<p class="stale-note">no prior starts this season</p>`
    : `<div class="table-scroll"><table class="lineup-table">
        <thead><tr><th>Date</th><th>IP</th><th>ER</th><th>SO</th><th>BB</th><th>HR</th><th>P</th></tr></thead>
        <tbody>${starts.map((st) => `<tr>
          <td>${escapeHtml(st.date ?? "")}</td>
          <td>${fmtOrDash(st.ip, fmt1)}</td>
          <td>${fmtOrDash(st.er, fmt0)}</td>
          <td>${fmtOrDash(st.so, fmt0)}</td>
          <td>${fmtOrDash(st.bb, fmt0)}</td>
          <td>${fmtOrDash(st.hr, fmt0)}</td>
          <td>${fmtOrDash(st.pitches, fmt0)}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;

  const vo = sp.vs_opponent;
  const voLine = vo
    ? `<p>vs ${escapeHtml(oppCode)}: ${fmtOrDash(vo.bf, fmt0)} BF · ERA ${fmtOrDash(vo.era, fmt2)} · WHIP ${fmtOrDash(vo.whip, fmt2)} · K/9 ${fmtOrDash(vo.k9, fmt1)} · BB/9 ${fmtOrDash(vo.bb9, fmt1)} · HR/9 ${fmtOrDash(vo.hr9, fmt1)} · H/9 ${fmtOrDash(vo.h9, fmt1)} · ${fmtOrDash(vo.ip, fmt1)} IP</p>`
    : `<p class="stale-note">no career history vs ${escapeHtml(oppCode)}</p>`;

  return `<div class="sp-panel">
    <h3>${teamTagHtml(code)}</h3>
    ${nameLine}
    ${debutNote}
    ${seasonTable}
    ${workloadLine}
    ${startsHtml}
    ${voLine}
  </div>`;
}

function renderSpDetailHtml(spDetail, awayCode, homeCode) {
  if (!spDetail) return `<h2>Starting pitchers</h2><p class="stale-note">Starter detail unavailable.</p>`;
  return `<h2>Starting pitchers</h2>
    <div class="detail-grid">
      ${spPanelHtml(awayCode, spDetail.away, homeCode)}
      ${spPanelHtml(homeCode, spDetail.home, awayCode)}
    </div>`;
}

function formChipHtml(entry) {
  const oppLabel = (entry.at_home ? "" : "@") + escapeHtml(entry.opp ?? "");
  const score = `${fmtOrDash(entry.rf, fmt0)}–${fmtOrDash(entry.ra, fmt0)}`;
  const cls = entry.won === true ? "result-win" : entry.won === false ? "result-loss" : "";
  const text = entry.won === true ? "W" : entry.won === false ? "L" : "—";
  return `<div class="form-chip">
    <span class="fc-date" title="${escapeHtml(entry.date ?? "")}">${escapeHtml(fmtShortDate(entry.date))}</span>
    <span class="fc-opp">${oppLabel}</span>
    <span class="fc-score">${score}</span>
    <span class="flag ${cls}">${text}</span>
  </div>`;
}

function formColumnHtml(code, entries) {
  if (!entries || entries.length === 0) {
    return `<div class="form-col"><h3>${teamTagHtml(code)}</h3><p class="stale-note">No recent games.</p></div>`;
  }
  return `<div class="form-col"><h3>${teamTagHtml(code)}</h3>${entries.map(formChipHtml).join("")}</div>`;
}

function renderRecentFormHtml(recentForm, awayCode, homeCode) {
  if (!recentForm) return `<h2>Recent form</h2><p class="stale-note">Recent form unavailable.</p>`;
  return `<h2>Recent form</h2>
    <div class="detail-grid">
      ${formColumnHtml(awayCode, recentForm.away)}
      ${formColumnHtml(homeCode, recentForm.home)}
    </div>`;
}

function renderDetailEmptyHtml() {
  return `<div class="box">Details unavailable for this game.</div>`;
}

function isGraded(g) {
  return !!(g?.result && typeof g.result.home_won === "boolean");
}

let _detailCtx = null;
let _detailEligible = false;

async function renderGameDetail() {
  const headerEl = document.getElementById("game-header");
  const stickyEl = document.getElementById("game-sticky");
  const emptyEl = document.getElementById("detail-empty");
  const lineupsEl = document.getElementById("lineups");
  const statsEl = document.getElementById("team-stats");
  const spEl = document.getElementById("sp-detail");
  const formEl = document.getElementById("recent-form");
  const crumbEl = document.getElementById("crumb");
  const crumbHomeEl = document.getElementById("crumb-home");
  if (!headerEl) return;

  try {
    const params = new URLSearchParams(location.search);
    const date = params.get("date");
    const parsed = parseGameKey(params.get("g"));

    if (!isValidDateParam(date) || !parsed) {
      headerEl.innerHTML = `<p class="stale-note">Invalid game link.</p>`;
      if (emptyEl) emptyEl.style.display = "none";
      _detailEligible = false;
      return;
    }

    const { away, home, dh } = parsed;
    if (crumbEl) crumbEl.textContent = `${away} @ ${home}`;
    if (crumbHomeEl) crumbHomeEl.href = `./?date=${encodeURIComponent(date)}`;

    const [predictions, details] = await Promise.all([
      fetchJSON(`${REPO_ROOT}/data/predictions/${date}.json`).catch(() => null),
      fetchJSON(`${REPO_ROOT}/data/details/${date}.json`).catch(() => null),
    ]);

    const matchGame = findGameInPredictions(predictions, away, home, dh);
    const gameKey = `${away}-${home}-${dh}`;
    const gameDetail = details?.games?.[gameKey] ?? null;

    document.title = `${away} @ ${home} — ml.ball`;

    headerEl.innerHTML = renderGameHeaderHtml({ away, home, dh }, matchGame, gameDetail?.header ?? null);
    if (stickyEl) stickyEl.innerHTML = gameStickyHtml(away, home, matchGame);

    _detailCtx = { date, away, home, dh, detailsHeader: gameDetail?.header ?? null, hadDetail: !!gameDetail };
    _detailEligible = !isGraded(matchGame);

    if (!gameDetail) {
      if (emptyEl) {
        emptyEl.style.display = "";
        emptyEl.innerHTML = renderDetailEmptyHtml();
      }
      if (stickyEl) stickyEl.innerHTML = "";
      if (lineupsEl) lineupsEl.innerHTML = "";
      if (statsEl) statsEl.innerHTML = "";
      if (spEl) spEl.innerHTML = "";
      if (formEl) formEl.innerHTML = "";
      return;
    }
    if (emptyEl) emptyEl.style.display = "none";

    if (lineupsEl) {
      lineupsEl.innerHTML = renderLineupsHtml(
        gameDetail.lineups, gameDetail.header?.lineup_status, away, home, date.slice(0, 4), gameDetail.header
      );
      wireExpandableRows(lineupsEl);
    }
    if (statsEl) statsEl.innerHTML = renderTeamStatsHtml(gameDetail.team_stats, away, home);
    if (spEl) spEl.innerHTML = renderSpDetailHtml(gameDetail.sp_detail, away, home);
    if (formEl) formEl.innerHTML = renderRecentFormHtml(gameDetail.recent_form, away, home);
  } catch (e) {
    if (emptyEl) {
      emptyEl.style.display = "";
      emptyEl.innerHTML = renderDetailEmptyHtml();
    }
    if (stickyEl) stickyEl.innerHTML = "";
    if (lineupsEl) lineupsEl.innerHTML = "";
    if (statsEl) statsEl.innerHTML = "";
    if (spEl) spEl.innerHTML = "";
    if (formEl) formEl.innerHTML = "";
    _detailEligible = false;
  }
}

let _detailRefreshToken = 0;

/* Refreshes only the header + sticky bar (win prob / result flag) — never
   lineups/team-stats/SP-detail/recent-form, so an expanded lineup row stays
   expanded across a background refresh. Stops polling once the game is
   graded (isGraded), since a graded result never changes again. */
async function refreshGameResult() {
  if (!_detailCtx || !_detailEligible) return;
  const my = ++_detailRefreshToken;
  const preds = await fetchJSON(`${REPO_ROOT}/data/predictions/${_detailCtx.date}.json`).catch(() => null);
  if (my !== _detailRefreshToken || !preds) return;
  const g = findGameInPredictions(preds, _detailCtx.away, _detailCtx.home, _detailCtx.dh);
  if (!g) return;

  const headerEl = document.getElementById("game-header");
  if (headerEl) {
    headerEl.innerHTML = renderGameHeaderHtml(
      { away: _detailCtx.away, home: _detailCtx.home, dh: _detailCtx.dh },
      g,
      _detailCtx.detailsHeader
    );
  }
  if (_detailCtx.hadDetail) {
    const stickyEl = document.getElementById("game-sticky");
    if (stickyEl) stickyEl.innerHTML = gameStickyHtml(_detailCtx.away, _detailCtx.home, g);
  }
  if (isGraded(g)) _detailEligible = false;
}

function updateNavHeightVar() {
  const nav = document.querySelector(".nav");
  if (nav) {
    document.documentElement.style.setProperty("--nav-h", `${nav.getBoundingClientRect().height}px`);
  }
}

/* ---------- accuracy history panel ---------- */

/* Filters index.json's `dates` array down to rows that actually have a
   graded result and turns it into a running cumulative-accuracy series.
   Gap days (no entry) are simply absent from `entries`, so they show up as
   wider horizontal spacing in the chart's true time scale rather than a
   plotted point; the trailing today's-slate entry (n_graded: 0) is dropped
   here, same as any other malformed/ungraded row. */
function cumulativeAccuracySeries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let cumCorrect = 0;
  let cumGraded = 0;
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const { date, n_graded, n_correct } = e;
    if (!isValidDateParam(date)) continue;
    if (!isFiniteNum(n_graded) || n_graded <= 0) continue;
    if (!isFiniteNum(n_correct) || n_correct < 0 || n_correct > n_graded) continue;
    cumCorrect += n_correct;
    cumGraded += n_graded;
    out.push({
      date,
      dayCorrect: n_correct,
      dayGraded: n_graded,
      dayAcc: n_correct / n_graded,
      cumCorrect,
      cumGraded,
      cumAcc: cumCorrect / cumGraded,
    });
  }
  return out;
}

function _accDayNum(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? ""));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000;
}

function _accFloor10(v) { return Math.floor(v / 10) * 10; }
function _accCeil10(v) { return Math.ceil(v / 10) * 10; }

/* Thins a sorted array of candidate tick values down to at most `max`,
   always keeping the first and last, picking evenly-spaced indices in
   between — shared by the x-axis tick selection below. */
function _accThinToMax(arr, max) {
  if (arr.length <= max) return arr;
  const out = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i * (arr.length - 1)) / (max - 1));
    out.push(arr[idx]);
  }
  return out.filter((v, i) => i === 0 || v !== out[i - 1]);
}

function _accReadoutText(pt) {
  const dayPct = Math.round(pt.dayAcc * 100);
  const cumPct = (pt.cumAcc * 100).toFixed(1);
  return `${fmtShortDate(pt.date)} — day ${pt.dayCorrect}/${pt.dayGraded} (${dayPct}%) · cumulative ${pt.cumCorrect}/${pt.cumGraded} (${cumPct}%)`;
}

/* Pure string -> inline SVG. Colors/fonts are set via inline `style` (not
   new CSS classes) so this stays a self-contained, independently testable
   string builder — same reasoning as teamTagHtml's inline --team-color. */
function accuracyChartSvg(series) {
  const W = 640, H = 220;
  const margin = { top: 16, right: 54, bottom: 28, left: 16 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;

  const showDots = series.length > 0 && series.length <= 60;

  const dayNums = series.map((s) => _accDayNum(s.date)).filter((n) => Number.isFinite(n));
  const minDay = dayNums.length ? Math.min(...dayNums) : 0;
  const maxDay = dayNums.length ? Math.max(...dayNums) : 0;
  const dayRange = Math.max(1, maxDay - minDay);
  const xOf = (dateStr) => margin.left + ((_accDayNum(dateStr) - minDay) / dayRange) * plotW;

  const yValues = series.map((s) => s.cumAcc * 100);
  if (showDots) yValues.push(...series.map((s) => s.dayAcc * 100));
  yValues.push(50);
  const yMin = Math.max(0, _accFloor10(Math.min(...yValues) - 5));
  const yMax = Math.min(100, _accCeil10(Math.max(...yValues) + 5));
  const yRange = Math.max(1, yMax - yMin);
  const yOf = (pctVal) => margin.top + (1 - (pctVal - yMin) / yRange) * plotH;

  const gridTicks = [];
  for (let t = Math.ceil(yMin / 10) * 10; t <= yMax; t += 10) gridTicks.push(t);
  const gridlinesHtml = gridTicks
    .map((t) => `<line x1="${margin.left}" y1="${yOf(t).toFixed(1)}" x2="${(margin.left + plotW).toFixed(1)}" y2="${yOf(t).toFixed(1)}" style="stroke:var(--rule);stroke-width:1;opacity:0.5" />`)
    .join("");

  const y50 = yOf(50);
  const hairlineHtml = `<line x1="${margin.left}" y1="${y50.toFixed(1)}" x2="${(margin.left + plotW).toFixed(1)}" y2="${y50.toFixed(1)}" style="stroke:var(--faint);stroke-width:1;stroke-dasharray:3 3" />
    <text x="${margin.left + 2}" y="${(y50 - 4).toFixed(1)}" style="fill:var(--faint);font-family:var(--font-mono);font-size:9px">50%</text>`;

  const pointsAttr = series.map((s) => `${xOf(s.date).toFixed(1)},${yOf(s.cumAcc * 100).toFixed(1)}`).join(" ");
  const lineHtml = `<polyline class="acc-line" points="${pointsAttr}" style="fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round" />`;

  const dotsHtml = showDots
    ? series.map((s) => `<circle cx="${xOf(s.date).toFixed(1)}" cy="${yOf(s.dayAcc * 100).toFixed(1)}" r="3.5" style="fill:var(--faint);stroke:var(--paper);stroke-width:2" />`).join("")
    : "";

  const last = series[series.length - 1];
  const first = series[0];
  const lastX = xOf(last.date);
  const lastY = yOf(last.cumAcc * 100);
  const endPct = (last.cumAcc * 100).toFixed(1);
  const endMarkHtml = `<circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4" style="fill:var(--accent)" />
    <text x="${(lastX + 8).toFixed(1)}" y="${(lastY + 4).toFixed(1)}" style="fill:var(--ink);font-family:var(--font-mono);font-size:12px;font-weight:600">${endPct}%</text>`;

  const monthBoundaries = [];
  let lastMonth = null;
  for (const s of series) {
    const mk = s.date.slice(0, 7);
    if (mk !== lastMonth) { monthBoundaries.push(s.date); lastMonth = mk; }
  }
  const seen = new Set();
  const candidateDates = [];
  for (const d of [first.date, ...monthBoundaries, last.date]) {
    if (!seen.has(d)) { seen.add(d); candidateDates.push(d); }
  }
  candidateDates.sort();
  const tickDates = _accThinToMax(candidateDates, 5);
  const xTicksHtml = tickDates
    .map((d, i) => {
      const anchor = i === 0 ? "start" : i === tickDates.length - 1 ? "end" : "middle";
      return `<text x="${xOf(d).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}" style="fill:var(--muted);font-family:var(--font-mono);font-size:10px">${escapeHtml(fmtShortDate(d))}</text>`;
    })
    .join("");

  const hitRectsHtml = series
    .map((s, i) => {
      const x = xOf(s.date);
      const y = yOf(s.cumAcc * 100);
      const prevX = i > 0 ? xOf(series[i - 1].date) : x - plotW / series.length;
      const nextX = i < series.length - 1 ? xOf(series[i + 1].date) : x + plotW / series.length;
      const w = Math.max(4, (nextX - prevX) / 2);
      const rx = Math.max(margin.left, x - w / 2);
      return `<rect class="acc-hit" data-i="${i}" data-x="${x.toFixed(1)}" data-y="${y.toFixed(1)}" x="${rx.toFixed(1)}" y="${margin.top}" width="${w.toFixed(1)}" height="${plotH}" style="fill:transparent;cursor:crosshair" />`;
    })
    .join("");

  const crosshairHtml = `<line class="acc-crosshair" x1="0" y1="${margin.top}" x2="0" y2="${margin.top + plotH}" style="stroke:var(--rule-strong);stroke-width:1;display:none" />
    <circle class="acc-hover-dot" cx="0" cy="0" r="5" style="fill:var(--accent);stroke:var(--paper);stroke-width:2;display:none" />`;

  const n = series.length;
  const ariaLabel = `Cumulative prediction accuracy across ${n} graded day${n === 1 ? "" : "s"}, ${fmtShortDate(first.date)} to ${fmtShortDate(last.date)}, ending at ${endPct}%.`;

  return `<svg class="acc-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(ariaLabel)}">
    <g class="acc-gridlines">${gridlinesHtml}</g>
    ${hairlineHtml}
    ${lineHtml}
    <g class="acc-dots">${dotsHtml}</g>
    ${endMarkHtml}
    <g class="acc-xticks">${xTicksHtml}</g>
    ${crosshairHtml}
    <g class="acc-hitrects">${hitRectsHtml}</g>
  </svg>`;
}

function renderAccuracyPanel(panelEl, indexData) {
  if (!panelEl) return;
  if (!indexData || !Array.isArray(indexData.dates)) {
    panelEl.innerHTML = `<p class="stale-note">History unavailable.</p>`;
    return;
  }
  const series = cumulativeAccuracySeries(indexData.dates);
  if (series.length === 0) {
    panelEl.innerHTML = `<p class="stale-note">No graded games yet.</p>`;
    return;
  }
  if (series.length === 1) {
    const s = series[0];
    const dayPct = (s.dayAcc * 100).toFixed(1);
    panelEl.innerHTML = `<div class="acc-chart-readout">
      <span aria-hidden="true" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:6px;vertical-align:middle"></span>${escapeHtml(fmtShortDate(s.date))} — ${s.dayCorrect} of ${s.dayGraded} correct (${dayPct}%)
    </div>`;
    return;
  }

  const last = series[series.length - 1];
  panelEl.innerHTML = `
    <div class="acc-chart-readout" id="acc-chart-readout">${escapeHtml(_accReadoutText(last))}</div>
    ${accuracyChartSvg(series)}
    <p class="slate-note">Cumulative accuracy after each day's graded games. Dots are single-day accuracy — small samples, mostly noise.</p>`;

  const svgEl = panelEl.querySelector("svg");
  const readoutEl = panelEl.querySelector("#acc-chart-readout");
  if (!svgEl) return;
  const crosshair = svgEl.querySelector(".acc-crosshair");
  const hoverDot = svgEl.querySelector(".acc-hover-dot");
  const hitRects = Array.from(svgEl.querySelectorAll(".acc-hit"));

  const toSvgX = (clientX) => {
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width) return 0;
    return (clientX - rect.left) * (640 / rect.width);
  };
  const nearestIndex = (svgX) => {
    let bestI = 0, bestD = Infinity;
    hitRects.forEach((r) => {
      const d = Math.abs(Number(r.dataset.x) - svgX);
      if (d < bestD) { bestD = d; bestI = Number(r.dataset.i); }
    });
    return bestI;
  };
  const showPoint = (idx) => {
    const pt = series[idx];
    const hit = hitRects[idx];
    if (!pt || !hit) return;
    if (readoutEl) readoutEl.textContent = _accReadoutText(pt);
    if (crosshair) {
      crosshair.setAttribute("x1", hit.dataset.x);
      crosshair.setAttribute("x2", hit.dataset.x);
      crosshair.style.display = "";
    }
    if (hoverDot) {
      hoverDot.setAttribute("cx", hit.dataset.x);
      hoverDot.setAttribute("cy", hit.dataset.y);
      hoverDot.style.display = "";
    }
  };
  const resetToLatest = () => {
    if (readoutEl) readoutEl.textContent = _accReadoutText(last);
    if (crosshair) crosshair.style.display = "none";
    if (hoverDot) hoverDot.style.display = "none";
  };

  svgEl.addEventListener("pointermove", (e) => showPoint(nearestIndex(toSvgX(e.clientX))));
  svgEl.addEventListener("pointerleave", resetToLatest);
}

/* ---------- accuracy page (accuracy.html) ---------- */

const CONFIDENCE_BUCKET_LABELS = {
  "[0.50,0.55)": "50–55% · toss-ups",
  "[0.55,0.60)": "55–60% · leans",
  "[0.60,1.00]": "60%+ · confident",
};

/* Known buckets first in their natural order, then any unrecognized key in
   whatever order record.json carries it — so a future/renamed bucket still
   renders instead of silently vanishing. */
function orderedConfidenceBucketKeys(byConfidence) {
  const known = ["[0.50,0.55)", "[0.55,0.60)", "[0.60,1.00]"];
  const keys = Object.keys(byConfidence);
  const rest = keys.filter((k) => !known.includes(k));
  return [...known.filter((k) => keys.includes(k)), ...rest];
}

function confidenceRowHtml(key, bucket) {
  const label = CONFIDENCE_BUCKET_LABELS[key] ?? key;
  const acc = isFiniteNum(bucket?.accuracy) ? bucket.accuracy : null;
  const n = isFiniteNum(bucket?.n_graded) ? bucket.n_graded : null;
  const barPct = acc != null ? Math.max(0, Math.min(100, acc * 100)) : 0;
  return `<div class="acc-conf-row">
    <div class="acc-conf-label">${escapeHtml(label)}</div>
    <div class="acc-conf-bar-wrap"><div class="acc-conf-bar-ref"></div><div class="acc-conf-bar" style="width:${barPct.toFixed(1)}%"></div></div>
    <div class="acc-conf-value">${fmtPctVal(acc)}</div>
    <div class="acc-conf-n">${n != null ? `${n} game${n === 1 ? "" : "s"}` : "—"}</div>
  </div>`;
}

function renderConfidenceSection(container, byConfidence) {
  if (!container) return;
  if (!byConfidence || typeof byConfidence !== "object" || Object.keys(byConfidence).length === 0) {
    container.innerHTML = `<p class="stale-note">Not available yet — check back soon.</p>`;
    return;
  }
  const keys = orderedConfidenceBucketKeys(byConfidence);
  container.innerHTML = keys.map((k) => confidenceRowHtml(k, byConfidence[k])).join("");
}

function renderLogLossStats(container, rec) {
  if (!container) return;
  const overall = isFiniteNum(rec?.overall?.log_loss) ? rec.overall.log_loss.toFixed(4) : null;
  if (overall == null) {
    container.innerHTML = `<p class="stale-note">Not available yet — check back soon.</p>`;
    return;
  }
  const parts = [`Overall: <strong>${overall}</strong>`];
  if (isFiniteNum(rec?.last_30d?.log_loss)) {
    parts.push(`Last 30 days: <strong>${rec.last_30d.log_loss.toFixed(4)}</strong>`);
  }
  container.innerHTML = `<p class="acc-stat-line">${parts.join(" · ")}</p>`;
}

/* home_baseline is one of the two new (currently absent from the deployed
   record.json) optional keys — must degrade to a stale-note, never throw,
   until the pipeline redeploys with it. */
function renderHomeBaselineSection(container, homeBaseline) {
  if (!container) return;
  if (!homeBaseline || typeof homeBaseline !== "object") {
    container.innerHTML = `<p class="stale-note">Not available yet — check back soon.</p>`;
    return;
  }
  const winRate = fmtPctVal(homeBaseline.home_win_rate);
  const pickRate = fmtPctVal(homeBaseline.home_pick_rate);
  const n = isFiniteNum(homeBaseline.n_graded) ? homeBaseline.n_graded : null;
  const onText = n != null ? `On the ${n} games graded here` : "On the games graded here";
  container.innerHTML = `<p class="acc-explainer">Home teams win roughly 52–54% of MLB games, so a &ldquo;model&rdquo; that always picks the home team gets ~53% accuracy for free — raw accuracy only means something against that baseline. ${onText}, always picking home would have scored ${winRate}. The model picked the home side in ${pickRate} of games. We watch that gap: a well-calibrated model shouldn't lean on home teams far beyond the real home-win rate for cheap accuracy.</p>`;
}

const ACCURACY_TEAM_STORAGE_KEY = "mlball-accuracy-team";

function teamDisplayName(code) {
  return TEAM_META[code]?.name ?? TEAM_META[TEAM_ALIASES[code]]?.name ?? code;
}

const TEAM_SPLIT_ROWS = [
  { key: "picked", label: "Picked them" },
  { key: "faded", label: "Picked against them" },
  { key: "home", label: "Home games" },
  { key: "away", label: "Road games" },
];

function teamSplitRowHtml(row, split) {
  const n = isFiniteNum(split?.n) ? split.n : null;
  const acc = isFiniteNum(split?.accuracy) ? split.accuracy : null;
  return `<div class="acc-team-split-row">
    <div class="acc-team-split-label">${escapeHtml(row.label)}</div>
    <div class="acc-team-split-n">${n != null ? `${n} game${n === 1 ? "" : "s"}` : "—"}</div>
    <div class="acc-team-split-value">${fmtPctVal(acc)}</div>
  </div>`;
}

/* Inner HTML for one team's expanded detail (summary stats + split rows +
   small-sample note) — used inline inside a division panel, under the row
   for that team, rather than in a separate shared container. */
function teamDetailContentHtml(entry) {
  if (!entry || typeof entry !== "object") {
    return `<p class="stale-note">No graded games for this team yet.</p>`;
  }
  const n = isFiniteNum(entry.n_graded) ? entry.n_graded : null;
  const wins = isFiniteNum(entry.wins) ? entry.wins : null;
  const record = n != null && wins != null ? `${wins}–${Math.max(0, n - wins)}` : "—";
  const splitsHtml = TEAM_SPLIT_ROWS.map((row) => teamSplitRowHtml(row, entry[row.key])).join("");
  return `
    <div class="acc-team-summary">
      <div class="acc-team-stat"><div class="label">Games graded</div><div class="value">${n != null ? n : "—"}</div></div>
      <div class="acc-team-stat"><div class="label">Team record</div><div class="value">${record}</div></div>
      <div class="acc-team-stat"><div class="label">Model accuracy</div><div class="value">${fmtPctVal(entry.accuracy)}</div></div>
    </div>
    <div class="acc-team-splits">${splitsHtml}</div>
    <p class="stale-note">A team appears in only a handful of graded games so far — treat these as noise until the sample grows.</p>`;
}

/* Looks up a division-mapped code's by_team entry, resolving any raw code
   that aliases onto it (e.g. a by_team key of "ATH" for a franchise whose
   division slot is "OAK") — direct code match wins if both happen to be
   present at once. */
function byTeamEntryForCode(code, byTeam) {
  if (byTeam[code]) return byTeam[code];
  for (const rawCode of Object.keys(TEAM_ALIASES)) {
    if (TEAM_ALIASES[rawCode] === code && byTeam[rawCode]) return byTeam[rawCode];
  }
  return null;
}

/* Raw by_team codes that don't resolve (directly or via TEAM_ALIASES) onto
   any division-mapped code — rendered in an "Other" panel so they're never
   silently dropped. */
function accOtherTeamCodes(byTeam) {
  return Object.keys(byTeam).filter((code) => {
    if (ACC_DIVISION_CODE_SET.has(code)) return false;
    const resolved = TEAM_ALIASES[code];
    return !(resolved && ACC_DIVISION_CODE_SET.has(resolved));
  });
}

/* Team codes drive DOM element ids (rowId/detailId) below. by_team keys
   (especially the "Other" bucket) aren't provably safe under the site's
   escapeHtml-everything discipline, so ids are derived from a whitelisted
   subset of the code rather than the raw string — keeps the id attribute
   value and its aria-controls reference matching by construction, and
   avoids any risk of breaking out of the surrounding double-quoted
   attribute. Shared with wireTeamPanels' post-toggle focus lookup so the
   two never drift apart. */
function accTeamIdSafe(code) {
  return String(code).replace(/[^A-Za-z0-9_-]/g, "_");
}

function accTeamRowHtml(code, entry, isExpanded) {
  const acc = entry ? fmtPctVal(entry.accuracy) : "—";
  const n = entry && isFiniteNum(entry.n_graded) ? entry.n_graded : null;
  const rowId = `acc-team-row-${accTeamIdSafe(code)}`;
  const detailId = `acc-team-detail-${accTeamIdSafe(code)}`;
  return `<div class="acc-team-row-wrap">
    <button type="button" class="acc-team-row${isExpanded ? " expanded" : ""}" id="${rowId}" data-team-code="${escapeHtml(code)}" aria-expanded="${isExpanded ? "true" : "false"}" aria-controls="${detailId}">
      <span class="acc-team-row-name">${escapeHtml(teamDisplayName(code))}</span>
      <span class="acc-team-row-stats">
        <span class="acc-team-row-acc">${acc}</span>
        <span class="acc-team-row-n">${n != null ? `${n}g` : "—"}</span>
        <span class="expand-caret" aria-hidden="true">${isExpanded ? "▾" : "▸"}</span>
      </span>
    </button>
    <div class="acc-team-row-detail" id="${detailId}"${isExpanded ? "" : " hidden"}>${isExpanded ? teamDetailContentHtml(entry) : ""}</div>
  </div>`;
}

function accPanelHtml(label, codes, byTeam, expandedCode, resolveEntry) {
  const sorted = [...codes].sort((a, b) => teamDisplayName(a).localeCompare(teamDisplayName(b)));
  const rowsHtml = sorted.map((code) => accTeamRowHtml(code, resolveEntry(code, byTeam), expandedCode === code)).join("");
  return `<div class="acc-division-panel">
    <div class="acc-division-label micro-label">${escapeHtml(label)}</div>
    <div class="acc-division-teams">${rowsHtml}</div>
  </div>`;
}

function renderTeamPanels(container, byTeam, expandedCode) {
  if (!container) return;
  const divisionsHtml = ACC_DIVISIONS.map((div) => accPanelHtml(div.label, div.teams, byTeam, expandedCode, byTeamEntryForCode)).join("");
  const otherCodes = accOtherTeamCodes(byTeam);
  const otherHtml = otherCodes.length
    ? accPanelHtml("Other", otherCodes, byTeam, expandedCode, (code, bt) => bt[code] ?? null)
    : "";
  container.innerHTML = divisionsHtml + otherHtml;
}

/* by_team is the other new (currently absent from the deployed record.json)
   optional key — degrades to an empty panels container + stale-note until
   the pipeline redeploys with it. */
function renderTeamSection(panelsEl, staleEl, byTeam, expandedCode) {
  const hasData = !!byTeam && typeof byTeam === "object" && Object.keys(byTeam).length > 0;
  if (!hasData) {
    if (panelsEl) panelsEl.innerHTML = "";
    if (staleEl) staleEl.hidden = false;
    return;
  }
  if (staleEl) staleEl.hidden = true;
  renderTeamPanels(panelsEl, byTeam, expandedCode);
}

let _accuracyExpandedTeam = null;
let _accuracyExpandedTeamLoaded = false;

function loadStoredExpandedTeam() {
  if (_accuracyExpandedTeamLoaded) return;
  _accuracyExpandedTeamLoaded = true;
  try {
    const stored = localStorage.getItem(ACCURACY_TEAM_STORAGE_KEY);
    if (stored) _accuracyExpandedTeam = stored;
  } catch { /* ignore */ }
}

/* Wired once (guarded by dataset.wired) — subsequent auto-refreshes only
   re-render panel contents, never re-attach the listener. getByTeam is a
   thunk so the handler always reads the latest fetched record, not a stale
   closure over the record.json snapshot at wiring time. Delegated on the
   panels container since rows are fully rebuilt on every render/refresh. */
function wireTeamPanels(panelsEl, getByTeam) {
  if (!panelsEl || panelsEl.dataset.wired) return;
  panelsEl.dataset.wired = "1";
  panelsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".acc-team-row");
    if (!btn || !panelsEl.contains(btn)) return;
    const code = btn.dataset.teamCode;
    if (!code) return;
    _accuracyExpandedTeam = _accuracyExpandedTeam === code ? null : code;
    try {
      if (_accuracyExpandedTeam) localStorage.setItem(ACCURACY_TEAM_STORAGE_KEY, _accuracyExpandedTeam);
      else localStorage.removeItem(ACCURACY_TEAM_STORAGE_KEY);
    } catch { /* ignore */ }
    renderTeamPanels(panelsEl, getByTeam() || {}, _accuracyExpandedTeam);
    document.getElementById(`acc-team-row-${accTeamIdSafe(code)}`)?.focus();
  });
}

let _accuracyRenderToken = 0;
let _accuracyByTeamCache = null;

async function renderAccuracyPage() {
  const myToken = ++_accuracyRenderToken;
  const isCurrent = () => myToken === _accuracyRenderToken;

  const panelEl = document.getElementById("acc-history-panel");
  const loglossEl = document.getElementById("acc-logloss-stats");
  const homeBaselineEl = document.getElementById("acc-home-baseline");
  const confidenceEl = document.getElementById("acc-confidence-rows");
  const teamPanelsEl = document.getElementById("acc-team-panels");
  const teamStaleEl = document.getElementById("acc-team-stale");
  loadStoredExpandedTeam();

  try {
    const rec = await fetchJSON(`${REPO_ROOT}/data/record.json`);
    if (!isCurrent()) return;
    setStat("acc-stat-acc", isFiniteNum(rec.overall?.accuracy) ? (rec.overall.accuracy * 100).toFixed(1) + "%" : "—");
    setStat("acc-stat-30d", isFiniteNum(rec.last_30d?.accuracy) ? (rec.last_30d.accuracy * 100).toFixed(1) + "%" : "—");
    setStat("acc-stat-n", rec.overall?.n_graded ?? "—");
    setStat("acc-stat-ll", isFiniteNum(rec.overall?.log_loss) ? rec.overall.log_loss.toFixed(4) : "—");

    renderLogLossStats(loglossEl, rec);
    renderConfidenceSection(confidenceEl, rec.by_confidence);
    renderHomeBaselineSection(homeBaselineEl, rec.home_baseline);

    _accuracyByTeamCache = rec.by_team && typeof rec.by_team === "object" ? rec.by_team : null;
    renderTeamSection(teamPanelsEl, teamStaleEl, _accuracyByTeamCache, _accuracyExpandedTeam);
    wireTeamPanels(teamPanelsEl, () => _accuracyByTeamCache);
  } catch {
    if (!isCurrent()) return;
    ["acc-stat-acc", "acc-stat-30d", "acc-stat-n", "acc-stat-ll"].forEach((id) => setStat(id, "—"));
    renderLogLossStats(loglossEl, null);
    renderConfidenceSection(confidenceEl, null);
    renderHomeBaselineSection(homeBaselineEl, null);
    _accuracyByTeamCache = null;
    renderTeamSection(teamPanelsEl, teamStaleEl, null, _accuracyExpandedTeam);
  }

  const indexData = await fetchDateIndex();
  if (!isCurrent()) return;
  renderAccuracyPanel(panelEl, indexData);
}

/* The panels re-render replaces #acc-team-panels' innerHTML wholesale, which
   drops keyboard focus to <body> if a user is mid-navigation there when the
   12-minute/visibility-return refresh fires. Capture the focused row's id
   beforehand and re-focus the equivalent element after — a no-op when focus
   is elsewhere, and safe if the team disappeared from the rebuilt payload
   (getElementById returns null; optional chaining + try/catch swallow it). */
function refreshAccuracyPage() {
  if (isTypingTarget(document.activeElement)) return;
  _dateIndexCache = undefined;
  const teamPanelsEl = document.getElementById("acc-team-panels");
  const active = document.activeElement;
  const focusedId = teamPanelsEl && active && teamPanelsEl.contains(active) ? active.id : null;
  const result = renderAccuracyPage();
  if (focusedId && result && typeof result.then === "function") {
    result.then(() => {
      try { document.getElementById(focusedId)?.focus(); } catch { /* ignore */ }
    });
  }
}

/* ---------- auto-refresh ----------
   GitHub Pages' CDN serves data/*.json with ~10-min max-age; cache:"no-store"
   bypasses the browser cache but not the CDN, so freshness is push time
   + <=10 min. Accepted latency — deliberately NO cache-buster query params
   (unique params would make every request a CDN miss). */
const REFRESH_INTERVAL_MS = 12 * 60 * 1000;
const REFRESH_AFTER_HIDDEN_MS = 5 * 60 * 1000;

document.addEventListener("DOMContentLoaded", () => {
  updateNavHeightVar();
  window.addEventListener?.("resize", updateNavHeightVar);
  const legendJumpLink = document.querySelector("#legend-jump a");
  const legendEl = document.getElementById("chip-legend");
  if (legendJumpLink && legendEl) {
    legendJumpLink.addEventListener("click", () => { legendEl.open = true; });
  }
  if (document.getElementById("game-header")) {
    renderGameDetail();
    setInterval(() => { if (!document.hidden) refreshGameResult(); }, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { _hiddenAt = Date.now(); return; }
      if (_hiddenAt && Date.now() - _hiddenAt >= REFRESH_AFTER_HIDDEN_MS) refreshGameResult();
      _hiddenAt = 0;
    });
  } else if (document.getElementById("games")) {
    renderDashboard();
    window.addEventListener("popstate", renderDashboard);
    document.addEventListener("keydown", handleDashboardKeydown);
    setInterval(() => { if (!document.hidden) refreshDashboard(); }, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { _hiddenAt = Date.now(); return; }
      if (_hiddenAt && Date.now() - _hiddenAt >= REFRESH_AFTER_HIDDEN_MS) refreshDashboard();
      _hiddenAt = 0;
    });
  } else if (document.getElementById("accuracy-page")) {
    renderAccuracyPage();
    setInterval(() => { if (!document.hidden) refreshAccuracyPage(); }, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { _hiddenAt = Date.now(); return; }
      if (_hiddenAt && Date.now() - _hiddenAt >= REFRESH_AFTER_HIDDEN_MS) refreshAccuracyPage();
      _hiddenAt = 0;
    });
  }
});
