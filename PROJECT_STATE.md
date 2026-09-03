# Project State

## Goal
Add Play.net store scraper to `Playdotnet` capability, implement SimuCoins-only scan and balance retrieval in `AccountsStore` and API, add a dedicated "SimuCoins" tab to the Look Up page on the dashboard, and run a scan to capture SimuCoin balances across all accounts.

## What changed
- Beginning SimuCoins feature implementation across core capability, accounts store, accounts API routes, and Look Up frontend tab.

## Commands run + results
- Tested `store.play.net/Account/SignIn` live with node on production for `BUTCHERJ4`: successfully acquired CSRF token, authenticated, and retrieved balance (3,977 SC) and reward message.

## Files touched
- `backend/src/core/playdotnet.ts` (in progress)
- `backend/src/modules/accounts/store.ts` (in progress)
- `backend/src/modules/accounts/index.ts` (in progress)
- `frontend/src/pages/lookup/index.tsx` (in progress)
- `PROJECT_STATE.md`

## Next 3 actions
- [ ] Implement `scrapeStore` in `Playdotnet` with unit tests.
- [ ] Implement `scanSimucoins` and SimuCoins routes in `AccountsStore` and `accounts` module.
- [ ] Add SimuCoins tab to Look Up page and trigger live SimuCoins scan on production.
