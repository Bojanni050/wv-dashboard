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

## 2026-10-09 (Lopende en afgesloten campagnes op de Google Ads-tab)

- Findings: de tab toonde alleen de afgelopen week per campagne. Bo wilde de
  historische cijfers van afgesloten campagnes én zien welke campagnes nu lopen
  met hun cijfers. Windsor's Google Ads-connector levert daarvoor de velden
  `campaign_status` (ENABLED/PAUSED/REMOVED), `start_date` en `end_date`
  (2037-12-30 = oneindig).
- Conclusions: één extra Windsor-query over de hele geschiedenis, naar campagne
  geaggregeerd (geen `date`-veld, dus geen losse dagrijen). Lopend = status
  ENABLED en einddatum niet voorbij; de rest is afgesloten. Voor lopende
  campagnes koos Bo voor totalen sinds de start (niet de week/30 dagen), zodat
  het naast de gesloten campagnes logisch staat. De week-KPI's bovenaan blijven.
- Actions: `lib/google-ads.js` — `request()`/cache-refactor, `summarize()`
  neemt nu `status`/`startDate`/`endDate` mee per campagne, nieuw
  `fetchCampaignOverview()` + `classifyCampaigns()`; `index.js` — `GET
  /api/google-ads` geeft naast de weekcijfers ook `activeCampaigns` en
  `closedCampaigns` (overview-fout laat alleen die twee tabellen leeg);
  `public/index.html` — één campagnetabel vervangen door "Lopende campagnes" en
  "Afgesloten campagnes" (met looptijd/periode-kolom); `public/app.js` —
  `renderCampaignTable()` + `campaignPeriod()`/`formatDateNL()`,
  `renderGaCampaigns` vervangen, widget-info gesplitst; `.env.example` +
  README bijgewerkt. `node --check` geslaagd en de parsing/classificatie
  getest met Bo's naslagcijfers (Campagne 1 → afgesloten, Campagne 2 → lopend,
  totalen en CPC kloppen). Nog te valideren op de VPS: dat Windsor
  `campaign_status`/`start_date`/`end_date` daadwerkelijk teruggeeft.
