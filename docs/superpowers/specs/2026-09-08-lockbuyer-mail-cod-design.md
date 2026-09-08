# lockbuyer — mail-in lock/key buying with COD pay-back (design)

Status: Approved 2026-09-08 (pending user review of this file)
Flow decision: mail-in first (no COD inbound), verify, then COD payment back.
Runtime: headless gs4sd-lich unit on the GSIV server.
Buyer character: Neleourg.

## 1. Goal

Sell-side: advertise a few times per day on the merchant channel that Neleourg
buys locks/keys at fixed prices and that sellers should mail a **parcel without
COD** to Neleourg; payment is mailed back COD after verification.

Buy-side (the script): while logged in, poll `MAIL CHECK`, collect non-COD
parcels, open them, verify each lock/key against a fixed price table
(material/tier), then mail one COD parcel per seller for the verified total.

Safety invariant: the script never pays a blind COD demand. All inbound COD
parcels are auto-`REJECT`ed unless the sender is on a whitelist.

## 2. Background (mail mechanics)

- Mail works while the recipient is offline; parcels queue at the post office.
- Parcels are NOT destroyed by opening (envelopes are). Parcels hold up to 9 items.
- Stamps are single-use. `MAIL SEND <name> COD <amount>` requests payment on
  delivery; the recipient pays at `MAIL COLLECT`, and the amount is mailed back
  to the sender. Amount must be > 0, max 250,000,000.
- The sender of a COD parcel pays a 2% COD tax + normal postage (stamp +
  container + per-pound). Standard/express/first class:
  - Standard: 60 min, stamp 2,500 / envelope 300 / parcel 800 / 25 per lb.
  - Express: 20 min, 5,000 / 600 / 1,600 / 50 per lb.
  - First Class: immediate, 10,000 / 2,400 / 4,800 / 200 per lb.
- Recipient-side messaging is NOT fully documented on gswiki: whether `MAIL
  CHECK` exposes the COD flag/amount, and the exact collect-time prompt for a
  COD parcel, must be captured in-game before finalizing pay/reject parsing.

## 3. Commands used

- `MAIL CHECK` — list inbound mail (stamp #, sender, container, sent time).
- `MAIL COLLECT {stamp #}` — pick up mail (COD demand surfaces here, if at all).
- `MAIL REJECT {stamp #}` — return an item to sender without paying.
- `MAIL SEND {name} COD {amount}` — mail payment back to a seller.
- `MAIL STATUS` — confirm sent/pending pay-back parcels (reconciliation).
- Merchant channel broadcast — the ad.

## 4. Script behavior (per scheduled session)

1. **Advertise** — broadcast the ad up to `AD_COUNT_PER_SESSION` times with
   `AD_MIN_SPACING` between posts (config). Ad text: fixed template, placeholder
   for the price list. Explicitly tells sellers: parcel, no COD, addressed to
   Neleourg; payment mailed back COD after verification.
2. **Poll** — while logged in, run `MAIL CHECK` every `POLL_INTERVAL` minutes
   (config), up to `SESSION_MAX_MINUTES` (config), then log out.
3. **Collect + verify** per inbound parcel:
   - COD parcel from a non-whitelisted sender -> `MAIL REJECT`. Never pay.
   - COD parcel from a whitelisted sender -> pay (collect) as trusted.
   - Non-COD parcel -> `MAIL COLLECT` -> `OPEN` -> read each contained item's
     name/material via APPRAISE/ANALYZE -> match against PRICE_TABLE.
4. **Pay back** — for each seller with a verified non-empty total: one parcel
   (e.g. the same parcel re-used, or an envelope w/ paper note itemizing the
   purchase) sent `MAIL SEND <seller> COD <total>`. Script pays the 2% COD tax +
   postage; log them as cost.
5. **Unpaid/wrong items** — items that fail verification are kept-but-unpaid,
   logged, and stashed/discarded; no silver leaves for them. Sellers of junk get
   no pay-back (optionally a no-COD note).
6. **Log** — append daily ledger (JSON/CSV): date, seller, items bought, amounts
   paid, COD taxes + postage paid, rejects. Path under the unit's data dir.

## 5. Verification & price table

- Item identification: exact-name + material/tier matchers against APPRAISE /
  ANALYZE text. Only an item matching a PRICE_TABLE entry is paid for; strict
  match, else unpaid. (Real lock/key nouns/materials to be captured during the
  test phase and frozen in the table.)
- PRICE_TABLE: `{ "material/tier pattern" => amount }` — PLACEHOLDER (user).
  Example shape: `copper lock => 2500`, `brass lock => 5000`, ... keys likewise.
- Margin note: every pay-back costs the sender ~2% COD tax + postage; amounts
  should be set so the 2% + postage is inside the margin.

## 6. Whitelist

- WHITELIST: list of trusted sender names whose inbound COD parcels may be paid.
  PLACEHOLDER (user). Default empty (advertised flow never needs inbound COD).

## 7. Messaging unknowns — REQUIRED test phase (Fisternar/Neleourg only)

Before live use, capture real game text on the approved test pair:
1. Does `MAIL CHECK` show whether a parcel is COD and/or its amount?
2. Exact prompt sequence for `MAIL COLLECT` on a COD parcel — where the amount
   is stated and where the script must decline vs confirm. The wiki does not
   document this; the script must back out (REJECT) without ever confirming.
3. Whether a collected parcel can be re-mailed after opening (reuse for pay-back)
   and whether coins can be mailed inside a parcel (probably not — which is why
   pay-back must itself be COD).
4. Exact reject/retrieve messaging and failure cases (sender mailbox full).
Output: frozen message matchers in the script + real item/material text for the
PRICE_TABLE keys.

## 8. Deployment

- New Lich script `lockbuyer.lic` (or Ruby) run by Neleourg's gs4sd-lich unit.
- Scheduled sessions via the existing platform scheduling (cf. weekly roster
  sync timer): login at post office -> run -> logout.
- Post office town: PLACEHOLDER (user). Buyer must be inside a post office (or
  at a private mailbox) to use MAIL verbs.
- Logs written under the unit's data dir for dashboard/reconciliation (v1: file
  log only; platform surfacing out of scope unless requested).

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Blind COD pay (robbery) | Never pay inbound COD unless whitelisted; verify-then-pay flow. |
| Junk/wrong item mailed | Strict table match; unpaid + logged. Loss = time only. |
| Seller sets COD above agreed | Not possible: sellers are told not to COD; any inbound COD is rejected. |
| Mis-parsed collect prompt -> accidental pay | Test phase freezes exact matchers; fail-closed (REJECT on any ambiguity). |
| Flood/grief mail | Rejects are cheap; per-session caps on processing volume (config). |
| 2% tax + postage erodes margin | Priced into table by owner; logged as cost for reconciliation. |
| Ads violate channel etiquette | AD_COUNT_PER_SESSION + spacing config; owner tunes. |

## 10. Out of scope (v1)

- Platform/dashboard integration of the ledger (file log only).
- Automatic junk resale or returning junk parcels to senders.
- Sourcing/buying any item other than the configured locks/keys table.

## 11. Placeholders to fill (owner)

- [ ] PRICE_TABLE amounts + real item/material match text (needs test phase data).
- [ ] Ad text wording + AD_COUNT_PER_SESSION / AD_MIN_SPACING / poll + session
      window values.
- [ ] Post office town + unit schedule (times per day).
- [ ] WHITELIST seeds (default empty).
