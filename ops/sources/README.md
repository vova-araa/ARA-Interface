# Databronnen als bestanden — alle takken

Elke bron uit de playbooks is één bestand onder `data/sources/<tak>/` (of
`ARA_SOURCES_DIR`). Staat het er mét minstens één regel, dan meldt `/org` de
bron als aangesloten, verdwijnt hij uit de actielijst en leest de rol die hem
nodig heeft hem via `GET /sources/<tak>/<bestand>`. Een bestand met alleen een
kop telt niet — er is dan niets gemeten.

```bash
pnpm sources:init        # maakt elk ontbrekend bestand aan met alleen de kopregel
curl -s localhost:4747/sources | jq '.ventures[] | {id, open: [.sources[] | select(.state != "gevuld") | .file]}'
```

- CSV, scheiding `;` of `,`, kolomnamen in kleine letters (hoofdletters en
  spaties in de kop worden genormaliseerd). Kolommen erbij mag altijd.
- Datums: `2026-11-02`, `02-11-2026`, `02/11/2026`, eventueel met tijd erachter.
  Iets anders is geen datum en komt als *ontbreekt* terug.
- Getallen: `1.250,50` en `1250.50` lezen allebei goed.
- **Nooit een sleutel.** Posities en portefeuilles komen uit een export of het
  statusbestand dat je bot zelf schrijft. ARA vraagt nooit zelf de broker of de exchange.

| tak | bron | bestand | kolommen (kop verplicht; de eerste kolom is de sleutel en mag per regel niet leeg zijn) | opmerking |
|---|---|---|---|---|
| `traject` | Ritten en ETA per wagen | `ritten.csv` | `rit; kenteken; van; naar; eta; status` | status: gepland | onderweg | geleverd | vertraagd |
| `traject` | Facturatiestand | `facturen.csv` | `factuur; klant; bedrag; verstuurd; vervalt; betaald` | kolom betaald leeg = openstaand |
| `blex` | Kenteken, APK-datum, kilometerstand | `vehicles.csv` | `kenteken; apk; tachograaf; adr; verzekering; km` | termijnen die niet gelden: kolom weglaten |
| `blex` | Openstaande garagepunten | `garage.csv` | `kenteken; punt; gemeld; afgemeld` | afgemeld leeg = staat nog open |
| `blex` | Chauffeurstermijnen (rijbewijs, code 95, chauffeurskaart) | `drivers.csv` | `naam; rijbewijs; code95; chauffeurskaart` | — |
| `blex` | Kosten per voertuig (brandstof, banden, reparatie) | `kosten.csv` | `kenteken; maand; brandstof; banden; reparatie; km` | maand als 2026-09; één regel per wagen per maand |
| `blex` | Trailerlijst met standplaats en koppeling | `trailers.csv` | `trailer; standplaats; status; sinds` | gekoppeld_aan = kenteken van de trekker, leeg = los; status: inzetbaar | defect | verhuurd |
| `trading` | Posities, P&L, stops | `posities.csv` | `instrument; richting; inzet; entry; stop; geopend; pnl` | het statusbestand dat de bot zélf schrijft — ARA leest, nooit de broker |
| `trading` | Risicolimieten (max inzet per trade, drawdown) | `trading-limits.json` | `—` | dit is data/trading-limits.json van de risicomotor zelf; de actielijst zegt of hij bruikbaar is |
| `trading` | Handelslogboek van afgesloten trades | `trades.csv` | `datum; instrument; richting; resultaat_r; inzet` | resultaat in R (winst gedeeld door risico), niet in geld |
| `crypto` | Handelslogboek van afgesloten trades | `trades.csv` | `datum; munt; richting; resultaat_r; inzet` | resultaat in R (winst gedeeld door risico), niet in geld |
| `crypto` | Portefeuille en posities | `portefeuille.csv` | `munt; aantal; peildatum; koers; waarde_usd` | wallet-export of het statusbestand van je bot — geen exchange-sleutel |
| `crypto` | Streefverdeling en concentratiegrenzen | `allocatie.csv` | `munt_of_sector; doel_pct; max_pct` | — |
| `elevate` | Lopende opdrachten | `opdrachten.csv` | `klant; opdracht; status; deadline` | status: offerte | lopend | review | af |
| `elevate` | Te bewaken sites | `sites.csv` | `url; klant` | de site-watch leest alleen; niets gaat naar buiten |
| `uprising` | Agenda en boekingen | `boekingen.csv` | `datum; klant; ruimte; status; uren` | status: aanvraag | bevestigd | geannuleerd |
| `uprising` | Openstaande aanvragen | `aanvragen.csv` | `ontvangen; van; onderwerp; status` | status: nieuw | beantwoord | gesloten |
| `vovara` | Releases en streams | `releases.csv` | `titel; datum; streams` | distributeur-export, streams als getal |
| `vovara` | Releaseplanning en metadata | `releaseplanning.csv` | `titel; geplande_datum; status` | status: idee | productie | ingeleverd | uit — uitbrengen doet ARA nooit |
| `equities` | Handelslogboek van afgesloten trades | `trades.csv` | `datum; ticker; richting; resultaat_r; inzet` | resultaat in R (winst gedeeld door risico), niet in geld |
| `equities` | Koersen en portefeuille | `portefeuille.csv` | `ticker; aantal; peildatum; koers; waarde; sector` | broker-export — ARA vraagt nooit zelf de broker |
| `equities` | Kwartaalagenda | `kwartaalagenda.csv` | `ticker; datum; soort` | soort: kwartaalcijfers | jaarcijfers | ava | ex-dividend |
| `equities` | Jaarverslagen en kwartaalcijfers | `cijfers.csv` | `ticker; periode; bron_url; omzet; winst` | bron_url = de primaire bron (IR-site), niet een samenvatting |
| `equities` | Streefverdeling per sector | `sectorallocatie.csv` | `sector; doel_pct; max_pct` | — |

Crypto-koersen komen van een publiek endpoint zonder sleutel (CoinGecko) en staan
daarom niet in deze tabel. `trading-limits.json` is het bestand van de risicomotor
zelf; of hij *bruikbaar* is zegt de actielijst ("Handelslimieten onbruikbaar").

`data/` staat in `.gitignore`: deze bestanden reizen niet mee in git.
