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

// ETH price in USD: vibe/vibe's own endpoint if found, else null (the wall then shows ETH only)
async function ethUsd() {
  var urls = ['https://testnet.vibevibe.fun/api/v1/eth-usd', BASE + '/eth-usd', BASE + '/v6/eth-usd'];
  for (var i = 0; i < urls.length; i++) {
    try {
      var j = await getJson(urls[i], 1);
      var found = null;
      (function walk(o, depth) {
        if (found !== null || !o || typeof o !== 'object' || depth > 3) return;
        Object.keys(o).forEach(function (k) {
          var v = o[k];
          if (found === null && /usd|price/i.test(k) && (typeof v === 'number' || (typeof v === 'string' && /^[0-9.]+$/.test(v)))) {
            var n = Number(v); if (n > 1e20) n = n / 1e18;      // wad value
            if (n > 100 && n < 100000) found = n;
          } else if (typeof v === 'object') walk(v, depth + 1);
        });
      })(j, 0);
      if (found) return found;
    } catch (e) { /* try the next one */ }
  }
  return null;
}

async function collect() {
  var out = {
    ok: true, version: 2, asOf: new Date().toISOString(), source: 'vibe/vibe public data',
    totalTokens: null, sampleTokens: 0, trades24h: 0, buys24h: 0, sells24h: 0,
    volume24hEth: 0, volume24hUsd: null, ethUsd: null, unpricedTokens: 0,
    volumeByPair: {}, top: [], heatmap: [], whales: [], vibevibe: null, wallToken: null
  };
  // 1) prices, ETH/USD and the list of all pairs (the "shelf") with their launch counts
  var first = await Promise.all([pairPrices(), ethUsd(), getJson(BASE + '/board?tab=TRENDING&limit=' + PER_PAGE + '&page=1&include=shelf')]);
  var prices = first[0]; out.ethUsd = first[1];
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
