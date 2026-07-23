"""
Bookkeeper — ledger provider backends.

Abstracts the LEDGER capability role so the three Bookkeeper scripts run
against either provider:

  - googlesheets  → Google Sheets API v4           (full design system)
  - excel         → Microsoft Graph workbook API   (best-effort styling)

Selection (env):
  LEDGER_PROVIDER          "googlesheets" (default) | "excel"
  GOOGLESHEETS_ACCESS_TOKEN  token for the google path
  MSGRAPH_ACCESS_TOKEN       token for the excel path (Files.ReadWrite scope)

The ledger id argument the scripts take is:
  googlesheets → the spreadsheet ID
  excel        → the OneDrive driveItem ID of the .xlsx workbook

Excel styling is BEST-EFFORT by design. Graph's workbook API (v1.0) does not
expose tab colors, freeze panes, banded-range objects, or conditional-format
rules, so the Excel path approximates the Visual Design System with direct
fills/fonts/number formats and silently skips the rest. The source of truth
for the full design remains the Google path / reference.md.
"""

import os
import json
import requests


def resolve_provider_and_token():
    """Returns (provider, token). Exits with a friendly message if missing."""
    provider = os.environ.get("LEDGER_PROVIDER", "googlesheets").strip().lower()
    if provider not in ("googlesheets", "excel"):
        raise SystemExit(f"ERROR: unknown LEDGER_PROVIDER '{provider}' "
                         "(use 'googlesheets' or 'excel').")
    env = "GOOGLESHEETS_ACCESS_TOKEN" if provider == "googlesheets" else "MSGRAPH_ACCESS_TOKEN"
    token = os.environ.get(env, "")
    if not token:
        raise SystemExit(
            f"ERROR: {env} environment variable is required for "
            f"LEDGER_PROVIDER={provider}.\n"
            "Get a fresh token via get_connector_token(...) and export it.")
    return provider, token


def get_backend(ledger_id, provider=None, token=None):
    if provider is None or token is None:
        provider, token = resolve_provider_and_token()
    if provider == "excel":
        return ExcelGraphBackend(ledger_id, token)
    return GoogleSheetsBackend(ledger_id, token)


# ─── GOOGLE SHEETS ────────────────────────────────────────────────────────────
class GoogleSheetsBackend:
    provider = "googlesheets"
    supports_rich_styling = True

    def __init__(self, sheet_id, token):
        self.base = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}"
        self.h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def read_values(self, tab):
        r = requests.get(f"{self.base}/values/{tab}", headers=self.h)
        if r.status_code != 200:
            return []
        return r.json().get("values", [])

    def list_tabs(self):
        r = requests.get(f"{self.base}?includeGridData=false", headers=self.h)
        r.raise_for_status()
        return {s["properties"]["title"]: s["properties"]["sheetId"]
                for s in r.json().get("sheets", [])}

    def clear_range(self, tab, a1):
        return requests.post(f"{self.base}/values/{tab}!{a1}:clear",
                             headers=self.h, data="{}")

    def write_values(self, tab, a1, values):
        rng = f"{tab}!{a1}"
        return requests.put(
            f"{self.base}/values/{rng}?valueInputOption=RAW", headers=self.h,
            data=json.dumps({"range": rng, "majorDimension": "ROWS", "values": values}))

    def batch_update(self, reqs):
        return requests.post(f"{self.base}:batchUpdate", headers=self.h,
                             data=json.dumps({"requests": reqs}))


# ─── MICROSOFT GRAPH (EXCEL) ──────────────────────────────────────────────────
class ExcelGraphBackend:
    provider = "excel"
    supports_rich_styling = False

    # design tokens (hex) for best-effort styling
    INK_900, INK_700, INK_500 = "#0F172A", "#334155", "#64748B"
    INK_100, SURFACE_50, WHITE = "#F1F5F9", "#F8FAFC", "#FFFFFF"
    NUM_FMTS = {"CURRENCY": "#,##0.00", "DATE": "yyyy-mm-dd",
                "PERCENT": "0%", "INTEGER": "#,##0"}
    MAX_BAND_ROWS = 60  # cap alternating-fill calls (one PATCH per stripe)

    def __init__(self, item_id, token):
        self.base = (f"https://graph.microsoft.com/v1.0/me/drive/items/"
                     f"{item_id}/workbook")
        self.h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def _ws(self, tab):
        return f"{self.base}/worksheets('{tab}')"

    def _rng(self, tab, a1):
        return f"{self._ws(tab)}/range(address='{a1}')"

    def read_values(self, tab):
        r = requests.get(f"{self._ws(tab)}/usedRange?$select=values", headers=self.h)
        if r.status_code != 200:
            return []
        values = r.json().get("values", [])
        # Graph pads with empty strings; normalize fully-empty sheets to []
        if values == [[""]] or values == [[]]:
            return []
        return [[("" if v is None else v) for v in row] for row in values]

    def list_tabs(self):
        r = requests.get(f"{self.base}/worksheets?$select=name", headers=self.h)
        r.raise_for_status()
        return {w["name"]: w["name"] for w in r.json().get("value", [])}

    def clear_range(self, tab, a1):
        return requests.post(f"{self._rng(tab, a1)}/clear", headers=self.h,
                             data=json.dumps({"applyTo": "All"}))

    def write_values(self, tab, a1, values):
        return requests.patch(self._rng(tab, a1), headers=self.h,
                              data=json.dumps({"values": values}))

    def unmerge(self, tab, a1):
        return requests.post(f"{self._rng(tab, a1)}/unmerge", headers=self.h, data="{}")

    def merge(self, tab, a1):
        return requests.post(f"{self._rng(tab, a1)}/merge", headers=self.h,
                             data=json.dumps({"across": False}))

    # — best-effort styling primitives —
    def set_fill(self, tab, a1, hex_color):
        requests.patch(f"{self._rng(tab, a1)}/format/fill", headers=self.h,
                       data=json.dumps({"color": hex_color}))

    def set_font(self, tab, a1, bold=None, color=None, size=None):
        body = {}
        if bold is not None:  body["bold"] = bold
        if color is not None: body["color"] = color
        if size is not None:  body["size"] = size
        requests.patch(f"{self._rng(tab, a1)}/format/font", headers=self.h,
                       data=json.dumps(body))

    def set_halign(self, tab, a1, align):  # "Left" | "Center" | "Right"
        requests.patch(f"{self._rng(tab, a1)}/format", headers=self.h,
                       data=json.dumps({"horizontalAlignment": align}))

    def set_column_width(self, tab, col_letter, px):
        # Graph columnWidth is in points; px → pt ≈ ×0.75
        requests.patch(f"{self._rng(tab, f'{col_letter}:{col_letter}')}/format",
                       headers=self.h,
                       data=json.dumps({"columnWidth": round(px * 0.75)}))

    def set_number_format(self, tab, a1, fmt, nrows, ncols):
        requests.patch(self._rng(tab, a1), headers=self.h,
                       data=json.dumps({"numberFormat": [[fmt] * ncols] * nrows}))


def col_letter(idx):
    """0-based column index → A1 letter(s)."""
    s = ""
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


# ─── EXCEL BEST-EFFORT: data tabs ────────────────────────────────────────────
def excel_style_all_tabs(be, tab_config):
    """Approximate style_all_tabs.py's design system on an Excel workbook.
    Skipped (unsupported in Graph v1.0): tab colors, freeze panes, gridline
    hiding, conditional formatting, hidden columns."""
    tabs = be.list_tabs()
    ok = 0
    for tab, cfg in tab_config.items():
        if tab not in tabs:
            print(f"  ⤳ skipped {tab} (not in workbook)")
            continue
        if tab == "dashboard":   # dashboard content styled by refresh script
            ok += 1
            continue
        rows = be.read_values(tab)
        header = rows[0] if rows else (cfg.get("schema") or [])
        if not header:
            print(f"  ⤳ skipped {tab} (no columns)")
            continue
        ncols = len(header)
        ndata = max(len(rows) - 1, 1)
        last = col_letter(ncols - 1)

        # header bar: ink-900 fill, white bold 11pt
        be.set_fill(tab, f"A1:{last}1", be.INK_900)
        be.set_font(tab, f"A1:{last}1", bold=True, color=be.WHITE, size=11)
        # data rows: ink-700 regular 10pt + alternating surface-50 stripes
        be.set_font(tab, f"A2:{last}{ndata + 1}", bold=False, color=be.INK_700, size=10)
        for r in range(3, min(ndata + 2, be.MAX_BAND_ROWS + 2), 2):
            be.set_fill(tab, f"A{r}:{last}{r}", be.SURFACE_50)
        # number formats / widths / alignment per config
        for col, fmt_key in cfg.get("column_formats", {}).items():
            if col in header:
                c = col_letter(header.index(col))
                be.set_number_format(tab, f"{c}2:{c}{ndata + 1}",
                                     be.NUM_FMTS.get(fmt_key, "General"), ndata, 1)
        for col, px in cfg.get("column_widths", {}).items():
            if col in header:
                be.set_column_width(tab, col_letter(header.index(col)), px)
        for col in cfg.get("right_align", []):
            if col in header:
                c = col_letter(header.index(col))
                be.set_halign(tab, f"{c}2:{c}{ndata + 1}", "Right")
        for col in cfg.get("center_align", []):
            if col in header:
                c = col_letter(header.index(col))
                be.set_halign(tab, f"{c}2:{c}{ndata + 1}", "Center")
        print(f"  ✓ {tab} (excel best-effort: header bar, stripes, formats, widths)")
        ok += 1
    print(f"Done (excel). Styled {ok} tabs. Skipped by design: tab colors, "
          "freeze panes, conditional formatting.")
    return ok


# ─── EXCEL BEST-EFFORT: dashboard ────────────────────────────────────────────
def excel_style_dashboard(be, tab, layout, num_cols):
    """Style the dashboard rows written by refresh_dashboard.py using its
    layout meta (1-based row indices)."""
    last = col_letter(num_cols - 1)

    def row_rng(r):
        return f"A{r}:{last}{r}"

    title = layout.get("title_row")
    if title:
        be.set_fill(tab, row_rng(title), be.INK_900)
        be.set_font(tab, row_rng(title), bold=True, color=be.WHITE, size=14)
    for key in ("section_this_month", "section_by_cat", "section_monthly"):
        r = layout.get(key)
        if r:
            be.set_font(tab, row_rng(r), bold=True, color=be.INK_500, size=10)
    for key in ("kpi_labels_row", "by_cat_header_row", "monthly_header_row"):
        r = layout.get(key)
        if r:
            be.set_fill(tab, row_rng(r), be.INK_100)
            be.set_font(tab, row_rng(r), bold=True, color=be.INK_700, size=10)
    kpi_vals = layout.get("kpi_values_row")
    if kpi_vals:
        be.set_font(tab, row_rng(kpi_vals), bold=True, color=be.INK_900, size=13)
    print("  ✓ dashboard (excel best-effort styling)")
