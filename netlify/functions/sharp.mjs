// Pinnacle sharp-price reader. Read-only. Returns, for the next ~2.5 days of football, the margin-free
// ("fair") odds for 1X2 and Over/Under 1.5 / 2.5 / 3.5. Nothing is placed anywhere.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const H = { "User-Agent": UA, "Accept": "application/json", "X-API-Key": "CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R", "Referer": "https://www.pinnacle.com/" };
const B = "https://guest.api.arcadia.pinnacle.com/0.1/sports/29/";
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const dec = a => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
const fair = arr => { const ip = arr.map(x => 1 / x), s = ip.reduce((a, b) => a + b, 0); return { f: ip.map(x => +(s / x).toFixed(3)), m: +((s - 1) * 100).toFixed(2) }; };

async function __handler(req) {
  try {
    const hrs = Math.min(+(new URL(req.url).searchParams.get("hrs")) || 60, 96);
    const now = Date.now(), lim = now + hrs * 3600e3;
    const [mr, kr] = await Promise.all([fetch(B + "matchups", { headers: H }), fetch(B + "markets/straight", { headers: H })]);
    if (!mr.ok || !kr.ok) return json({ error: "pinnacle " + mr.status + "/" + kr.status }, 502);
    const mu = await mr.json(); const mk = await kr.json();
    const ev = {};
    for (const m of mu) {
      if (m.parent || m.type !== "matchup" || m.special || !m.participants || m.participants.length < 2) continue;
      const t = Date.parse(m.startTime); if (!(t > now && t < lim)) continue;
      const h = m.participants.find(p => p.alignment === "home"), a = m.participants.find(p => p.alignment === "away");
      if (!h || !a) continue;
      ev[m.id] = { h: h.name, a: a.name, t, lg: (m.league && m.league.name) || "" };
    }
    for (const k of mk) {
      const e = ev[k.matchupId]; if (!e || k.period !== 0 || k.status !== "open" || !k.prices) continue;
      if (k.type === "moneyline") {
        const p = {}; k.prices.forEach(x => p[x.designation] = dec(x.price));
        if (p.home && p.draw && p.away) { const r = fair([p.home, p.draw, p.away]); e.ml = r.f; e.mm = r.m; }
      } else if (k.type === "total") {
        const ov = k.prices.find(x => x.designation === "over"), un = k.prices.find(x => x.designation === "under");
        if (!ov || !un) continue; const pt = ov.points;
        if (![1.5, 2.5, 3.5].includes(pt)) continue;
        e.ou = e.ou || {};
        if (!e.ou[pt] || !k.isAlternate) e.ou[pt] = fair([dec(ov.price), dec(un.price)]).f;
      }
    }
    const out = Object.values(ev).filter(e => e.ml || e.ou);
    return json({ at: now, n: out.length, matches: out, dbg: { mu: mu.length, mk: mk.length, ev: Object.keys(ev).length, k0: mk[0] ? { type: mk[0].type, period: mk[0].period, status: mk[0].status, id: mk[0].matchupId } : null } });
  } catch (e) { return json({ error: String((e && e.message) || e) }, 500); }
}
// ---- request guard: only this site's own page may call this function ----
const __OOK = (typeof process !== "undefined" && process.env && process.env.OO_KEY) || "c6ca96329d6369503e578bd9";
const __nf = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
function __guard(req) {
  if (req.headers.get("x-oo") !== __OOK) return __nf();
  const sf = req.headers.get("sec-fetch-site");
  if (sf && sf !== "same-origin") return __nf();
  return null;
}

export default async (req) => {
  const g = __guard(req);
  if (g) return g;
  return __handler(req);
};
