# Walkthrough — White Vision Analytics Dashboard

## 2026-10-10 (tab Planning)

- Findings: de winteractie-campagnes (bruiloft en bedrijfsfeest, 25% korting op
  feestdata jan t/m mrt 2027) liepen zonder overzicht van planning en taken.
- Conclusions: een generieke tab **Planning** die uit één databestand rendert,
  zodat hij ook voor volgende acties bruikbaar is. Live cijfers blijven op de tab
  Google Ads; deze tab toont campagnestatus en budget (handmatig), een tijdlijn
  met vandaag-lijn en een takenlijst.
- Actions: `lib/planning.js` (titel, campagnes, planning, taken; handmatig
  bijhouden en deployen), `GET /api/planning` (basic auth), tab + view in
  `public/index.html`, render in `public/app.js`, stijlen `pl-*` in
  `public/styles.css`.
- Admins kunnen een taak met één klik op de status op Gedaan of terug op Open
  zetten (`PUT /api/planning/tasks/:id`, alleen admin). De wijziging staat in
  `data/planning-state.json` (volume `./data`) en wint van de status in
  `lib/planning.js`. Kijkers zien de status, maar kunnen hem niet wijzigen.

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

## 2026-10-09 (Google Ads-KPI's volgen de periodeselector)

- Findings: de bovenste Google Ads-tegels stonden vast op de afgelopen week,
  terwijl de Paid Ads/Conversie-tegels en de rest van het dashboard de
  periodeselector volgden. Bo wilde die twee Paid Ads-tegels boven de
  campagnetabellen, en de bovenste vijf tegels allemaal aan de geselecteerde
  periode laten hangen.
- Conclusions: `GET /api/google-ads` accepteert nu dezelfde `range`/`compare`/
  `start`/`end`-parameters als `/api/analytics` (via de bestaande
  `resolveRangeParam` + `getRanges`), haalt de huidige én de vergelijkingsperiode
  op en geeft `previous` + `changes` terug, zodat de drie Windsor-tegels dezelfde
  "(vorige) + %"-opmaak krijgen als de rest. De campagnetabellen blijven
  levensduur-totalen en bewegen dus bewust niet mee met de periode.
- Actions: `index.js` — Google Ads-endpoint periode-bewust, `pctChange` op
  klikken/kosten/CPC, `previous`/`changes` in de respons; `public/index.html` —
  Paid Ads/Conversie-blok verplaatst naar boven de campagnetabellen, `kpi-change`
  toegevoegd aan de drie Windsor-tegels; `public/app.js` — `loadGoogleAds(range,
  compare, customRange)`, `setKpiValue`/`formatChangeEl` voor de drie tegels,
  `gaRangeLabel()` voor de periode in de ondertitel, aanroep vanuit `load()` en
  de lazy `googleAdsLoaded`-guard verwijderd; README bijgewerkt. `node --check`
  op alle gewijzigde JS geslaagd. Nog te valideren op de VPS: dat de Windsor-
  cijfers per periode kloppen t.o.v. Google Ads.

## 2026-10-13 (Vandaag vergelijken op hetzelfde tijdstip)

- Findings: Bij "Vandaag" werd de lopende dag (tot nu) vergeleken met de volledige vorige dag, waardoor alle deltas sterk negatief waren. Daarnaast levert GA4 voor de lopende dag engagement-cijfers (tijd, engagement, bounce) met vertraging, waardoor 0:00 / 0% / 100% getoond werd.
- Conclusions: Vergelijk de comparison-periode alleen tot hetzelfde uur (GA4-dimensie `hour`, Europe/Amsterdam) en toon een melding dat de engagement-cijfers voorlopig zijn. Geen wijziging voor andere periodes.
- Actions: index.js: `currentHourInReportTz`, `hourCapFilter`, `withHourCap`; `getRanges` zet `previous.hourCap` bij range 'today'; filter toegepast in fetchMetricsForRange, fetchChannels, fetchOfferteSessions, fetchSocialByPlatform, fetchDailySessions; response bevat `partialDay` en `compareUntilHour`. public/app.js + index.html + styles.css: melding onder kop Engagement en gedimde tegels bij partialDay. `node --check` geslaagd; nog te valideren tegen live GA4-data.

## 2026-10-29 (Formulierinzending 26 okt ontbrak in dashboard)

- Findings: GA4 had op 26 okt één `gforms_submission`, maar met kanaal "Unassigned" en 0 sessies; het dashboard telt de metric `sessions`, dus die inzending telde als 0. Op 27 en 28 okt vuurde alleen `form_submit` (geen `gforms_submission`), en dat event werd sinds 15 sept genegeerd.
- Conclusions: Na 15 sept beide events tellen in één query (inListFilter, dus één keer per sessie), en elke rij met minstens één event telt minimaal 1, ook als GA4 er geen sessie aan koppelt.
- Actions: index.js: `offerteEventParts` geeft nu `events`-lijsten; `fetchOfferteSessions` gebruikt `inListFilter`, vraagt ook `eventCount` op en telt `max(sessions, events>0 ? 1 : 0)`; `node --check` geslaagd. Gevalideerd tegen GA4-data via rapport (26/27/28 okt), nog niet tegen de live dashboard-output. Let op: of gforms_submission bij elke echte inzending vuurt is niet vastgesteld (27 en 28 okt waren testinzendingen); alleen vaststaand is dat de inzending van 26 okt zonder sessie binnenkwam.

## 2026-10-29 (Alleen gforms_submission tellen na 15 sept)

- Findings: De `form_submit`-events van 27 en 28 okt waren testinzendingen van Bo en horen niet mee te tellen.
- Conclusions: Na 15 sept weer alleen `gforms_submission`; de aanpassing voor inzendingen zonder sessie (26 okt) blijft staan.
- Actions: index.js `offerteEventParts`: events na de switchdatum is weer alleen `[OFFERTE_EVENT]`; `node --check` geslaagd.
