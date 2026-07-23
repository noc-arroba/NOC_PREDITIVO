"""
Bookkeeper — Report Generator

Usage:
  python3 generate_report.py <mode> <output_path> <sheet_id>

Args:
  mode         — see "Modes" below
  output_path  — full path where the PNG should be saved (e.g. /app/report.png)
  sheet_id     — the Google Sheet ID for THIS user's Bookkeeper sheet

Modes:
  week              → Monday of current ISO week to today
  month             → 1st of current month to today
  months_back=N     → 1st of (today - N months) to today
  N (plain integer) → same as months_back=N
  YYYY-MM-DD:YYYY-MM-DD  → explicit start:end date range

Examples:
  python3 generate_report.py month       /app/report.png 1abc...xyz
  python3 generate_report.py 2026-05-01:2026-05-31 /app/report.png 1abc...xyz

Env: GOOGLESHEETS_ACCESS_TOKEN  (required)

Layout (5 sections, no overlaps):
  1. Header bar + KPI strip
  2. Category distribution (horizontal bar chart)
  3. Over-budget categories (progress bars, only shown if budgets configured)
  4. Top 10 expenses (table)
  5. Subscriptions this month (table)
"""

import os, sys, re, requests, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch
from datetime import datetime, date, timedelta
from collections import defaultdict
from dateutil.relativedelta import relativedelta

# ── RTL TEXT HANDLING ─────────────────────────────────────────────────────────
try:
    from bidi.algorithm import get_display
    HAS_BIDI = True
except ImportError:
    HAS_BIDI = False

def bidi(s):
    if not HAS_BIDI or not s:
        return str(s) if s else ''
    s = str(s)
    if any('\u0590' <= c <= '\u06FF' for c in s):
        try:
            return get_display(s)
        except Exception:
            return s
    return s

# ── ARGS / ENV ────────────────────────────────────────────────────────────────
from ledger_backend import get_backend, resolve_provider_and_token
PROVIDER, TOKEN = resolve_provider_and_token()
TODAY       = date.today()
mode        = sys.argv[1] if len(sys.argv) > 1 else 'month'
OUTPUT_PATH = sys.argv[2] if len(sys.argv) > 2 else '/app/report.png'
SHEET_ID    = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("BOOKKEEPER_SHEET_ID", "")

if not SHEET_ID:
    print("ERROR: SHEET_ID is required. Pass as 3rd arg or set BOOKKEEPER_SHEET_ID env var.")
    sys.exit(1)

# ── DATE WINDOW ───────────────────────────────────────────────────────────────
if mode == 'week':
    window_start = TODAY - timedelta(days=TODAY.weekday())
    window_end   = TODAY
elif mode == 'month':
    window_start = TODAY.replace(day=1)
    window_end   = TODAY
elif mode.startswith('months_back='):
    n = int(mode.split('=')[1])
    window_start = (TODAY - relativedelta(months=n)).replace(day=1)
    window_end   = TODAY
elif ':' in mode:
    start_str, end_str = mode.split(':', 1)
    window_start = datetime.strptime(start_str, '%Y-%m-%d').date()
    window_end   = datetime.strptime(end_str,   '%Y-%m-%d').date()
else:
    try:
        n = int(mode)
        window_start = (TODAY - relativedelta(months=n)).replace(day=1)
    except:
        window_start = TODAY.replace(day=1)
    window_end = TODAY

label = f"{window_start.strftime('%b %d')} – {window_end.strftime('%b %d, %Y')}"

# ── FETCH LEDGER (provider-agnostic) ─────────────────────────────────────────
_backend = get_backend(SHEET_ID, PROVIDER, TOKEN)

def fetch(tab):
    return _backend.read_values(tab)

expenses_raw = fetch("expenses")
budgets_raw  = fetch("_budgets")
settings_raw = fetch("_settings")
subs_raw     = fetch("subscriptions")

if len(expenses_raw) < 2:
    print("ERROR: No expense data found.")
    sys.exit(1)

headers = expenses_raw[0]
COL     = {h.lower().strip(): i for i, h in enumerate(headers)}

# ── SETTINGS ──────────────────────────────────────────────────────────────────
settings = {}
for r in settings_raw[1:]:
    if len(r) >= 2:
        settings[r[0]] = r[1]
HOME_CURRENCY = settings.get("home_currency", "USD")
CUR_SYM       = {"ILS": "₪", "USD": "$", "EUR": "€", "GBP": "£"}.get(HOME_CURRENCY, HOME_CURRENCY + " ")

# ── LABEL TRANSLATIONS ────────────────────────────────────────────────────────
_translations = {}
_raw = settings.get("label_translations", "{}")
try:
    _translations = json.loads(_raw) if isinstance(_raw, str) else (_raw or {})
except Exception:
    pass

def L(key):
    """Look up a translated label. Falls back to the English key itself."""
    return _translations.get(key, key)

# ── PARSE EXPENSES ────────────────────────────────────────────────────────────
all_expenses = []
for r in expenses_raw[1:]:
    if len(r) < 7: continue
    try:    d = datetime.strptime(r[COL['date']], '%Y-%m-%d').date()
    except: continue
    # Try home_currency_total first; if empty, fall back to total/amount column
    # Use fuzzy matching for home-currency column — agent may name it differently
    raw_amt = ""
    hc_col = COL.get('home_currency_total') or COL.get('amount_home_currency')
    if hc_col is None:
        for h, idx in COL.items():
            hl = h.lower()
            if 'home' in hl and ('amount' in hl or 'total' in hl):
                hc_col = idx
                break
    if hc_col is None:
        for h, idx in COL.items():
            hl = h.lower()
            if hl.startswith('home_currency_') and hl != 'home_currency':
                hc_col = idx
                break
    t_col  = COL.get('total') or COL.get('amount')
    if t_col is None:
        t_col = 3  # last-resort positional fallback
    if hc_col is not None and len(r) > hc_col:
        raw_amt = r[hc_col]
    if not raw_amt and t_col is not None and len(r) > t_col:
        raw_amt = r[t_col]
    raw_amt = re.sub(r'[^\d.\-]', '', raw_amt)
    try:    amt = float(raw_amt or 0)
    except: amt = 0.0
    all_expenses.append({
        'date':     d,
        'vendor':   r[COL.get('vendor', 2)] if len(r) > COL.get('vendor', 2) else '',
        'amount':   amt,
        'category': r[COL.get('category', 6)] if len(r) > COL.get('category', 6) else 'Other',
        'notes':    r[COL['notes']]  if 'notes'  in COL and len(r) > COL['notes']  else '',
        'status':   r[COL['status']] if 'status' in COL and len(r) > COL['status'] else 'logged',
    })

windowed = [e for e in all_expenses if window_start <= e['date'] <= window_end]

# Aggregates
by_cat = defaultdict(float)
for e in windowed:
    by_cat[e['category']] += e['amount']
by_cat = dict(sorted(by_cat.items(), key=lambda x: -x[1]))

total_spent = sum(by_cat.values())
tx_count    = len(windowed)
avg_tx      = total_spent / tx_count if tx_count else 0

# ── PARSE BUDGETS ─────────────────────────────────────────────────────────────
budgets = {}
for r in budgets_raw[3:]:
    if not r or len(r) < 2 or not r[0].strip() or r[0].startswith('💡'): continue
    cat = r[0].strip()
    bv_raw = re.sub(r'[^\d.\-]', '', r[1]) if r[1] not in ('—', '', '-') else ''
    try:    bv = float(bv_raw) if bv_raw else None
    except: bv = None
    budgets[cat] = bv

# Over-budget: categories where spent > budget (only if budget is set)
over_budget = []
for cat, budget in budgets.items():
    if budget is None: continue
    spent = by_cat.get(cat, 0.0)
    if spent > budget:
        over_budget.append({'cat': cat, 'spent': spent, 'budget': budget})
over_budget.sort(key=lambda x: -(x['spent'] / x['budget']))

# ── PARSE SUBSCRIPTIONS ───────────────────────────────────────────────────────
subs = []
# Primary: read from subscriptions tab (header-based, not positional)
subs_headers = subs_raw[0] if subs_raw else []
SC = {h.lower().strip(): i for i, h in enumerate(subs_headers)}

def sc_get(row, *keys, default=''):
    """Get a cell from subscriptions row by trying multiple header names."""
    for k in keys:
        idx = SC.get(k)
        if idx is not None and len(row) > idx and row[idx]:
            return row[idx]
    return default

for r in subs_raw[1:]:
    if len(r) < 2: continue
    active_val = sc_get(r, 'active', 'status', default='true').strip().lower()
    if active_val not in ('true', 'yes', '1', 'active', ''): continue
    try:    amount = float(sc_get(r, 'amount', 'total', default='0') or 0)
    except: amount = 0.0
    try:    last_seen = datetime.strptime(sc_get(r, 'last_seen', 'last seen'), '%Y-%m-%d').date()
    except: last_seen = TODAY
    subs.append({
        'vendor':    sc_get(r, 'vendor', 'service', 'name'),
        'amount':    amount,
        'currency':  sc_get(r, 'currency', default=HOME_CURRENCY),
        'frequency': (sc_get(r, 'frequency', 'cycle', default='') or L('Monthly')).capitalize(),
        'last_seen': last_seen,
    })

# Fallback: detect from expenses if subscriptions tab is empty
if not subs and all_expenses:
    grouped = defaultdict(list)
    for e in all_expenses:
        grouped[e['vendor'].lower().strip()].append(e)
    for vendor_key, charges in grouped.items():
        if len(charges) < 2: continue
        charges.sort(key=lambda x: x['date'])
        intervals = [(charges[i]['date'] - charges[i-1]['date']).days for i in range(1, len(charges))]
        med_interval = sorted(intervals)[len(intervals) // 2]
        avg_amount = sum(c['amount'] for c in charges) / len(charges)
        if avg_amount <= 0: continue
        spread = max(abs(c['amount'] - avg_amount) / avg_amount for c in charges)
        if spread > 0.05: continue
        if   25  <= med_interval <= 35:  freq = L('Monthly')
        elif 85  <= med_interval <= 95:  freq = L('Quarterly')
        elif 355 <= med_interval <= 375: freq = L('Yearly')
        else: continue
        subs.append({
            'vendor':    charges[-1]['vendor'],
            'amount':    charges[-1]['amount'],
            'currency':  HOME_CURRENCY,
            'frequency': freq,
            'last_seen': charges[-1]['date'],
        })
    subs.sort(key=lambda s: s['last_seen'], reverse=True)

# Subscriptions seen within this month's window
subs_this_month = [
    s for s in subs
    if window_start <= s['last_seen'] <= window_end
]
subs_total = sum(s['amount'] for s in subs_this_month)

# Top 10 expenses by amount
top10 = sorted(windowed, key=lambda x: -x['amount'])[:10]

# ── PALETTE ───────────────────────────────────────────────────────────────────
BG        = '#F8FAFC'
INK_900   = '#0F1729'
INK_600   = '#475569'
INK_300   = '#CBD5E1'
INK_100   = '#F1F5F9'
WHITE     = '#FFFFFF'
ACCENT    = '#F97316'
BLUE      = '#3B82F6'
GREEN     = '#22C55E'
RED       = '#EF4444'
AMBER     = '#F59E0B'
CAT_PAL   = [ACCENT, BLUE, '#8B5CF6', '#06B6D4', '#10B981', '#EC4899', '#6366F1', '#F59E0B', '#EF4444', '#64748B']

# ── FIGURE ────────────────────────────────────────────────────────────────────
# 5 sections stacked vertically. Heights are proportional to content.
# No GridSpec — use explicit axes positioning to avoid any overlap.
FIG_W   = 12
FIG_H   = 22
fig     = plt.figure(figsize=(FIG_W, FIG_H), facecolor=BG)

# Layout constants (normalised, bottom=0, top=1)
PAD   = 0.018   # horizontal padding (left + right)
LEFT  = PAD
WIDTH = 1 - 2 * PAD

# Section top positions (from top of figure, descending)
SEC_TOPS    = [0.980, 0.870, 0.700, 0.530, 0.320, 0.070]
SEC_HEIGHTS = [t - b - 0.010 for t, b in zip(SEC_TOPS, SEC_TOPS[1:])]

# Helper: add a section axis
def section_ax(idx):
    top = SEC_TOPS[idx]
    h   = SEC_HEIGHTS[idx]
    ax  = fig.add_axes([LEFT, top - h, WIDTH, h])
    ax.set_facecolor(WHITE)
    for sp in ax.spines.values():
        sp.set_edgecolor(INK_300)
        sp.set_linewidth(0.5)
    return ax

def section_title(ax, txt):
    ax.text(0.012, 0.97, txt,
        transform=ax.transAxes, va='top',
        fontsize=11, fontweight='bold', color=INK_900)

# ═══════════════════════════════════════════════════════
# SECTION 0 — Header bar + KPI strip
# ═══════════════════════════════════════════════════════
ax0 = section_ax(0)
ax0.set_facecolor(INK_900)
for sp in ax0.spines.values(): sp.set_visible(False)
ax0.axis('off')

# Title
ax0.text(0.015, 0.78, L('Bookkeeper'),
    transform=ax0.transAxes, va='center',
    fontsize=17, fontweight='bold', color=WHITE)
ax0.text(0.015, 0.28, label,
    transform=ax0.transAxes, va='center',
    fontsize=10, color=INK_300)

# KPI boxes
kpis = [
    (L('Total Spent'),    f'{CUR_SYM}{total_spent:,.0f}', ACCENT),
    (L('TRANSACTIONS'),   str(tx_count),                  BLUE),
    (L('AVG / EXPENSE'),  f'{CUR_SYM}{avg_tx:,.0f}',      '#8B5CF6'),
    (L('SUBSCRIPTIONS'),  f'{CUR_SYM}{subs_total:,.0f}',  '#06B6D4'),
]
box_w   = 0.19
box_gap = 0.015
x_start = 0.38
for i, (lbl, val, clr) in enumerate(kpis):
    x = x_start + i * (box_w + box_gap)
    rect = FancyBboxPatch((x, 0.08), box_w, 0.82,
        boxstyle="round,pad=0.02", linewidth=0,
        facecolor='#1E2D4E', transform=ax0.transAxes, zorder=1)
    ax0.add_patch(rect)
    ax0.text(x + box_w / 2, 0.72, lbl,
        transform=ax0.transAxes, ha='center', va='center',
        fontsize=7.5, color=INK_300, fontweight='bold')
    ax0.text(x + box_w / 2, 0.38, val,
        transform=ax0.transAxes, ha='center', va='center',
        fontsize=15, color=clr, fontweight='bold')

# ═══════════════════════════════════════════════════════
# SECTION 1 — Category distribution (horizontal bar chart)
# ═══════════════════════════════════════════════════════
ax1 = section_ax(1)
ax1.axis('off')
section_title(ax1, L('Category Distribution'))

if by_cat:
    cats  = list(by_cat.keys())
    vals  = list(by_cat.values())
    n     = len(cats)
    bar_h = 0.055           # height of each bar in axes coords
    gap   = 0.010
    row_h = bar_h + gap
    y_top = 0.86            # start below the title
    max_v = max(vals)
    bar_area_left  = 0.28   # left edge of bars (room for cat labels)
    bar_area_width = 0.56   # width reserved for bars
    val_x_start    = bar_area_left + bar_area_width + 0.008  # where amount text starts

    for i, (cat, val) in enumerate(zip(cats, vals)):
        y = y_top - i * row_h
        color = CAT_PAL[i % len(CAT_PAL)]
        pct   = val / total_spent if total_spent else 0
        bar_w = bar_area_width * (val / max_v)

        # Category label (left)
        ax1.text(bar_area_left - 0.008, y + bar_h / 2,
            bidi(cat), ha='right', va='center',
            fontsize=9, color=INK_600, transform=ax1.transAxes)

        # Background track
        ax1.add_patch(FancyBboxPatch(
            (bar_area_left, y), bar_area_width, bar_h,
            boxstyle="round,pad=0", facecolor=INK_100, linewidth=0,
            transform=ax1.transAxes, zorder=1))

        # Filled bar
        if bar_w > 0:
            ax1.add_patch(FancyBboxPatch(
                (bar_area_left, y), bar_w, bar_h,
                boxstyle="round,pad=0", facecolor=color, linewidth=0, alpha=0.9,
                transform=ax1.transAxes, zorder=2))

        # Amount + percentage (right)
        ax1.text(val_x_start, y + bar_h / 2,
            f'{CUR_SYM}{val:,.0f}  ({pct*100:.0f}%)',
            ha='left', va='center',
            fontsize=9, color=INK_600, fontweight='bold',
            transform=ax1.transAxes)

    # Total line
    ax1.text(0.012, 0.06,
        f'Total: {CUR_SYM}{total_spent:,.0f}',
        ha='left', va='center', fontsize=9,
        color=INK_900, fontweight='bold',
        transform=ax1.transAxes)

else:
    ax1.text(0.5, 0.5, L('No data in this period'),
        ha='center', va='center', fontsize=10, color=INK_300,
        transform=ax1.transAxes)

# ═══════════════════════════════════════════════════════
# SECTION 2 — Over-budget categories
# ═══════════════════════════════════════════════════════
ax2 = section_ax(2)
ax2.axis('off')
section_title(ax2, L('Budget Overview'))

if not budgets:
    ax2.text(0.5, 0.45, L('No budgets configured yet  —  add them in the _budgets tab'),
        ha='center', va='center', fontsize=10, color=INK_300,
        transform=ax2.transAxes)
else:
    # Show ALL categories with a budget (not just over-budget)
    budget_cats = [(cat, bv) for cat, bv in budgets.items() if bv is not None]
    budget_cats.sort(key=lambda x: -(by_cat.get(x[0], 0) / x[1]))  # sort by % utilization

    n_rows  = len(budget_cats)
    row_h   = 0.72 / max(n_rows, 1)
    bar_l   = 0.30
    bar_w   = 0.52
    y_start = 0.88

    # Column headers
    ax2.text(0.012,  y_start + 0.05, L('Category'),  fontsize=8, color=INK_300, fontweight='bold', transform=ax2.transAxes)
    ax2.text(bar_l,  y_start + 0.05, L('Progress'),  fontsize=8, color=INK_300, fontweight='bold', transform=ax2.transAxes)
    ax2.text(bar_l + bar_w + 0.01, y_start + 0.05, L('Spent / Budget'), fontsize=8, color=INK_300, fontweight='bold', transform=ax2.transAxes)

    for i, (cat, budget) in enumerate(budget_cats):
        spent = by_cat.get(cat, 0.0)
        pct   = min(spent / budget, 1.0) if budget else 0
        over  = spent > budget
        clr   = RED if over else (AMBER if pct > 0.80 else GREEN)
        y     = y_start - (i + 0.5) * row_h
        bh    = row_h * 0.45

        # Row background (alternating)
        bg = INK_100 if i % 2 == 0 else WHITE
        ax2.add_patch(FancyBboxPatch((0, y - bh * 0.6), 1.0, row_h * 0.88,
            boxstyle="round,pad=0", facecolor=bg, linewidth=0,
            transform=ax2.transAxes, zorder=0))

        # Category name
        ax2.text(0.012, y, bidi(cat),
            ha='left', va='center', fontsize=9,
            color=INK_900, fontweight='bold',
            transform=ax2.transAxes)

        # Track
        ax2.add_patch(FancyBboxPatch((bar_l, y - bh / 2), bar_w, bh,
            boxstyle="round,pad=0", facecolor=INK_100, linewidth=0,
            transform=ax2.transAxes, zorder=1))
        # Fill
        fill_w = max(bar_w * pct, 0.004)
        ax2.add_patch(FancyBboxPatch((bar_l, y - bh / 2), fill_w, bh,
            boxstyle="round,pad=0", facecolor=clr, linewidth=0, alpha=0.85,
            transform=ax2.transAxes, zorder=2))

        # Pct badge for over-budget
        if over:
            ax2.text(bar_l + bar_w * 0.5, y,
                f'+{(pct-1)*100:.0f}% over',
                ha='center', va='center', fontsize=7.5,
                color=WHITE, fontweight='bold',
                transform=ax2.transAxes, zorder=3)

        # Amount text
        ax2.text(bar_l + bar_w + 0.012, y,
            f'{CUR_SYM}{spent:,.0f} / {CUR_SYM}{budget:,.0f}',
            ha='left', va='center', fontsize=8.5,
            color=RED if over else INK_600, fontweight='bold' if over else 'normal',
            transform=ax2.transAxes)

# ═══════════════════════════════════════════════════════
# SECTION 3 — Top 10 expenses
# ═══════════════════════════════════════════════════════
ax3 = section_ax(3)
ax3.axis('off')
section_title(ax3, L('Top 10 Expenses'))

COL_X   = [0.012, 0.10, 0.40, 0.64, 0.82]
COL_HDR = [L('Date'), L('Vendor'), L('Category'), L('Amount'), L('Status')]
HDR_Y   = 0.92

# Header row
for x, hdr in zip(COL_X, COL_HDR):
    ax3.text(x, HDR_Y, hdr,
        ha='left', va='center', fontsize=8,
        color=INK_300, fontweight='bold',
        transform=ax3.transAxes)
ax3.axhline(y=HDR_Y - 0.04, xmin=0.01, xmax=0.99,
    color=INK_300, linewidth=0.5)

n10    = len(top10)
row_h3 = 0.78 / max(n10, 1)
y0     = HDR_Y - 0.07

for i, e in enumerate(top10):
    y  = y0 - i * row_h3
    bg = INK_100 if i % 2 == 0 else WHITE
    ax3.add_patch(FancyBboxPatch((0, y - row_h3 * 0.45), 1.0, row_h3 * 0.88,
        boxstyle="round,pad=0", facecolor=bg, linewidth=0,
        transform=ax3.transAxes, zorder=0))

    status_clr = AMBER if e['status'] == 'needs_review' else GREEN
    status_txt = '⚠ Review' if e['status'] == 'needs_review' else '✓'

    row_vals = [
        (COL_X[0], e['date'].strftime('%d %b'), INK_600,  'normal', 8.5),
        (COL_X[1], bidi(e['vendor'][:22]),      INK_900,  'bold',   9),
        (COL_X[2], bidi(e['category'][:20]),    INK_600,  'normal', 8.5),
        (COL_X[3], f"{CUR_SYM}{e['amount']:,.0f}", INK_900, 'bold',  9),
        (COL_X[4], status_txt,                  status_clr, 'bold', 8.5),
    ]
    for xv, txt, clr, fw, fs in row_vals:
        ax3.text(xv, y, txt,
            ha='left', va='center', fontsize=fs,
            color=clr, fontweight=fw,
            transform=ax3.transAxes)

# ═══════════════════════════════════════════════════════
# SECTION 4 — Subscriptions this month
# ═══════════════════════════════════════════════════════
ax4 = section_ax(4)
ax4.axis('off')
section_title(ax4, f'{L("Subscriptions This Period")}  —  {CUR_SYM}{subs_total:,.2f} {L("Total").lower()}')

if not subs_this_month:
    ax4.text(0.5, 0.45, L('No subscriptions detected'),
        ha='center', va='center', fontsize=10, color=INK_300,
        transform=ax4.transAxes)
else:
    S_COL_X   = [0.012, 0.38, 0.60, 0.80]
    S_COL_HDR = [L('Vendor'), L('Amount'), L('Frequency'), L('Last Seen')]
    S_HDR_Y   = 0.90

    for x, hdr in zip(S_COL_X, S_COL_HDR):
        ax4.text(x, S_HDR_Y, hdr,
            ha='left', va='center', fontsize=8,
            color=INK_300, fontweight='bold',
            transform=ax4.transAxes)
    ax4.axhline(y=S_HDR_Y - 0.04, xmin=0.01, xmax=0.99,
        color=INK_300, linewidth=0.5)

    n_s   = len(subs_this_month)
    row_s = 0.75 / max(n_s, 1)
    y_s0  = S_HDR_Y - 0.10

    for i, s in enumerate(subs_this_month):
        y  = y_s0 - i * row_s
        bg = INK_100 if i % 2 == 0 else WHITE
        ax4.add_patch(FancyBboxPatch((0, y - row_s * 0.45), 1.0, row_s * 0.88,
            boxstyle="round,pad=0", facecolor=bg, linewidth=0,
            transform=ax4.transAxes, zorder=0))

        s_cur_sym = {"ILS": "₪", "USD": "$", "EUR": "€", "GBP": "£"}.get(s.get('currency', HOME_CURRENCY), CUR_SYM)
        rows_s = [
            (S_COL_X[0], bidi(s['vendor'][:35]),                    INK_900, 'bold',   9.5),
            (S_COL_X[1], f"{s_cur_sym}{s['amount']:,.2f}",          BLUE,    'bold',   9.5),
            (S_COL_X[2], s.get('frequency', L('Monthly')),             INK_600, 'normal', 9),
            (S_COL_X[3], s['last_seen'].strftime('%d %b %Y'),       INK_600, 'normal', 9),
        ]
        for xv, txt, clr, fw, fs in rows_s:
            ax4.text(xv, y, txt,
                ha='left', va='center', fontsize=fs,
                color=clr, fontweight=fw,
                transform=ax4.transAxes)

# ── FOOTER ────────────────────────────────────────────────────────────────────
needs_review_count = len([e for e in windowed if e['status'] == 'needs_review'])
footer_txt = f"Generated {TODAY.strftime('%B %d, %Y')}  ·  {tx_count} transactions  ·  {HOME_CURRENCY}"
if needs_review_count:
    footer_txt += f"  ·  {needs_review_count} item(s) need review"
fig.text(0.5, 0.012, footer_txt,
    ha='center', fontsize=8, color=INK_300)

# ── SAVE ──────────────────────────────────────────────────────────────────────
plt.savefig(OUTPUT_PATH, dpi=150, bbox_inches='tight',
    facecolor=BG, edgecolor='none')
print(f"Report saved to {OUTPUT_PATH}")
