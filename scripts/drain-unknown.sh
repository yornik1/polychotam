#!/usr/bin/env bash
# Троттл-дренаж unknown maker_address: повторяющиеся bounded-пасы whale-first
# с внутренней паузой между строками, пока recoverable не иссякнет.
set -uo pipefail
cd "$(dirname "$0")/.."

LOG=/tmp/drain-unknown.log
PSQL="docker compose exec -T postgres psql -U postgres -d polychotam -P pager=off -At"
COUNT_SQL="SELECT count(*) FILTER (WHERE status='RECORDED_WS' AND (lower(maker_address)='unknown' OR maker_address='')) FROM trades;"

echo "=== drain start $(date -u +%H:%M:%S) ===" | tee -a "$LOG"
for pass in $(seq 1 60); do
  before=$($PSQL -c "$COUNT_SQL" | tr -d '\r')
  res=$(UNKNOWN_TRADES_REPAIR_LIMIT=2000 UNKNOWN_TRADES_REPAIR_DELAY_MS=150 \
        UNKNOWN_TRADES_REPAIR_ORDER=recent \
        node dist/repair-unknown-trades.main.js 2>/dev/null \
        | tr -d '\n' | grep -oE '"scanned": *[0-9]+,[^}]*' | tr -d ' ')
  after=$($PSQL -c "$COUNT_SQL" | tr -d '\r')
  delta=$((before - after))
  echo "pass $pass $(date -u +%H:%M:%S) before=$before after=$after delta=$delta | $res" | tee -a "$LOG"
  if [ "$delta" -lt 30 ]; then
    echo "=== stop: delta<30 (recoverable top drained) ===" | tee -a "$LOG"
    break
  fi
  sleep 20
done
echo "=== drain end $(date -u +%H:%M:%S) ===" | tee -a "$LOG"
