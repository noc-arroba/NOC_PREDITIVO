"""
Bookkeeper — Dashboard Refresh (deterministic)

Populates the `dashboard` tab in the user's Bookkeeper sheet with the
MVP layout from reference.md § Dashboard: title bar, KPI strip,
spending-by-category table, and monthly trend table. Idempotent —
running twice yields the same result.

This script exists so the dashboard is always populated and consistent.
The agent should call it after every expense write (per SKILL.md
Critical Rule 3). Pair it with style_all_tabs.py for the tab-level chrome.

Usage:
  python3 refresh_dashboard.py <sheet_id>

Env:
  GOOGLESHEETS_ACCESS_TOKEN  (required)
  BOOKKEEPER_SHEET_ID        (optional fallback)

What it writes (MVP — 4 sections):
  1. Title bar:        "Bookkeeper" + period + last-updated timestamp
  2. KPI strip:        This Month total · vs Last Month · Avg/Day · Receipts
  3. Spending by Category:  table, sorted desc by amount, with share %
  4. Monthly Trend:    last 12 months, total + receipt count per month

What it does NOT do (intentionally minimal):
  - Native Sheets charts — use generate_report.py for the PNG visual
  - Top vendors, subscriptions section, insights — out of MVP scope

Labels are translated via _settings.label_translations (populated at onboarding).
If translations are missing, falls back to English.
"""

import os
import sys
import json
import re
import datetime as dt
import requests
from collections import defaultdict
from calendar import monthrange

# ─── ARGS / ENV ───────────────────────────────────────────────────────────────
from ledger_backend import get_backend, resolve_provider_and_token, excel_style_dashboard
PROVIDER, TOKEN = resolve_provider_and_token()

SHEET_ID = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("BOOKKEEPER_SHEET_ID", "")
if not SHEET_ID:
    print("ERROR: SHEET_ID is required. Pass as 1st arg or set BOOKKEEPER_SHEET_ID env var.")
    print("(googlesheets → spreadsheet ID; excel → OneDrive driveItem ID of the workbook)")
    sys.exit(1)

BACKEND  = get_backend(SHEET_ID, PROVIDER, TOKEN)
API_BASE = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"
HEADERS  = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

DASHBOARD_TAB = "dashboard"
CLEAR_RANGE   = f"{DASHBOARD_TAB}!A1:Z200"
TODAY         = dt.date.today()

# ─── COLORS (subset from reference.md § Visual design system) ─────────────────
def rgb(hex_str):
    h = hex_str.lstrip("#")
    return {"red": int(h[0:2], 16) / 255,
            "green": int(h[2:4], 16) / 255,
            "blue":  int(h[4:6], 16) / 255}

INK_900    = rgb("#0F172A")  # title + section header bg
INK_700    = rgb("#334155")  # primary text on light bg
INK_500    = rgb("#64748B")  # subdued text
INK_100    = rgb("#F1F5F9")  # table header bg
SURFACE_0  = rgb("#FFFFFF")
SURFACE_50 = rgb("#F8FAFC")
WHITE      = rgb("#FFFFFF")
POS_GREEN  = rgb("#16A34A")  # spending decreased
NEG_RED    = rgb("#DC2626")  # spending increased

# ─── FETCH (provider-agnostic) ───────────────────────────────────────────────
def fetch_values(tab):
    return BACKEND.read_values(tab)

def fetch_metadata():
    r = requests.get(f"{API_BASE}?includeGridData=false", headers=HEADERS)
    r.raise_for_status()
    return r.json()

# ─── READ DATA ────────────────────────────────────────────────────────────────
def read_settings():
    out = {}
    for row in fetch_values("_settings")[1:]:
        if len(row) >= 2:
            out[row[0]] = row[1]
    return out

def parse_expenses():
    """Return list of dicts: {date, vendor, amount, category, status}."""
    rows = fetch_values("expenses")
    if len(rows) < 2:
        return []
    headers = rows[0]
    col = {h.lower().strip(): i for i, h in enumerate(headers)}
    amt_col       = col.get("home_currency_total") or col.get("amount_home_currency")
    if amt_col is None:
        for h, idx in col.items():
            hl = h.lower()
            if 'home' in hl and ('amount' in hl or 'total' in hl):
                amt_col = idx
                break
    if amt_col is None:
        for h, idx in col.items():
            hl = h.lower()
            if hl.startswith('home_currency_') and hl != 'home_currency':
                amt_col = idx
                break
    amt_col_fb    = col.get("total") or col.get("amount")  # fallback if primary is empty
    date_col = col.get("date")
    out = []
    for r in rows[1:]:
        if len(r) <= max(date_col or 0, amt_col or 0, amt_col_fb or 0):
            continue
        try:
            d = dt.datetime.strptime(r[date_col], "%Y-%m-%d").date()
        except Exception:
            continue
        # Try home_currency_total first; if empty, fall back to total column
        raw_amt = ""
        if amt_col is not None and len(r) > amt_col:
            raw_amt = r[amt_col]
        if not raw_amt and amt_col_fb is not None and len(r) > amt_col_fb:
            raw_amt = r[amt_col_fb]
        # Strip currency symbols, commas, whitespace before parsing
        raw_amt = re.sub(r'[^\d.\-]', '', raw_amt)
        try:
            amt = float(raw_amt or 0)
        except Exception:
            amt = 0.0
        status = r[col["status"]] if "status" in col and len(r) > col["status"] else "logged"
        if status == "duplicate_pending":
            continue
        out.append({
            "date":     d,
            "vendor":   r[col["vendor"]] if "vendor" in col and len(r) > col["vendor"] else "",
            "amount":   amt,
            "category": r[col["category"]] if "category" in col and len(r) > col["category"] else "Other",
            "status":   status,
        })
    return out

# ─── COMPUTE AGGREGATES ───────────────────────────────────────────────────────
def month_bounds(year, month):
    last_day = monthrange(year, month)[1]
    return dt.date(year, month, 1), dt.date(year, month, last_day)

def aggregates(expenses):
    this_y, this_m = TODAY.year, TODAY.month
    last_m_year, last_m_month = (this_y, this_m - 1) if this_m > 1 else (this_y - 1, 12)
    this_start, _   = month_bounds(this_y, this_m)
    last_start, last_end = month_bounds(last_m_year, last_m_month)

    this_month_total = sum(e["amount"] for e in expenses
                           if this_start <= e["date"] <= TODAY)
    last_month_total = sum(e["amount"] for e in expenses
                           if last_start <= e["date"] <= last_end)
    receipts_this    = sum(1 for e in expenses if this_start <= e["date"] <= TODAY)
    days_elapsed     = (TODAY - this_start).days + 1
    avg_per_day      = this_month_total / days_elapsed if days_elapsed else 0.0

    pct_vs_last = None
    if last_month_total > 0:
        pct_vs_last = (this_month_total - last_month_total) / last_month_total * 100.0

    by_cat = defaultdict(float)
    for e in expenses:
        if this_start <= e["date"] <= TODAY:
            by_cat[e["category"] or "Other"] += e["amount"]
    by_cat_sorted = sorted(by_cat.items(), key=lambda x: -x[1])

    # last 12 months trend
    monthly = defaultdict(lambda: {"total": 0.0, "count": 0})
    for e in expenses:
        key = f"{e['date'].year:04d}-{e['date'].month:02d}"
        monthly[key]["total"] += e["amount"]
        monthly[key]["count"] += 1
    # Build the last 12 month keys in order (oldest → newest), even if some are 0
    months_list = []
    y, m = this_y, this_m
    for _ in range(12):
        months_list.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12; y -= 1
    months_list.reverse()
    monthly_trend = [(k, monthly[k]["total"], monthly[k]["count"]) for k in months_list]

    return {
        "this_month_total": this_month_total,
        "last_month_total": last_month_total,
        "pct_vs_last":      pct_vs_last,
        "avg_per_day":      avg_per_day,
        "receipts_this":    receipts_this,
        "by_cat":           by_cat_sorted,
        "monthly_trend":    monthly_trend,
        "this_period_label": this_start.strftime("%B %Y"),
    }

# ─── CURRENCY FORMATTING ──────────────────────────────────────────────────────
SETTINGS      = read_settings()
HOME_CURRENCY = SETTINGS.get("home_currency", "USD")
CURRENCY_SYMBOL = {"USD": "$", "EUR": "€", "GBP": "£", "ILS": "₪",
                   "JPY": "¥", "CHF": "CHF ", "AUD": "$", "CAD": "$"}.get(HOME_CURRENCY,
                                                                          f"{HOME_CURRENCY} ")
CURRENCY_PATTERN = {
    "USD": '[$$-409]#,##0.00;[Red]-[$$-409]#,##0.00',
    "EUR": '[$€-2]#,##0.00;[Red]-[$€-2]#,##0.00',
    "GBP": '[$£-809]#,##0.00;[Red]-[$£-809]#,##0.00',
    "ILS": '[$₪-40D]#,##0.00;[Red]-[$₪-40D]#,##0.00',
    "JPY": '[$¥-411]#,##0;[Red]-[$¥-411]#,##0',
}.get(HOME_CURRENCY,
      f'"{HOME_CURRENCY} "#,##0.00;[Red]"-{HOME_CURRENCY} "#,##0.00')


def fmt_money(v):
    return f"{CURRENCY_SYMBOL}{v:,.2f}"

# ─── LABEL TRANSLATIONS ──────────────────────────────────────────────────────
# Read from _settings.label_translations (JSON dict). Fall back to English.
_translations = {}
_raw = SETTINGS.get("label_translations", "{}")
try:
    _translations = json.loads(_raw) if isinstance(_raw, str) else (_raw or {})
except Exception:
    pass

def L(key):
    """Look up a translated label. Falls back to the English key itself."""
    return _translations.get(key, key)

# ─── LAYOUT BUILD ─────────────────────────────────────────────────────────────
NUM_COLS = 5  # A..E

def build_value_rows(agg):
    """Build (values, layout_meta) where layout_meta tracks row indices for styling."""
    rows = []
    meta = {}

    # Row 1 — title
    last_updated = TODAY.strftime("%b %d, %Y")
    title_line = f"{L('Bookkeeper')}  ·  {agg['this_period_label']}  ·  {L('Last updated')} {last_updated}"
    rows.append([title_line, "", "", "", ""])
    meta["title_row"] = len(rows)  # 1

    # Row 2 — spacer
    rows.append(["", "", "", "", ""])

    # Row 3 — section header
    rows.append([L("THIS MONTH"), "", "", "", ""])
    meta["section_this_month"] = len(rows)  # 3

    # Rows 4-5 — KPI strip
    pct = agg["pct_vs_last"]
    vs_last_str = (f"{pct:+.1f}% {L('vs LAST MONTH').lower()}" if pct is not None
                   else f"({L('no data last month')})")
    rows.append([L("TOTAL"), L("vs LAST MONTH"), L("AVG / DAY"), L("RECEIPTS"), ""])
    meta["kpi_labels_row"] = len(rows)  # 4
    rows.append([fmt_money(agg["this_month_total"]),
                 vs_last_str,
                 fmt_money(agg["avg_per_day"]),
                 str(agg["receipts_this"]),
                 ""])
    meta["kpi_values_row"] = len(rows)  # 5

    # Row 6 — spacer
    rows.append(["", "", "", "", ""])

    # Row 7 — section header
    rows.append([L("SPENDING BY CATEGORY"), "", "", "", ""])
    meta["section_by_cat"] = len(rows)  # 7

    # Row 8 — table header
    rows.append([L("Category"), L("Total"), L("% of Total"), "", ""])
    meta["by_cat_header_row"] = len(rows)

    # Rows 9+ — category data
    cat_data_start = len(rows) + 1
    total_this = agg["this_month_total"] or 1.0  # avoid div by zero
    if not agg["by_cat"]:
        rows.append([f"({L('no spending this period')})", "", "", "", ""])
    else:
        for cat, val in agg["by_cat"]:
            share_pct = (val / total_this) * 100.0
            rows.append([cat, fmt_money(val), f"{share_pct:.0f}%", "", ""])
    meta["by_cat_data_start"] = cat_data_start
    meta["by_cat_data_end"]   = len(rows)  # inclusive

    # Spacer
    rows.append(["", "", "", "", ""])
    rows.append(["", "", "", "", ""])

    # Section header — Monthly trend
    rows.append([L("MONTHLY TREND"), "", "", "", ""])
    meta["section_monthly"] = len(rows)

    # Table header
    rows.append([L("Month"), L("Total"), L("Receipts"), "", ""])
    meta["monthly_header_row"] = len(rows)

    # Data
    mon_start = len(rows) + 1
    for key, total, count in agg["monthly_trend"]:
        # display "Jun 2026" instead of "2026-06"
        y, m = key.split("-")
        d  = dt.date(int(y), int(m), 1)
        label = d.strftime("%b %Y")
        rows.append([label, fmt_money(total) if count else "—", str(count) if count else "—", "", ""])
    meta["monthly_data_start"] = mon_start
    meta["monthly_data_end"]   = len(rows)

    return rows, meta

# ─── FORMAT REQUESTS ──────────────────────────────────────────────────────────
def get_dashboard_sheet_id():
    meta = fetch_metadata()
    for s in meta.get("sheets", []):
        if s["properties"]["title"] == DASHBOARD_TAB:
            return s["properties"]["sheetId"]
    return None

def fmt_range(sid, r0, r1, c0=0, c1=NUM_COLS):
    """Row index is 0-based; r0 inclusive, r1 exclusive."""
    return {"sheetId": sid, "startRowIndex": r0, "endRowIndex": r1,
            "startColumnIndex": c0, "endColumnIndex": c1}

def format_requests(sid, meta):
    """Build all formatting batchUpdate requests."""
    reqs = []

    # Title row — large white-on-navy
    r = meta["title_row"] - 1  # to 0-indexed
    reqs.append({"mergeCells": {
        "range": fmt_range(sid, r, r + 1),
        "mergeType": "MERGE_ALL"
    }})
    reqs.append({"repeatCell": {
        "range": fmt_range(sid, r, r + 1),
        "cell": {"userEnteredFormat": {
            "backgroundColor": INK_900,
            "backgroundColorStyle": {"rgbColor": INK_900},
            "textFormat": {"foregroundColor": WHITE, "fontSize": 14, "bold": True},
            "horizontalAlignment": "LEFT",
            "verticalAlignment": "MIDDLE",
            "padding": {"top": 8, "bottom": 8, "left": 12, "right": 12},
        }},
        "fields": ("userEnteredFormat.backgroundColor,"
                   "userEnteredFormat.backgroundColorStyle,"
                   "userEnteredFormat.textFormat,"
                   "userEnteredFormat.horizontalAlignment,"
                   "userEnteredFormat.verticalAlignment,"
                   "userEnteredFormat.padding")
    }})
    reqs.append({"updateDimensionProperties": {
        "range": {"sheetId": sid, "dimension": "ROWS",
                  "startIndex": r, "endIndex": r + 1},
        "properties": {"pixelSize": 44},
        "fields": "pixelSize"
    }})

    # Section headers — smaller white-on-navy
    section_rows_1idx = [meta["section_this_month"],
                         meta["section_by_cat"],
                         meta["section_monthly"]]
    for r1 in section_rows_1idx:
        r = r1 - 1
        reqs.append({"mergeCells": {
            "range": fmt_range(sid, r, r + 1),
            "mergeType": "MERGE_ALL"
        }})
        reqs.append({"repeatCell": {
            "range": fmt_range(sid, r, r + 1),
            "cell": {"userEnteredFormat": {
                "backgroundColor": INK_900,
                "backgroundColorStyle": {"rgbColor": INK_900},
                "textFormat": {"foregroundColor": WHITE, "fontSize": 10, "bold": True},
                "horizontalAlignment": "LEFT",
                "verticalAlignment": "MIDDLE",
                "padding": {"top": 4, "bottom": 4, "left": 12, "right": 12},
            }},
            "fields": ("userEnteredFormat.backgroundColor,"
                       "userEnteredFormat.backgroundColorStyle,"
                       "userEnteredFormat.textFormat,"
                       "userEnteredFormat.horizontalAlignment,"
                       "userEnteredFormat.verticalAlignment,"
                       "userEnteredFormat.padding")
        }})
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sid, "dimension": "ROWS",
                      "startIndex": r, "endIndex": r + 1},
            "properties": {"pixelSize": 28},
            "fields": "pixelSize"
        }})

    # KPI labels (row 4)
    r = meta["kpi_labels_row"] - 1
    reqs.append({"repeatCell": {
        "range": fmt_range(sid, r, r + 1, 0, 4),
        "cell": {"userEnteredFormat": {
            "backgroundColor": INK_100,
            "textFormat": {"foregroundColor": INK_500, "fontSize": 9, "bold": True},
            "horizontalAlignment": "CENTER",
            "verticalAlignment": "MIDDLE",
        }},
        "fields": ("userEnteredFormat.backgroundColor,"
                   "userEnteredFormat.textFormat,"
                   "userEnteredFormat.horizontalAlignment,"
                   "userEnteredFormat.verticalAlignment")
    }})

    # KPI values (row 5) — bigger, bolder
    r = meta["kpi_values_row"] - 1
    reqs.append({"repeatCell": {
        "range": fmt_range(sid, r, r + 1, 0, 4),
        "cell": {"userEnteredFormat": {
            "backgroundColor": SURFACE_0,
            "textFormat": {"foregroundColor": INK_700, "fontSize": 14, "bold": True},
            "horizontalAlignment": "CENTER",
            "verticalAlignment": "MIDDLE",
        }},
        "fields": ("userEnteredFormat.backgroundColor,"
                   "userEnteredFormat.textFormat,"
                   "userEnteredFormat.horizontalAlignment,"
                   "userEnteredFormat.verticalAlignment")
    }})
    reqs.append({"updateDimensionProperties": {
        "range": {"sheetId": sid, "dimension": "ROWS",
                  "startIndex": r, "endIndex": r + 1},
        "properties": {"pixelSize": 40},
        "fields": "pixelSize"
    }})

    # Color the "vs LAST MONTH" KPI value based on direction
    # (B5 — column index 1 in row meta["kpi_values_row"])
    pct = aggregates_cache["pct_vs_last"] if "pct_vs_last" in aggregates_cache else None
    if pct is not None:
        color = NEG_RED if pct > 0 else POS_GREEN
        reqs.append({"repeatCell": {
            "range": fmt_range(sid, r, r + 1, 1, 2),
            "cell": {"userEnteredFormat": {
                "textFormat": {"foregroundColor": color, "fontSize": 12, "bold": True}
            }},
            "fields": "userEnteredFormat.textFormat"
        }})

    # Table headers (by_cat + monthly)
    for r1, cols in [(meta["by_cat_header_row"], 3),
                     (meta["monthly_header_row"], 3)]:
        r = r1 - 1
        reqs.append({"repeatCell": {
            "range": fmt_range(sid, r, r + 1, 0, cols),
            "cell": {"userEnteredFormat": {
                "backgroundColor": INK_100,
                "textFormat": {"foregroundColor": INK_500, "fontSize": 9, "bold": True},
                "horizontalAlignment": "LEFT",
                "verticalAlignment": "MIDDLE",
                "padding": {"top": 4, "bottom": 4, "left": 8, "right": 8},
            }},
            "fields": ("userEnteredFormat.backgroundColor,"
                       "userEnteredFormat.textFormat,"
                       "userEnteredFormat.horizontalAlignment,"
                       "userEnteredFormat.verticalAlignment,"
                       "userEnteredFormat.padding")
        }})
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sid, "dimension": "ROWS",
                      "startIndex": r, "endIndex": r + 1},
            "properties": {"pixelSize": 26},
            "fields": "pixelSize"
        }})

    # Data rows for both tables — banded, dark text
    for r_start_1idx, r_end_1idx, num_cols in [
        (meta["by_cat_data_start"], meta["by_cat_data_end"], 3),
        (meta["monthly_data_start"], meta["monthly_data_end"], 3),
    ]:
        if r_end_1idx < r_start_1idx:
            continue
        r0 = r_start_1idx - 1
        r1_excl = r_end_1idx  # since end_1idx is the last row 1-indexed = 0-indexed end-exclusive
        # Text format on all data rows in this block
        reqs.append({"repeatCell": {
            "range": fmt_range(sid, r0, r1_excl, 0, num_cols),
            "cell": {"userEnteredFormat": {
                "textFormat": {"foregroundColor": INK_700, "fontSize": 10, "bold": False},
                "verticalAlignment": "MIDDLE",
                "padding": {"top": 2, "bottom": 2, "left": 8, "right": 8},
            }},
            "fields": ("userEnteredFormat.textFormat,"
                       "userEnteredFormat.verticalAlignment,"
                       "userEnteredFormat.padding")
        }})
        # Banded backgrounds: even data rows surface_50, odd surface_0
        for i, row_1idx in enumerate(range(r_start_1idx, r_end_1idx + 1)):
            r = row_1idx - 1
            bg = SURFACE_50 if i % 2 == 1 else SURFACE_0
            reqs.append({"repeatCell": {
                "range": fmt_range(sid, r, r + 1, 0, num_cols),
                "cell": {"userEnteredFormat": {"backgroundColor": bg}},
                "fields": "userEnteredFormat.backgroundColor"
            }})
            reqs.append({"updateDimensionProperties": {
                "range": {"sheetId": sid, "dimension": "ROWS",
                          "startIndex": r, "endIndex": r + 1},
                "properties": {"pixelSize": 24},
                "fields": "pixelSize"
            }})
        # Right-align the numeric columns (Total, Receipts, %)
        for col_idx in range(1, num_cols):
            reqs.append({"repeatCell": {
                "range": fmt_range(sid, r0, r1_excl, col_idx, col_idx + 1),
                "cell": {"userEnteredFormat": {"horizontalAlignment": "RIGHT"}},
                "fields": "userEnteredFormat.horizontalAlignment"
            }})

    # Column widths
    for col_idx, width in enumerate([220, 140, 110, 80, 80]):
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sid, "dimension": "COLUMNS",
                      "startIndex": col_idx, "endIndex": col_idx + 1},
            "properties": {"pixelSize": width},
            "fields": "pixelSize"
        }})

    # Hide gridlines + freeze the title row
    reqs.append({"updateSheetProperties": {
        "properties": {
            "sheetId": sid,
            "gridProperties": {"hideGridlines": True, "frozenRowCount": 1}
        },
        "fields": "gridProperties.hideGridlines,gridProperties.frozenRowCount"
    }})

    # Unmerge anything outside the explicit merge ranges (defensive — old layouts
    # may have left merges in odd cells; safest is to issue unmerge for the
    # whole range then re-merge what we want. We'll skip this for simplicity:
    # the title + section header merges above replace any previous merges in
    # those rows because mergeCells is idempotent for the same range.)

    return reqs

# Global so the `pct color` block above can read it (no clean way to thread
# it through without restructuring)
aggregates_cache = {}

# ─── MAIN (excel path — best-effort, no Sheets batchUpdate) ──────────────────
def main_excel():
    print(f"Bookkeeper — refreshing dashboard (excel) in workbook {SHEET_ID[:12]}…")
    if DASHBOARD_TAB not in BACKEND.list_tabs():
        print("ERROR: dashboard tab not found. Run onboarding first.")
        return 1

    expenses = parse_expenses()
    print(f"  loaded {len(expenses)} expense rows")
    agg = aggregates(expenses)
    aggregates_cache.update(agg)
    values, layout = build_value_rows(agg)

    BACKEND.clear_range(DASHBOARD_TAB, "A1:Z200")
    BACKEND.unmerge(DASHBOARD_TAB, f"A1:E200")
    w = BACKEND.write_values(DASHBOARD_TAB, f"A1:E{len(values)}", values)
    if w.status_code not in (200, 201):
        print(f"  ERROR: write values returned {w.status_code}: {w.text[:300]}")
        return 1
    excel_style_dashboard(BACKEND, DASHBOARD_TAB, layout, NUM_COLS)
    print(f"  ✓ dashboard refreshed — {len(values)} rows written (excel best-effort)")
    print(f"    this month: {fmt_money(agg['this_month_total'])} "
          f"({agg['receipts_this']} receipts)")
    return 0


# ─── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    if PROVIDER == "excel":
        return main_excel()

    print(f"Bookkeeper — refreshing dashboard in sheet {SHEET_ID[:12]}…")

    sid = get_dashboard_sheet_id()
    if sid is None:
        print("ERROR: dashboard tab not found. Run onboarding first.")
        return 1

    expenses = parse_expenses()
    print(f"  loaded {len(expenses)} expense rows")
    agg = aggregates(expenses)
    aggregates_cache.update(agg)

    values, layout = build_value_rows(agg)

    # 1. Clear the dashboard tab
    clear_resp = requests.post(
        f"{API_BASE}/values/{CLEAR_RANGE}:clear",
        headers=HEADERS, data="{}"
    )
    if clear_resp.status_code not in (200, 204):
        print(f"  WARN: clear returned {clear_resp.status_code}: {clear_resp.text[:200]}")

    # Also remove any existing merges across the dashboard sheet so the new
    # merges land cleanly. The unmerge below is scoped to the rows we care
    # about; existing data outside our layout is gone after the clear.
    unmerge_req = {"requests": [{
        "unmergeCells": {
            "range": {"sheetId": sid,
                      "startRowIndex": 0, "endRowIndex": 200,
                      "startColumnIndex": 0, "endColumnIndex": NUM_COLS}
        }
    }]}
    requests.post(f"{API_BASE}:batchUpdate", headers=HEADERS,
                  data=json.dumps(unmerge_req))

    # 2. Write values
    write_resp = requests.put(
        f"{API_BASE}/values/{DASHBOARD_TAB}!A1:E{len(values)}?valueInputOption=RAW",
        headers=HEADERS,
        data=json.dumps({"range": f"{DASHBOARD_TAB}!A1:E{len(values)}",
                         "majorDimension": "ROWS",
                         "values": values})
    )
    if write_resp.status_code != 200:
        print(f"  ERROR: write values returned {write_resp.status_code}: {write_resp.text[:300]}")
        return 1

    # 3. Apply formatting
    reqs = format_requests(sid, layout)
    fmt_resp = requests.post(
        f"{API_BASE}:batchUpdate",
        headers=HEADERS,
        data=json.dumps({"requests": reqs})
    )
    if fmt_resp.status_code != 200:
        print(f"  ERROR: formatting returned {fmt_resp.status_code}: {fmt_resp.text[:300]}")
        return 1

    print(f"  ✓ dashboard refreshed — {len(values)} rows written, "
          f"{len(reqs)} format requests applied")
    print(f"    this month: {fmt_money(agg['this_month_total'])} "
          f"({agg['receipts_this']} receipts)")
    if agg["pct_vs_last"] is not None:
        print(f"    vs last:    {agg['pct_vs_last']:+.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
