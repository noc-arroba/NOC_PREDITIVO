"""
Bookkeeper — Tab Styler (deterministic)

Applies the full Bookkeeper Visual Design System to every tab in the
user's Bookkeeper sheet. Idempotent: running it twice yields the same
result. This script exists because the styling has to be deterministic;
prose instructions to the agent are not reliable enough.

Usage:
  python3 style_all_tabs.py <sheet_id>

Args:
  sheet_id  — the Google Sheet ID for THIS user's Bookkeeper sheet.

Env:
  GOOGLESHEETS_ACCESS_TOKEN  (required) — fresh OAuth token with edit scope.
  BOOKKEEPER_SHEET_ID        (optional) — fallback if sheet_id not passed.

What it does (in order, per tab):
  1. Tab color (per the per-tab table in reference.md § Tab styling)
  2. Freeze row 1
  3. Hide gridlines on the `dashboard` tab
  4. Header row (row 0) styling — ink-900 background, WHITE BOLD text,
     row height 32pt
  5. Data rows styling — banded backgrounds (surface-0 / surface-50),
     EXPLICIT ink-700 text color (never inherits white from header),
     row height 26pt
  6. Per-column number formats (date / currency / percent), driven by
     each tab's canonical schema (see onboarding.md § Tab schemas)
  7. Column widths to per-tab minimums
  8. Conditional formatting per tab

If a tab from the canonical set is missing, it is skipped with a warning;
the script does not create tabs (that is onboarding's job).
"""

import os
import sys
import json
import requests

# ─── ARGS / ENV ───────────────────────────────────────────────────────────────
from ledger_backend import get_backend, resolve_provider_and_token, excel_style_all_tabs
PROVIDER, TOKEN = resolve_provider_and_token()

SHEET_ID = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("BOOKKEEPER_SHEET_ID", "")
if not SHEET_ID:
    print("ERROR: SHEET_ID is required. Pass as 1st arg or set BOOKKEEPER_SHEET_ID env var.")
    print("(googlesheets → spreadsheet ID; excel → OneDrive driveItem ID of the workbook)")
    sys.exit(1)

API_BASE = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"
HEADERS  = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

# ─── COLOR TOKENS (from reference.md § Visual design system) ─────────────────
def rgb(hex_str):
    """#RRGGBB → {red, green, blue} floats 0..1 (Sheets API format)."""
    h = hex_str.lstrip("#")
    return {
        "red":   int(h[0:2], 16) / 255,
        "green": int(h[2:4], 16) / 255,
        "blue":  int(h[4:6], 16) / 255,
    }

INK_900    = rgb("#0F172A")
INK_700    = rgb("#334155")
INK_500    = rgb("#64748B")
INK_300    = rgb("#CBD5E1")
SURFACE_0  = rgb("#FFFFFF")
SURFACE_50 = rgb("#F8FAFC")
WHITE      = rgb("#FFFFFF")

CHART_1_BLUE   = rgb("#3B82F6")  # expenses tab color
CHART_3_AMBER  = rgb("#F59E0B")  # subscriptions tab color
POS_500_GREEN  = rgb("#22C55E")  # _budgets tab color
ACCENT_ORANGE  = rgb("#F97316")  # dashboard tab color
INCOME_EMERALD = rgb("#10B981")  # income tab color (money in)
ACCT_TEAL      = rgb("#14B8A6")  # _accounts tab color (linked banks)

POS_BG   = rgb("#DCFCE7")  # active TRUE
NEG_BG   = rgb("#FEE2E2")  # over budget / inactive
AMBER_BG = rgb("#FEF3C7")  # needs_review

# ─── TEXT FORMATS — explicit; do NOT let header white leak into data rows ─────
HEADER_TEXT_FORMAT = {
    "foregroundColor": WHITE,
    "fontSize":        11,
    "bold":            True,
}

DATA_TEXT_FORMAT = {
    "foregroundColor": INK_700,
    "fontSize":        10,
    "bold":            False,
}

# ─── HOME CURRENCY (from _settings, fallback USD) ─────────────────────────────
def fetch_settings():
    """Read _settings tab into a dict. Empty dict if tab missing."""
    r = requests.get(f"{API_BASE}/values/_settings", headers=HEADERS)
    if r.status_code != 200:
        return {}
    out = {}
    for row in r.json().get("values", [])[1:]:
        if len(row) >= 2:
            out[row[0]] = row[1]
    return out

settings      = fetch_settings()
HOME_CURRENCY = settings.get("home_currency", "USD")

# Google Sheets locale codes for currency format strings
CURRENCY_LOCALE_PATTERN = {
    "USD": '[$$-409]#,##0.00;[Red]-[$$-409]#,##0.00',
    "EUR": '[$€-2]#,##0.00;[Red]-[$€-2]#,##0.00',
    "GBP": '[$£-809]#,##0.00;[Red]-[$£-809]#,##0.00',
    "ILS": '[$₪-40D]#,##0.00;[Red]-[$₪-40D]#,##0.00',
    "JPY": '[$¥-411]#,##0;[Red]-[$¥-411]#,##0',
    "CHF": '[$CHF-100C]#,##0.00;[Red]-[$CHF-100C]#,##0.00',
    "AUD": '[$$-C09]#,##0.00;[Red]-[$$-C09]#,##0.00',
    "CAD": '[$$-1009]#,##0.00;[Red]-[$$-1009]#,##0.00',
}
CURRENCY_FORMAT = CURRENCY_LOCALE_PATTERN.get(
    HOME_CURRENCY,
    f'"{HOME_CURRENCY} "#,##0.00;[Red]"-{HOME_CURRENCY} "#,##0.00'
)

NUMBER_FORMATS = {
    "DATE":     {"type": "DATE",     "pattern": "yyyy-mm-dd"},
    "CURRENCY": {"type": "CURRENCY", "pattern": CURRENCY_FORMAT},
    "PERCENT":  {"type": "PERCENT",  "pattern": "0%"},
    "INTEGER":  {"type": "NUMBER",   "pattern": "#,##0"},
}

# ─── PER-TAB CONFIG (canonical schemas from onboarding.md § Tab schemas) ─────
TAB_CONFIG = {
    "expenses": {
        "tab_color": CHART_1_BLUE,
        "schema":    ["id", "date", "vendor", "total", "currency", "home_currency_total",
                      "category", "subcategory", "payment_method", "tax", "notes",
                      "original_doc_url", "confidence", "status", "is_subscription",
                      "split_group_id", "deductible", "bank_txn_id"],
        "column_formats": {
            "date":                "DATE",
            "total":               "CURRENCY",
            "home_currency_total": "CURRENCY",
            "tax":                 "CURRENCY",
            "confidence":          "PERCENT",
        },
        "column_widths": {
            "id": 80, "date": 110, "vendor": 180, "total": 110, "currency": 70,
            "home_currency_total": 130, "category": 180, "subcategory": 160,
            "payment_method": 110, "tax": 90, "notes": 220, "original_doc_url": 240,
            "confidence": 90, "status": 130, "is_subscription": 90, "split_group_id": 100,
            "deductible": 90, "bank_txn_id": 160,
        },
        "right_align": ["total", "home_currency_total", "tax", "confidence"],
        "center_align": ["date", "currency", "is_subscription", "deductible"],
        "conditional_rules": "expenses",
    },
    "subscriptions": {
        "tab_color": CHART_3_AMBER,
        "schema":    ["vendor", "amount", "currency", "frequency", "first_seen",
                      "last_seen", "next_expected", "category", "active", "notes"],
        "column_formats": {
            "amount":        "CURRENCY",
            "first_seen":    "DATE",
            "last_seen":     "DATE",
            "next_expected": "DATE",
        },
        "column_widths": {
            "vendor": 200, "amount": 100, "currency": 80, "frequency": 100,
            "first_seen": 110, "last_seen": 110, "next_expected": 120,
            "category": 160, "active": 80, "notes": 200,
        },
        "right_align": ["amount"],
        "center_align": ["currency", "frequency", "first_seen", "last_seen",
                         "next_expected", "active"],
        "conditional_rules": "subscriptions",
    },
    "income": {
        "tab_color": INCOME_EMERALD,
        "schema":    ["id", "date", "source", "amount", "currency", "home_currency_total",
                      "category", "recurring", "frequency", "next_expected",
                      "bank_txn_id", "notes"],
        "column_formats": {
            "date":                "DATE",
            "amount":              "CURRENCY",
            "home_currency_total": "CURRENCY",
            "next_expected":       "DATE",
        },
        "column_widths": {
            "id": 90, "date": 110, "source": 200, "amount": 110, "currency": 70,
            "home_currency_total": 130, "category": 130, "recurring": 90,
            "frequency": 100, "next_expected": 120, "bank_txn_id": 160, "notes": 200,
        },
        "right_align": ["amount", "home_currency_total"],
        "center_align": ["date", "currency", "recurring", "frequency", "next_expected"],
        "conditional_rules": None,
    },
    "_accounts": {
        "tab_color": ACCT_TEAL,
        "schema":    ["account_id", "name", "type", "currency", "balance",
                      "balance_as_of", "tracked", "last_sync_cursor", "notes"],
        "column_formats": {
            "balance":       "CURRENCY",
            "balance_as_of": "DATE",
        },
        "column_widths": {
            "account_id": 160, "name": 200, "type": 100, "currency": 70,
            "balance": 120, "balance_as_of": 120, "tracked": 80,
            "last_sync_cursor": 200, "notes": 200,
        },
        "right_align": ["balance"],
        "center_align": ["type", "currency", "balance_as_of", "tracked"],
        "conditional_rules": None,
    },
    "_budgets": {
        "tab_color": POS_500_GREEN,
        "schema":    ["category", "monthly_target", "currency", "notify_at_percent",
                      "active", "created", "last_updated", "fired_thresholds"],
        "column_formats": {
            "monthly_target":    "CURRENCY",
            "notify_at_percent": "INTEGER",
            "created":           "DATE",
            "last_updated":      "DATE",
        },
        "column_widths": {
            "category": 180, "monthly_target": 130, "currency": 80,
            "notify_at_percent": 130, "active": 80, "created": 110, "last_updated": 110,
            "fired_thresholds": 120,
        },
        "right_align": ["monthly_target", "notify_at_percent"],
        "center_align": ["currency", "active", "created", "last_updated"],
        "conditional_rules": "budgets",
    },
    "_subcategories": {
        "tab_color": None,
        "schema":    ["name", "created", "entry_count", "total_home_currency", "active"],
        "column_formats": {
            "created":             "DATE",
            "entry_count":         "INTEGER",
            "total_home_currency": "CURRENCY",
        },
        "column_widths": {
            "name": 200, "created": 110, "entry_count": 110,
            "total_home_currency": 150, "active": 80,
        },
        "right_align": ["entry_count", "total_home_currency"],
        "center_align": ["created", "active"],
        "conditional_rules": "subcategories",
    },
    "_settings": {
        "tab_color": INK_300,
        "schema":    ["key", "value"],
        "column_formats": {},
        "column_widths": {"key": 200, "value": 420},
        "right_align": [],
        "center_align": [],
        "conditional_rules": None,
    },
    "_audit": {
        "tab_color": INK_300,
        "schema":    ["timestamp", "row_id", "field", "old_value", "new_value", "source"],
        "column_formats": {},
        "column_widths": {
            "timestamp": 160, "row_id": 90, "field": 130,
            "old_value": 200, "new_value": 200, "source": 120,
        },
        "right_align": [],
        "center_align": ["timestamp", "row_id", "source"],
        "conditional_rules": None,
    },
    "dashboard": {
        "tab_color": ACCENT_ORANGE,
        "schema":    None,
        "column_formats": {},
        "column_widths": {},
        "right_align": [],
        "center_align": [],
        "conditional_rules": None,
        "hide_gridlines": True,
    },
}

# ─── EXCEL PATH — short-circuit before any Google API calls ──────────────────
if PROVIDER == "excel":
    _be = get_backend(SHEET_ID, PROVIDER, TOKEN)
    print(f"Bookkeeper — styling workbook {SHEET_ID[:12]}… (excel best-effort)")
    excel_style_all_tabs(_be, TAB_CONFIG)
    sys.exit(0)

# ─── SPREADSHEET METADATA — find sheetId for each named tab ───────────────────
def fetch_metadata():
    r = requests.get(f"{API_BASE}?includeGridData=false", headers=HEADERS)
    r.raise_for_status()
    return r.json()

meta = fetch_metadata()
sheets_by_name = {}
existing_bandings_by_sheet = {}
existing_cf_by_sheet = {}
for s in meta.get("sheets", []):
    name = s["properties"]["title"]
    sid  = s["properties"]["sheetId"]
    sheets_by_name[name] = sid
    existing_bandings_by_sheet[sid] = [b["bandedRangeId"] for b in s.get("bandedRanges", [])]
    existing_cf_by_sheet[sid] = len(s.get("conditionalFormats", []))

def get_header_columns(tab_name):
    """Fetch the actual header row to know how many columns to style."""
    r = requests.get(f"{API_BASE}/values/{tab_name}!1:1", headers=HEADERS)
    if r.status_code != 200:
        return []
    vals = r.json().get("values", [])
    return vals[0] if vals else []

def get_data_row_count(tab_name):
    """Total rows in the tab (including header)."""
    r = requests.get(f"{API_BASE}/values/{tab_name}", headers=HEADERS)
    if r.status_code != 200:
        return 0
    return len(r.json().get("values", []))

# How many data rows to pre-style with banding. Future appends inside the
# range inherit the banding automatically. Re-running the script extends if needed.
BAND_ROWS = 200

# ─── REQUEST BUILDERS ─────────────────────────────────────────────────────────
def req_sheet_properties(sid, tab_name, config):
    """Set tab color, freeze row 1, hide gridlines on dashboard."""
    grid = {"frozenRowCount": 1}
    if config.get("hide_gridlines"):
        grid["hideGridlines"] = True

    props  = {"sheetId": sid, "gridProperties": grid}
    fields = "gridProperties.frozenRowCount"
    if "hideGridlines" in grid:
        fields += ",gridProperties.hideGridlines"

    if config.get("tab_color"):
        props["tabColorStyle"] = {"rgbColor": config["tab_color"]}
        fields += ",tabColorStyle"

    return {"updateSheetProperties": {"properties": props, "fields": fields}}


def req_header_styling(sid, num_cols):
    """Header row 0 — dark navy bg, white bold text, padded, left-aligned."""
    return {
        "repeatCell": {
            "range": {
                "sheetId":         sid,
                "startRowIndex":   0,
                "endRowIndex":     1,
                "startColumnIndex": 0,
                "endColumnIndex":  num_cols,
            },
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor":     INK_900,
                    "backgroundColorStyle": {"rgbColor": INK_900},
                    "textFormat":           HEADER_TEXT_FORMAT,
                    "horizontalAlignment":  "LEFT",
                    "verticalAlignment":    "MIDDLE",
                    "padding": {"top": 4, "bottom": 4, "left": 8, "right": 8},
                }
            },
            "fields": ("userEnteredFormat.backgroundColor,"
                       "userEnteredFormat.backgroundColorStyle,"
                       "userEnteredFormat.textFormat,"
                       "userEnteredFormat.horizontalAlignment,"
                       "userEnteredFormat.verticalAlignment,"
                       "userEnteredFormat.padding"),
        }
    }


def req_header_row_height(sid):
    return {
        "updateDimensionProperties": {
            "range": {"sheetId": sid, "dimension": "ROWS", "startIndex": 0, "endIndex": 1},
            "properties": {"pixelSize": 32},
            "fields": "pixelSize",
        }
    }


def req_data_text_format(sid, num_cols, num_rows):
    """Apply DATA_TEXT_FORMAT (ink-700, regular weight) to ALL data rows.

    This MUST be applied separately from the background, otherwise the
    header's white text color carries over and we get white-on-white.
    """
    return {
        "repeatCell": {
            "range": {
                "sheetId":         sid,
                "startRowIndex":   1,
                "endRowIndex":     1 + num_rows,
                "startColumnIndex": 0,
                "endColumnIndex":  num_cols,
            },
            "cell": {
                "userEnteredFormat": {
                    "textFormat":          DATA_TEXT_FORMAT,
                    "verticalAlignment":   "MIDDLE",
                    "padding": {"top": 2, "bottom": 2, "left": 8, "right": 8},
                }
            },
            "fields": ("userEnteredFormat.textFormat,"
                       "userEnteredFormat.verticalAlignment,"
                       "userEnteredFormat.padding"),
        }
    }


def req_delete_bandings(sid):
    """Delete any existing bandings on this sheet so addBanding stays idempotent."""
    return [
        {"deleteBanding": {"bandedRangeId": bid}}
        for bid in existing_bandings_by_sheet.get(sid, [])
    ]


def req_add_banding(sid, num_cols, num_rows):
    """Banded backgrounds on data rows (starts at row index 1, skips header).

    Critical: do NOT set headerColor / headerColorStyle. If set, the first
    band row would be treated as a header and colored dark — the bug.
    """
    return {
        "addBanding": {
            "bandedRange": {
                "range": {
                    "sheetId":         sid,
                    "startRowIndex":   1,
                    "endRowIndex":     1 + num_rows,
                    "startColumnIndex": 0,
                    "endColumnIndex":  num_cols,
                },
                "rowProperties": {
                    "firstBandColor":      SURFACE_0,
                    "firstBandColorStyle": {"rgbColor": SURFACE_0},
                    "secondBandColor":      SURFACE_50,
                    "secondBandColorStyle": {"rgbColor": SURFACE_50},
                },
            }
        }
    }


def req_data_row_height(sid, num_rows):
    return {
        "updateDimensionProperties": {
            "range": {"sheetId": sid, "dimension": "ROWS",
                      "startIndex": 1, "endIndex": 1 + num_rows},
            "properties": {"pixelSize": 26},
            "fields": "pixelSize",
        }
    }


def req_column_width(sid, col_idx, width):
    return {
        "updateDimensionProperties": {
            "range": {"sheetId": sid, "dimension": "COLUMNS",
                      "startIndex": col_idx, "endIndex": col_idx + 1},
            "properties": {"pixelSize": width},
            "fields": "pixelSize",
        }
    }


def req_column_number_format(sid, col_idx, num_rows, format_key):
    fmt = NUMBER_FORMATS[format_key]
    return {
        "repeatCell": {
            "range": {
                "sheetId":         sid,
                "startRowIndex":   1,
                "endRowIndex":     1 + num_rows,
                "startColumnIndex": col_idx,
                "endColumnIndex":  col_idx + 1,
            },
            "cell": {"userEnteredFormat": {"numberFormat": fmt}},
            "fields": "userEnteredFormat.numberFormat",
        }
    }


def req_column_alignment(sid, col_idx, num_rows, alignment):
    return {
        "repeatCell": {
            "range": {
                "sheetId":         sid,
                "startRowIndex":   1,
                "endRowIndex":     1 + num_rows,
                "startColumnIndex": col_idx,
                "endColumnIndex":  col_idx + 1,
            },
            "cell": {"userEnteredFormat": {"horizontalAlignment": alignment}},
            "fields": "userEnteredFormat.horizontalAlignment",
        }
    }


# ─── CONDITIONAL FORMATTING — per-tab rules ───────────────────────────────────
def _cf_text_eq_rule(sid, col_idx, num_rows, text_value, bg_color, fg_color=None):
    """Background color when a cell's text equals `text_value` (case-insensitive)."""
    fmt = {"backgroundColor": bg_color, "backgroundColorStyle": {"rgbColor": bg_color}}
    if fg_color:
        fmt["textFormat"] = {"foregroundColor": fg_color, "bold": True}
    return {
        "addConditionalFormatRule": {
            "rule": {
                "ranges": [{
                    "sheetId":         sid,
                    "startRowIndex":   1,
                    "endRowIndex":     1 + num_rows,
                    "startColumnIndex": col_idx,
                    "endColumnIndex":  col_idx + 1,
                }],
                "booleanRule": {
                    "condition": {
                        "type": "TEXT_EQ",
                        "values": [{"userEnteredValue": text_value}],
                    },
                    "format": fmt,
                },
            },
            "index": 0,
        }
    }


def _cf_number_less_than_rule(sid, col_idx, num_rows, value, bg_color):
    return {
        "addConditionalFormatRule": {
            "rule": {
                "ranges": [{
                    "sheetId":         sid,
                    "startRowIndex":   1,
                    "endRowIndex":     1 + num_rows,
                    "startColumnIndex": col_idx,
                    "endColumnIndex":  col_idx + 1,
                }],
                "booleanRule": {
                    "condition": {
                        "type": "NUMBER_LESS",
                        "values": [{"userEnteredValue": str(value)}],
                    },
                    "format": {
                        "backgroundColor": bg_color,
                        "backgroundColorStyle": {"rgbColor": bg_color},
                        "textFormat": {"foregroundColor": rgb("#B91C1C"), "bold": True},
                    },
                },
            },
            "index": 0,
        }
    }


def cf_rules_for_tab(tab_name, sid, header_cols, num_rows):
    """Return a list of conditional-formatting requests appropriate for this tab."""
    rules = []
    name_to_idx = {h: i for i, h in enumerate(header_cols)}

    if tab_name == "expenses":
        if "status" in name_to_idx:
            i = name_to_idx["status"]
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "needs_review", AMBER_BG))
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "duplicate_pending", NEG_BG))
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "awaiting_payment", rgb("#E0E7FF")))
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "logged", POS_BG))
        if "total" in name_to_idx:
            rules.append(_cf_number_less_than_rule(sid, name_to_idx["total"], num_rows, 0, NEG_BG))
        if "is_subscription" in name_to_idx:
            i = name_to_idx["is_subscription"]
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "TRUE",  rgb("#E0F2FE")))
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "true",  rgb("#E0F2FE")))

    elif tab_name == "subscriptions":
        if "active" in name_to_idx:
            i = name_to_idx["active"]
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "TRUE",  POS_BG))
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "true",  POS_BG))
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "FALSE", NEG_BG))
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "false", NEG_BG))

    elif tab_name == "_budgets":
        if "active" in name_to_idx:
            i = name_to_idx["active"]
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "TRUE",  POS_BG))
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "true",  POS_BG))
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "FALSE", NEG_BG))
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "false", NEG_BG))

    elif tab_name == "_subcategories":
        if "active" in name_to_idx:
            i = name_to_idx["active"]
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "TRUE",  POS_BG))
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "true",  POS_BG))
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "FALSE", rgb("#F3F4F6")))
            rules.append(_cf_text_eq_rule(sid, i, num_rows, "false", rgb("#F3F4F6")))

    return rules


def req_delete_existing_cf(sid):
    """Remove all existing conditional formatting rules (so re-runs stay idempotent).

    deleteConditionalFormatRule deletes the rule at index, and remaining
    rules shift left. Delete from highest index downward.
    """
    count = existing_cf_by_sheet.get(sid, 0)
    return [
        {"deleteConditionalFormatRule": {"sheetId": sid, "index": i}}
        for i in range(count - 1, -1, -1)
    ]


# ─── MAIN — assemble + send per-tab batchUpdates ──────────────────────────────
def style_tab(tab_name, config):
    if tab_name not in sheets_by_name:
        print(f"  ⤳ skipped {tab_name} (tab not found in sheet)")
        return False

    sid = sheets_by_name[tab_name]

    # Dashboard: tab color, freeze, hide gridlines — nothing else.
    # The dashboard layout is owned by the report renderer / agent.
    if tab_name == "dashboard":
        batch = {"requests": [req_sheet_properties(sid, tab_name, config)]}
        r = requests.post(f"{API_BASE}:batchUpdate", headers=HEADERS, data=json.dumps(batch))
        if r.status_code != 200:
            print(f"  ✗ {tab_name} — error {r.status_code}: {r.text[:200]}")
            return False
        print(f"  ✓ {tab_name} (tab color + frozen row + hide gridlines)")
        return True

    header_cols = get_header_columns(tab_name)
    if not header_cols:
        # Tab exists but no header yet — apply just sheet props + header chrome
        # using the canonical schema so future row appends look right.
        header_cols = config["schema"] or []

    num_cols = len(header_cols)
    if num_cols == 0:
        print(f"  ⤳ skipped {tab_name} (no columns)")
        return False

    actual_rows = max(get_data_row_count(tab_name) - 1, 0)
    num_rows    = max(actual_rows, BAND_ROWS)

    requests_list = []

    # 1. Sheet properties (tab color, freeze, hide gridlines)
    requests_list.append(req_sheet_properties(sid, tab_name, config))

    # 2. Header row styling
    requests_list.append(req_header_styling(sid, num_cols))
    requests_list.append(req_header_row_height(sid))

    # 3. Data rows — text format FIRST (so banded bg overlays on correct text color)
    requests_list.append(req_data_text_format(sid, num_cols, num_rows))
    requests_list.append(req_data_row_height(sid, num_rows))

    # 4. Banded backgrounds — delete any old bandings first for idempotency
    requests_list.extend(req_delete_bandings(sid))
    requests_list.append(req_add_banding(sid, num_cols, num_rows))

    # 5. Per-column number formats
    for col_name, fmt_key in config.get("column_formats", {}).items():
        if col_name in header_cols:
            col_idx = header_cols.index(col_name)
            requests_list.append(req_column_number_format(sid, col_idx, num_rows, fmt_key))

    # 6. Per-column widths
    for col_name, width in config.get("column_widths", {}).items():
        if col_name in header_cols:
            col_idx = header_cols.index(col_name)
            requests_list.append(req_column_width(sid, col_idx, width))

    # 7. Per-column alignments
    for col_name in config.get("right_align", []):
        if col_name in header_cols:
            col_idx = header_cols.index(col_name)
            requests_list.append(req_column_alignment(sid, col_idx, num_rows, "RIGHT"))
    for col_name in config.get("center_align", []):
        if col_name in header_cols:
            col_idx = header_cols.index(col_name)
            requests_list.append(req_column_alignment(sid, col_idx, num_rows, "CENTER"))

    # 8. Conditional formatting — clear existing, then add new
    requests_list.extend(req_delete_existing_cf(sid))
    requests_list.extend(cf_rules_for_tab(tab_name, sid, header_cols, num_rows))

    # Send
    batch = {"requests": requests_list}
    r = requests.post(f"{API_BASE}:batchUpdate", headers=HEADERS, data=json.dumps(batch))
    if r.status_code != 200:
        print(f"  ✗ {tab_name} — error {r.status_code}: {r.text[:300]}")
        return False

    print(f"  ✓ {tab_name} ({len(requests_list)} requests applied; "
          f"{num_cols} cols × {num_rows} data rows banded)")
    return True


def main():
    print(f"Bookkeeper — styling all tabs in sheet {SHEET_ID[:12]}…")
    print(f"  home currency: {HOME_CURRENCY}")
    print(f"  tabs found: {', '.join(sorted(sheets_by_name.keys()))}")
    print()

    ok = 0
    for tab_name, config in TAB_CONFIG.items():
        if style_tab(tab_name, config):
            ok += 1

    print()
    print(f"Done. Styled {ok}/{len(TAB_CONFIG)} tabs.")
    return 0 if ok == len(TAB_CONFIG) else 1


if __name__ == "__main__":
    sys.exit(main())
