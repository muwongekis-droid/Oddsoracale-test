// OddsOracle betPawa fetcher (replaces the probe). Deploy as netlify/functions/betpawa.mjs
//
//   LIST a day's football matches (EAT calendar day, default = tomorrow):
//     /.netlify/functions/betpawa?list=1&day=2026-11-23
//   ONE match as a board in the SAME text layout the Analyse box already reads:
//     /.netlify/functions/betpawa?id=39407969
//     /.netlify/functions/betpawa?home=Criciuma&away=Fortaleza        (finds it by names)
//   Add &debug=1 to also get the raw layout of a few markets (send me that if something looks off).
//
// Read-only. Nothing is placed or changed on betPawa.

const BASE = "https://www.betpawa.ug";
const H = {
  "x-pawa-brand": "betpawa-uganda",
  accept: "application/json, text/plain, */*",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  referer: BASE + "/",
  origin: BASE,
};
const EAT = 3 * 3600 * 1000;
const PAGE = 50; // betPawa refuses take > ~100; 50 is safe
const MAX_PAGES = 70;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });

async function get(path, ms = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(BASE + path, { headers: H, redirect: "manual", signal: ctrl.signal });
    const text = await r.text();
    let j = null;
    try {
      j = JSON.parse(text);
    } catch {}
    return { status: r.status, json: j, text };
  } catch (e) {
    return { status: 0, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(t);
  }
}

const listPath = (skip) =>
  "/api/sportsbook/v4/events/lists/by-queries?q=" +
  encodeURIComponent(
    JSON.stringify({
      queries: [{ query: { eventType: "UPCOMING", categories: ["2"], zones: {}, hasOdds: true }, view: { marketTypes: [] }, skip, take: PAGE }],
    })
  );
const pageEvents = (r) => (r && r.json && r.json.responses && r.json.responses[0] && r.json.responses[0].responses) || [];

// ---- all upcoming football matches, cached a few minutes between calls ----
let CACHE = { t: 0, rows: [] };
async function allEvents() {
  if (Date.now() - CACHE.t < 4 * 60 * 1000 && CACHE.rows.length) return CACHE.rows;
  const rows = [];
  let skip = 0,
    done = false;
  while (!done && skip / PAGE < MAX_PAGES) {
    const batch = [];
    for (let i = 0; i < 8; i++) batch.push(get(listPath(skip + i * PAGE)));
    const res = await Promise.all(batch);
    for (const r of res) {
      const ev = pageEvents(r);
      for (const e of ev) rows.push(slim(e));
      if (ev.length < PAGE) done = true;
    }
    skip += 8 * PAGE;
  }
  const seen = new Set();
  const uniq = rows.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  uniq.sort((a, b) => a.ts - b.ts);
  CACHE = { t: Date.now(), rows: uniq };
  return uniq;
}
function slim(e) {
  const p = e.participants || [];
  const h = (p.find((x) => x.position === 1) || p[0] || {}).name || (e.name || "").split(" - ")[0];
  const a = (p.find((x) => x.position === 2) || p[1] || {}).name || (e.name || "").split(" - ")[1];
  return {
    id: String(e.id),
    home: h,
    away: a,
    start: e.startTime,
    ts: Date.parse(e.startTime),
    comp: e.competition && e.competition.name,
    region: e.region && e.region.name,
    markets: +e.totalMarketCount || 0,
  };
}

// ---- kickoff text in the collector's layout: "Kickoff: 10:45 pm Fri 20/11" (East Africa Time) ----
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function kickText(ts) {
  const d = new Date(ts + EAT);
  let h = d.getUTCHours();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  const mi = String(d.getUTCMinutes()).padStart(2, "0"),
    dd = String(d.getUTCDate()).padStart(2, "0"),
    mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  return h + ":" + mi + " " + ap + " " + DAYS[d.getUTCDay()] + " " + dd + "/" + mo;
}
const eatDay = (ts) => new Date(ts + EAT).toISOString().slice(0, 10);

// ---- build the board text ----
const SKIP_MARKET = /player|corner|booking|goalkeeper|goalscorer|scorer|sent off|assist|carded|shots|next goal|last goal|intervals|1up|2up/i;
const fix = (s, home, away) => String(s || "").replace(/\{home\}/gi, home).replace(/\{away\}/gi, away).replace(/\s+/g, " ").trim();
const num = (v) => (v == null ? "" : String(v));
function priceLabel(p, home, away) {
  let dn = p.displayName || p.name || "";
  const hc = p.formattedHandicap != null ? p.formattedHandicap : p.handicap;
  if (/\{formattedHandicap\}/.test(dn)) dn = dn.replace(/\{formattedHandicap\}/g, num(hc));
  return fix(dn, home, away).replace(/^([12X])\s*$/i, (m) => m.toUpperCase());
}
function buildBoard(ev, detail) {
  const home = ev.home,
    away = ev.away;
  const L = [home, away, "Football//", "Kickoff: " + kickText(ev.ts), "ALL"];
  const stats = { markets: 0, prices: 0 };
  for (const m of detail.markets || []) {
    const mt = m.marketType || {};
    const name = fix(mt.displayName || mt.name, home, away);
    if (!name || SKIP_MARKET.test(name)) continue;
    const lines = [];
    for (const row of m.row || []) {
      for (const p of row.prices || []) {
        if (p.suspended || !(p.odds > 1)) continue;
        let lab = priceLabel(p, home, away);
        if (/correct score/i.test(name)) lab = lab.replace(/:/g, "-").replace(/\s+/g, "");
        lines.push(lab, Number(p.odds).toFixed(2));
        stats.prices++;
      }
    }
    if (lines.length) {
      L.push(name, ...lines);
      stats.markets++;
    }
  }
  return { text: L.join("\n"), stats };
}

// ---- find a match by names ----
const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const toks = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 1));
function sim(a, b) {
  const A = toks(a),
    B = toks(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const w of A) if (B.has(w)) i++;
  return i / Math.min(A.size, B.size);
}
function findByNames(rows, h, a) {
  let best = null,
    bs = 0;
  for (const r of rows) {
    const s1 = norm(r.home) === norm(h) && norm(r.away) === norm(a) ? 2 : 0;
    const s = s1 || Math.min(sim(h, r.home), sim(a, r.away));
    if (s > bs) {
      bs = s;
      best = r;
    }
  }
  return bs >= 0.6 ? best : null;
}

export default async (req) => {
  const u = new URL(req.url);
  const q = (k) => u.searchParams.get(k) || "";
  try {
    if (q("list")) {
      const rows = await allEvents();
      const day = q("day") || eatDay(Date.now() + 24 * 3600 * 1000);
      const minM = +q("min") || 0;
      const out = rows
        .filter((r) => eatDay(r.ts) === day && r.markets >= minM)
        .map((r) => ({ id: r.id, home: r.home, away: r.away, kickoff: kickText(r.ts), start: r.start, comp: r.comp, region: r.region, markets: r.markets }));
      return json({ day, count: out.length, totalUpcoming: rows.length, matches: out });
    }
    let ev = null;
    const id = q("id");
    if (id) {
      const rows = CACHE.rows.length ? CACHE.rows : [];
      ev = rows.find((r) => r.id === id) || null;
    } else if (q("home") && q("away")) {
      ev = findByNames(await allEvents(), q("home"), q("away"));
      if (!ev) return json({ error: "match not found on betPawa", home: q("home"), away: q("away") }, 404);
    } else return json({ error: "use ?list=1, ?id=ID or ?home=..&away=.." }, 400);

    const det = await get("/api/sportsbook/v4/events/" + (ev ? ev.id : id), 9000);
    if (det.status !== 200 || !det.json) return json({ error: "betPawa did not return the match", status: det.status, sample: (det.text || "").slice(0, 200) }, 502);
    if (!ev) ev = slim(det.json); // direct id, not in cache
    const board = buildBoard(ev, det.json);
    const out = { id: ev.id, home: ev.home, away: ev.away, kickoff: kickText(ev.ts), start: ev.start, comp: ev.comp, region: ev.region, fetchedAt: new Date().toISOString(), stats: board.stats, board: board.text };
    if (q("debug")) {
      const want = new Set(["3774", "4724", "3795", "28000869", "4706", "5051", "4703"]);
      out.debugRaw = (det.json.markets || [])
        .filter((m) => want.has(String(m.marketType && m.marketType.id)))
        .map((m) => ({ id: m.marketType.id, displayName: m.marketType.displayName, firstRow: (m.row || [])[0], rows: (m.row || []).length }));
    }
    return json(out);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};
