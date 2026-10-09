# White Vision Analytics Dashboard

Live dashboard: https://dashboard-wv.studiovanderheide.nl

## Auto-tagging validatie

Na het toevoegen van UTM-tags (of het inschakelen van auto-tagging) aan een
advertentie, valideer je dat het werkt via de sectie **"Offerteaanvragen per
campagne"** onderaan het dashboard:

1. Open https://dashboard-wv.studiovanderheide.nl en log in.
2. Wacht tot er minimaal één sessie via de betreffende ad is geweest.
3. Check de campagnetabel:
   - Staat de juiste campagnenaam in de tabel? → tagging werkt.
   - Staat de rij nog op `(referral)` of `(not set)`? → `utm_campaign`
     ontbreekt op de advertentie-URL, of de sessie is nog niet verwerkt door
     GA4 (kan enkele uren duren).

## Google Ads

De cijfers op de tab **Google Ads** (en in de week-/maandrapporten) komen
automatisch uit Google Ads via [Windsor.ai](https://windsor.ai) — niet meer
handmatig ingevuld. De tab toont de **afgelopen volledige week (ma–zo)**: KPI's
klikken / kosten / kost per klik en een tabel per campagne.

Instellen:

1. Maak een Windsor.ai-account en koppel daar één keer het Google Ads-account
   (OAuth) in hun dashboard.
2. Kopieer de Windsor API-key naar `WINDSOR_API_KEY` in `.env`.
3. Zet het Google Ads customer id (met streepjes, bijv. `307-043-6491`) in
   `WINDSOR_GOOGLE_ADS_ACCOUNT`. Optioneel als het Windsor-account maar één
   Ads-customer heeft.

Zonder `WINDSOR_API_KEY` valt het dashboard terug op het oude, handmatige
snapshot in `data/google-ads.json` (dat bestand wordt niet meer door de UI
bijgewerkt). Resultaten worden één uur gecacht, zodat de tab en de rapporten
niet bij elke weergave de connector bevragen.

## Lokaal draaien

```bash
docker compose up --build
```

Vereist `.env` (zie `.env.example`) en een GA4 `service-account.json` in de
project root. Standaard bereikbaar op de poort uit `.env` (`PORT`).

## AI-instellingen en weekrapport

Admin ziet een tab **AI-instellingen**: kies provider (Google Gemini, Eden AI of
OpenRouter), pas de base URL aan, vul de API-key in en haal de beschikbare
modellen op. Instellingen staan in `data/ai-settings.json` (API-keys worden
nooit naar de browser teruggestuurd).

Elke maandag (na 07:00 Amsterdamse tijd) maakt de server een PDF-weekrapport
van de vorige week (ma–zo, vergeleken met de week ervoor) met een door de AI
geschreven, verklarende inleiding. Het rapport verschijnt in de tab
**Rapporten**. Lukt de AI niet, dan wordt een standaardinleiding gebruikt.
Met "Weekrapport nu maken" kan admin het handmatig testen.

Optioneel maakt de server ook, elke 1e van de maand (na 08:00 Amsterdamse
tijd), een **maandrapport**: dezelfde opzet als het weekrapport maar over de
volledige vorige kalendermaand (vergeleken met de maand ervoor), met twee
extra secties omdat een maand meer om over te rapporteren geeft: **sessies
per week** binnen de maand en de **populairste pagina's**. Ook dit rapport
verschijnt in de tab **Rapporten**. Aan/uit via de checkbox in
AI-instellingen; "Maandrapport nu maken" test het handmatig.

## Actiepunten per mail (niet op de site)

Los van de PDF-rapporten in **Rapporten** kan de server elke maandag en elke
1e van de maand een kort **actiepunten-rapport** mailen: een door de AI
geschreven, genummerde lijst van 4–8 concrete verbeterpunten op basis van de
cijfers van die periode, plus een tabel met de kerncijfers. Dit rapport wordt
nooit gepubliceerd op het dashboard — het gaat alleen als e-mail naar
`bojan@studiovanderheide.nl` (of het adres in `REPORT_EMAIL_TO`). Lukt de AI
niet, dan bevat de mail een automatisch gegenereerde standaardlijst met de
grootste uitschieters.

Vereist SMTP-instellingen, in te stellen door admin op het dashboard zelf
onder AI-instellingen → **E-mail (SMTP)**: host, poort, TLS/SSL, gebruiker,
wachtwoord, afzender en de ontvanger van de actiepunten-mails. Een
"Testmail versturen"-knop slaat de ingevulde instellingen op en verstuurt
direct een testmail, zodat je een foute configuratie meteen ziet. Instellen
kan ook via `.env` (zie `.env.example`: `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, optioneel `SMTP_SECURE`, `MAIL_FROM`,
`REPORT_EMAIL_TO`) — de instellingen op het dashboard hebben voorrang zodra
ze zijn ingevuld. Zonder SMTP-configuratie (via de tab of `.env`) blijft de
rest van het dashboard werken; alleen het mailen mislukt (met een duidelijke
foutmelding in de server-log en, bij handmatig gebruik, in de statusregel).

## Opslag en versleuteling

Er is geen database: instellingen staan in JSON-bestanden onder `data/`
(bijv. `data/ai-settings.json`), rapporten als PDF onder `reports/`. De
gevoelige velden daarin — de AI-provider API-keys en het SMTP-wachtwoord —
worden versleuteld (AES-256-GCM) voordat ze naar schijf gaan; ze staan dus
nooit in leesbare tekst in die bestanden. De sleutel komt uit
`SETTINGS_ENCRYPTION_KEY` (zie `.env.example`) of wordt, als die niet is
gezet, automatisch aangemaakt en bewaard in `data/.encryption-key` (alleen
leesbaar door de server-user). Zet `SETTINGS_ENCRYPTION_KEY` expliciet zodra
`data/` ergens wordt gebackupt of gesynchroniseerd, en bewaar die sleutel
apart van die backup.

Aan/uit via de checkboxes onder **Actiepunten per mail** in
AI-instellingen; "Actiepunten (week/maand) nu mailen" test het handmatig.

## Rapport (PDF) per mail

Admin kan het week- of maandrapport ook direct als **PDF-bijlage** mailen via
de twee knoppen onder **Rapport (PDF) per mail** in AI-instellingen
("Weekrapport (PDF) nu mailen" / "Maandrapport (PDF) nu mailen"). De knop
maakt een vers rapport uit de actuele cijfers, voegt het toe aan de tab
**Rapporten** en mailt de PDF als bijlage naar hetzelfde adres als de
actiepunten (`bojan@studiovanderheide.nl`, of het adres in
`REPORT_EMAIL_TO`). De mailtekst zelf bevat een samenvatting met de
kerncijfers, zodat de mail ook op een telefoon leesbaar is.

## AI-verklaring op het Dashboard

Boven de widgets staat een korte, door AI geschreven verklaring van de cijfers.

- **7 dagen** en **Deze maand**: de tekst wordt automatisch gemaakt, maar alleen
  op het moment dat iemand de tab bekijkt. Daarna blijft de tekst staan tot het
  volgende moment van 06:00, 12:00 of 18:00 (Amsterdamse tijd).
- **Overige perioden** (vandaag, gisteren, 90 dagen, aangepast): een knop
  "Verklaring vragen". Die kan voor de hele site maar 1x per 3 uur worden gebruikt.

De teksten worden bewaard in `data/ai-explanations.json`.
