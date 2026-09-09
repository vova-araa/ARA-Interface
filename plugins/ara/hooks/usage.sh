#!/bin/bash
# Achtergrond-tokenteller: parseert het transcript en POST totalen naar de
# collector. Altijd exit 0, blokkeert nooit; kost geen LLM-tokens.
PAYLOAD="$(head -c 100000)"
if command -v node >/dev/null 2>&1; then
  (printf '%s' "$PAYLOAD" | node "$(dirname "$0")/usage.mjs" >/dev/null 2>&1 &)
fi
exit 0
