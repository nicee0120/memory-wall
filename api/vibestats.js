// VibeVibe Memory Wall: live vibe/vibe testnet stats  (file: api/vibestats.js)
// Vercel runs this automatically at /api/vibestats. Results are cached for 5 minutes.

var BASE = 'https://testnet.vibevibe.fun/api/v1/chains/46630';
var WALL_TOKEN = '0x0D2D35fE37d14A39F32dBa44bbd924517E18c391';
var PAGES = 5;            // 5 x 40 = the 200 most active (trending) tokens
var PER_PAGE = 40;
var ETH_PAIR = '0x0000000000000000000000000000000000000000';

function units(v) {      // "14932619032883544513" (18 decimals) -> 14.93
  if (v === null || v === undefined || v === '') return 0;
  var s = String(v).replace(/[^0-9]/g, '');
  if (!s) return 0;
  if (s.length <= 18) return Number('0.' + ('000000000000000000' + s).slice(-18));
  return Number(s.slice(0, s.length - 18) + '.' + s.slice(s.length - 18, s.length - 12));
}
function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function pairOf(l) {
  if (!l || typeof l !== 'object') return null;
  var c = l.curve || {}, m = l.market || {};
  var p = l.pairCurrencyAddress || l.pairAddress || c.pairCurrencyAddress || m.pairCurrencyAddress || null;
  return typeof p === 'string' ? p.toLowerCase() : null;
}
function nameOf(l) {
  var c = (l && l.content) || {};
  var n = c.symbol || l.symbol || c.name || l.name || '';
  return n ? String(n).slice(0, 24) : null;
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function getJson(url) {
  var last = null;
  for (var i = 0; i < 3; i++) {
    try {
      var r = await fetch(url, { headers: { 'accept': 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; vibevibe-memory-wall/1.1)' } });
      if (r.ok) return await r.json();
      last = new Error('vibe/vibe answered HTTP ' + r.status);
    } catch (e) { last = e; }
    await wait(400 * (i + 1));
  }
  throw last || new Error('no answer');
}

async function collect() {
  var out = {
    ok: true, asOf: new Date().toISOString(), source: 'vibe/vibe public data',
    totalTokens: null, sampleTokens: 0, trades24h: 0, buys24h: 0, sells24h: 0,
    volume24hEth: 0, activeTokens24h: 0, otherPairTokens: 0, top: [], wallToken: null
  };
  var rows = [];
  for (var p = 1; p <= PAGES; p++) {
    var j = await getJson(BASE + '/board?tab=TRENDING&limit=' + PER_PAGE + '&page=' + p);
    var d = (j && j.data) || {};
    if (p === 1 && d.page && d.page.total != null) out.totalTokens = num(d.page.total);
    var items = Array.isArray(d.items) ? d.items : [];
    for (var k = 0; k < items.length; k++) if (items[k] && items[k].launch) rows.push(items[k].launch);
    if (!d.page || d.page.hasMore === false || items.length < PER_PAGE) break;
  }
  var seen = {};
  rows.forEach(function (l) {
    var addr = String(l.tokenAddress || '').toLowerCase();
    if (!addr || seen[addr]) return;
    seen[addr] = 1;
    out.sampleTokens++;
    var m = l.market || {};
    var buys = num(m.buyCount24h), sells = num(m.sellCount24h);
    var trades = m.tradeCount24h != null ? num(m.tradeCount24h) : buys + sells;
    out.buys24h += buys; out.sells24h += sells; out.trades24h += trades;
    if (trades > 0) out.activeTokens24h++;
    var vol = m.volume24hPairUnits != null ? units(m.volume24hPairUnits) : units(m.buyVolume24hPairUnits) + units(m.sellVolume24hPairUnits);
    var pair = pairOf(l);
    if (pair && pair !== ETH_PAIR) { out.otherPairTokens++; return; }
    out.volume24hEth += vol;
    if (vol > 0) out.top.push({ token: l.tokenAddress, name: nameOf(l), volumeEth: Math.round(vol * 1000) / 1000, trades24h: trades });
  });
  out.top.sort(function (a, b) { return b.volumeEth - a.volumeEth; });
  out.top = out.top.slice(0, 5);
  out.volume24hEth = Math.round(out.volume24hEth * 1000) / 1000;
  try {
    var w = await getJson(BASE + '/v6/launches/' + WALL_TOKEN + '/market?limit=1');
    var s = (w && w.data && w.data.stats) || {};
    var b2 = num(s.buyCount24h), s2 = num(s.sellCount24h);
    out.wallToken = {
      token: WALL_TOKEN,
      holders: s.holderCount != null ? num(s.holderCount) : null,
      trades24h: s.tradeCount24h != null ? num(s.tradeCount24h) : b2 + s2,
      buys24h: b2, sells24h: s2
    };
  } catch (e) { out.wallToken = null; }
  return out;
}

function send(res, code, body, cache) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  try {
    if (typeof fetch !== 'function') throw new Error('fetch is not available in this Node version');
    var data = await collect();
    send(res, 200, data, 'public, s-maxage=300, stale-while-revalidate=600');
  } catch (e) {
    send(res, 502, { ok: false, error: String((e && e.message) || e).slice(0, 200) }, 'public, s-maxage=30');
  }
};
module.exports.collect = collect;
module.exports.units = units;
