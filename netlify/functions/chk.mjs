// TEMPORARY read-only probe. Deploy, open once, send me the output, then DELETE this file.
// Open: https://YOUR-V3-SITE/.netlify/functions/chk
// Tests whether SportyBet (Uganda) and Pinnacle answer a Netlify server, and how many football matches each returns.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const TESTS = [
  { name: "sporty_ug_upcoming", url: "https://www.sportybet.com/api/ug/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A1&marketId=1%2C18%2C10%2C29%2C11%2C26%2C36%2C14&pageSize=100&pageNum=1&option=1&_t=" + Date.now(),
    headers: { "User-Agent": UA, "Accept": "application/json", "operid": "2", "platform": "web", "clientid": "web", "Referer": "https://www.sportybet.com/ug/sport/football" } },
  { name: "sporty_ug_home", url: "https://www.sportybet.com/ug/sport/football", headers: { "User-Agent": UA } },
  { name: "pinnacle_guest_matchups", url: "https://guest.api.arcadia.pinnacle.com/0.1/sports/29/matchups",
    headers: { "User-Agent": UA, "Accept": "application/json", "X-API-Key": "CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R", "Referer": "https://www.pinnacle.com/" } },
  { name: "pinnacle_guest_markets", url: "https://guest.api.arcadia.pinnacle.com/0.1/sports/29/markets/straight",
    headers: { "User-Agent": UA, "Accept": "application/json", "X-API-Key": "CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R", "Referer": "https://www.pinnacle.com/" } },
];

function names(j) {
  const out = [];
  try {
    const ev = j?.data?.tournaments ? j.data.tournaments.flatMap(t => t.events || []) : Array.isArray(j) ? j : [];
    for (const e of ev) {
      if (e.homeTeamName) out.push(e.homeTeamName + " v " + e.awayTeamName);
      else if (e.participants && e.participants.length >= 2 && !e.parent) out.push(e.participants.map(p => p.name).join(" v "));
      else if (e.special == null && e.parent == null && e.participants) out.push(e.participants.map(p => p.name).join(" v "));
    }
  } catch (_) {}
  return out;
}

export default async () => {
  const res = [];
  for (const t of TESTS) {
    const r = { test: t.name };
    const t0 = Date.now();
    try {
      const c = new AbortController();
      const to = setTimeout(() => c.abort(), 9000);
      const x = await fetch(t.url, { headers: t.headers, signal: c.signal });
      clearTimeout(to);
      const txt = await x.text();
      r.status = x.status; r.bytes = txt.length; r.ms = Date.now() - t0;
      r.type = x.headers.get("content-type");
      r.head = txt.slice(0, 160).replace(/\s+/g, " ");
      try { const n = names(JSON.parse(txt)); r.matches = n.length; r.sample = n.slice(0, 8); } catch (_) {}
    } catch (e) { r.error = String(e && e.message || e); r.ms = Date.now() - t0; }
    res.push(r);
  }
  return new Response(JSON.stringify(res, null, 1), { headers: { "content-type": "application/json" } });
};
