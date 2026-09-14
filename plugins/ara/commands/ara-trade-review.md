---
description: Handelsrapport over het audit-spoor — wat blokkeerde, wie liep waarop stuk, en wat de papieren uitkomst was.
argument-hint: "[aantal dagen, standaard 7]"
allowed-tools: Bash
---

Draai het handelsrapport en bespreek het met de gebruiker.

```bash
pnpm trade:review ${1:-7}
```

De cijfers komen uit `GET /trade/review` — deterministische code, geen
samenvatting. **Tel zelf niets na en reken niets om.** Als je een getal noemt,
komt het letterlijk uit de uitvoer; klopt er iets niet, dan is dat een bug in
`buildTradeReview()` en meld je dat als zodanig.

Bespreek in deze volgorde, kort:

1. **Waarop het stukliep.** Dit is de kern. Veel afwijzingen op *risico per
   trade* of *blootstelling* betekent dat de agents groter willen dan de
   limieten toestaan — dat is het systeem dat werkt. Veel afwijzingen op *bron*
   of *reden* betekent iets anders: die rollen hebben geen databron, en dat is
   een gat in de configuratie, niet in hun oordeel.
2. **Herhaalpogingen.** Staat daar iets, begin er dan mee. Een afgewezen
   voorstel dat een half uur later terugkomt, is precies het gedrag waartegen
   de limieten bestaan.
3. **De papieren uitkomst**, met de verwachtingswaarde in R vóór de trefkans.
   Veel kleine winsten en één grote verliezer is een verliezend systeem, ook bij
   80% trefkans.
4. **De drempels**, en welke nog niet gehaald zijn.

Sluit af met de waarschuwing uit het rapport zelf: papieren vullingen kennen
geen spread, geen slippage en geen gemiste order. De papieren uitkomst is een
bovengrens, nooit een verwachting.

Geef **geen** handelsadvies en geen oordeel of de gebruiker naar `approval` of
`live` zou moeten. Je levert het beeld; het besluit over zijn geld is van hem.
Vraagt hij er toch om: zeg dat je het beeld geeft en het besluit niet neemt.
