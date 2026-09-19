# Wagenpark als CSV — de eerste twee Blex-bronnen

Twee bestanden in `data/fleet/` (of `ARA_FLEET_DIR`), wekelijks ververst uit
je eigen administratie. Meer is er niet nodig: `GET /fleet` op de collector
leest ze en rekent de termijnen uit (`fleetDeadlines()` in `@ara/shared`,
pure functie, 0 tokens). Staat het bestand er, dan meldt `/org` die bron als
aangesloten en verdwijnt hij uit de actielijst.

| bestand | verplichte kolom | termijnkolommen (datum) | overig |
|---|---|---|---|
| `vehicles.csv` | `kenteken` | `apk`, `tachograaf`, `adr`, `verzekering` | `km` |
| `drivers.csv` | `naam` | `rijbewijs`, `code95`, `chauffeurskaart` | — |

- Scheiding `;` of `,` (Excel-export uit Nederland geeft `;`), kop op de
  eerste regel, hoofdletters en spaties in kolomnamen maken niet uit.
- Datums als `2026-11-02`, `02-11-2026` of `02/11/2026`. Iets anders is geen
  datum en wordt gemeld als **ontbreekt** — nooit als "waarschijnlijk in orde".
- Een lege termijn (bv. geen ADR) komt ook als *ontbreekt* terug. Wil je die
  niet zien, laat de kolom dan weg; dan is hij niet van toepassing.
- Vensters: verlopen · ≤14 · ≤30 · ≤60 dagen (`DEADLINE_WINDOWS`). Verder weg
  staat er niet in.

```bash
mkdir -p data/fleet
cp ops/fleet/vehicles.example.csv data/fleet/vehicles.csv   # en dan: vul 'm met je eigen wagens
cp ops/fleet/drivers.example.csv  data/fleet/drivers.csv
curl -s localhost:4747/fleet | jq .summary
```

`data/` staat in `.gitignore`; deze lijsten gaan niet mee in git. Wat er nog
niet uit bestanden komt (garagepunten, kosten, trailers) staat gewoon in de
actielijst totdat het er is.
