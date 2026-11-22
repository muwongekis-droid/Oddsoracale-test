// OddsOracle betPawa PROBE 3 (diagnostic only; nothing in the app calls it).
// Replace netlify/functions/betpawa.mjs with this, deploy, open
//   https://hmasal-v2.netlify.app/.netlify/functions/betpawa
// It checks how many matches the list gives, paging, and shows one full match's markets/odds layout.

const BASE = "https://www.betpawa.ug";
const H = {
  "x-pawa-brand": "betpawa-uganda",
  accept: "application/json, text/plain, */*",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  referer: BASE + "/",
  origin: BASE,
};

async function get(path, ms = 6500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + path, { headers: H, redirect: "manual", signal: ctrl.signal });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: r.status, ms: Date.now() - t0, bytes: text.length, json, text };
  } catch (e) {
    return { status: 0, error: String((e && e.message) || e), ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

const listPath = (skip, take, extra = {}) =>
  "/api/sportsbook/v4/events/lists/by-queries?q=" +
  encodeURIComponent(
    JSON.stringify({
      queries: [
        { query: { eventType: "UPCOMING", categories: ["2"], zones: {}, hasOdds: true, ...extra }, view: { marketTypes: [] }, skip, take },
      ],
    })
  );

const evs = (r) => (r && r.json && r.json.responses && r.json.responses[0] && r.json.responses[0].responses) || [];
const brief = (e) => ({ id: e.id, name: e.name, start: e.startTime, markets: e.totalMarketCount, comp: e.competition && e.competition.name, region: e.region && e.region.name });

export default async () => {
  const out = { note: "send this whole page to Claude" };
  const [a, b, c, d] = await Promise.all([get(listPath(0, 50)), get(listPath(0, 500)), get(listPath(50, 50)), get(listPath(0, 5, { startTime: { from: "2026-11-23T00:00:00Z", to: "2026-11-23T23:59:59Z" } }))]);
  const A = evs(a),
    B = evs(b),
    C = evs(c),
    D = evs(d);
  out.list = {
    take50: { status: a.status, n: A.length, first3: A.slice(0, 3).map(brief), keys: A[0] ? Object.keys(A[0]) : null },
    take500: { status: b.status, n: B.length, bytes: b.bytes, error: b.error || null, top: b.json && b.json.responses && b.json.responses[0] ? Object.keys(b.json.responses[0]) : null },
    skip50take50: { status: c.status, n: C.length, firstId: C[0] && C[0].id, overlapWithFirstPage: C.filter((x) => A.some((y) => y.id === x.id)).length },
    dateFilterTry: { status: d.status, n: D.length, starts: D.map((x) => x.startTime), sample: d.status !== 200 ? (d.text || "").slice(0, 200) : null },
  };
  // pick the event with the most markets from the biggest page we got
  const pool = (B.length ? B : A).slice().sort((x, y) => (+y.totalMarketCount || 0) - (+x.totalMarketCount || 0));
  const pick = pool[0];
  if (pick) {
    const det = await get("/api/sportsbook/v4/events/" + pick.id, 8000);
    const j = det.json || {};
    out.detail = { id: pick.id, name: pick.name, status: det.status, bytes: det.bytes, keys: Object.keys(j) };
    const ms = j.markets || [];
    out.detail.marketCount = ms.length;
    out.detail.marketNames = ms.map((m) => (m.marketType && (m.marketType.displayName || m.marketType.name)) + " [" + (m.marketType && m.marketType.id) + "]");
    out.detail.rawMarket1 = ms[0] || null;
    out.detail.rawHandicapOrOU = ms.find((m) => /over|handicap|correct/i.test((m.marketType && m.marketType.name) || "")) || null;
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
};
