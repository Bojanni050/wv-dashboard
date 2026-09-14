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
