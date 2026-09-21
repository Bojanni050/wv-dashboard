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

## AI-verklaring op het Dashboard

Boven de widgets staat een korte, door AI geschreven verklaring van de cijfers.

- **7 dagen** en **Deze maand**: de tekst wordt automatisch gemaakt, maar alleen
  op het moment dat iemand de tab bekijkt. Daarna blijft de tekst staan tot het
  volgende moment van 12:00 of 18:00 (Amsterdamse tijd).
- **Overige perioden** (vandaag, gisteren, 90 dagen, aangepast): een knop
  "Verklaring vragen". Die kan voor de hele site maar 1x per 3 uur worden gebruikt.

De teksten worden bewaard in `data/ai-explanations.json`.
