// Jouw posities. Pas hier entry, SL, liquidatieprijs of marge aan; de site rekent de rest uit.
// symbol = Bybit USDT-perpetual (linear) symbool.
// ath / athDate = all-time high (startwaarde; de site haalt de actuele ATH live op bij CoinGecko).
// tps = take-profit plan: prijs en % van de positie dat je daar verkoopt (voorbeeldwaarden, pas aan).
// opened = exact vulmoment (optioneel, gaat voor ORDERS_PLACED).
// coingecko = id voor de ntfy-meldingen (GitHub Actions draait in de VS, waar Bybit geblokkeerd is).
// Datum waarop je de limit orders plaatste ('JJJJ-MM-DD'). De site zoekt dan zelf per munt het eerste uur
// waarin de Bybit-koers je entry raakte (= vulmoment) en rekent vanaf daar de betaalde funding uit.
// Weet je het exacte vulmoment (Bybit > Orders > Geschiedenis), vul dan per positie 'opened' in; dat gaat voor.
window.ORDERS_PLACED = null;

window.TRADES = [
  { name: 'BTC',      symbol: 'BTCUSDT',      entry: 63200,     sl: 51000,   liq: 50727,    margin: 506, leverage: 5, coingecko: 'bitcoin', ath: 126080, athDate: '2025-10-06',
    opened: '2026-11-17T12:00:00Z', // uit Bybit: eerste funding 17-11 17:00 (NL-tijd), dus gevuld tussen 09:00 en 17:00
    tps: [{ label: 'TP1', price: 100000, pct: 25 }, { label: 'ATH', price: 126080, pct: 25 }, { label: 'Cyclus', price: 180000, pct: 50 }] },
  { name: 'ETH',      symbol: 'ETHUSDT',      entry: 1794,      sl: 1450,    liq: 1440,     margin: 302, leverage: 5, coingecko: 'ethereum', ath: 4946.05, athDate: '2025-08-24',
    opened: '2026-11-17T12:00:00Z', // uit Bybit: eerste funding 17-11 17:00 (NL-tijd), dus gevuld tussen 09:00 en 17:00
    tps: [{ label: '2x', price: 3588, pct: 25 }, { label: 'ATH', price: 4946, pct: 25 }, { label: 'Cyclus', price: 7060, pct: 50 }] },
  { name: 'SOL',      symbol: 'SOLUSDT',      entry: 71.07,     sl: 57.5,    liq: 57.3,     margin: 323, leverage: 5, coingecko: 'solana', ath: 293.31, athDate: '2025-01-19',
    opened: null, // exact vulmoment, bijv. '2026-11-19' of '2026-11-19T16:00:00Z' (optioneel)
    tps: [{ label: '2x', price: 142, pct: 25 }, { label: 'ATH', price: 293, pct: 25 }, { label: 'Cyclus', price: 418, pct: 50 }] },
  { name: 'HYPE',     symbol: 'HYPEUSDT',     entry: 63.72,     sl: 51.8,    liq: 51.7,     margin: 294, leverage: 5, coingecko: 'hyperliquid', ath: 97.96, athDate: '2026-09-23',
    opened: null, // exact vulmoment, bijv. '2026-11-19' of '2026-11-19T16:00:00Z' (optioneel)
    tps: [{ label: 'ATH', price: 98, pct: 25 }, { label: 'TP2', price: 120, pct: 25 }, { label: 'Cyclus', price: 140, pct: 50 }] },
  { name: 'LINK',     symbol: 'LINKUSDT',     entry: 8.98,      sl: 7.35,    liq: 7.3,      margin: 243, leverage: 5, coingecko: 'chainlink', ath: 52.7, athDate: '2021-05-09',
    opened: null, // exact vulmoment, bijv. '2026-11-19' of '2026-11-19T16:00:00Z' (optioneel)
    tps: [{ label: '2x', price: 18, pct: 25 }, { label: 'ATH', price: 52.7, pct: 25 }, { label: 'Cyclus', price: 75, pct: 50 }] },
  { name: 'ONDO',     symbol: 'ONDOUSDT',     entry: 0.2921,    sl: 0.238,   liq: 0.2371,   margin: 231, leverage: 5, coingecko: 'ondo-finance', ath: 2.14, athDate: '2024-12-15',
    opened: null, // exact vulmoment, bijv. '2026-11-19' of '2026-11-19T16:00:00Z' (optioneel)
    tps: [{ label: '2x', price: 0.58, pct: 25 }, { label: 'ATH', price: 2.14, pct: 25 }, { label: 'Cyclus', price: 3.05, pct: 50 }] },
  { name: '1000PEPE', symbol: '1000PEPEUSDT', entry: 0.0037891, sl: 0.00307, liq: 0.003059, margin: 249, leverage: 5, coingecko: 'pepe', cgMult: 1000, ath: 0.02803, athDate: '2024-12-09',
    opened: null, // exact vulmoment, bijv. '2026-11-19' of '2026-11-19T16:00:00Z' (optioneel)
    tps: [{ label: '2x', price: 0.0076, pct: 25 }, { label: 'ATH', price: 0.028, pct: 25 }, { label: 'Cyclus', price: 0.04, pct: 50 }] },
  { name: 'QNT',      symbol: 'QNTUSDT',      entry: 150,       sl: 122,     liq: 121.22,   margin: 150, leverage: 5, coingecko: 'quant-network', ath: 427.42, athDate: '2021-09-11',
    opened: null, // exact vulmoment, bijv. '2026-11-19' of '2026-11-19T16:00:00Z' (optioneel)
    tps: [{ label: '2x', price: 300, pct: 25 }, { label: 'ATH', price: 427, pct: 25 }, { label: 'Cyclus', price: 610, pct: 50 }] }
];
