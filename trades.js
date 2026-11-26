// Jouw posities. Pas hier entry, SL, liquidatieprijs of marge aan; de site rekent de rest uit.
// symbol = Bybit USDT-perpetual (linear) symbool.
// ath / athDate = all-time high (startwaarde; de site haalt de actuele ATH live op bij CoinGecko).
// coingecko = id voor de ntfy-meldingen (GitHub Actions draait in de VS, waar Bybit geblokkeerd is).
window.TRADES = [
  { name: 'BTC',      symbol: 'BTCUSDT',      entry: 63200,     sl: 51000,   liq: 50727,    margin: 506, leverage: 5, coingecko: 'bitcoin', ath: 126080, athDate: '2025-10-06' },
  { name: 'ETH',      symbol: 'ETHUSDT',      entry: 1794,      sl: 1450,    liq: 1440,     margin: 302, leverage: 5, coingecko: 'ethereum', ath: 4946.05, athDate: '2025-08-24' },
  { name: 'SOL',      symbol: 'SOLUSDT',      entry: 71.07,     sl: 57.5,    liq: 57.3,     margin: 323, leverage: 5, coingecko: 'solana', ath: 293.31, athDate: '2025-01-19' },
  { name: 'HYPE',     symbol: 'HYPEUSDT',     entry: 63.72,     sl: 51.8,    liq: 51.7,     margin: 294, leverage: 5, coingecko: 'hyperliquid', ath: 97.96, athDate: '2026-09-23' },
  { name: 'LINK',     symbol: 'LINKUSDT',     entry: 8.98,      sl: 7.35,    liq: 7.3,      margin: 243, leverage: 5, coingecko: 'chainlink', ath: 52.7, athDate: '2021-05-09' },
  { name: 'ONDO',     symbol: 'ONDOUSDT',     entry: 0.2921,    sl: 0.238,   liq: 0.2371,   margin: 231, leverage: 5, coingecko: 'ondo-finance', ath: 2.14, athDate: '2024-12-15' },
  { name: '1000PEPE', symbol: '1000PEPEUSDT', entry: 0.0037891, sl: 0.00307, liq: 0.003059, margin: 249, leverage: 5, coingecko: 'pepe', cgMult: 1000, ath: 0.02803, athDate: '2024-12-09' },
  { name: 'QNT',      symbol: 'QNTUSDT',      entry: 150,       sl: 122,     liq: 121.22,   margin: 150, leverage: 5, coingecko: 'quant-network', ath: 427.42, athDate: '2021-09-11' }
];
