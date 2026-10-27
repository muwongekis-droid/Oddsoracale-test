// OddsOracle TEST helper: final score of one match.
// mutating.com fills the score box with a POST to /updategame-<code>/ (code = end of the match page address).
// /.netlify/functions/results?url=<match page address>            (preferred: saved when stats were fetched)
// /.netlify/functions/results?home=Como&away=Sassuolo            (fallback: looks the match up on the day lists)
const BASE = "https://www.mutating.com";
const UA = "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
async function fetchT(url, opts = {}, ms = 8000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}
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

function extractRows(html) {
  const out = [], seen = new Set();
  const re = /href=["']((?:https?:)?\/\/(?:www\.)?mutating\.com\/football-stats\/match-preview-[^"']+|\/football-stats\/match-preview-[^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let u = m[1]; if (u.startsWith("//")) u = "https:" + u; else if (u.startsWith("/")) u = BASE + u;
    u = u.replace("://mutating.com", "://www.mutating.com");
    if (seen.has(u)) continue; seen.add(u);
    const s = u.match(/match-preview-(.+?)-stats-h2h-preview-and-prediction-([a-z0-9]+)\/?$/i); if (!s) continue;
    const parts = s[1].split("-vs-"); if (parts.length !== 2) continue;
    out.push({ url: u, home: parts[0].replace(/-/g, " "), away: parts[1].replace(/-/g, " ") });
  }
  return out;
}
const clean = (s) => String(s == null ? "" : s).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
export default async (req) => {
  const u = new URL(req.url);
  const home = (u.searchParams.get("home") || "").trim(), away = (u.searchParams.get("away") || "").trim();
  let matchUrl = (u.searchParams.get("url") || "").trim();
  const diag = { dayPages: [] };
  try {
    if (!/^https:\/\/www\.mutating\.com\/football-stats\/match-preview-[a-z0-9-]+\/?$/i.test(matchUrl)) matchUrl = "";
    if (!matchUrl) {
      if (!home || !away) return json({ ok: false, reason: "missing_names" }, 400);
      const days = ["/football-stats/yesterday/", "/football-stats/", "/football-stats/tomorrow/"];
      const rows = (await Promise.all(days.map(async (d) => {
        try { const r = await fetchT(BASE + d, { headers: { "user-agent": UA, accept: "text/html" } }); const h = await r.text(); const l = extractRows(h);
          diag.dayPages.push({ day: d, status: r.status, rows: l.length }); return l; }
        catch (e) { diag.dayPages.push({ day: d, error: String(e && e.message || e) }); return []; }
      }))).flat();
      const sc = rows.map((c) => ({ ...c, sh: nameScore(home, c.home), sa: nameScore(away, c.away) })).sort((a, b) => b.sh + b.sa - (a.sh + a.sa));
      const best = sc[0];
      diag.best = best && { url: best.url, sh: +best.sh.toFixed(2), sa: +best.sa.toFixed(2) };
      const strict = best && best.sh >= 0.75 && best.sa >= 0.75;
      const sec = sc[1];
      const fuzzy = !strict && best && best.sh >= 0.4 && best.sa >= 0.4 && best.sh + best.sa >= 0.9 && !(sec && sec.sh + sec.sa >= best.sh + best.sa - 0.15);
      if (!strict && !fuzzy) return json({ ok: false, reason: "match_not_found", diag });
      matchUrl = best.url;
    }
    const code = (matchUrl.match(/prediction-([a-z0-9]+)\/?$/i) || [])[1];
    if (!code) return json({ ok: false, reason: "no_code", diag });
    const r = await fetchT(BASE + "/updategame-" + code + "/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", accept: "*/*", referer: matchUrl, origin: BASE, "user-agent": UA },
      body: "",
    });
    const raw = await r.text();
    diag.post = { status: r.status, raw: raw.slice(0, 400) };
    let data = null; try { data = JSON.parse(raw); } catch {}
    if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }
    const o = Array.isArray(data) ? data[0] : data;
    if (!o || typeof o !== "object") return json({ ok: false, reason: "bad_response", diag });
    const time = clean(o.matchgotime), res = clean(o.matchgoresult);
    const m = res.match(/(\d+)\s*[-:–]\s*(\d+)/);
    const finished = !!m && /^(FT|AET|PEN|AP|AFTER|FINAL|FINISHED|FULL)/i.test(time);
    diag.read = { time, res };
    if (finished) return json({ ok: true, finished: true, hs: +m[1], as: +m[2], status: time, matchUrl, diag });
    return json({ ok: true, finished: false, status: time || "not started", live: m ? m[1] + "-" + m[2] : null, matchUrl, diag });
  } catch (e) { return json({ ok: false, reason: "error", message: String(e && e.message || e), diag }); }
};
