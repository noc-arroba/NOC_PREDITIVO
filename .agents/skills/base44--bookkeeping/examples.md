# Bookkeeper — workflow examples

Concrete end-to-end walkthroughs. Use these as a model when handling real entries. Full rules live in `reference.md`.

> Provider note: examples are written against the Google stack for concreteness. Every flow works identically on Microsoft 365 (Outlook / Excel / OneDrive / Outlook Calendar) via the equivalences in `reference.md` § Providers & capability roles — "Gmail watcher" means the user's mailbox watcher, "Drive" means their files provider, etc.

## Example 1 — receipt photo in chat

User uploads a photo with caption "client lunch".

1. Extract: vendor `Sushi Yasaka`, total `$84.20`, date `2026-10-22`
2. Check duplicates → none
3. Categorize → `Meals & Entertainment` (caption + vendor)
4. Save photo to Drive: `Bookkeeper/Receipts/2026-10/Sushi-Yasaka-84.20.jpg`
5. Append row to `expenses`
6. Reply:
   > ✅ Logged: $84.20 at Sushi Yasaka → Meals & Entertainment

## Example 2 — incoming invoice (multipart email)

Gmail email from `billing@vendor.com`, subject "Invoice", PDF nested at depth 2 inside `multipart/mixed → multipart/alternative → application/pdf`.

1. Walk `payload.parts` recursively → find the PDF.
2. Extract: vendor `Acme Hosting`, total `$240.72`, tax `$36.72`, date `2026-05-04`, due date `2026-06-04`.
3. Append row with `status = logged`.
4. Save PDF to Drive: `Bookkeeper/Receipts/2026-05/Acme-Hosting-240.72.pdf`
5. Create calendar event on `2026-06-01`: `Invoice due: Acme Hosting — $240.72 USD`. Update row `status = awaiting_payment`.
6. **Stay silent.** Do not message the user — this was an automatic Gmail capture, not a chat request.

## Example 3 — HTML body receipt (Apple)

Gmail email from `no_reply@email.apple.com`, subject `Your receipt from Apple`, **no PDF attached** — the receipt is rendered as HTML directly in the body.

1. Gmail watcher fetches the email — caught by clause 2 (vendor-like sender) and clause 4 (money pattern in subject like `$9.99`).
2. PDF walker runs → finds no PDF.
3. **Fall back to HTML body extraction:** find the `text/html` part, decode the base64 body, pass HTML to the LLM.
4. Extract: vendor `Apple`, total `$9.99`, tax `$0.79`, date `2026-05-30`, payment `Apple Pay`, line items `[{description: "iCloud+ 200GB", qty: 1, unit_price: 9.99}]`.
5. **Render HTML to PDF** for archival. Save to Drive: `Bookkeeper/Receipts/2026-05/Apple-9.99-{shortid}.pdf`.
6. Categorize → `Software & Subscriptions`. Remember vendor `Apple → Software & Subscriptions` for the rest of the session.
7. Append row with `status = logged`, stay silent (Gmail-triggered).

## Example 4 — forwarded receipt

User forwards a Wolt receipt to themselves. Gmail `From` header is the user. Subject is `Fwd: Wolt purchase receipt`. Original sender appears inside the forwarded body.

1. Detect forwarded (`Fwd:` prefix) → ignore the `From` header.
2. Walk `payload.parts` recursively → find the attached PDF.
3. Extract vendor from PDF content: `Greenberg Burger`.
4. Extract real sender from the forwarded body: `From: Wolt <info@wolt.com>` → noted as the delivery platform.
5. Extract: total `$28.50`, tax `$4.30`, date `2026-05-25`, payment `Apple Pay`.
6. Categorize → `Meals & Entertainment`.
7. Save PDF, append row, log silently.

## Example 5 — bulk bank CSV

User uploads a bank CSV (47 rows) in chat. The sheet has no expenses in this statement's period, so reconciliation is skipped — straight import (see Example 18 for the reconcile path).

1. Parse the CSV. Normalize header variants: `Trans Date` → `date`, `Merchant` → `vendor`, `Debit` → `amount`.
2. For each row, look up the vendor against existing `expenses` rows to infer category.
3. Known vendors → auto-categorize.
4. Unknown vendors → flag for web-search funnel. Warn the user up front:
   > Looking up 6 new vendors — this may take a moment.
5. Run the search funnel per `reference.md`. Remember results in-session.
6. Batch-write all 47 rows to `expenses`.
7. Reply:
   > ✅ Logged 47 transactions. 6 new vendors categorized and cached. 0 need manual review.

## Example 6 — natural-language query

User asks: *"How much did I spend on coffee this month?"*

1. Recognize this as a query, not an entry.
2. Filter `expenses` where `category = Meals & Entertainment` AND `vendor` matches `/coffee|starbucks/i` AND `date` is in the current month.
3. Sum `home_currency_total`.
4. Reply (two parts):
   > $87 across 14 visits this month.
   >
   > See the filtered view: {link to filtered Sheet view}

## Example 7 — foreign-language invoice in an unknown language

User has `_settings.languages = ["en"]`. A Spanish invoice arrives from `facturacion@hosting.es`, subject `Factura mensual #4421`, PDF attached.

1. Gmail watcher fetches it — caught by the **vendor-like sender + PDF** rule, not the subject keyword filter (which only knows English variants).
2. Recursively find the PDF.
3. Extract: vendor `Hosting España`, total `€42.00`, date `2026-05-01`, due date `2026-05-15`.
4. Detect document language = `es`.
5. Append `es` to `_settings.languages` so the keyword filter now also includes `factura`, `recibo`, `pago`, `RV:`, etc. Future Spanish invoices from any sender are caught at the subject stage.
6. Categorize → `Software & Subscriptions`. Remember vendor `Hosting España → Software & Subscriptions` for the rest of the session.
7. Save PDF, append row, create calendar reminder, stay silent (Gmail-triggered).

## Example 8 — image attachment (scanned receipt)

Gmail email from a small vendor, subject `Receipt #4421`, single `.jpg` attached (a phone photo of a paper receipt).

1. Watcher fetches it — caught by clauses 1 (`receipt` keyword) and 4 (money pattern).
2. Content inventory finds zero PDFs, one image attachment.
3. Source priority → image attachment path. Vision OCR directly on the JPG bytes.
4. Extract: vendor `Café Tortoni`, total `ARS 8,500`, tax `ARS 1,475`, date `2026-05-21`. FX-convert to home currency.
5. Save the JPG to Drive: `Bookkeeper/Receipts/2026-05/Cafe-Tortoni-8500-{shortid}.jpg`.
6. Categorize → `Meals & Entertainment`. Append row, stay silent.

## Example 9 — refund / credit note

Gmail email from `noreply@stripe.com`, subject `Refund of $12.00`, HTML body.

1. Watcher fetches via clauses 2 + 4.
2. Intent classifier returns `refund`.
3. Extract from HTML body. Total = **−$12.00** (negative).
4. Append row to `expenses` with `total = -12.00`, `notes = "refund"`, `status = logged`.
5. Stay silent. The refund netts against the original transaction in monthly totals automatically.

## Example 10 — payment-failure notification (skipped)

Gmail email from `billing@vendor.com`, subject `Your payment failed`, HTML body, no PDF.

1. Watcher fetches via clauses 2 + 4.
2. Intent classifier returns `payment_failure`.
3. **Do not extract.** Skip silently. The dedup check (vendor + date + amount) will prevent any re-processing if this message is encountered again.
4. Stay silent. If the user later retries and the charge succeeds, a new `paid_receipt` email will arrive and be processed normally.

## Example 11 — AWS monthly digest (multi-receipt)

Gmail email from `no-reply-aws@amazon.com`, subject `AWS bill — May 2026`, PDF attached. The PDF contains 12 distinct service charges: EC2, S3, Route53, etc.

1. Watcher fetches; PDF extraction begins.
2. LLM detects "multiple distinct billable services, each with its own line".
3. Ask the LLM: *"One receipt with line items, or multiple separate transactions?"* → "multiple".
4. Emit **12 rows** in `expenses`, one per service, all sharing the same `original_doc_url`.
5. Each row categorized to `Software & Subscriptions` (cached under `Amazon Web Services - EC2`, etc.).
6. Append, stay silent.

## Example 12 — user correction updates memory

After Example 4, the user says: *"Actually, categorize Stripe as Professional Services, not Software."*

1. Update the existing row(s) for Stripe in `expenses`.
2. Remember the correction in-session: `Stripe → Professional Services`. Update the vendor's category on any existing `expenses` rows that were mis-categorized.
3. Reply:
   > ✅ Got it. Future Stripe charges will go to Professional Services.

## Example 13 — splitting a Costco receipt

User uploads a Costco photo. PDF extraction returns 11 line items totaling $150. The LLM sees 8 grocery/household items (~$105) and 3 office-supply items — printer paper, toner, desk organizer (~$45).

1. Detect a likely split (bulk-store vendor + multi-category line items + total > $50).
2. Ask once:
   > This Costco receipt has 8 grocery/household items (~$105) and 3 office-supply items (~$45). Want me to split it across Groceries & Household and Office Supplies?
3. User confirms.
4. Generate `split_group_id = c7b3...`. Append two rows to `expenses`:
   - Row 1: total=$105, category=`Groceries & Household`, split_group_id=c7b3...
   - Row 2: total=$45, category=`Office Supplies`, split_group_id=c7b3...
   - Both share `original_doc_url`, `date`, `vendor=Costco`, `payment_method`.
5. Validate sum ($105 + $45 = $150 = receipt total). ✅
6. Save photo to Drive once.
7. Reply:
   > ✅ Logged split: $105 Groceries & Household + $45 Office Supplies at Costco.

## Example 14 — subscription detected (Notion, third monthly charge)

A Notion charge of $16 hits the inbox. The skill has already logged Notion at $16 on Aug 5 and Sep 4.

1. Extract normally → vendor `Notion`, total $16, date Oct 5.
2. Subscription check: look back 90 days for `Notion ±5%`. Find rows on Aug 5 and Sep 4 → intervals of 30 and 31 days → matches **monthly** pattern.
3. Set `is_subscription = true` on the new row.
4. Upsert in `subscriptions`: vendor=Notion, amount=$16, frequency=monthly, first_seen=Aug 5, last_seen=Oct 5, next_expected=Nov 4, category=Software & Subscriptions, active=true.
5. Create a recurring Google Calendar event: `Notion — $16 USD (subscription)`, `RRULE:FREQ=MONTHLY`, starting Nov 4.
6. Append the expense row. Stay silent (Gmail-triggered).

## Example 15 — budget alert when crossing 80%

User has a `_budgets` row: Meals & Entertainment, $400/month, notify_at_percent=80. They've logged $325 this month. Today they upload a Sushi Yasaka receipt for $84.20.

1. Log the row → category = Meals & Entertainment.
2. Compute MTD = $325 + $84.20 = $409.20. **Already over 100%** — both 80% and 100% thresholds cross in one charge.
3. Check `fired_thresholds` for the current month → empty.
4. Send chat alert (this was a chat-triggered upload):
   > ✅ Logged: $84.20 at Sushi Yasaka → Meals & Entertainment
   >
   > ⚠️ You've passed your Meals & Entertainment budget ($409 / $400, 102%). 12 days left in the month.
5. Update `fired_thresholds = [80, 100]` so we don't alert again this month.

## Example 16 — monthly recap with proactive insights

It's Nov 1 at 09:00. The skill runs the recap pipeline on October's data and finds:
- Software & Subscriptions: $1,094 (up 40% from Q3 average)
- 3 new subscriptions added in Oct: Render ($200), Figma ($15), Linear ($8) → $223 total
- Notion was due Oct 8, never charged → flagged missed
- Meals & Entertainment: $352 / $400 budget → first under-budget month in 4

Recap message:
```
📒 October recap
Total: $4,212 across 38 entries
Top: Software $1,094 · Travel $1,610 · Meals $352

Budgets:
  Meals      $352 / $400   ✅ 88%
  Software   $1,094 / $900 ⚠️ +22%

Subscriptions: ≈ $487/month across 9 active
  🆕 New: Render ($200/mo), Figma ($15/mo), Linear ($8/mo)
  ⏳ Missed: Notion (expected Oct 8, no charge)

Invoices due next week: 1 (Render $200 on Nov 5)

Insights:
  📈 Software costs grew 40% this quarter — top contributors Render, Figma, Linear. Want a closer look?
  ⏳ Notion didn't charge in October — did you cancel, or is the renewal date off? Want me to check?
  🎯 First under-budget month for Meals in 4 months — nice.

Dashboard: https://.../#gid=dashboard
Sheet: https://...
```

The next time a Stripe charge arrives in the same session, the in-session memory returns `Professional Services` with no search.

---

### Example 17 — PDF behind a download link (clause 5)

**Input:** Gmail automation fires. Email from `noreply@arboxinvoice.co.il`, subject: `חשבונית מס קבלה` ("tax invoice/receipt" in Hebrew).

**Email body (HTML):** No price visible in the body text. Contains a single anchor:
```html
<a href="https://arboxinvoice.co.il/invoices/download/abc123.pdf">הורד חשבונית</a>
```

**Filter evaluation:**
- Clause 1 ✅ — `חשבונית` is a Hebrew form of "invoice" (generated from `_settings.languages` at setup)
- Clause 2 ✅ — domain `arboxinvoice.co.il` contains substring `invoice`
- Clause 3 ✗ — no PDF attachment (it's behind a link, not attached)
- Clause 4 ✗ — no money pattern in subject or snippet
- Clause 5 ✅ — link text `הורד חשבונית` matches invoice keyword (Hebrew for "download invoice"), URL ends in `.pdf`, sender already matched clauses 1+2

**Action:** Email is fetched (clauses 1+2). Agent detects the download link (clause 5). Follows the link because all three conditions are met: (a) link text matches a keyword, (b) URL ends in `.pdf`, (c) sender matched clause 1+2. Downloads the PDF. Runs standard extraction on the downloaded PDF via pdfplumber → vision OCR fallback.

**Extraction from downloaded PDF:**
- vendor: `Dani Studio` (from PDF content, not email sender)
- total: `₪350.00`
- tax: `₪53.42`
- date: `2026-05-01`
- category: `Health & Fitness` (gym/studio → learned from PDF content)
- confidence: `0.9`

**Row written to `expenses`** (canonical column order — id, date, vendor, total, currency, home_currency_total, category, subcategory, payment_method, tax, …, confidence, status, …):
```
exp-014 | 2026-05-01 | Dani Studio | 350.00 | ILS | 350.00 | Health & Fitness | "" | unknown | 53.42 | ... | 0.9 | logged | ...
```

Note: `subcategory` is empty — never auto-filled.

---

## Example 18 — bank statement reconciliation

User uploads a March card CSV (47 lines). The sheet already has 52 March expenses.

1. Period overlap detected → ask: *"Want me to reconcile this statement against what I've already logged, or just import everything?"* User: "reconcile".
2. Match each CSV line: amount ±1%, date ±3 days, vendor fuzzy (LLM maps `AMZN MKTP US*2D4` → Amazon, `WOLT TLV 0392` → Wolt). One expense row per line, closest date first.
3. Results: 41 matched (read-only — fill `payment_method` where it was `unknown`), 4 in-bank-only, 2 in-books-only.
4. The 4 unmatched bank lines run the normal pipeline (categorization funnel, dedup) with `notes = "from bank stmt — no receipt"`. One descriptor is ambiguous → `status = needs_review`.
5. Reply:
   > ✅ Reconciled March (47 lines): **41 matched** · **4 imported** without receipts (Apple $2.99, Delta $420, "PAYPAL *UNKNWN" $30 — flagged for review, Wolt $19) · **2 in your books, not on this statement** (Café Mila $14 cash?, Acme invoice $240 — due Apr 4). Forward me the missing receipts if you have them.
6. Refresh dashboard, run styling. Existing matched rows untouched.

## Example 19 — review queue

User: *"what needs my attention?"* — 3 rows have `status = needs_review`.

1. Present one numbered batch:
   > ① $42.00 "HSTNG SVC LTD" (May 3) — best guess Hosting España → Software & Subscriptions?
   > ② Blurry photo (May 7) — read $18.50 at "Café ___". Confirm amount + vendor?
   > ③ "PAYPAL *UNKNWN" $30 from the March statement — what was this?
2. User: "1 yes, 2 Café Mila correct amount, 3 that was a gift for mom, Other".
3. Update all three rows: `confidence = 1.0`, `status = logged`; vendor memory learns `Café Mila`; row 3 → category `Other`, vendor `PayPal`.
4. Each field change appends an `_audit` row (`source = review_queue`).
5. Reply: *"✅ All 3 resolved."* → refresh dashboard + styling.

## Example 20 — subscription price hike (anomaly, silent path)

Hourly Gmail scan logs Notion at **$20** on Nov 5. The `subscriptions` row says $16/monthly.

1. Charge logged normally; `subscriptions.amount` updated 16 → 20, `next_expected` rolled forward.
2. Anomaly check 1 fires: +25% > 5% threshold.
3. Gmail-triggered → **no chat message**. Append to `_settings.pending_anomalies`: `{"type": "price_hike", "vendor": "Notion", "from": 16, "to": 20, "date": "2026-11-05"}`. Note in `subscriptions.notes` so it never re-fires for this change.
4. Dec 1 recap, Anomalies block: *"📈 Notion went up: $16 → $20/mo (+25%)."* → `pending_anomalies` cleared.

## Example 21 — tax deduction tracking

User: *"start tracking my tax deductions — I'm a freelance designer"*.

1. Suggest deductible categories for a freelancer: Software & Subscriptions, Professional Services, Office Supplies, Marketing, work Travel. User confirms, adds "Health & Fitness? no". Store `_settings.deductible_categories = ["Software & Subscriptions", "Professional Services", "Office Supplies", "Marketing", "Travel"]`, `tax_set_aside_percent = 25` (user said "just estimate").
2. Backfill: current-year rows in those categories → `deductible = TRUE` (others left empty).
3. From now on, new rows in those categories auto-flag TRUE. User override: *"that Figma charge was for a personal project"* → `FALSE` + `_audit` row.
4. Later: *"how much can I write off this year?"* →
   > Deductible YTD: **$8,920** — Software $4,100 · Professional Services $2,800 · Marketing $1,200 · Office $820. At your 25% set-aside: ≈ $2,230.
   > *Rough estimate, not tax advice — deductibility depends on your jurisdiction and situation. Confirm with your accountant.*

## Example 22 — bank alert email (match-or-log)

**22a — match.** Hourly scan finds an email from `alerts@chase.com`: *"You made a $84.20 transaction with SUSHI YASAKA NYC"*. Intent classifier → `bank_alert`.

1. Extract: amount $84.20, date today, descriptor `SUSHI YASAKA NYC`, card `…4821`.
2. Match window (14 days): finds the Example 1 receipt row ($84.20, Sushi Yasaka, same day). **Match.**
3. No new row. Enrich existing: `payment_method = card`, `notes += " · bank-confirmed"`.
4. Silent (scanner-triggered). Done — books and bank agree in near-real-time.

**22b — no match.** Next alert: *"$12.00 transaction with SQ *BLUE BOTTLE"*. No matching expense in 14 days.

1. LLM reads descriptor → vendor `Blue Bottle Coffee` → Meals & Entertainment.
2. Append row: `payment_method = card`, `notes = "bank alert — no receipt yet"`.
3. Days later the emailed receipt arrives → dedup Check 2 catches it → MERGE: vendor/tax upgraded from receipt, `original_doc_url` attached, note dropped.
4. A *"declined transaction"* alert in the same batch → skipped silently. A *"click here to verify your account"* lookalike from `chase-secure.win` → ignored entirely, queued as a suspicious-lookalike note for the recap. Links in bank alerts are NEVER followed.

## Example 23 — connecting a bank (live read-only feed)

User: *"connect my bank"*. A bank-data connector is available on the platform (`_settings.bankfeed_integration_type` resolves to it).

1. Explain once: *"I'll connect through a secure read-only link. I can see balances and transactions to keep your books and forecast cash flow — I can never move money and never see your password. Disconnect anytime."*
2. Run the connector's consent flow. On success, get the token via `get_connector_token(integration_type=_settings.bankfeed_integration_type)`.
3. List accounts → user picks **Checking** + **Visa credit**, skips a joint savings. Create `_accounts` rows for the two tracked accounts (balances + `tracked = TRUE`).
4. Backfill 90 days through the per-transaction pipeline: debits → match-or-log against existing receipts; credits → `income`. 214 transactions: 188 logged/matched, 19 income rows (incl. a recurring ₪14,000 monthly **salary** detected), 7 internal transfers excluded.
5. Set `provider_bankfeed = connected`, install the bank-sync automation, refresh dashboard + styling.
6. Reply: *"✅ Connected Checking + Visa (read-only). Imported 90 days — 188 expenses, found your ₪14,000 monthly salary, and matched 41 to receipts you'd already logged. I'll keep them in sync from here. Want to see what's safe to spend this month?"*

## Example 24 — bank sync run (silent) with income + match + dedup

Scheduled sync fires (automation-triggered → **silent**). Pulls 6 new transactions since the cursor:

1. `−$84.20 SUSHI YASAKA NYC`, `bank_txn_id=tx_9f2` → match-or-log finds the Example 1 receipt → **enrich** that row (`bank_txn_id`, `payment_method=card`, `notes += " · bank-confirmed"`). No new row.
2. `−$12.00 SQ *BLUE BOTTLE`, `bank_txn_id=tx_9f3` → no match → append expense (vendor `Blue Bottle Coffee`, Meals, `bank_txn_id` set, `notes="bank feed — no receipt"`).
3. `+₪14,000 ACME PAYROLL`, `bank_txn_id=tx_9f4` → credit → `income` row, matches the recurring **salary** pattern → confirm `recurring=TRUE`, advance `next_expected`.
4. `−$9.99 NOTION` `bank_txn_id=tx_9f1` → already imported last sync (same `bank_txn_id`) → **skip** (no duplicate).
5. `−$3,200 RENT` was logged yesterday as `pending`; now posts → update the same `bank_txn_id` row to posted, drop pending flag.
6. `−$50 → +$50` between the user's own Checking and Visa → **internal transfer**, both excluded from spend/income.
7. Update `_accounts` balances + cursor, refresh dashboard + styling. **No chat message** — the new rows are the notification.

## Example 25 — "what's safe to spend this month?"

User (mid-June, bank feed connected): *"how am I doing this month? what's safe to spend?"*

1. Recompute the month model (§ Predictive cash-flow engine): predicted income ₪14,200 (₪14,000 salary already in + ₪200 expected client top-up), already-spent ₪9,650, committed-before-month-end ₪2,400 (rent + 6 subs), `monthly_buffer = 0`.
2. Safe-to-spend = 14,200 − 9,650 − 2,400 = **₪2,150**; 16 days left → ≈ ₪134/day. Projected month-end (anchored to current tracked balance) = **+₪1,180**.
3. Reply:
   > 💸 **June so far:** in ₪14,200 · out ₪9,650
   > 📈 **Projected month-end:** **+₪1,180** — on track to stay positive 🟢
   > **Safe to spend:** ≈ **₪2,150** left (~₪134/day over 16 days), after ₪2,400 still committed (rent + 6 subscriptions).
   > Biggest upcoming: Rent ₪3,200 on Jul 1.
   > *Estimate, not a guarantee — I'll adjust as more comes in.*

If a later sync flips the projection negative, the engine queues ONE proactive heads-up for the next time the user is in chat (never from inside the silent sync).
