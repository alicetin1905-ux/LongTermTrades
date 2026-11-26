# Long Trades

Live dashboard voor 8 long posities op 5x, met Bybit-koersen (USDT-perpetuals).

- **Live koersen** via de publieke Bybit WebSocket (markprijs), met REST als terugval.
- **Tegel per munt**: markprijs, 24u, PnL en ROE, 7-daagse grafiek met entry-lijn, rail met liquidatie / SL / entry, afstand tot SL en liq, funding, verlies bij SL.
- **Overzicht** van alle trades op één %-schaal, **scenario-schuif** (hele markt ±%) en een tabel.

## Posities aanpassen

Alles staat in [`trades.js`](trades.js). Pas entry, SL, liquidatieprijs, marge of hefboom aan, commit, en de site rekent de rest uit.

## Live zetten (GitHub Pages)

1. GitHub Pages werkt op een **privé** repo alleen met GitHub Pro/Team. Anders: maak de repo openbaar (je posities zijn dan zichtbaar) of gebruik Netlify / Vercel / Cloudflare Pages (gratis, werkt ook met privé repo's).
2. Ga naar **Settings → Pages → Build and deployment**.
3. Kies **Deploy from a branch**, branch `claude/dazzling-mccarthy-j97g8w` (of `main` na een merge), map `/ (root)`, en klik **Save**.
4. Na ±1 minuut staat de site op `https://alicetin1905-ux.github.io/LongTermTrades/`.

Lokaal openen kan ook: dubbelklik `index.html`.

> Bybit blokkeert zijn API in sommige landen (o.a. de VS). Vanuit Nederland/België werkt het normaal.

## ntfy-meldingen bij ±10% PnL

Een GitHub Action (`.github/workflows/ntfy.yml`) checkt elke 5 minuten je totale PnL en stuurt een
[ntfy](https://ntfy.sh)-melding zodra die met **10% van je totale marge** (≈ 230 USDT) is veranderd
sinds de vorige melding. Dit werkt ook als de website dicht is.

1. Installeer de ntfy-app (iOS/Android) en abonneer je op een eigen, moeilijk te raden topic, bijv. `longtrades-233db67089`.
   Iedereen die het topic kent kan je meldingen lezen, dus houd het geheim.
2. Ga op GitHub naar **Settings → Secrets and variables → Actions → New repository secret**:
   naam `NTFY_TOPIC`, waarde je topic.
3. Ga naar **Actions → ntfy PnL-melding → Run workflow** voor een testmelding.
4. Andere drempel? Maak onder **Variables** een variabele `NTFY_THRESHOLD` aan (bijv. `5`).

GitHub-servers staan in de VS, waar Bybit geblokkeerd is; de melding gebruikt daarom CoinGecko-spotprijzen
(wijkt meestal maar een paar tienden van een procent af van de Bybit markprijs).
