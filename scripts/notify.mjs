// Stuurt een ntfy-melding zodra de totale PnL met NTFY_THRESHOLD % van je totale marge is veranderd
// sinds de vorige melding, en zodra een take-profit uit trades.js geraakt wordt. Draait in GitHub Actions (zie .github/workflows/ntfy.yml).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const TOPIC = (process.env.NTFY_TOPIC || '').trim();
const SERVER = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
const THRESHOLD = Number(process.env.NTFY_THRESHOLD) || 10; // procentpunt ROE op de totale marge
const SITE_URL = process.env.SITE_URL || '';
const TEST = String(process.env.TEST) === 'true';
const STATE_FILE = process.env.STATE_FILE || '.ntfy-state/state.json';
const TZ = 'Europe/Amsterdam';

fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
if (!TOPIC) {
  console.log('::notice::Geen NTFY_TOPIC secret ingesteld; er wordt niets verstuurd.');
  process.exit(0);
}

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../trades.js', import.meta.url), 'utf8'), ctx);
const TRADES = ctx.window.TRADES.map((t) => ({ leverage: 5, cgMult: 1, ...t }));

async function getJson(url, opts) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// Bybit markprijs als dat lukt; GitHub-runners staan in de VS waar Bybit blokkeert, dan CoinGecko.
async function bybitPrices() {
  const out = {};
  for (const t of TRADES) {
    const j = await getJson(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${t.symbol}`);
    const p = parseFloat(j?.result?.list?.[0]?.markPrice);
    if (!isFinite(p)) throw new Error('Bybit gaf geen prijs voor ' + t.symbol);
    out[t.symbol] = p;
  }
  return { prices: out, source: 'Bybit markprijs' };
}
async function coingeckoPrices() {
  const ids = [...new Set(TRADES.map((t) => t.coingecko))].join(',');
  const j = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, { headers: { accept: 'application/json' } });
  const out = {};
  for (const t of TRADES) {
    const p = j?.[t.coingecko]?.usd;
    if (!isFinite(p)) throw new Error('CoinGecko gaf geen prijs voor ' + t.coingecko);
    out[t.symbol] = p * t.cgMult;
  }
  return { prices: out, source: 'CoinGecko spot' };
}
async function prices() {
  try { return await bybitPrices(); } catch (e) { console.log('Bybit niet bereikbaar (' + e.message + '), CoinGecko wordt gebruikt.'); }
  return coingeckoPrices();
}

const f2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
const usd = (v) => sgn(v) + f2.format(Math.abs(v)) + ' USDT';
const pct = (v) => sgn(v) + f1.format(Math.abs(v)) + '%';
const when = (iso) => new Date(iso).toLocaleString('nl-NL', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function send({ title, message, tags, priority }) {
  const body = { topic: TOPIC, title, message, tags, priority };
  if (SITE_URL) body.click = SITE_URL;
  const res = await fetch(SERVER, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('ntfy -> HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  console.log('Melding verstuurd: ' + title);
}

const { prices: px, source } = await prices();
const rows = TRADES.map((t) => {
  const mark = px[t.symbol], qty = t.margin * t.leverage / t.entry, pnl = qty * (mark - t.entry);
  return { name: t.name, pnl, roe: pnl / t.margin * 100, toSl: (mark - t.sl) / mark * 100 };
});
const margin = TRADES.reduce((a, t) => a + t.margin, 0);
const pnl = rows.reduce((a, r) => a + r.pnl, 0);
const roe = pnl / margin * 100;
const near = rows.reduce((a, r) => (r.toSl < a.toSl ? r : a));
const best = rows.reduce((a, r) => (r.roe > a.roe ? r : a));
const worst = rows.reduce((a, r) => (r.roe < a.roe ? r : a));
const now = new Date().toISOString();
const status =
  `Nu: ${usd(pnl)} (${pct(roe)} ROE op ${f2.format(margin)} USDT marge).\n` +
  `Dichtst bij SL: ${near.name}, nog ${f1.format(near.toSl)}%.\n` +
  `Beste: ${best.name} ${pct(best.roe)}. Slechtste: ${worst.name} ${pct(worst.roe)}.\n` +
  `Bron: ${source}.`;
console.log(`PnL ${usd(pnl)} | ROE ${pct(roe)} | ${source}`);

let state = null;
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* eerste run */ }

if (TEST) {
  await send({ title: `Long Trades testmelding: ${usd(pnl)}`, message: status + `\nJe krijgt een melding bij elke verandering van ${THRESHOLD}% van je marge (${f2.format(margin * THRESHOLD / 100)} USDT).`, tags: ['white_check_mark'], priority: 3 });
}

if (!state || !isFinite(state.anchorRoe)) {
  if (!TEST) await send({ title: `Long Trades meldingen staan aan: ${usd(pnl)}`, message: status + `\nVolgende melding bij ±${THRESHOLD}% van je marge (±${f2.format(margin * THRESHOLD / 100)} USDT).`, tags: ['bell'], priority: 3 });
  state = { anchorPnl: pnl, anchorRoe: roe, anchorAt: now };
} else {
  const diff = roe - state.anchorRoe;
  if (Math.abs(diff) >= THRESHOLD) {
    const up = diff > 0;
    const dUsd = pnl - state.anchorPnl;
    await send({
      title: `Long Trades: PnL ${up ? 'omhoog' : 'omlaag'} ${usd(dUsd)} (${pct(diff)})`,
      message: `Totale PnL ${up ? 'steeg' : 'daalde'} met ${f2.format(Math.abs(dUsd))} USDT (${f1.format(Math.abs(diff))}% van je marge) sinds ${when(state.anchorAt)}, van ${usd(state.anchorPnl)} naar ${usd(pnl)}.\n` + status,
      tags: [up ? 'chart_with_upwards_trend' : 'chart_with_downwards_trend'],
      priority: up ? 3 : 4
    });
    state = { anchorPnl: pnl, anchorRoe: roe, anchorAt: now };
  } else {
    console.log(`Verandering sinds ${when(state.anchorAt)}: ${pct(diff)} van de marge (drempel ${THRESHOLD}%). Geen melding.`);
  }
}
// Take-profit meldingen: één keer per niveau; opnieuw actief als de koers 10% onder het niveau zakt.
const fp = (v) => (v >= 10000 ? f2.format(v).replace(/\.\d+$/, '') : v >= 1 ? f2.format(v) : String(Number(v.toPrecision(5))));
state.tp = state.tp || {};
const firstTp = !state.tpInit;
for (const t of TRADES) {
  const mark = px[t.symbol], qty = t.margin * t.leverage / t.entry;
  for (const x of (t.tps || []).filter((x) => x && x.price > 0)) {
    const key = t.symbol + '@' + x.price;
    if (mark >= x.price) {
      if (!state.tp[key] && !firstTp) {
        const part = qty * (x.pct || 0) / 100;
        await send({
          title: `Take-profit geraakt: ${t.name} ${x.label || ''} (${fp(x.price)})`.replace('  ', ' '),
          message: `${t.name} staat op ${fp(mark)}, boven je take-profit van ${fp(x.price)}.\n` +
            `Plan: verkoop ${x.pct || 0}% van de positie (${part.toLocaleString('en-US', { maximumFractionDigits: part < 1 ? 5 : 2 })} stuks), dat levert ongeveer ${usd(part * (x.price - t.entry))} op.\n` + status,
          tags: ['moneybag'],
          priority: 4
        });
      }
      state.tp[key] = true;
    } else if (mark < x.price * 0.9) {
      state.tp[key] = false;
    }
  }
}
state.tpInit = true;
state.lastPnl = pnl; state.lastRoe = roe; state.lastCheck = now;
fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
