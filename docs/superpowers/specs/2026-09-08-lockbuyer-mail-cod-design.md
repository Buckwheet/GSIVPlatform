# lockbuyer — mail-in lock/key buying with note pay-back (design)

Status: Approved 2026-09-08 (pending user review of this file; rev 2: COD pay-back -> bank-note pay-back per owner)
Flow decision: mail-in first (no COD inbound), verify, then **bank-note pay-back**.
Runtime: headless gs4sd-lich unit on the GSIV server.
Buyer character: Neleourg.

## 1. Goal

Sell-side: advertise a few times per day on the merchant channel that Neleourg
buys locks/keys at fixed prices and that sellers should mail a **parcel without
COD** to Neleourg; payment is mailed back as a bank note after verification.

Buy-side (the script): while logged in, poll `MAIL CHECK`, collect non-COD
parcels, open them, verify each lock/key against a fixed price table
(material/tier), then withdraw a bank note for each seller's verified total and
mail it to them.

Safety invariant: the script never pays a blind COD demand and never mails a
note for unverified contents. All inbound COD parcels are auto-`REJECT`ed
unless the sender is on a whitelist.

## 2. Background (mail mechanics)

- Mail works while the recipient is offline; parcels queue at the post office.
- Parcels are NOT destroyed by opening (envelopes are). Parcels hold up to 9 items.
- Stamps are single-use. `MAIL SEND <name> COD <amount>` requests payment on
  delivery: the recipient pays at `MAIL COLLECT`, amount mailed back to sender.
  The COD **sender** pays a 2% COD tax. COD exists to protect the PAYEE
  (guaranteed pickup payment) — of no value when we are the payer.
- Plain coins cannot be mailed in containers. Value is sent by mail as a
  **bank note**: withdraw silvers as a note at a bank, mail the note item.
  Notes are bearer instruments, exact-amount, no COD tax. If the recipient
  never collects, `MAIL RETRIEVE` returns the parcel (and the note) to us.
- Recipient-side messaging is NOT fully documented on gswiki: whether `MAIL
  CHECK` exposes the COD flag/amount, the exact collect-time prompt for a COD
  parcel, and the bank note-withdrawal commands/messaging must be captured
  in-game before finalizing parsing.

## 3. Commands used

- `MAIL CHECK` — list inbound mail (stamp #, sender, container, sent time).
- `MAIL COLLECT {stamp #}` — pick up mail (COD demand surfaces here, if at all).
- `MAIL REJECT {stamp #}` — return an item to sender without paying.
- `MAIL SEND {name}` — mail the note(s) to a seller (no COD).
- `MAIL STATUS` — confirm sent/pending pay-back parcels (reconciliation).
- Bank: withdraw exact total as a note per seller (exact verbs/messaging to be
  captured in the test phase, e.g. at the town bank).
- Merchant channel broadcast — the ad.

## 4. Script behavior (per scheduled session)

Session flow is location-ordered: post office (collect/verify) -> bank (withdraw
notes) -> post office (mail notes). If the chosen post office and bank are in
different rooms, the script walks between them; if the post office and bank are
the same building/town the walk is trivial.

1. **Advertise** — broadcast the ad up to `AD_COUNT_PER_SESSION` times with
   `AD_MIN_SPACING` between posts (config). Ad text: fixed template, placeholder
   for the price list. Tells sellers: parcel, no COD, addressed to Neleourg;
   payment mailed back as a note after verification.
2. **Poll + collect + verify (post office)** — run `MAIL CHECK` every
   `POLL_INTERVAL` minutes (config) up to `SESSION_MAX_MINUTES` (config). Per
   inbound parcel:
   - COD parcel, sender not whitelisted -> `MAIL REJECT`. Never pay.
   - COD parcel, sender whitelisted -> pay (collect) as trusted.
   - Non-COD parcel -> `MAIL COLLECT` -> `OPEN` -> read each contained item's
     name/material via APPRAISE/ANALYZE -> match against PRICE_TABLE.
   - Accumulate per-seller verified totals.
3. **Withdraw notes (bank)** — for each seller with a verified non-empty total:
   withdraw a note for exactly that total. If the script cannot reach the bank
   this session, defer pay-back to the next session (seller parcels already
   collected stay safe in our inventory) and log it.
4. **Mail notes (post office)** — one envelope/parcel per seller containing the
   note, sent `MAIL SEND <seller>`. Cost = stamp + container + per-pound only
   (no COD tax). `MAIL STATUS` after sending for reconciliation.
5. **Unpaid/wrong items** — items that fail verification are kept-but-unpaid,
   logged, and stashed/discarded; no note is ever mailed for them. Sellers of
   junk get no pay-back (optionally a no-COD note explaining why).
6. **Log** — append daily ledger (JSON/CSV): date, seller, items bought, note
   amounts mailed, postage paid, rejects. Path under the unit's data dir.

## 5. Verification & price table

- Item identification: exact-name + material/tier matchers against APPRAISE /
  ANALYZE text. Only an item matching a PRICE_TABLE entry is paid for; strict
  match, else unpaid. (Real lock/key nouns/materials to be captured during the
  test phase and frozen in the table.)
- PRICE_TABLE: `{ "material/tier pattern" => amount }` — PLACEHOLDER (user).
  Example shape: `copper lock => 2500`, `brass lock => 5000`, ... keys likewise.
- Margin note: each pay-back costs only its postage (stamp + container +
  per-pound). No 2% COD tax. Amounts should still leave headroom for postage.

## 6. Whitelist

- WHITELIST: list of trusted sender names whose inbound COD parcels may be paid.
  PLACEHOLDER (user). Default empty (advertised flow never needs inbound COD).
- We never send COD ourselves (note pay-back), so no outbound COD handling.

## 7. Messaging unknowns — REQUIRED test phase (Fisternar/Neleourg only)

Before live use, capture real game text on the approved test pair:
1. Does `MAIL CHECK` show whether a parcel is COD and/or its amount? If not, the
   script must attempt `MAIL COLLECT` and detect a payment demand to classify
   the parcel as COD, then back out (REJECT) without ever confirming.
2. Exact `MAIL COLLECT` prompt sequence on a COD parcel — where the amount is
   stated and where the script must decline vs confirm.
3. Bank note withdrawal: exact command + messaging for "withdraw N silvers as a
   note" and whether arbitrary exact amounts are allowed. Confirm the note is a
   mailable item and how it reads (for matchers).
4. Whether a collected parcel can be re-mailed after opening and whether coins
   can ever be placed in a parcel (assumed no — that is why notes are used).
5. Exact reject/retrieve messaging and failure cases (sender mailbox full).
Output: frozen message matchers in the script + real item/material text for the
PRICE_TABLE keys + bank/note matchers.

## 8. Deployment

- New Lich script `lockbuyer.lic` (or Ruby) run by Neleourg's gs4sd-lich unit.
- Scheduled sessions via the existing platform scheduling (cf. weekly roster
  sync timer): login at post office -> run -> logout.
- Post office + bank town: PLACEHOLDER (user). Buyer must be inside a post
  office (or at a private mailbox) to use MAIL verbs, and at the bank to
  withdraw notes.
- Logs written under the unit's data dir for dashboard/reconciliation (v1: file
  log only; platform surfacing out of scope unless requested).

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Blind COD pay (robbery) | Never pay inbound COD unless whitelisted; verify-then-pay flow. |
| Junk/wrong item mailed | Strict table match; unpaid + logged. Loss = time only. |
| Note mailed for wrong/unverified items | Notes only withdrawn+mailed after table verification. |
| Note lost to never-collected mail | `MAIL RETRIEVE` returns the parcel/note; monitor `MAIL STATUS`. |
| Bearer-note float theft | No float: exact notes withdrawn per sale at session time only. |
| Mis-parsed collect prompt -> accidental pay | Test phase freezes exact matchers; fail-closed (REJECT on ambiguity). |
| Flood/grief mail | Rejects are cheap; per-session caps on processing volume (config). |
| Postage erodes margin | Priced into table by owner; logged as cost for reconciliation. |
| Ads violate channel etiquette | AD_COUNT_PER_SESSION + spacing config; owner tunes. |


## 10. Out of scope (v1)

- Platform/dashboard integration of the ledger (file log only).
- Automatic junk resale or returning junk parcels to senders.
- Sourcing/buying any item other than the configured locks/keys table.
- Sending COD in any direction (we only ever reject inbound COD).

## 11. Placeholders to fill (owner)

- [ ] PRICE_TABLE amounts + real item/material match text (needs test phase data).
- [ ] Ad text wording + AD_COUNT_PER_SESSION / AD_MIN_SPACING / poll + session
      window values.
- [ ] Post office + bank town + unit schedule (times per day).
- [ ] WHITELIST seeds (default empty).
