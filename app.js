(() => {
  'use strict';

  const TRADES = (window.TRADES || []).map((t) => ({ leverage: 5, ...t }));
  const REST_HOSTS = ['https://api.bybit.com', 'https://api.bytick.com'];
  const WS_URL = 'wss://stream.bybit.com/v5/public/linear';
  const NEAR_SL = 8; // % afstand tot SL waarbij een tegel oranje oplicht
  const START = Date.now();
  const SVGNS = 'http://www.w3.org/2000/svg';

  const state = {
    tickers: {},   // symbol -> laatste Bybit ticker (snapshot + deltas)
    closes: {},    // symbol -> slotkoersen 7 dagen (4u candles)
    ws: null, wsOpen: false, lastTick: 0, restOk: false,
    sort: 'default', move: -10, shown: {}, ath: {}
  };

  /* ---------- formatting ---------- */
  const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const NF = [0, 1, 2, 3, 4, 5].map(nf);
  const PF3 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const sign = (v) => (v > 0 ? '+' : v < 0 ? '-' : '');
  const usd = (v, unit = true) => v == null || !isFinite(v) ? '—' : sign(v) + NF[2].format(Math.abs(v)) + (unit ? ' USDT' : '');
  const usd0 = (v) => v == null || !isFinite(v) ? '—' : NF[0].format(v) + ' USDT';
  const pct = (v, s) => v == null || !isFinite(v) ? '—' : (s ? sign(v) : v < 0 ? '-' : '') + NF[Math.abs(v) < 10 ? 2 : 1].format(Math.abs(v)) + '%';
  const price = (v) => {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 10000) return NF[0].format(v);
    if (a >= 1) return PF3.format(v);
    if (a >= 0.1) return NF[4].format(v);
    return String(Number(v.toPrecision(5)));
  };
  const qty = (v) => { const a = Math.abs(v); return NF[a >= 1000 ? 0 : a >= 1 ? 3 : 5].format(v); };
  const tone = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (id) => document.getElementById(id);
  const setText = (el, text, cls) => {
    if (!el) return;
    if (el.textContent !== text) el.textContent = text;
    if (cls !== undefined && el.className !== cls) el.className = cls;
  };
  const setAttr = (el, k, v) => { v = String(v); if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
  const setStyle = (el, k, v) => { if (el.style[k] !== v) el.style[k] = v; };
  const svgEl = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

  /* ---------- calculations ---------- */
  function calc(t) {
    const tk = state.tickers[t.symbol] || {};
    const mark = parseFloat(tk.markPrice) || parseFloat(tk.lastPrice) || null;
    const last = parseFloat(tk.lastPrice) || null;
    const size = t.margin * t.leverage;
    const q = size / t.entry;
    const has = mark != null;
    const pnl = has ? q * (mark - t.entry) : null;
    const fr = parseFloat(tk.fundingRate);
    const fInt = parseFloat(tk.fundingIntervalHour) || 8;
    const value = has ? q * mark : null;
    const closes = state.closes[t.symbol] || [];
    return {
      ...t, mark, last, size, qty: q, has, pnl, value,
      roe: has ? pnl / t.margin * 100 : null,
      move: has ? (mark / t.entry - 1) * 100 : null,
      slPct: (t.sl / t.entry - 1) * 100,
      liqPct: (t.liq / t.entry - 1) * 100,
      toSl: has ? (mark - t.sl) / mark * 100 : null,
      toLiq: has ? (mark - t.liq) / mark * 100 : null,
      lossSl: q * (t.sl - t.entry),
      chg24: tk.price24hPcnt != null ? parseFloat(tk.price24hPcnt) * 100 : null,
      high24: parseFloat(tk.highPrice24h) || null,
      low24: parseFloat(tk.lowPrice24h) || null,
      funding: isFinite(fr) ? fr * 100 : null,
      fundingDay: isFinite(fr) && has ? -value * fr * (24 / fInt) : null,
      ...athFields(t, q, mark),
      closes,
      chg7d: closes.length > 1 && has ? (mark / closes[0] - 1) * 100 : null
    };
  }

  function athFields(t, q, mark) {
    const live = state.ath[t.symbol];
    const ath = live ? live.ath : t.ath, athDate = live ? live.date : t.athDate;
    if (!(ath > 0)) return { ath: null };
    const athPnl = q * (ath - t.entry);
    return {
      ath, athDate, athX: ath / t.entry, athPnl,
      athMarginX: (t.margin + athPnl) / t.margin,
      toAth: mark != null ? (ath / mark - 1) * 100 : null,
      athProgress: mark != null ? Math.max(0, Math.min(1, (mark - t.entry) / (ath - t.entry))) : 0
    };
  }
  const monthYear = (d) => { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('nl-NL', { month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  const xf = (v) => v == null || !isFinite(v) ? '—' : (v >= 100 ? NF[0] : v >= 10 ? NF[1] : NF[2]).format(v) + 'x';

  /* ---------- tiles: built once, then only attributes and text change ---------- */
  const tileEls = {};
  function buildTiles() {
    const box = $('tiles');
    TRADES.forEach((t) => {
      const el = document.createElement('article');
      el.className = 'tile';
      el.id = 'tile-' + t.symbol;
      el.innerHTML = `
        <div class="t-top">
          <div class="t-name">${esc(t.name)}<span class="badge">${esc(t.leverage)}x Long</span></div>
          <span class="t-chg" data-k="chg">—</span>
        </div>
        <div>
          <div class="t-price" data-k="price">—</div>
          <div class="t-last" data-k="last">&nbsp;</div>
        </div>
        <div class="t-pnl"><b data-k="pnl">—</b><span data-k="roe">—</span></div>
        <div>
          <svg class="spark" viewBox="0 0 100 52" preserveAspectRatio="none" role="img" aria-label="${esc(t.name)} koers 7 dagen">
            <defs><linearGradient id="g-${esc(t.symbol)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-opacity=".28"/><stop offset="1" stop-opacity="0"/></linearGradient></defs>
            <polygon data-k="sArea" fill="url(#g-${esc(t.symbol)})" points=""/>
            <line data-k="sEntry" x1="0" x2="100" stroke="var(--ref)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" visibility="hidden"/>
            <polyline data-k="sLine" fill="none" stroke-width="1.75" stroke-linejoin="round" vector-effect="non-scaling-stroke" points=""/>
          </svg>
          <div class="spark-cap"><span>7d <b data-k="chg7d">—</b></span><span data-k="range7d">—</span></div>
        </div>
        <div class="t-ath">
          <div class="ath-head"><b>ATH-doel</b><span data-k="athLabel">—</span></div>
          <div class="ath-bar" role="img" data-k="athBarWrap"><i data-k="athBar"></i></div>
          <div class="ath-grid">
            <div><b data-k="athX">—</b><small>vanaf entry</small></div>
            <div><b class="up" data-k="athPnl">—</b><small>USDT PnL</small></div>
            <div><b data-k="athMx">—</b><small>op je marge</small></div>
          </div>
          <div class="ath-foot" data-k="athFoot">—</div>
        </div>
        <div class="rail" data-k="rail" role="img">
          <div class="tr"></div><div class="zone" data-k="rZone"></div><div class="fill" data-k="rFill"></div>
          <div class="mk" data-k="rLiq" style="background:var(--down)"></div><div class="mk" data-k="rSl" style="background:var(--warn)"></div>
          <div class="en" data-k="rEntry"></div><div class="dot" data-k="rDot"></div>
          <span class="lb" style="left:0">liq / SL</span><span class="lb" data-k="rEntryLb" style="transform:translateX(-50%)">entry</span>
        </div>
        <dl class="dl">
          <div><dt>Entry</dt><dd>${price(t.entry)}</dd></div>
          <div><dt>Vs entry</dt><dd data-k="move">—</dd></div>
          <div><dt>Stop-loss</dt><dd>${price(t.sl)}</dd></div>
          <div><dt>Tot SL</dt><dd data-k="toSl">—</dd></div>
          <div><dt>Liquidatie</dt><dd>${price(t.liq)}</dd></div>
          <div><dt>Tot liq</dt><dd data-k="toLiq">—</dd></div>
          <div><dt>Marge</dt><dd>${NF[0].format(t.margin)}</dd></div>
          <div><dt>Grootte</dt><dd>${NF[0].format(t.margin * t.leverage)}</dd></div>
          <div><dt>Aantal</dt><dd>${qty(t.margin * t.leverage / t.entry)}</dd></div>
          <div><dt>Nu waard</dt><dd data-k="value">—</dd></div>
          <div><dt>24u laag</dt><dd data-k="low24">—</dd></div>
          <div><dt>24u hoog</dt><dd data-k="high24">—</dd></div>
          <div><dt>Funding</dt><dd data-k="funding">—</dd></div>
          <div><dt>Funding/dag</dt><dd data-k="fundDay">—</dd></div>
          <div><dt>Verlies SL</dt><dd class="down">${usd(t.margin * t.leverage / t.entry * (t.sl - t.entry), false)}</dd></div>
          <div><dt>Marge weg</dt><dd class="down">${pct(-(t.sl - t.entry) / t.entry * t.leverage * 100)}</dd></div>
        </dl>`;
      const refs = {};
      el.querySelectorAll('[data-k]').forEach((n) => { refs[n.dataset.k] = n; });
      refs.stops = el.querySelectorAll('stop');
      tileEls[t.symbol] = { el, refs };
      box.appendChild(el);
    });
  }

  function updateSpark(refs, r) {
    const s = r.mark != null ? [...r.closes, r.mark] : r.closes;
    if (s.length < 2) return;
    const lo = Math.min(...s), hi = Math.max(...s), span = hi - lo || 1;
    const y = (v) => (48 - (v - lo) / span * 44).toFixed(2);
    const pts = s.map((v, i) => (i / (s.length - 1) * 100).toFixed(2) + ',' + y(v)).join(' ');
    const col = (r.chg7d ?? 0) >= 0 ? 'var(--up)' : 'var(--down)';
    setAttr(refs.sLine, 'points', pts);
    setAttr(refs.sArea, 'points', '0,52 ' + pts + ' 100,52');
    setStyle(refs.sLine, 'stroke', col);
    refs.stops.forEach((st) => setStyle(st, 'stopColor', col));
    const inRange = r.entry >= lo && r.entry <= hi;
    setAttr(refs.sEntry, 'visibility', inRange ? 'visible' : 'hidden');
    if (inRange) { setAttr(refs.sEntry, 'y1', y(r.entry)); setAttr(refs.sEntry, 'y2', y(r.entry)); }
  }

  function updateRail(refs, r) {
    if (r.move == null) return;
    const lo = r.liqPct - 3, hi = Math.max(r.move, 0) + 6;
    const p = (v) => ((v - lo) / (hi - lo) * 100).toFixed(2) + '%';
    setStyle(refs.rZone, 'left', p(r.liqPct));
    setStyle(refs.rZone, 'width', `calc(${p(r.slPct)} - ${p(r.liqPct)} + 3px)`);
    setStyle(refs.rFill, 'left', p(Math.min(0, r.move)));
    setStyle(refs.rFill, 'width', (Math.abs(r.move) / (hi - lo) * 100).toFixed(2) + '%');
    setStyle(refs.rFill, 'background', r.move >= 0 ? 'var(--up)' : 'var(--down)');
    setStyle(refs.rLiq, 'left', p(r.liqPct));
    setStyle(refs.rSl, 'left', p(r.slPct));
    setStyle(refs.rEntry, 'left', p(0));
    setStyle(refs.rEntryLb, 'left', p(0));
    setStyle(refs.rDot, 'left', p(r.move));
    setAttr(refs.rail, 'aria-label', `${r.name}: ${pct(r.move, true)} vanaf entry, SL op ${pct(r.slPct, true)}, liquidatie op ${pct(r.liqPct, true)}`);
  }

  function updateTile(r) {
    const { el, refs } = tileEls[r.symbol];
    const prev = state.shown[r.symbol];
    setText(refs.price, price(r.mark));
    if (prev != null && r.mark != null && r.mark !== prev) {
      refs.price.classList.remove('flash-up', 'flash-down');
      void refs.price.offsetWidth;
      refs.price.classList.add(r.mark > prev ? 'flash-up' : 'flash-down');
    }
    state.shown[r.symbol] = r.mark;
    setText(refs.last, r.last != null ? 'Laatste trade ' + price(r.last) : ' ');
    setText(refs.chg, pct(r.chg24, true) + ' 24u', 't-chg ' + tone(r.chg24));
    setText(refs.pnl, usd(r.pnl), tone(r.pnl));
    setText(refs.roe, 'ROE ' + pct(r.roe, true), tone(r.roe));
    setText(refs.chg7d, pct(r.chg7d, true), tone(r.chg7d));
    if (r.closes.length) setText(refs.range7d, price(Math.min(...r.closes)) + ' – ' + price(Math.max(...r.closes)));
    setText(refs.move, pct(r.move, true), tone(r.move));
    setText(refs.toSl, pct(r.toSl), r.toSl != null && r.toSl < NEAR_SL ? 'down' : '');
    setText(refs.toLiq, pct(r.toLiq));
    setText(refs.value, r.value == null ? '—' : NF[0].format(r.value));
    setText(refs.low24, price(r.low24));
    setText(refs.high24, price(r.high24));
    setText(refs.funding, r.funding == null ? '—' : sign(r.funding) + NF[4].format(Math.abs(r.funding)) + '%');
    setText(refs.fundDay, usd(r.fundingDay, false), tone(r.fundingDay));
    updateSpark(refs, r);
    updateRail(refs, r);
    if (r.ath) {
      setText(refs.athLabel, price(r.ath) + (r.athDate ? ' (' + monthYear(r.athDate) + ')' : ''));
      setText(refs.athX, xf(r.athX));
      setText(refs.athPnl, (r.athPnl >= 0 ? '+' : '-') + NF[0].format(Math.abs(r.athPnl)));
      setText(refs.athMx, xf(r.athMarginX));
      setStyle(refs.athBar, 'width', (r.athProgress * 100).toFixed(1) + '%');
      setAttr(refs.athBarWrap, 'aria-label', `${NF[0].format(r.athProgress * 100)}% van de weg van entry naar ATH`);
      setText(refs.athFoot, r.toAth == null ? '—' : r.toAth > 0 ? `Nog ${pct(r.toAth, true)} tot de ATH` + (r.athProgress > 0 ? `, ${NF[0].format(r.athProgress * 100)}% van de weg vanaf je entry` : '') : 'Boven de ATH!');
    }
    el.classList.toggle('near', r.toSl != null && r.toSl < NEAR_SL);
  }

  function sortRows(rows) {
    const by = {
      pnl: (a, b) => (b.pnl ?? -1e12) - (a.pnl ?? -1e12),
      risk: (a, b) => (a.toSl ?? 1e9) - (b.toSl ?? 1e9),
      day: (a, b) => (b.chg24 ?? -1e9) - (a.chg24 ?? -1e9)
    }[state.sort];
    return by ? [...rows].sort(by) : rows;
  }

  /* ---------- summary ---------- */
  function updateSummary(rows) {
    const live = rows.filter((r) => r.has);
    const sum = (k, rs = rows) => rs.reduce((a, r) => a + (r[k] || 0), 0);
    const margin = sum('margin'), pnl = sum('pnl', live), roe = margin ? pnl / margin * 100 : null;
    const loss = sum('lossSl');
    setText($('h-margin'), usd0(margin));
    if (!live.length) return;
    setText($('h-pnl'), usd(pnl, false));
    setAttr($('h-pnl-wrap'), 'class', 'hero-pnl ' + tone(pnl));
    setText($('h-roe'), pct(roe, true), 'chip ' + tone(roe));
    const glow = pnl >= 0 ? 'rgba(52,224,161,.16)' : 'rgba(255,84,112,.16)';
    const hero = document.querySelector('.hero');
    if (hero.style.getPropertyValue('--glow') !== glow) hero.style.setProperty('--glow', glow);
    setText($('k-size'), usd0(sum('size')));
    setText($('k-value'), usd0(sum('value', live)));
    setText($('k-winners'), String(live.filter((r) => r.pnl > 0).length));
    setText($('k-loss'), usd(loss));
    setText($('k-losspct'), pct(-loss / margin * 100));
    const athRows = rows.filter((r) => r.ath);
    if (athRows.length === rows.length) {
      const athPnl = sum('athPnl', athRows);
      setText($('k-athpnl'), '+' + usd0(athPnl).replace(/^-/, ''), athPnl >= 0 ? 'up' : 'down');
      setText($('k-athval'), usd0(margin + athPnl));
      setText($('k-athx'), xf((margin + athPnl) / margin));
    }
    const fd = live.every((r) => r.fundingDay != null) ? sum('fundingDay', live) : null;
    setText($('k-fund'), usd(fd), tone(fd));
    const near = live.reduce((a, r) => (a == null || r.toSl < a.toSl ? r : a), null);
    const best = live.reduce((a, r) => (a == null || r.roe > a.roe ? r : a), null);
    const worst = live.reduce((a, r) => (a == null || r.roe < a.roe ? r : a), null);
    $('h-msg').hidden = true; $('h-line').hidden = false;
    setText($('l-near'), near.name);
    setText($('l-nearpct'), pct(near.toSl), near.toSl < NEAR_SL ? 'down' : '');
    setText($('l-best'), best.name + ' ' + pct(best.roe, true), tone(best.roe));
    setText($('l-worst'), worst.name + ' ' + pct(worst.roe, true), tone(worst.roe));
  }

  /* ---------- ladder chart: rebuilt only when width, scale or order changes ---------- */
  let ladder = null;
  function drawLadder(rows) {
    const el = $('ladder');
    const data = rows.filter((r) => r.move != null);
    if (!data.length) { if (!ladder) el.innerHTML = '<p class="muted">Wacht op koersen…</p>'; return; }
    const W = el.clientWidth, rowH = 44, m = { t: 26, r: 64, b: 8, l: 86 };
    const H = m.t + data.length * rowH + m.b;
    const vals = data.flatMap((r) => [r.liqPct, r.move]);
    let d0 = Math.min(-24, Math.min(...vals) - 2), d1 = Math.max(8, Math.max(...vals) + 3);
    const step = (d1 - d0) / (W < 520 ? 4 : 8) > 5 ? 10 : 5;
    d0 = Math.floor(d0 / step) * step; d1 = Math.ceil(d1 / step) * step;
    const x = (v) => m.l + (v - d0) / (d1 - d0) * (W - m.l - m.r);
    const y = (i) => m.t + i * rowH + rowH / 2;
    const key = [W, d0, d1, step, data.map((r) => r.symbol).join()].join('|');

    if (!ladder || ladder.key !== key) {
      const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
      for (let v = d0; v <= d1 + 1e-9; v += step) {
        svg.appendChild(svgEl('line', { x1: x(v), x2: x(v), y1: m.t - 6, y2: H - m.b, stroke: v === 0 ? 'var(--ref)' : 'var(--line)', 'stroke-dasharray': v === 0 ? '4 3' : 'none' }));
        const t = svgEl('text', { class: 'tk', x: x(v), y: m.t - 11, 'text-anchor': 'middle' }); t.textContent = (v > 0 ? '+' : '') + v + '%'; svg.appendChild(t);
      }
      const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true;
      const refs = data.map((r, i) => {
        const yy = y(i), g = svgEl('g', {});
        g.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, stroke: 'var(--line2)', 'stroke-width': 6, 'stroke-linecap': 'round' }));
        g.appendChild(svgEl('rect', { x: x(r.liqPct), y: yy - 9, width: Math.max(3, x(r.slPct) - x(r.liqPct)), height: 18, rx: 3, fill: 'var(--down-bg)' }));
        g.appendChild(svgEl('line', { x1: x(r.liqPct), x2: x(r.liqPct), y1: yy - 10, y2: yy + 10, stroke: 'var(--down)', 'stroke-width': 2.5 }));
        g.appendChild(svgEl('line', { x1: x(r.slPct), x2: x(r.slPct), y1: yy - 10, y2: yy + 10, stroke: 'var(--warn)', 'stroke-width': 2.5 }));
        const fill = svgEl('line', { x1: x(0), y1: yy, y2: yy, 'stroke-width': 6, 'stroke-linecap': 'round' });
        const dot = svgEl('circle', { cy: yy, r: 6.5, fill: 'var(--ink)', stroke: 'var(--panel)', 'stroke-width': 2.5 });
        const name = svgEl('text', { x: 0, y: yy + 4, 'font-weight': 600 }); name.textContent = r.name;
        const val = svgEl('text', { x: W, y: yy + 4, 'text-anchor': 'end' });
        const hit = svgEl('rect', { x: 0, y: yy - rowH / 2, width: W, height: rowH, fill: 'transparent' });
        g.append(fill, dot, name, val, hit);
        hit.addEventListener('pointerenter', () => {
          const d = ladder.data[i];
          tip.innerHTML = `<b>${esc(d.name)}</b>Mark: ${price(d.mark)}<br>Vs entry: ${pct(d.move, true)}<br>PnL: ${usd(d.pnl)}<br>Tot SL: ${pct(d.toSl)}<br>Tot liquidatie: ${pct(d.toLiq)}`;
          tip.hidden = false;
          const tw = tip.offsetWidth;
          tip.style.left = Math.max(0, Math.min(W - tw, x(d.move) - tw / 2)) + 'px';
          tip.style.top = (yy + 14) + 'px';
        });
        hit.addEventListener('pointerleave', () => { tip.hidden = true; });
        svg.appendChild(g);
        return { fill, dot, val };
      });
      el.replaceChildren(svg, tip);
      ladder = { key, refs };
    }
    ladder.data = data;
    data.forEach((r, i) => {
      const c = r.move >= 0 ? 'var(--up)' : 'var(--down)', f = ladder.refs[i];
      setAttr(f.fill, 'x2', x(r.move).toFixed(1)); setAttr(f.fill, 'stroke', c);
      setAttr(f.dot, 'cx', x(r.move).toFixed(1));
      setAttr(f.val, 'fill', c);
      if (f.val.textContent !== pct(r.move, true)) f.val.textContent = pct(r.move, true);
    });
  }

  /* ---------- scenario ---------- */
  let scen = null;
  function drawScenario(rows) {
    const k = state.move / 100;
    setText($('s-pct'), pct(state.move, true));
    const res = rows.filter((r) => r.has).map((r) => {
      const np = r.mark * (1 + k), hit = np <= r.sl;
      return { name: r.name, hit, pnl: hit ? r.lossSl : r.qty * (np - r.entry) };
    });
    if (!res.length) return;
    const total = res.reduce((a, r) => a + r.pnl, 0), hits = res.filter((r) => r.hit);
    setText($('s-pnl'), usd(total), 'scen-big ' + tone(total));
    setText($('s-stops'), 'Totale PnL in dit scenario. ' + (hits.length ? `${hits.length} stop-loss${hits.length > 1 ? 'es' : ''} geraakt: ${hits.map((h) => h.name).join(', ')}.` : 'Geen stop-loss geraakt.'));
    const key = res.map((r) => r.name).join();
    const box = $('s-bars');
    if (!scen || scen.key !== key) {
      box.innerHTML = res.map((r) => `<div class="sb"><span>${esc(r.name)}</span><div class="sb-tr"><div class="sb-fill"></div></div><span class="sb-val"></span></div>`).join('');
      scen = { key, fills: box.querySelectorAll('.sb-fill'), vals: box.querySelectorAll('.sb-val') };
    }
    const max = Math.max(1, ...res.map((r) => Math.abs(r.pnl)));
    res.forEach((r, i) => {
      const w = Math.abs(r.pnl) / max * 50, f = scen.fills[i];
      setStyle(f, 'width', w.toFixed(2) + '%');
      setStyle(f, 'left', (r.pnl >= 0 ? 50 : 50 - w).toFixed(2) + '%');
      setStyle(f, 'background', r.pnl >= 0 ? 'var(--up)' : 'var(--down)');
      setStyle(f, 'opacity', r.hit ? '0.5' : '1');
      setText(scen.vals[i], (r.hit ? 'SL ' : '') + usd(r.pnl, false), 'sb-val ' + tone(r.pnl));
    });
  }

  /* ---------- table: rows built once per order, cells updated in place ---------- */
  const COLS = [
    ['name', 'Munt', (r) => r.name, () => ''],
    ['mark', 'Mark', (r) => price(r.mark), () => ''],
    ['chg24', '24u', (r) => pct(r.chg24, true), (r) => tone(r.chg24)],
    ['entry', 'Entry', (r) => price(r.entry), () => ''],
    ['pnl', 'PnL', (r) => usd(r.pnl, false), (r) => tone(r.pnl)],
    ['roe', 'ROE', (r) => pct(r.roe, true), (r) => tone(r.roe)],
    ['toSl', 'Tot SL', (r) => pct(r.toSl), (r) => (r.toSl != null && r.toSl < NEAR_SL ? 'down' : '')],
    ['toLiq', 'Tot liq', (r) => pct(r.toLiq), () => ''],
    ['lossSl', 'Verlies bij SL', (r) => usd(r.lossSl, false), () => 'down'],
    ['margin', 'Marge', (r) => NF[0].format(r.margin), () => '']
  ];
  let table = null;
  function drawTable(rows) {
    const tb = $('rows');
    const key = rows.map((r) => r.symbol).join();
    if (!table || table.key !== key) {
      tb.innerHTML = rows.map(() => '<tr>' + COLS.map((c, j) => `<td${j ? ` data-l="${esc(c[1])}"` : ''}></td>`).join('') + '</tr>').join('');
      table = { key, cells: [...tb.rows].map((tr) => [...tr.cells]) };
    }
    rows.forEach((r, i) => COLS.forEach((c, j) => setText(table.cells[i][j], c[2](r), c[3](r))));
  }

  /* ---------- render loop ---------- */
  let pending = false, lastOrder = '';
  function render() {
    pending = false;
    const rows = TRADES.map(calc);
    rows.forEach(updateTile);
    const sorted = sortRows(rows);
    const order = sorted.map((r) => r.symbol).join();
    if (order !== lastOrder) {
      lastOrder = order;
      const box = $('tiles');
      sorted.forEach((r) => box.appendChild(tileEls[r.symbol].el));
    }
    updateSummary(rows);
    drawLadder(sorted);
    drawScenario(sorted);
    drawTable(sorted);
    updateStatus();
  }
  function schedule() { if (!pending) { pending = true; setTimeout(() => requestAnimationFrame(render), 400); } }

  function updateStatus() {
    const st = $('status');
    let s = 'connecting', text = 'Verbinden…';
    const fresh = Date.now() - state.lastTick < 30000;
    if (state.wsOpen && fresh) { s = 'live'; text = 'Live'; }
    else if (state.restOk && fresh) { s = 'poll'; text = 'Elke 10s'; }
    else if (state.lastTick) { s = 'offline'; text = 'Geen verbinding'; }
    else if (Date.now() - START > 15000) {
      s = 'offline'; text = 'Bybit niet bereikbaar';
      setText($('h-msg'), 'Bybit reageert niet. Controleer je verbinding; de pagina blijft het opnieuw proberen.');
    }
    if (st.dataset.state !== s) st.dataset.state = s;
    setText($('status-text'), text);
    if (state.lastTick) setText($('updated'), 'Bijgewerkt ' + new Date(state.lastTick).toLocaleTimeString('nl-NL'));
  }

  /* ---------- Bybit REST ---------- */
  async function getJson(path) {
    let err;
    for (const host of REST_HOSTS) {
      try {
        const res = await fetch(host + path, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        if (j.retCode !== 0) throw new Error(j.retMsg || 'Bybit fout');
        return j.result;
      } catch (e) { err = e; }
    }
    throw err;
  }
  async function loadTickers() {
    const results = await Promise.allSettled(TRADES.map((t) => getJson('/v5/market/tickers?category=linear&symbol=' + t.symbol)));
    let ok = false;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.list && r.value.list[0]) {
        state.tickers[TRADES[i].symbol] = { ...state.tickers[TRADES[i].symbol], ...r.value.list[0] };
        ok = true;
      }
    });
    if (ok) { state.restOk = true; state.lastTick = Date.now(); schedule(); }
    return ok;
  }
  async function loadKlines() {
    await Promise.allSettled(TRADES.map(async (t) => {
      const r = await getJson(`/v5/market/kline?category=linear&symbol=${t.symbol}&interval=240&limit=42`);
      state.closes[t.symbol] = (r.list || []).slice().reverse().map((c) => parseFloat(c[4])).filter(isFinite);
    }));
    schedule();
  }

  /* ---------- ATH (CoinGecko, valt terug op trades.js) ---------- */
  async function loadAth() {
    const ids = [...new Set(TRADES.map((t) => t.coingecko).filter(Boolean))];
    if (!ids.length) return;
    const res = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + ids.join(','), { cache: 'no-store' });
    if (!res.ok) return;
    const list = await res.json();
    TRADES.forEach((t) => {
      const c = Array.isArray(list) && list.find((x) => x.id === t.coingecko);
      if (c && c.ath > 0) state.ath[t.symbol] = { ath: c.ath * (t.cgMult || 1), date: c.ath_date };
    });
    schedule();
  }

  /* ---------- Bybit WebSocket ---------- */
  let backoff = 1000, pingTimer = null;
  function connect() {
    let ws;
    try { ws = new WebSocket(WS_URL); } catch (e) { return retry(); }
    state.ws = ws;
    ws.onopen = () => {
      state.wsOpen = true; backoff = 1000;
      ws.send(JSON.stringify({ op: 'subscribe', args: TRADES.map((t) => 'tickers.' + t.symbol) }));
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { if (ws.readyState === 1) ws.send('{"op":"ping"}'); }, 20000);
      updateStatus();
    };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg.topic || !msg.topic.startsWith('tickers.') || !msg.data) return;
      const sym = msg.data.symbol || msg.topic.slice(8);
      state.tickers[sym] = { ...(state.tickers[sym] || {}), ...msg.data };
      state.lastTick = Date.now();
      if (!document.hidden) schedule();
    };
    ws.onclose = () => { state.wsOpen = false; clearInterval(pingTimer); updateStatus(); retry(); };
    ws.onerror = () => { try { ws.close(); } catch (e) { /* noop */ } };
  }
  function retry() { setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 30000); }

  /* ---------- controls ---------- */
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    state.sort = b.dataset.sort;
    document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render();
  }));
  const slider = $('move');
  const setMove = (v) => { state.move = v; slider.value = v; drawScenario(sortRows(TRADES.map(calc))); };
  slider.addEventListener('input', () => setMove(+slider.value));
  document.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => setMove(+b.dataset.move)));
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; schedule(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });

  /* ---------- start ---------- */
  buildTiles();
  render();
  loadTickers().catch(() => {});
  loadKlines().catch(() => {});
  loadAth().catch(() => {});
  connect();
  // REST-terugval als de WebSocket niet werkt, en candles elke 15 min verversen
  setInterval(() => { if (!state.wsOpen && !document.hidden) loadTickers().catch(() => {}); }, 10000);
  setInterval(() => { if (!document.hidden) loadKlines().catch(() => {}); }, 15 * 60 * 1000);
  setInterval(() => { if (!document.hidden) loadAth().catch(() => {}); }, 30 * 60 * 1000);
  setInterval(updateStatus, 5000);
})();
