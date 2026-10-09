# Walkthrough — White Vision Analytics Dashboard

## 2026-10-09 (Google Ads-koppeling via Windsor.ai)

- Findings: Google Ads-cijfers werden handmatig door Admin ingevuld op de tab
  (klikken, kosten, kost per klik) en kwamen uit Strato rankingcoach; de
  data stond in `data/google-ads.json`. Voor de week-/maandrapporten was dat
  één vaste snapshot zonder periode. Na vergelijking van Windsor.ai, Composio
  en de directe Google Ads API viel de keuze op Windsor: geen developer token
  of MCC-review nodig, slechts een API-key, en `date_from`/`date_to` levert
  meteen de juiste periode.
- Conclusions: Windsor als bron, met het oude bestand als fallback wanneer de
  key ontbreekt. De tab toont de afgelopen volledige week (ma–zo, dezelfde
  range als het weekrapport) met KPI's plus een tabel per campagne. Het
  handmatige invulformulier en `PUT /api/google-ads` zijn verwijderd. Er is een
  korte cache (1 uur) toegevoegd zodat tab en rapporten de connector niet
  onnodig bevragen. De `spend`-waarde van Windsor is al in euro's (geen
  micros), dus CPC = spend / klikken.
- Actions: nieuw `lib/google-ads.js` (Windsor-call, per campagne gegroepeerd,
  defensieve parsing van de JSON-vorm); `index.js` — Windsor-module
  geïmporteerd, `readGoogleAds()` async + periode-bewust met fallback, `GET
  /api/google-ads` accepteert `?from=&to=`, `PUT` verwijderd; `weekly-report.js`
  en `monthly-report.js` — `await readGoogleAds(ranges.current)` op alle drie
  de call-sites per bestand; `public/index.html` — invulformulier vervangen
  door campagnetabel; `public/app.js` — `loadGoogleAds()` herschreven +
  `renderGaCampaigns()`, formulier/`setGoogleAdsStatus` weg, widget-info
  bijgewerkt, `gaCampaigns` toegevoegd; `.env.example` + README bijgewerkt;
  `node --check` op alle gewijzigde JS en een losse test van de Windsor-parsing
  geslaagd. Nog te valideren zodra `WINDSOR_API_KEY` is ingevuld: dat
  `date_from`/`date_to` inclusief is en dat de campagne-veldnaam `campaign`
  klopt.
