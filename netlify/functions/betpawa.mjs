// OddsOracle betPawa PROBE (diagnostic only; nothing in the app calls it yet).
// Deploy as netlify/functions/betpawa.mjs, then open in your browser:
//   https://YOUR-SITE.netlify.app/.netlify/functions/betpawa
// It makes 3 read-only requests to betpawa.ug and shows what came back, so we
// learn whether betPawa answers a Netlify server at all (it blocks many cloud IPs).
// Send me the whole page it shows.

const BASE = "https://www.betpawa.ug";
const H = {
  "x-pawa-brand": "betpawa-uganda",
  accept: "application/json, text/plain, */*",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  referer: BASE + "/",
  origin: BASE,
};

async function tryUrl(label, url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: H, redirect: "manual", signal: ctrl.signal, ...opts });
    const text = await r.text();
    return {
      label,
      url: url.slice(0, 300),
      status: r.status,
      ms: Date.now() - t0,
      type: r.headers.get("content-type"),
      server: r.headers.get("server"),
      cfRay: r.headers.get("cf-ray"),
      location: r.headers.get("location"),
      bytes: text.length,
      sample: text.slice(0, 1200),
    };
  } catch (e) {
    return { label, url: url.slice(0, 300), error: String((e && e.message) || e), ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

export default async () => {
  const q = encodeURIComponent(
    JSON.stringify({
      queries: [
        {
          query: { eventType: "UPCOMING", categories: ["2"], zones: {}, hasOdds: true },
          view: { marketTypes: [] },
          skip: 0,
          take: 3,
        },
      ],
    })
  );
  const out = [];
  out.push(await tryUrl("A sports list (documented)", BASE + "/api/sportsbook/v4/categories/list/all"));
  out.push(await tryUrl("B football regions (documented)", BASE + "/api/sportsbook/v4/categories/list/2?includeRegions=true"));
  out.push(await tryUrl("C upcoming football events (guessed path)", BASE + "/api/sportsbook/v3/events/lists/by-queries?q=" + q));
  return new Response(JSON.stringify({ note: "send this whole page to Claude", results: out }, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
};
