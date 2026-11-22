// OddsOracle betPawa PROBE 2 (diagnostic only; nothing in the app calls it).
// Same file name as before: replace netlify/functions/betpawa.mjs with this, deploy, open
//   https://hmasal-v2.netlify.app/.netlify/functions/betpawa
// It tries several likely "list upcoming football matches" addresses at once, then
// (if one works) tries several "one match's odds" addresses. Send me the whole page.

const BASE = "https://www.betpawa.ug";
const H = {
  "x-pawa-brand": "betpawa-uganda",
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  referer: BASE + "/",
  origin: BASE,
};

async function go(label, method, path, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4500);
  const t0 = Date.now();
  try {
    const opts = { method, headers: H, redirect: "manual", signal: ctrl.signal };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(BASE + path, opts);
    const text = await r.text();
    return { label, method, path: path.slice(0, 160), status: r.status, ms: Date.now() - t0, bytes: text.length, sample: text.slice(0, 700), _text: text };
  } catch (e) {
    return { label, method, path: path.slice(0, 160), error: String((e && e.message) || e), ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

const clean = (r) => {
  const { _text, ...rest } = r;
  return rest;
};

export default async () => {
  const mk = (eventType, extra = {}) => ({
    queries: [
      { query: { eventType, categories: ["2"], zones: {}, hasOdds: true, ...extra }, view: { marketTypes: [] }, skip: 0, take: 3 },
    ],
  });
  const body = mk("UPCOMING");
  const q = encodeURIComponent(JSON.stringify(body));
  const cand = [
    go("P1 POST v3 by-queries", "POST", "/api/sportsbook/v3/events/lists/by-queries", body),
    go("P2 POST v2 by-queries", "POST", "/api/sportsbook/v2/events/lists/by-queries", body),
    go("P3 POST v4 by-queries", "POST", "/api/sportsbook/v4/events/lists/by-queries", body),
    go("P4 GET v2 by-queries", "GET", "/api/sportsbook/v2/events/lists/by-queries?q=" + q),
    go("P5 GET v4 by-queries", "GET", "/api/sportsbook/v4/events/lists/by-queries?q=" + q),
    go("P6 POST v3 events/lists", "POST", "/api/sportsbook/v3/events/lists", body),
    go("P7 POST v4 events/lists", "POST", "/api/sportsbook/v4/events/lists", body),
    go("P8 POST v4 events/list", "POST", "/api/sportsbook/v4/events/list", body),
  ];
  const res = await Promise.all(cand);
  const out = { note: "send this whole page to Claude", listAttempts: res.map(clean), detailAttempts: [] };

  // find an event id in any successful list response
  let id = null,
    from = null;
  for (const r of res) {
    if (r.status === 200 && r._text) {
      const m = r._text.match(/"id"\s*:\s*"?(\d{6,})"?/);
      if (m) {
        id = m[1];
        from = r.label;
        break;
      }
    }
  }
  out.eventIdFound = id;
  out.foundVia = from;
  if (id) {
    const det = [
      go("D1 GET v3 events/" + id, "GET", "/api/sportsbook/v3/events/" + id),
      go("D2 GET v4 events/" + id, "GET", "/api/sportsbook/v4/events/" + id),
      go("D3 GET v2 events/" + id, "GET", "/api/sportsbook/v2/events/" + id),
      go("D4 GET v3 events/" + id + "/markets", "GET", "/api/sportsbook/v3/events/" + id + "/markets"),
      go("D5 GET v4 events/" + id + "/markets", "GET", "/api/sportsbook/v4/events/" + id + "/markets"),
      go("D6 GET v3 events/detail/" + id, "GET", "/api/sportsbook/v3/events/detail/" + id),
    ];
    out.detailAttempts = (await Promise.all(det)).map(clean);
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
};
