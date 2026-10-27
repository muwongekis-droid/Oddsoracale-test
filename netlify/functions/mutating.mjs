// OddsOracle TEST helper: given the home/away names from a betPawa odds paste,
// finds the match on mutating.com and returns the Last 5 / Last 15 text in the
// SAME layout Oracle's parsers already read from a manual page paste.
// Called as: /.netlify/functions/mutating?home=Como%201907&away=Sassuolo%20Calcio
// Add &debug=1 to also get raw diagnostics (share these if something fails).

const BASE = "https://www.mutating.com";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// ---------- small helpers ----------
async function fetchT(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
const strip = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- team-name matching (betPawa name <-> mutating name) ----------
const STOP = new Set([
  "fc", "cf", "sc", "ac", "as", "afc", "sk", "fk", "kv", "ud", "cd", "sd", "rc", "ss", "us", "nk", "ue", "tc", "kf", "gd", "cs", "ca",
  "the", "de", "la", "el", "club", "calcio", "cp", "fsv", "tsv", "vfb", "vfl", "sv", "bk", "if", "ik",
]);
const GENERIC = new Set(["city", "united", "town", "rovers", "athletic", "real", "sporting", "dynamo", "dinamo", "juniors", "academy", "county", "wanderers", "albion", "rangers", "olympic", "olympique", "sparta", "central", "north", "south", "east", "west", "saint", "santa", "deportivo", "deportes", "atletico", "racing", "inter", "internacional", "sport", "stadium", "utd"]);
const ALIAS = { wolves: "wolverhampton", spurs: "tottenham", utd: "united", man: "manchester", psg: "paris", gladbach: "monchengladbach", st: "saint", cologne: "koln", praha: "prague", prag: "prague", brondby: "broendby", munchen: "munich", koeln: "koln" };
const MARK = /^(women|w|u\d{2}|ii|iii|b|res|reserves|youth)$/;
function parts(name) {
  const raw = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean).map((t) => ALIAS[t] || t);
  const marks = raw.filter((t) => MARK.test(t)).sort().join(",");
  const core = raw.filter((t) => !MARK.test(t) && t.length > 1 && !STOP.has(t) && !/^\d{4}$/.test(t));
  return { marks, core };
}
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// spelling variants (Qadsiah / Qadisiyah): allow 1 typo on 5-6 letter words, 2 on 7+ letters
const near = (a, b) => { const m = Math.min(a.length, b.length); return m >= 5 && lev(a, b) <= (m >= 7 ? 2 : 1); };
const tokMatch = (a, b) => a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) || near(a, b);
const wt = (t) => (GENERIC.has(t) ? 0.35 : 1);
// 1 = same team, 0 = different. A short name that sits inside a longer one still scores high ("Rudes" in "NK Rudes Zagreb").
function nameScore(a, b) {
  const A = parts(a), B = parts(b);
  // acronym ("UCD" = University College Dublin)
  const acr = (x, y) => x.core.length === 1 && /^[a-z]{2,4}$/.test(x.core[0]) && y.core.length >= 2 && y.core.map((t) => t[0]).join("") === x.core[0];
  if (A.marks === B.marks && (acr(A, B) || acr(B, A))) return 0.9;
  if (!A.core.length || !B.core.length || A.marks !== B.marks) return 0;
  const sum = (arr) => arr.reduce((s, t) => s + wt(t), 0);
  const matched = A.core.filter((x) => B.core.some((y) => tokMatch(x, y))).reduce((s, t) => s + wt(t), 0);
  if (!matched) return 0;
  const ta = sum(A.core), tb = sum(B.core);
  if (matched < 1 && (matched < ta - 0.001 || matched < tb - 0.001)) return 0; // only a generic word in common (Inter vs Inter Miami)
  const overlap = matched / Math.min(ta, tb), jacc = matched / (ta + tb - matched);
  return 0.8 * overlap + 0.2 * jacc;
}

// ---------- find the match page from the day lists ----------
function extractMatches(html) {
  const out = [];
  const seen = new Set();
  const re = /href=["']((?:https?:)?\/\/(?:www\.)?mutating\.com\/football-stats\/match-preview-[^"']+|\/football-stats\/match-preview-[^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let u = m[1];
    if (u.startsWith("//")) u = "https:" + u;
    else if (u.startsWith("/")) u = BASE + u;
    u = u.replace("://mutating.com", "://www.mutating.com");
    if (seen.has(u)) continue;
    seen.add(u);
    const s = u.match(/match-preview-(.+?)-stats-h2h-preview-and-prediction-([a-z0-9]+)\/?$/i);
    if (!s) continue;
    const parts = s[1].split("-vs-");
    if (parts.length !== 2) continue;
    out.push({ url: u, home: parts[0].replace(/-/g, " "), away: parts[1].replace(/-/g, " ") });
  }
  return out;
}
async function findMatch(home, away, diag) {
  const days = ["/football-stats/tomorrow/", "/football-stats/", "/football-stats/after-tomorrow/", "/football-stats/yesterday/"];
  const pages = await Promise.all(
    days.map(async (d) => {
      try {
        const r = await fetchT(BASE + d, { headers: { "user-agent": UA, accept: "text/html" } });
        const html = await r.text();
        const list = extractMatches(html);
        diag.dayPages.push({ day: d, status: r.status, bytes: html.length, matchLinks: list.length });
        return list;
      } catch (e) {
        diag.dayPages.push({ day: d, error: String(e && e.message || e) });
        return [];
      }
    })
  );
  const all = pages.flat();
  const scored = all
    .map((c) => ({ ...c, sh: nameScore(home, c.home), sa: nameScore(away, c.away) }))
    .map((c) => ({ ...c, total: c.sh + c.sa }))
    .sort((a, b) => b.total - a.total);
  const best = scored[0];
  diag.candidates = scored.slice(0, 3).filter((c) => c.total >= 0.5).map((c) => ({ url: c.url, sh: +c.sh.toFixed(2), sa: +c.sa.toFixed(2) }));
  if (!best || best.sh < 0.75 || best.sa < 0.75) {
    // closest-match fallback: both teams partly agree, nothing else comes close
    if (best && best.sh >= 0.4 && best.sa >= 0.4 && best.total >= 0.9) {
      const sec = scored[1];
      if (!(sec && sec.url !== best.url && sec.total >= best.total - 0.15)) { diag.fuzzy = true; return best; }
      diag.ambiguous = true;
    }
    return null;
  }
  const second = scored[1];
  if (second && second.total >= best.total - 0.15 && second.url !== best.url) {
    diag.ambiguous = true;
    return null;
  }
  return best;
}

// ---------- stat table definition (labels exactly as the site prints them) ----------
const SECTIONS = [
  ["Main Stats", [["goals_score", "Goals scored per game", 1], ["goals_conceded", "Goals conceded per game", 1], ["clean_sheet", "Clean sheets"], ["team_scored", "Team scored"], ["team_twice_scored", "Team scored twice"], ["both_scored", "Scored in both halves"], ["both_conceded", "Goal in both halves"]]],
  ["Win Draw Lose", [["win", "Win"], ["draw", "Draw"], ["lose", "Lose"], ["win_over", "Win and Over 1.5 goals"], ["lose_over", "Lose and Over 1.5 goals"], ["half_win", "Team win first half"], ["half_draw", "Team draw at half time"], ["half_lose", "Team lost first half"]]],
  ["Both Teams to Score", [["bts", "Both Teams to Score"], ["first_bts", "BTTS in first-half"], ["second_bts", "BBTS in second-half"], ["bts_over15", "BBTS and Over 1.5"], ["bts_over25", "BBTS and Over 2.5"], ["win_bts", "Win and BTTS"], ["draw_bts", "Draw and BTTS"], ["lose_bts", "Lose and BTTS"]]],
  ["Match Total Goals", [["match0", "Match total goals 0"], ["match1", "Match total goals 1"], ["match2", "Match total goals 2"], ["match3", "Match total goals 3"], ["match4", "Match total goals 4"], ["match01", "Match total goals 0 or 1"], ["match23", "Match total goals 2 or 3"], ["match4_more", "Match total goals 4+"]]],
  ["Over Under Goals", [["over15", "Over 1.5 goals"], ["over25", "Over 2.5 goals"], ["over35", "Over 3.5 goals"], ["under15", "Under 1.5 goals"], ["under25", "Under 2.5 goals"], ["under35", "Under 3.5 goals"], ["half_over15", "Over 0.5 goals at half-time"], ["half_over25", "Over 1.5 goals at half-time"], ["half_over35", "Over 2.5 goals at half-time"]]],
  ["Half Time-Full Time", [["win_hf", "Win HT - Win FT"], ["win_ht_draw_ft", "Win HT - Draw FT"], ["win_ht_lost_ft", "Win HT - Lose FT"], ["draw_ht_win_ft", "Draw HT - Win FT"], ["draw_ht_draw_ft", "Draw HT - Draw FT"], ["draw_ht_lost_ft", "Draw HT - Lose FT"], ["lost_ht_win_ft", "Lose HT - Win FT"], ["lost_ht_draw_ft", "Lose HT - Draw FT"], ["lost_ht_lost_ft", "Lose HT - Lose FT"]]],
];

// ---------- parse the match page ----------
function cell(html, id) {
  const m = html.match(new RegExp("id=[\"']" + esc(id) + "[\"'][^>]*>\\s*([^<]*?)\\s*<", "i"));
  return m ? m[1].trim() : null;
}
function parseMatchPage(html) {
  const sid = html.match(/static_id\s*:\s*["']?(\d+)["']?/);
  const names = [...html.matchAll(/<strong class="mx-auto lessstrong">([^<]+)<\/strong>/g)].map((x) => strip(x[1]));
  const home = names[0] || null, away = names[1] || null;

  // default (Last 10) table straight from the HTML
  const defaults = {};
  for (const [, rows] of SECTIONS)
    for (const [k] of rows) {
      const h = cell(html, "home_" + k), a = cell(html, "away_" + k);
      if (h != null && a != null) defaults[k] = [h, a];
    }

  // trends
  const trends = {};
  const tre = /<h2[^>]*>\s*([^<]*?)\s+Trends\s*<\/h2>([\s\S]*?)(?=<h2|<section|$)/gi;
  let tm;
  while ((tm = tre.exec(html))) {
    const lines = [...tm[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => strip(x[1])).filter(Boolean);
    trends[strip(tm[1])] = lines;
  }

  // last matches (always the last 10 per team, independent of the filter)
  const last = {};
  const lre = /<h2[^>]*class=["']h2divider["'][^>]*>\s*Last Matches ([^<]+?)\s*<\/h2>([\s\S]*?)(?=<h2[^>]*class=["']h2divider["']|$)/gi;
  let lm;
  while ((lm = lre.exec(html))) {
    const team = strip(lm[1]);
    const rows = [];
    for (const piece of lm[2].split(/<a href=/i).slice(1)) {
      const d = piece.match(/<span class=['"]flex['"]>([^<]*)<\/span>\s*<span>([^<]*)<\/span>/i);
      const alts = [...piece.matchAll(/alt=['"]([^'"]*)['"]/g)].map((x) => strip(x[1]));
      const sc = [...piece.matchAll(/class=['"]scorem['"]>\s*(\d+)/g)].map((x) => x[1]);
      if (d && alts.length >= 2 && sc.length >= 2) rows.push({ date: strip(d[1]), time: strip(d[2]), a: alts[0], as: sc[0], b: alts[1], bs: sc[1] });
    }
    last[team] = rows;
  }

  // standings
  const standings = [];
  const sre = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let sm;
  while ((sm = sre.exec(html))) {
    const row = sm[1];
    if (!/linestands/.test(row)) continue;
    const rank = row.match(/class="linestands"[^>]*>\s*<span>(\d+)<\/span>/);
    const name = row.match(/trunkname[^>]*>([^<]+)</);
    const nums = [...row.matchAll(/<td class="linestands">\s*(\d+)\s*<\/td>/g)].map((x) => x[1]);
    const goals = row.match(/<td class="linestands">\s*(\d+:\d+)\s*<\/td>/);
    const pts = row.match(/<td class="font-semibold linestands">\s*(\d+)\s*<\/td>/);
    if (rank && name && goals && pts && nums.length >= 4)
      standings.push({ rank: +rank[1], name: strip(name[1]), P: nums[0], W: nums[1], D: nums[2], L: nums[3], goals: goals[1], pts: +pts[1] });
  }
  const lg = html.match(/Standings\s+([^<]+)<\/h2>/i);

  return { staticId: sid ? sid[1] : null, home, away, defaults, trends, last, standings, league: lg ? strip(lg[1]) : "" };
}

// ---------- the 5 / 15 window request the site's own filter makes ----------
function findStats(obj) {
  if (!obj || typeof obj !== "object") return null;
  if ("home_goals_score" in obj || "away_goals_score" in obj) return obj;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const r = findStats(v);
      if (r) return r;
    }
  }
  return null;
}
async function postWindow(matchUrl, staticId, n) {
  const body = new URLSearchParams({ static_id: staticId, game_count: String(n), home_style: "home", away_style: "away" }).toString();
  const r = await fetchT(BASE + "/check-game-stats-new/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      accept: "*/*",
      referer: matchUrl,
      origin: BASE,
      "user-agent": UA,
    },
    body,
  });
  const raw = await r.text();
  let data = null;
  try { data = JSON.parse(raw); } catch {}
  if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }
  const stats = findStats(data);
  return { status: r.status, raw: raw.slice(0, 600), stats };
}

// ---------- compose text in the layout Oracle already reads ----------
const fmt = (v, goal) => {
  const n = parseFloat(String(v).replace("%", ""));
  if (isNaN(n)) return String(v);
  return goal ? n.toFixed(2) : n.toFixed(2) + "%";
};
function composeText(info, n, valuesByKey, venue) {
  const { home, away } = info;
  const L = [];
  L.push("Football Stats", "Football Stats", `${home} v ${away} Stats`);

  // Real standings first (so Oracle reads the two actual teams, not stray numbers).
  // Points are written zero-padded ("014") on purpose: Oracle's reader still gets the
  // number, but a 3-digit line is not mistaken for a league position.
  const sh = info.standings.find((r) => nameScore(r.name, home) >= 0.99) || info.standings.find((r) => nameScore(r.name, home) >= 0.6);
  const sa = info.standings.find((r) => nameScore(r.name, away) >= 0.99) || info.standings.find((r) => nameScore(r.name, away) >= 0.6);
  if (sh && sa && sh.rank <= 30 && sa.rank <= 30 && sh !== sa) {
    L.push("Standings " + (info.league || ""));
    for (const r of [sh, sa]) {
      L.push(String(r.rank), r.name, r.name, [r.P, r.W, r.D, r.L, r.goals].join("\t"), String(r.pts).padStart(3, "0"));
    }
  }

  const hv = venue ? venue.home : "home", av = venue ? venue.away : "away";
  for (const [title, rows] of SECTIONS) {
    L.push(title, home, `Last ${n} games ${hv}`, away, `Last ${n} games ${av}`);
    for (const [k, label, goal] of rows) {
      const v = valuesByKey[k];
      if (!v) continue;
      L.push(`${fmt(v[0], goal)}\t${label}\t${fmt(v[1], goal)}`);
    }
  }
  for (const team of [home, away]) {
    const t = info.trends[team];
    if (t && t.length) L.push(`${team} Trends`, ...t);
  }
  for (const team of Object.keys(info.last)) {
    L.push(`Last Matches ${team}`);
    for (const m of info.last[team]) L.push(m.date, m.time, m.a, m.a, m.as, m.b, m.b, m.bs);
  }
  return L.join("\n");
}
function valuesFromStats(stats) {
  const out = {};
  for (const [, rows] of SECTIONS)
    for (const [k] of rows) {
      const h = stats["home_" + k], a = stats["away_" + k];
      if (h != null && a != null) out[k] = [h, a];
    }
  return out;
}

// ---------- handler ----------
export default async (req) => {
  const u = new URL(req.url);
  const home = (u.searchParams.get("home") || "").trim();
  const away = (u.searchParams.get("away") || "").trim();
  const debug = u.searchParams.get("debug") === "1";
  if (!home || !away) return json({ ok: false, reason: "missing_names" }, 400);

  const diag = { dayPages: [], candidates: [] };
  try {
    const found = await findMatch(home, away, diag);
    if (!found) return json({ ok: false, reason: diag.ambiguous ? "ambiguous" : "match_not_found", diag });

    const pr = await fetchT(found.url, { headers: { "user-agent": UA, accept: "text/html" } });
    const html = await pr.text();
    diag.matchPage = { url: found.url, status: pr.status, bytes: html.length };
    const info = parseMatchPage(html);
    if (!info.home || !info.away) return json({ ok: false, reason: "page_unreadable", diag });
    diag.parsed = { staticId: info.staticId, lastMatches: Object.fromEntries(Object.entries(info.last).map(([k, v]) => [k, v.length])), standings: info.standings.length, defaultsKeys: Object.keys(info.defaults).length };
    if (Object.keys(info.last).length < 2) return json({ ok: false, reason: "no_last_matches", diag });

    const notes = [];
    if (diag.fuzzy) notes.push("Closest match used: " + info.home + " v " + info.away + " (names differ slightly from betPawa).");
    let w5 = null, w15 = null, approx = false;
    if (info.staticId) {
      const [a, b] = await Promise.all([postWindow(found.url, info.staticId, 5).catch((e) => ({ error: String(e && e.message || e) })), postWindow(found.url, info.staticId, 15).catch((e) => ({ error: String(e && e.message || e) }))]);
      diag.post5 = debug ? a : { status: a.status, ok: !!a.stats, error: a.error };
      diag.post15 = debug ? b : { status: b.status, ok: !!b.stats, error: b.error };
      if (a.stats) w5 = valuesFromStats(a.stats);
      if (b.stats) w15 = valuesFromStats(b.stats);
    } else notes.push("static_id not found on the page");
    if (!w5 || !w15) {
      approx = true;
      notes.push("Could not get the 5 / 15 game tables from mutating.com; both windows below are the page's default Last 10 (approximate).");
      w5 = w5 || info.defaults;
      w15 = w15 || info.defaults;
    }
    const text5 = composeText(info, approx && w5 === info.defaults ? 10 : 5, w5);
    const text15 = composeText(info, approx && w15 === info.defaults ? 10 : 15, w15);
    const text10 = composeText(info, 10, info.defaults);
    return json({ ok: true, home: info.home, away: info.away, matchUrl: found.url, approx, notes, text5, text15, text10, diag });
  } catch (e) {
    return json({ ok: false, reason: "error", message: String((e && e.message) || e), diag });
  }
};
