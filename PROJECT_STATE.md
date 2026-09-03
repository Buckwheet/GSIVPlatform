# Project State

## Goal
Implement SimuCoins store balance scraping from Play.net, integrate balance scanning and retrieval in the accounts module, add a dedicated SimuCoins tab to the Look Up dashboard page, deploy to production, and run a full SimuCoins scan across all accounts.

## What changed
- Enhanced `backend/src/core/playdotnet.ts`:
  - Added `scrapeStore(account, password, gameCode)` to login to `store.play.net/Account/SignIn` and extract SimuCoin balance (`.balance > span`) and next reward message (`.RewardMessage`).
  - Added unit tests in `backend/tests/core/playdotnet.test.ts` (9/9 passed).
- Enhanced `backend/src/core/entry-yaml.ts`:
  - Added `listAccountNames()` to return all accounts declared in `entry.yaml`.
- Enhanced `backend/src/modules/accounts/store.ts`:
  - Updated `saveScan` to persist `store_balance` and `store_reward_next` using `COALESCE`.
  - Added `updateStoreBalance`, `getSimucoins`, and `scanSimucoins(targetAccount?)` to scan and store balances.
- Added API routes in `backend/src/modules/accounts/index.ts`:
  - `GET /api/modules/accounts/simucoins`: Returns all account SimuCoin balances and next reward dates (`accounts.read`).
  - `POST /api/modules/accounts/simucoins/scan`: Triggers targeted store scrape across all or a single account (`accounts.write`).
- Added "SimuCoins" Tab to `frontend/src/pages/lookup/index.tsx`:
  - Dedicated tab alongside Overview, Bank, Resources, Tickets, Items.
  - Displays summary cards: Total SimuCoins and Accounts with SimuCoins.
  - Interactive table showing Account, SimuCoins (formatted with `SC`), Next Reward date, and Last Checked relative timestamp.
  - One-click "Scan SimuCoins" button to refresh balances on demand.
  - Filterable by Account dropdown and search input.
- Deployed to production (`51.68.235.144`):
  - Updated backend distribution, restarted `gsiv-platform.service` (listening on `:3102`).
  - Updated frontend distribution and verified live bundle `index-BgF70Qjp.js` (`HTTP/2 200`, `text/javascript`).
  - Initiated live scan across all 36 accounts: successfully retrieved balances across 19 active accounts totaling **74,901 SimuCoins**.

## Commands run + results
- `npm test`: 49 test files passed, 383/383 tests passed.
- `npm run typecheck` + `npm run lint`: Passed with 0 errors.
- `npm run build`: Backend and frontend compiled cleanly.
- `POST /api/modules/accounts/simucoins/scan`: Scanned 36 accounts, saved 19 accounts with positive balances.

## Files touched
- `backend/src/core/playdotnet.ts`
- `backend/src/core/entry-yaml.ts`
- `backend/src/modules/accounts/store.ts`
- `backend/src/modules/accounts/index.ts`
- `backend/tests/core/playdotnet.test.ts`
- `backend/tests/modules/accounts/store.test.ts`
- `backend/tests/modules/accounts/routes.test.ts`
- `frontend/src/pages/lookup/index.tsx`
- `PROJECT_STATE.md`

## Next 3 actions
- [x] Implement Play.net store scraper and unit tests.
- [x] Add SimuCoins tab to Look Up page and wire scan endpoints.
- [x] Deploy to production and run live scan across all accounts.
