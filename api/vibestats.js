// VibeVibe Memory Wall: live vibe/vibe testnet stats  (file: api/vibestats.js)
// Vercel runs this automatically at /api/vibestats. Results are cached for 5 minutes.
// Every pair currency (ETH, VIBEVIBE, ...) is converted to ETH with vibe/vibe's own pair-prices.

var BASE = 'https://testnet.vibevibe.fun/api/v1/chains/46630';
var WALL_TOKEN = '0x0D2D35fE37d14A39F32dBa44bbd924517E18c391';
var VIBEVIBE = '0xf1f6b050550531226ee0257fec4a1e575ff4c341';
var PER_PAGE = 40;
var ETH_PAGES = 5;                     // ETH pair: the 200 most active tokens
var BIG_PAIR_PAGES = 2;                // VIBEVIBE (and any pair with 1,000+ launches): 80 tokens
var MAX_OTHER_PAIRS = 10;              // the 10 most used other pairs (NVDA, SPCX, AAPL...): 40 tokens each
var HEATMAP_TOKENS = 60;               // tiles in the heatmap
var WHALE_SOURCES = 12;                // check recent trades of the 12 busiest tokens
var ETH_PAIR = '0x0000000000000000000000000000000000000000';

function units(v, dec) {               // integer string with `dec` decimals -> number
  if (v === null || v === undefined || v === '') return 0;
  dec = dec == null ? 18 : dec;
  var neg = String(v).trim().charAt(0) === '-';
  var s = String(v).replace(/[^0-9]/g, '');
  if (!s) return 0;
  var n;
  if (s.length <= dec) n = Number('0.' + (new Array(dec + 1).join('0') + s).slice(-dec));
  else n = Number(s.slice(0, s.length - dec) + '.' + s.slice(s.length - dec, s.length - dec + 8));
  return neg ? -n : n;
}
function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function numOrNull(v) { if (v === null || v === undefined || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }
function low(a) { return typeof a === 'string' ? a.toLowerCase() : null; }
function pairOf(l) {
  if (!l || typeof l !== 'object') return null;
  var c = l.curve || {}, m = l.market || {};
  return low(l.pairCurrencyAddress || l.pairAddress || c.pairCurrencyAddress || m.pairCurrencyAddress || null);
}
function nameOf(l) {
  var c = (l && l.content) || {};
  var n = c.symbol || l.symbol || c.name || l.name || '';
  return n ? String(n).slice(0, 24) : null;
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function round(n, d) { var k = Math.pow(10, d); return Math.round(n * k) / k; }

async function getJson(url, tries) {
  var last = null; tries = tries || 3;
  for (var i = 0; i < tries; i++) {
    try {
      var r = await fetch(url, { headers: { 'accept': 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; vibevibe-memory-wall/1.2)' } });
      if (r.ok) return await r.json();
      last = new Error('vibe/vibe answered HTTP ' + r.status);
      if (r.status === 404) break;
    } catch (e) { last = e; }
    await wait(400 * (i + 1));
  }
  throw last || new Error('no answer');
}

// price of each pair currency in ETH (1 for ETH itself)
async function pairPrices() {
  var map = {}; map[ETH_PAIR] = { eth: 1, dec: 18 };
  try {
    var j = await getJson(BASE + '/v6/pair-prices');
    var items = (j && j.data && j.data.items) || [];
    items.forEach(function (it) {
      var a = low(it.pairAddress); if (!a) return;
      var dec = it.decimals != null ? num(it.decimals) : 18;
      if (it.priceEthWad != null) map[a] = { eth: units(it.priceEthWad, 18), dec: dec };
    });
  } catch (e) { /* only ETH-priced volume can be counted */ }
  return map;
}

// ETH price in USD from vibe/vibe's own endpoint. Returns { usd, raw } (raw is a short note when it can't be read)
function plausibleUsd(v) {
  var n = Number(v); if (!isFinite(n) || n <= 0) return null;
  var tries = [1, 1e2, 1e6, 1e8, 1e18];
  for (var i = 0; i < tries.length; i++) { var x = n / tries[i]; if (x >= 300 && x <= 50000) return x; }
  return null;
}
async function ethUsd() {
  var url = BASE + '/market/eth-usd', j;
  try { j = await getJson(url, 2); } catch (e) { return { usd: null, raw: 'eth-usd failed: ' + String(e && e.message || e).slice(0, 80) }; }
  var keyed = null, any = null;
  (function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > 4) return;
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      if (v !== null && typeof v === 'object') { walk(v, depth + 1); return; }
      if (typeof v !== 'number' && !(typeof v === 'string' && /^-?[0-9.]+$/.test(v))) return;
      if (/block|time|age|ttl|version|chain|decimals|ts$/i.test(k)) return;
      var x = plausibleUsd(v); if (x === null) return;
      if (keyed === null && /usd|price|rate|value|eth/i.test(k)) keyed = x;
      if (any === null) any = x;
    });
  })(j && j.data !== undefined ? j.data : j, 0);
  var usd = keyed !== null ? keyed : any;
  return { usd: usd, raw: usd === null ? JSON.stringify(j).slice(0, 300) : null };
}

async function collect() {
  var out = {
    ok: true, version: 3, asOf: new Date().toISOString(), source: 'vibe/vibe public data',
    totalTokens: null, sampleTokens: 0, trades24h: 0, buys24h: 0, sells24h: 0,
    volume24hEth: 0, volume24hUsd: null, ethUsd: null, unpricedTokens: 0,
    volumeByPair: {}, top: [], heatmap: [], whales: [], vibevibe: null, wallToken: null
  };
  // 1) prices, ETH/USD and the list of all pairs (the "shelf") with their launch counts
  var first = await Promise.all([pairPrices(), ethUsd(), getJson(BASE + '/board?tab=TRENDING&limit=' + PER_PAGE + '&page=1&include=shelf')]);
  var prices = first[0]; out.ethUsd = first[1].usd; if (first[1].raw) out.ethUsdNote = first[1].raw;
  var d0 = (first[2] && first[2].data) || {};
  if (d0.page && d0.page.total != null) out.totalTokensV6 = num(d0.page.total);
  var shelf = (d0.shelf && Array.isArray(d0.shelf.pairs)) ? d0.shelf.pairs : [];
  var pairNames = {}; pairNames[ETH_PAIR] = 'ETH'; pairNames[VIBEVIBE] = 'VIBEVIBE';
  var all = 0;
  shelf.forEach(function (sp) {
    all += num(sp.v6) + num(sp.v5);
    var a = low(sp.pair), nm = sp.symbol || sp.ticker || sp.name || (sp.meta && (sp.meta.symbol || sp.meta.name));
    if (a && nm && !pairNames[a]) pairNames[a] = String(nm).slice(0, 16);
  });
  out.totalTokens = all > 0 ? all : out.totalTokensV6;

  // 2) the most active tokens of EVERY major pair, read pair by pair
  var plan = [{ pair: ETH_PAIR, pages: ETH_PAGES }];
  shelf.filter(function (sp) { var a = low(sp.pair); return a && a !== ETH_PAIR && num(sp.v6) > 0; })
    .sort(function (a, b) { return num(b.v6) - num(a.v6); })
    .slice(0, MAX_OTHER_PAIRS)
    .forEach(function (sp) { plan.push({ pair: low(sp.pair), pages: num(sp.v6) >= 1000 ? BIG_PAIR_PAGES : 1 }); });
  if (!plan.some(function (x) { return x.pair === VIBEVIBE; })) plan.splice(1, 0, { pair: VIBEVIBE, pages: BIG_PAIR_PAGES });
  var urls = [];
  plan.forEach(function (pl) { for (var pg = 1; pg <= pl.pages; pg++) urls.push(BASE + '/board?tab=TRENDING&pair=' + pl.pair + '&limit=' + PER_PAGE + '&page=' + pg); });
  out.pairsCovered = plan.length;
  var rows = [];
  (Array.isArray(d0.items) ? d0.items : []).forEach(function (it) { if (it && it.launch) rows.push(it.launch); });
  for (var b = 0; b < urls.length; b += 6) {                       // small batches, polite to vibe/vibe
    var chunk = await Promise.all(urls.slice(b, b + 6).map(function (u) { return getJson(u, 2).catch(function () { return null; }); }));
    chunk.forEach(function (j) { var d = (j && j.data) || {}; (Array.isArray(d.items) ? d.items : []).forEach(function (it) { if (it && it.launch) rows.push(it.launch); }); });
  }

  rows.forEach(function (l) { var a = low(l.tokenAddress), nm = nameOf(l); if (a && nm && !pairNames[a]) pairNames[a] = nm; });   // pairs that are vibe/vibe tokens themselves (e.g. OPENAI)
  var need = {};
  rows.forEach(function (l) { var pr = pairOf(l); if (pr && !pairNames[pr]) need[pr] = (need[pr] || 0) + 1; });
  var unnamed = Object.keys(need).sort(function (a, b) { return need[b] - need[a]; }).slice(0, 6);
  var named = await Promise.all(unnamed.map(function (a) {
    return getJson(BASE + '/v6/launches/' + a + '/market?limit=1', 1).then(function (j) { var d = (j && j.data) || {}; return nameOf(d.launch || d); }).catch(function () { return null; });
  }));
  unnamed.forEach(function (a, i) { if (named[i]) pairNames[a] = named[i]; });
  var seen = {}, tokens = [];
  rows.forEach(function (l) {
    var addr = low(l.tokenAddress);
    if (!addr || seen[addr]) return; seen[addr] = 1;
    out.sampleTokens++;
    var m = l.market || {};
    var buys = num(m.buyCount24h), sells = num(m.sellCount24h);
    var trades = m.tradeCount24h != null ? num(m.tradeCount24h) : buys + sells;
    out.buys24h += buys; out.sells24h += sells; out.trades24h += trades;
    var pair = pairOf(l) || ETH_PAIR;
    var pr = prices[pair];
    var raw = m.volume24hPairUnits != null ? m.volume24hPairUnits : null;
    var volPair = raw != null ? units(raw, pr ? pr.dec : 18) : units(m.buyVolume24hPairUnits, pr ? pr.dec : 18) + units(m.sellVolume24hPairUnits, pr ? pr.dec : 18);
    if (!pr) { out.unpricedTokens++; return; }
    var volEth = volPair * pr.eth;
    out.volume24hEth += volEth;
    var label = pairNames[pair] || 'Other pairs';
    out.volumeByPair[label] = (out.volumeByPair[label] || 0) + volEth;
    var chg = numOrNull(m.priceChange24hBps); if (chg === null) chg = numOrNull(m.priceChange1hBps);
    tokens.push({ token: l.tokenAddress, name: nameOf(l), pair: label, volumeEth: volEth, trades24h: trades, change24hBps: chg, holders: numOrNull(m.holderCount), pairAddr: pair });
  });
  tokens.sort(function (a, b) { return b.volumeEth - a.volumeEth; });
  out.volume24hEth = round(out.volume24hEth, 3);
  Object.keys(out.volumeByPair).forEach(function (k) { out.volumeByPair[k] = round(out.volumeByPair[k], 3); });
  if (out.ethUsd) out.volume24hUsd = Math.round(out.volume24hEth * out.ethUsd);
  out.top = tokens.slice(0, 5).map(function (t) { return { token: t.token, name: t.name, pair: t.pair, volumeEth: round(t.volumeEth, 3), trades24h: t.trades24h }; });
  out.heatmap = tokens.filter(function (t) { return t.volumeEth > 0; }).slice(0, HEATMAP_TOKENS).map(function (t) {
    return { token: t.token, name: t.name, volumeEth: round(t.volumeEth, 4), change24hBps: t.change24hBps, trades24h: t.trades24h };
  });
  if (prices[VIBEVIBE]) out.vibevibe = { token: VIBEVIBE, priceEth: prices[VIBEVIBE].eth, priceUsd: out.ethUsd ? prices[VIBEVIBE].eth * out.ethUsd : null };

  // whales: the biggest recent trades in the busiest tokens
  var sources = tokens.slice(0, WHALE_SOURCES);
  var tradeLists = await Promise.all(sources.map(function (t) {
    return getJson(BASE + '/v6/launches/' + t.token + '/market?limit=25', 2).then(function (j) { return { t: t, list: (j && j.data && j.data.trades) || [] }; }).catch(function () { return { t: t, list: [] }; });
  }));
  var whales = [], dayAgo = Date.now() - 864e5;
  tradeLists.forEach(function (r) {
    var pr = prices[r.t.pairAddr]; if (!pr) return;
    r.list.forEach(function (tr) {
      if (!tr || (tr.kind && tr.kind !== 'TRADE')) return;
      var at = Date.parse(tr.occurredAt || ''); if (!at || at < dayAgo) return;
      var eth = units(tr.pairAmountUnits, pr.dec) * pr.eth;
      if (!(eth > 0)) return;
      whales.push({ token: r.t.token, name: r.t.name, side: String(tr.side || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY', eth: round(eth, 4), usd: out.ethUsd ? Math.round(eth * out.ethUsd) : null, actor: tr.actorAddress || null, at: tr.occurredAt });
    });
  });
  whales.sort(function (a, b) { return b.eth - a.eth; });
  out.whales = whales.slice(0, 15).sort(function (a, b) { return Date.parse(b.at) - Date.parse(a.at); });

  try {
    var w = await getJson(BASE + '/v6/launches/' + WALL_TOKEN + '/market?limit=1', 2);
    var s = (w && w.data && w.data.stats) || {};
    var b2 = num(s.buyCount24h), s2 = num(s.sellCount24h);
    out.wallToken = { token: WALL_TOKEN, holders: s.holderCount != null ? num(s.holderCount) : null, trades24h: s.tradeCount24h != null ? num(s.tradeCount24h) : b2 + s2, buys24h: b2, sells24h: s2 };
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
module.exports.ethUsd = ethUsd;
