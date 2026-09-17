# Inbox — werk dat van buiten de Mac binnenkomt

Elk `.md`-bestand in deze map (behalve dit) is één taak. De watchdog leest ze
bij elke ronde, zet ze op het takenbord, en onthoudt welke hij al gezien heeft
in `data/inbox-seen.json`. Daarna doet de gewone keten zijn werk: de watchdog
spawnt de supervisor of de manager, en die verdeelt het.

Waarvoor dit bestaat: de eigenaar werkt ook vanaf een andere machine of vanuit
een chat die niet bij de Mac kan. Zonder deze map is git de enige verbinding
die er altijd is — dus gebruiken we git.

## Vorm

```markdown
---
title: Korte titel, dit komt op het bord
assignee: supervisor
project: sharzi-tms
---

De opdracht in gewone taal. Wat af is, en waaraan je dat ziet.
```

Alleen `title` is verplicht. `assignee` is standaard `supervisor`; andere
geldige waarden zijn `manager:<venture>`, `agent:<rol>` en `gepland` (met
`due: <datum>` in de tekst).

## Grenzen

- **Uit tenzij aangezet.** `ARA_INBOX=1` in de omgeving van de watchdog. Zonder
  dat leest hij deze map niet. Het gaat hier om werk dat op een machine van de
  eigenaar uitgevoerd wordt; dat hoort een bewuste keuze te zijn, geen bijwerking
  van een `git pull`.
- **Eenmalig.** Een verwerkt bestand komt niet nog eens op het bord, ook niet na
  een herstart. Wil je iets herhalen, geef het bestand dan een nieuwe naam.
- **Telegram.** Elke taak die van hier op het bord komt, wordt gemeld. Werk dat
  vanzelf begint hoort niet ongezien te beginnen.
- Een taak is een *opdracht*, geen commando. De agent die hem oppakt houdt al
  zijn eigen grenzen: rollen zonder Edit/Write kunnen nog steeds niets
  schrijven, en de handelslimieten blijven staan.
