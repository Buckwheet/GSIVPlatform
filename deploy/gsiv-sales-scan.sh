#!/usr/bin/env bash
# Hourly: refresh v2 pricing data, then scan the user's shops for new sales.
set -euo pipefail
TOKEN="${GS4SD_TOKEN:?GS4SD_TOKEN (machine token) is required}"
BASE="${GSIV_API:-http://localhost:3102}"
curl -fsS -X POST "$BASE/api/modules/pricing/scrape" -H "Authorization: Bearer $TOKEN" >/dev/null
curl -fsS -X POST "$BASE/api/modules/your-shops/scan" -H "Authorization: Bearer $TOKEN"
