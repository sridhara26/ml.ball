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

function seedStdHtml(g) {
  const s = g.seed_std;
  if (typeof s !== "number" || !Number.isFinite(s)) return "";
  return `<span class="seed-std" title="ensemble seed spread (10 models)">± ${(s * 100).toFixed(1)}%</span>`;
}

function seedStdLegendHtml(g) {
  const s = g.seed_std;
  if (typeof s !== "number" || !Number.isFinite(s)) return "";
  return `<p class="stale-note prob-legend">± is the spread across the 10-model ensemble — larger means the models disagree more.</p>`;
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

function teamColor(code) {
  const meta = TEAM_META[code] ?? TEAM_META[TEAM_ALIASES[code]];
  return meta ? meta.color : "var(--violet)";
}

function teamTagHtml(code) {
  return `<span class="team-tag" style="--team-color:${teamColor(code)}">${escapeHtml(code)}</span>`;
}

const LINEUP_LABELS = {
  announced: { cls: "good", text: "announced" },
  projected_last_game: { cls: "", text: "projected" },
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
  const worstCls = [home, away].some((s) => LINEUP_LABELS[s]?.cls === "warn") ? "warn" : "";
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
    return '<span class="flag">no result</span>';
  }
  if (typeof result.home_won === "boolean") {
    const won = result.home_won === (pHome >= 0.5);
    return `<span class="flag ${won ? "result-win" : "result-loss"}">${won ? "✓ correct" : "✗ missed"} — final ${result.away_score ?? ""}${result.away_score != null ? "–" : ""}${result.home_score ?? ""}</span>`;
  }
  const hasScores = result.home_score != null && result.away_score != null;
  return `<span class="flag">final (tie)${hasScores ? ` — ${result.away_score}–${result.home_score}` : ""}</span>`;
}

function probBarHtml(awayCode, homeCode, pAway, pHome) {
  const a = escapeHtml(awayCode);
  const h = escapeHtml(homeCode);
  return `<div class="prob-bar" role="img" aria-label="${a} ${pct(pAway)} — ${h} ${pct(pHome)}">
      <div class="away-fill" style="width:${pAway * 100}%"></div>
      <div class="home-fill" style="width:${pHome * 100}%"></div>
    </div>`;
}

/* ---------- predictions dashboard (index.html) ---------- */

function gameCard(g) {
  const pHome = g.prob_home_win;
  const pAway = 1 - pHome;
  const homeFav = pHome >= 0.5;

  const flags = [];
  const rf = resultFlagHtml(g.result, pHome);
  if (rf) flags.push(rf);
  flags.push(...lineupFlags(g));
  flags.push(...spFlags(g));
  if (g.low_confidence) flags.push('<span class="flag warn">low confidence</span>');
  if (g.dh_game_number > 0) flags.push(`<span class="flag">DH game ${g.dh_game_number}</span>`);

  const awayCode = escapeHtml(g.away);
  const homeCode = escapeHtml(g.home);
  const awaySp = escapeHtml(g.away_sp ?? "TBD");
  const homeSp = escapeHtml(g.home_sp ?? "TBD");

  return `
  <div class="game-card">
    <div class="matchup">
      <div class="team away">
        <span class="code" style="--team-color:${teamColor(g.away)}">${awayCode}</span>
        <span class="pct ${homeFav ? "dog" : "fav"}">${pct(pAway)}</span>
        <span class="sp" title="${awaySp}">${awaySp}</span>
      </div>
      <span class="at">@</span>
      <div class="team home">
        <span class="code" style="--team-color:${teamColor(g.home)}">${homeCode}</span>
        <span class="pct ${homeFav ? "fav" : "dog"}">${pct(pHome)}${seedStdHtml(g)}</span>
        <span class="sp" title="${homeSp}">${homeSp}</span>
      </div>
    </div>
    ${probBarHtml(g.away, g.home, pAway, pHome)}
    <div class="flags">${flags.join("")}</div>
  </div>`;
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
  // would otherwise let the picker/`›` arrow step backwards into a past date
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
   strictly before / strictly after `pickedDate` — shared by the date-picker
   snap-back (snapToPublishedDate) and by the prev/next arrows when
   `targetDate` itself isn't published (setupDateNav). Returns null for a
   direction with nothing published. */
function nearestPublishedNeighbors(dates, pickedDate) {
  let earlier = null, later = null;
  for (const d of dates) {
    if (d < pickedDate) earlier = d;
    else if (d > pickedDate) { later = d; break; }
  }
  return { earlier, later };
}

function snapToPublishedDate(indexData, pickedDate) {
  const dates = sortedDateEntries(indexData).map((d) => d.date);
  if (dates.length === 0) return pickedDate;
  // load-bearing: nearestPublishedNeighbors only scans for strictly-before /
  // strictly-after dates, so an exact match must be handled here first — if
  // this early return were removed, an exact pick would silently snap back
  // to the previous published day instead of landing on itself.
  if (dates.includes(pickedDate)) return pickedDate;
  const { earlier } = nearestPublishedNeighbors(dates, pickedDate);
  return earlier ?? dates[0];
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

function setupDateNav({ navEl, prevBtn, nextBtn, pickerEl, backEl, recordEl, indexData, targetDate, latestDate, isLatest, suppressRecord = false, previewInfo = null }) {
  if (!navEl) return;
  const dates = indexData ? sortedDateEntries(indexData) : [];
  if (dates.length === 0) {
    if (prevBtn) prevBtn.style.display = "none";
    if (nextBtn) nextBtn.style.display = "none";
    if (pickerEl) pickerEl.style.display = "none";
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
  if (pickerEl) {
    pickerEl.style.display = "";
    pickerEl.min = dates[0].date;
    pickerEl.max = previewInfo ? previewInfo.date : dates[dates.length - 1].date;
    pickerEl.setAttribute("aria-label", previewInfo ? "Jump to a published date or the next preview" : "Jump to a published date");
    pickerEl.value = targetDate;
    pickerEl.onchange = () => {
      if (!pickerEl.value) {
        pickerEl.value = targetDate; // clearing the picker should no-op, not jump to the oldest slate
        return;
      }
      if (previewInfo && pickerEl.value === previewInfo.date) {
        navigateToDate(previewInfo.date, latestDate);
        return;
      }
      const snapped = snapToPublishedDate(indexData, pickerEl.value);
      navigateToDate(snapped, latestDate);
    };
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
  _lastGamesHtml = null;
}

/* `implicit` distinguishes "we were trying to load the latest/today slate and
   it isn't there yet" (targetDate === latestDate, however we got there — the
   home page, or an explicit ?date=<latestDate> — since either way "back to
   the latest slate" would just point at this same date) from "you asked for
   a specific date that was never published". `hasOtherDates` gates the
   "browse a previous day above" clause: with a single-date index, the arrows
   and picker have nothing else to navigate to, so that clause would promise
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
  // renderDashboard is re-entrant (arrow presses, popstate, the date picker
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
  const pickerEl = document.getElementById("date-picker");
  const backEl = document.getElementById("back-today");
  const recordEl = document.getElementById("day-record");
  const statusEl = document.getElementById("slate-status");
  if (!gamesEl) return;

  const header = { headingEl, dateEl, recordEl, statusEl };
  const navRefs = { navEl, prevBtn, nextBtn, pickerEl, backEl, recordEl };

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
    // history known (an index exists) means the arrows/picker are live and an
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

  let detailsAvailable = false;
  try {
    const res = await fetch(`${REPO_ROOT}/data/details/${targetDate}.json`, { method: "HEAD", cache: "no-store" });
    if (!isCurrent()) return;
    detailsAvailable = res.ok;
  } catch {
    if (!isCurrent()) return;
    detailsAvailable = false;
  }

  const isLatest = targetDate === latestDate;
  _autoRefreshEligible = isLatest || !entryFullyGraded(indexData, targetDate);
  if (headingEl) headingEl.textContent = "Win probabilities";
  document.title = isLatest ? DASHBOARD_DEFAULT_TITLE : `${fmtTitleDate(targetDate)} — ml.ball`;
  if (dateEl) dateEl.textContent = fmtDate(day.date);
  document.getElementById("slate-note")?.style.setProperty("display", "");

  try {
    setupDateNav({ navEl, prevBtn, nextBtn, pickerEl, backEl, recordEl, indexData, targetDate, latestDate, isLatest, previewInfo });
  } catch {
    /* defensive: nav cluster must never block the slate itself from rendering */
  }

  if (!day.games || day.games.length === 0) {
    gamesEl.innerHTML = `<div class="empty-state"><div class="box">No games on the slate for ${fmtDate(day.date)}.</div></div>`;
    _lastGamesHtml = null;
    if (statusEl) statusEl.textContent = `No games for ${fmtShortDate(day.date)}`;
    return;
  }
  const cardsHtml = day.games.map((g) => {
    const card = gameCard(g);
    if (!detailsAvailable) return card;
    const key = `${g.away}-${g.home}-${g.dh_game_number ?? 0}`;
    const href = `game.html?date=${encodeURIComponent(day.date)}&g=${encodeURIComponent(key)}`;
    return `<a class="game-card-link" href="${href}">${card}</a>`;
  }).join("");
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
   with the date picker (isTypingTarget) or the current view has nothing
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

async function refreshRecordStrip(isCurrent) {
  try {
    const rec = await fetchJSON(`${REPO_ROOT}/data/record.json`);
    if (!isCurrent()) return;
    setStat("stat-acc", rec.overall?.accuracy != null ? (rec.overall.accuracy * 100).toFixed(1) + "%" : "—");
    setStat("stat-ll", rec.overall?.log_loss != null ? rec.overall.log_loss.toFixed(4) : "—");
    setStat("stat-n", rec.overall?.n_graded ?? "—");
    setStat("stat-30d", rec.last_30d?.accuracy != null ? (rec.last_30d.accuracy * 100).toFixed(1) + "%" : "—");
  } catch {
    if (!isCurrent()) return;
    ["stat-acc", "stat-ll", "stat-n", "stat-30d"].forEach((id) => setStat(id, "—"));
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

  return `
  <div class="game-card preview-card">
    <div class="matchup">
      <div class="team away">
        <span class="code" style="--team-color:${teamColor(g.away)}">${awayCode}</span>
      </div>
      <span class="at">@</span>
      <div class="team home">
        <span class="code" style="--team-color:${teamColor(g.home)}">${homeCode}</span>
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
          <span class="pct ${homeFav ? "fav" : "dog"}">${pct(pHome)}${seedStdHtml(matchGame)}</span>
        </div>
      </div>
      ${probBarHtml(away, home, pAway, pHome)}
      ${seedStdLegendHtml(matchGame)}`;

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

function lineupRowSeasonLineHtml(seasonYear, st, rates) {
  if (!st) return "";
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
  return `${year} season: ${g} G, ${pa} PA — ${h}/${ab}, ${hr} HR, ${bb} BB, ${so} SO${rateSuffix}`;
}

function lineupRowCareerLineHtml(car) {
  if (!car) return "";
  const avg = car.avg != null ? fmtRate(car.avg) : "—";
  const obp = car.obp != null ? fmtRate(car.obp) : "—";
  const slg = car.slg != null ? fmtRate(car.slg) : "—";
  const h = fmtOrDash(car.h, fmt0);
  const ab = fmtOrDash(car.ab, fmt0);
  const hr = fmtOrDash(car.hr, fmt0);
  const pa = fmtOrDash(car.pa, fmt0);
  return `Career: ${avg}/${obp}/${slg} — ${h}/${ab}, ${hr} HR (${pa} PA)`;
}

function lineupRowVsSpLineHtml(vsSp, oppSpName) {
  if (!vsSp) return "";
  const name = oppSpName ? escapeHtml(oppSpName) : "TBD";
  const h = fmtOrDash(vsSp.h, fmt0);
  const ab = fmtOrDash(vsSp.ab, fmt0);
  const hr = fmtOrDash(vsSp.hr, fmt0);
  const bb = fmtOrDash(vsSp.bb, fmt0);
  const so = fmtOrDash(vsSp.so, fmt0);
  const avg = vsSp.avg != null ? fmtRate(vsSp.avg) : "—";
  return `vs ${name}: ${h}/${ab}, ${hr} HR, ${bb} BB, ${so} SO (AVG ${avg})`;
}

function lineupRowDetailHtml(row, seasonYear, oppSpName) {
  const lines = [
    lineupRowSeasonLineHtml(seasonYear, row.season_totals, row),
    lineupRowCareerLineHtml(row.career),
    lineupRowVsSpLineHtml(row.vs_sp, oppSpName),
  ].filter(Boolean);
  if (lines.length === 0) return "";
  const linesHtml = lines.map((l) => `<p class="row-detail-line">${l}</p>`).join("");
  return `<div class="row-detail-wrap">${linesHtml}</div>`;
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
  return `<h2>Lineups</h2>
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

  let barHtml = `<div class="compare-bar-spacer"></div>`;
  if (awayNum && homeNum) {
    const max = Math.max(Math.abs(awayVal), Math.abs(homeVal)) || 1;
    const awayW = (Math.abs(awayVal) / max) * 100;
    const homeW = (Math.abs(homeVal) / max) * 100;
    barHtml = `<div class="compare-bar">
      <div class="bar-half away"><div class="bar-fill${awayBetter ? " better" : ""}" style="width:${awayW}%"></div></div>
      <div class="bar-half home"><div class="bar-fill${homeBetter ? " better" : ""}" style="width:${homeW}%"></div></div>
    </div>`;
  }

  return `<div class="compare-row">
    <div class="compare-label">${escapeHtml(label)}</div>
    <div class="compare-val away${awayBetter ? " better" : ""}">${awayDisplay}</div>
    ${barHtml}
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
  ["games_behind", "Games behind", { fmt: fmt1, lowerIsBetter: true }],
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
  const body = groups
    .filter(([, , obj]) => obj)
    .map(([title, rowsCfg, obj]) => `<div class="compare-group"><h3>${title} — <span class="side away" style="--team-color:${teamColor(awayCode)}">${away}</span> | <span class="side home" style="--team-color:${teamColor(homeCode)}">${home}</span></h3>${statRows(rowsCfg, obj)}</div>`)
    .join("");
  return `<h2>Team stats</h2>${body || '<p class="stale-note">Team stats unavailable.</p>'}`;
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
  }
});
