# Bookkeeper skill — agent rules

## Always check the skill before acting

For ANY Bookkeeper-related task (report, expense log, backfill, dashboard, subscriptions, etc.):
1. Read `.agents/skills/bookkeeper/SKILL.md` first (or call `activate_platform_skill("bookkeeper")`)
2. Follow the documented procedure exactly — do NOT write inline code that duplicates existing scripts

## Report requests specifically

When the user asks for a "summary", "report", "monthly report", "dashboard image", or similar:
- DO NOT write a new matplotlib script inline
- DO run `.agents/skills/bookkeeper/generate_report.py` with the correct args
- Look up the ledger ID from `_settings` or from the files provider (search for the title prefix `Bookkeeper —`)
- Mode is `months_back=1` for "last month", `month` for current month, or `YYYY-MM-DD:YYYY-MM-DD` for explicit range

## Provider env for ALL three scripts

Set before every script call, per `_settings.provider_ledger`:
- Google: `LEDGER_PROVIDER=googlesheets` + `GOOGLESHEETS_ACCESS_TOKEN=<token>`; `<SHEET_ID>` = spreadsheet ID
- Microsoft: `LEDGER_PROVIDER=excel` + `MSGRAPH_ACCESS_TOKEN=<token>`; `<SHEET_ID>` = OneDrive driveItem ID of the workbook
- Excel styling is best-effort (no tab colors / freeze / conditional formats) — that's expected, not a bug to fix inline

## Sheet styling specifically

After ANY write to the Bookkeeper sheet (creating tabs, appending rows, bulk imports, dashboard refresh):
- DO NOT issue inline `batchUpdate` requests for `updateSheetProperties`, `repeatCell`, `addBanding`, `updateDimensionProperties`, or `addConditionalFormatRule`
- DO run `.agents/skills/bookkeeper/style_all_tabs.py <SHEET_ID>` — it applies the full Visual Design System deterministically and is idempotent

## Dashboard refresh specifically

After ANY new expense row is written:
- DO NOT write the dashboard tab inline
- DO run `.agents/skills/bookkeeper/refresh_dashboard.py <SHEET_ID>` — it computes aggregates and writes the MVP layout (title + KPI strip + categories + monthly trend). Idempotent.

## Bank feed & cash flow are agent-driven (no script)

- The **live bank feed** (connect, sync, match-or-log), **income tracking**, and the **predictive cash-flow engine** are agent-driven — there is no script for them. Follow `reference.md` § Bank feed (live read-only connection), § Income tracking, and § Predictive cash-flow engine.
- The bank feed is **read-only**: never call a payment/transfer/write endpoint on the bank connector, ever. Token: `get_connector_token(integration_type=_settings.bankfeed_integration_type)`.
- Bank feed is **provider-agnostic** — never hardcode an aggregator name; use `_settings.bankfeed_integration_type`.
- After writing to the new `income` / `_accounts` tabs, still run `style_all_tabs.py` (it now has config for both) and `refresh_dashboard.py`.

## Script exists, don't recreate it

- `generate_report.py` — visual PNG report (5 sections: header + KPI strip, category distribution, budget overview, top 10 expenses, subscriptions)
- `style_all_tabs.py` — Google Sheets styling (tab colors, frozen headers, banded rows with explicit dark text, per-column formats, conditional formatting). Call after every meaningful sheet write.
- `refresh_dashboard.py` — Google Sheets `dashboard` tab content (aggregates + sections). Call after every new expense.
