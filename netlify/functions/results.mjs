// OddsOracle TEST helper: final score of one match, from mutating.com day lists.
// /.netlify/functions/results?home=Como&away=Sassuolo  (add &debug=1 for diagnostics)
const BASE = "https://www.mutating.com";
const UA = "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
async function fetchT(url, opts = {}, ms = 8000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}
const STOP = new Set(["fc","cf","sc","ac","as","afc","sk","fk","kv","ud","cd","sd","rc","ss","us","the","de","la","el","club","calcio","cp","fsv","tsv","vfb","vfl","sv","bk","if","ik"]);
const ALIAS = { wolves: "wolverhampton", spurs: "tottenham", utd: "united", man: "manchester", psg: "paris", gladbach: "monchengladbach" };
const tokens = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").map((t) => ALIAS[t] || t).filter((t) => t.length > 1 && !STOP.has(t) && !/^\d{4}$/.test(t));
const tokMatch = (a, b) => a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));
function nameScore(a, b) {
  const A = tokens(a), B = tokens(b); if (!A.length || !B.length) return 0;
  const inter = A.filter((x) => B.some((y) => tokMatch(x, y))).length;
  const union = A.length + B.length - inter; return union ? inter / union : 0;
}
// every match-preview anchor on a day page, with a score if the row shows one
function extractRows(html) {
  const out = [];
  for (const piece of html.split(/<a\s+[^>]*?href=/i).slice(1)) {
    const hm = piece.match(/^["']([^"']*match-preview-(.+?)-stats-h2h-preview-and-prediction-[a-z0-9]+\/?)["']/i);
    if (!hm) continue;
    const parts = hm[2].split("-vs-"); if (parts.length !== 2) continue;
    const body = piece.slice(0, 2500).split(/<\/a>/i)[0];
    const sc = [...body.matchAll(/class=['"]scorem['"]>\s*(\d+)/g)].map((x) => +x[1]);
    out.push({ url: hm[1].startsWith("http") ? hm[1] : hm[1].startsWith("//") ? "https:" + hm[1] : BASE + hm[1], home: parts[0].replace(/-/g, " "), away: parts[1].replace(/-/g, " "), hs: sc.length >= 2 ? sc[0] : null, as: sc.length >= 2 ? sc[1] : null });
  }
  return out;
}
export default async (req) => {
  const u = new URL(req.url);
  const home = (u.searchParams.get("home") || "").trim(), away = (u.searchParams.get("away") || "").trim();
  if (!home || !away) return json({ ok: false, reason: "missing_names" }, 400);
  const diag = { dayPages: [] };
  try {
    const days = ["/football-stats/yesterday/", "/football-stats/", "/football-stats/tomorrow/"];
    const rows = (await Promise.all(days.map(async (d) => {
      try { const r = await fetchT(BASE + d, { headers: { "user-agent": UA, accept: "text/html" } }); const h = await r.text(); const l = extractRows(h);
        diag.dayPages.push({ day: d, status: r.status, rows: l.length, withScore: l.filter((x) => x.hs != null).length }); return l; }
      catch (e) { diag.dayPages.push({ day: d, error: String(e && e.message || e) }); return []; }
    }))).flat();
    const sc = rows.map((c) => ({ ...c, sh: nameScore(home, c.home), sa: nameScore(away, c.away) })).sort((a, b) => b.sh + b.sa - (a.sh + a.sa));
    const best = sc[0];
    diag.best = best && { home: best.home, away: best.away, sh: +best.sh.toFixed(2), sa: +best.sa.toFixed(2), hs: best.hs, as: best.as };
    if (!best || best.sh < 0.5 || best.sa < 0.5) return json({ ok: false, reason: "match_not_found", diag });
    if (best.hs != null) return json({ ok: true, finished: true, hs: best.hs, as: best.as, source: "daylist", diag });
    // the match page itself shows "FT" and the final score once the game is over
    const pr = await fetchT(best.url, { headers: { "user-agent": UA, accept: "text/html" } });
    const html = await pr.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
    const m = text.match(/\bFT\b\s*(\d{1,2})\s*[-\u2013:]\s*(\d{1,2})\b/);
    diag.page = { url: best.url, status: pr.status, bytes: html.length, ft: !!m };
    if (m) return json({ ok: true, finished: true, hs: +m[1], as: +m[2], source: "matchpage", diag });
    return json({ ok: true, finished: false, diag });
  } catch (e) { return json({ ok: false, reason: "error", message: String(e && e.message || e), diag }); }
};
