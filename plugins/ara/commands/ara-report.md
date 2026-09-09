---
description: Dagrapport van de ARA-organisatie - wat is af, wat draait, wat escaleert, activiteit per project. Draai dagelijks via - /loop 24h /ara-report
allowed-tools: Bash(curl:*)
---

Maak het dagrapport van ARA World. Collector: `$ARA_COLLECTOR_URL` (default
`http://127.0.0.1:4747`), header `X-ARA-Token: $ARA_TOKEN` indien gezet.

1. Haal op: `GET /state`, `GET /stats`, `GET /tasks?limit=100`, `GET /usage`.
2. Rapporteer in exact deze volgorde, compact (één scherm):

```
📋 ARA DAGRAPPORT — <datum>
🔴 ESCALATIES (N)          ← taken met result "ESCALATE:…" of status failed
  <project> — <vraag/reden>
🟢 AF VANDAAG (N)          ← counters.doneToday + done-taken van vandaag
  <project> — <taak/resultaat>
🟡 LOOPT (N)
  <project> — <taak of activeTool> (<leeftijd>)
📊 ACTIVITEIT              ← top-5 projecten op events (24u), fouten vermelden
  <project>: <events> events, <errors> fouten
⚡ TOKENS VANDAAG           ← uit /usage; cache apart (want ~10× goedkoper)
  <project>: <in> in / <uit> uit / <cache> cache
  totaal: <in+uit> (excl. cache)
```

3. Sluit af met de viewer-URL. Niets te melden in een sectie → één regel "—".
4. Escalaties zijn het belangrijkst: staan die er, open dan met "⚠ Actie nodig:".
