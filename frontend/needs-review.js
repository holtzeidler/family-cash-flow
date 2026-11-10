/**
 * Needs Review lists unconfirmed variable expected occurrences in the
 * currently viewed calendar month — not overdue items from other months.
 */

const NEEDS_REVIEW_INITIAL_LIMIT = 5;
const NEEDS_REVIEW_EMPTY_TITLE = "All caught up.";
const NEEDS_REVIEW_EMPTY_NONE_TITLE = "No estimates to review.";
const NEEDS_REVIEW_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NEEDS_REVIEW_MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function needsReviewNormalizeIso(raw) {
  if (raw == null || raw === "") return "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(raw));
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function needsReviewYm(raw) {
  const s = String(raw || "").trim();
  const fromYm = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (fromYm) return `${fromYm[1]}-${fromYm[2].padStart(2, "0")}`;
  return needsReviewNormalizeIso(s).slice(0, 7);
}

function needsReviewAddDays(iso, days) {
  const p = String(iso || "").split("-").map(Number);
  if (p.length < 3 || !p[0] || !p[1] || !p[2]) return "";
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + Number(days || 0)));
  return d.toISOString().slice(0, 10);
}

function needsReviewDaysUntil(iso, todayIso) {
  const due = needsReviewNormalizeIso(iso);
  const today = needsReviewNormalizeIso(todayIso);
  if (!due || !today) return null;
  const a = Date.UTC(Number(due.slice(0, 4)), Number(due.slice(5, 7)) - 1, Number(due.slice(8, 10)));
  const b = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  return Math.round((a - b) / 86400000);
}

function isNeedsReviewMonthEligible(iso, monthYm) {
  const ym = needsReviewYm(monthYm);
  if (!ym) return false;
  return needsReviewYm(iso) === ym;
}

function needsReviewTodayChanged(previousTodayIso, nowTodayIso) {
  const now = needsReviewNormalizeIso(nowTodayIso);
  if (!now) return false;
  return now !== needsReviewNormalizeIso(previousTodayIso);
}

function needsReviewMonthDay(iso) {
  const due = needsReviewNormalizeIso(iso);
  if (!due) return "";
  const m = Number(due.slice(5, 7));
  const d = Number(due.slice(8, 10));
  if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(d)) return due;
  return `${NEEDS_REVIEW_MONTHS[m - 1]} ${d}`;
}

function needsReviewMonthLabel(ym) {
  const key = needsReviewYm(ym);
  if (!key) return "";
  const m = Number(key.slice(5, 7));
  if (!Number.isFinite(m) || m < 1 || m > 12) return "";
  return `${NEEDS_REVIEW_MONTHS_LONG[m - 1]} ${key.slice(0, 4)}`;
}

function needsReviewFlowKey(row) {
  const date = needsReviewNormalizeIso(row?.date) || String(row?.date || "");
  const amt = Math.round(Math.abs(Number(row?.amount || 0)) * 100);
  return `${date}|${row?.category_id ?? "n"}|${row?.kind}|${amt}`;
}

function needsReviewOccurrenceKey(item) {
  const occ = needsReviewNormalizeIso(item?.occurrence_date || item?.date) || String(item?.date || "");
  const id = item?.expected_transaction_id ?? item?.id;
  if (id == null || id === "" || !occ) return "";
  return `${id}|${occ}`;
}

function needsReviewSeriesLookup(seriesById, expectedId) {
  if (expectedId == null || expectedId === "" || !seriesById) return null;
  const num = Number(expectedId);
  if (seriesById instanceof Map) {
    return seriesById.get(expectedId) || (Number.isFinite(num) ? seriesById.get(num) : null) || null;
  }
  return seriesById[expectedId] || (Number.isFinite(num) ? seriesById[num] : null) || null;
}

function needsReviewItemFromVariableSeries(item, seriesById) {
  if (item?.variable) return true;
  const series = needsReviewSeriesLookup(seriesById, item?.expected_transaction_id);
  return !!(series && series.variable);
}

function formatNeedsReviewDueLabel(daysUntil, iso) {
  if (!Number.isFinite(daysUntil)) return iso ? `due ${needsReviewMonthDay(iso)}` : "due date unknown";
  if (daysUntil < 0) {
    const n = Math.abs(daysUntil);
    return n === 1 ? "1 day overdue" : `${n} days overdue`;
  }
  if (daysUntil === 0) return "due today";
  if (daysUntil === 1) return "due tomorrow";
  return `due ${needsReviewMonthDay(iso)}`;
}

function formatNeedsReviewMoney(amount) {
  const num = Math.abs(Number(amount));
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatNeedsReviewMeta(amount, daysUntil, iso) {
  return `Est. $${formatNeedsReviewMoney(amount)} · ${formatNeedsReviewDueLabel(daysUntil, iso)}`;
}

function parseNeedsReviewAmount(raw) {
  const n = Number(String(raw ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function formatNeedsReviewAmountInput(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function applyNeedsReviewConfirmLocally(item, amount, expectedLists) {
  const key = needsReviewOccurrenceKey(item);
  const amt = Number(amount);
  const confirmItem = (it) => {
    if (!it) return;
    it.variable = false;
    if (Number.isFinite(amt) && amt > 0) it.amount = amt;
  };
  confirmItem(item);
  const lists = Array.isArray(expectedLists) ? expectedLists : [expectedLists];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const it of list) {
      if (!it || it === item) continue;
      if (key && needsReviewOccurrenceKey(it) === key) confirmItem(it);
    }
  }
  return item;
}

function buildNeedsReviewConfirmPayload(item, amount, series) {
  const accountId = item?.account_id ?? series?.account_id;
  const categoryRaw = item?.category_id ?? series?.category_id;
  const categoryId = categoryRaw == null || categoryRaw === "" ? null : Number(categoryRaw);
  return {
    action: "update",
    account_id: Number(accountId),
    kind: item?.kind || series?.kind || "expense",
    amount,
    description: String(item?.description || series?.description || "").trim().slice(0, 500),
    category_id: Number.isFinite(categoryId) && categoryId > 0 ? categoryId : null,
    moved_to_date: null,
    variable: false,
  };
}

function compareNeedsReviewRows(a, b) {
  if (a.iso !== b.iso) return String(a.iso || "").localeCompare(String(b.iso || ""));
  const aa = Math.abs(Number(a.item?.amount) || 0);
  const bb = Math.abs(Number(b.item?.amount) || 0);
  if (aa !== bb) return aa - bb;
  const an = String(a.item?.description || a.item?.category || "");
  const bn = String(b.item?.description || b.item?.category || "");
  return an.localeCompare(bn);
}

function visibleNeedsReviewRows(rows, { expanded = false, limit = NEEDS_REVIEW_INITIAL_LIMIT } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const cap = Number(limit);
  if (expanded || !Number.isFinite(cap) || cap < 1 || list.length <= cap) return list;
  return list.slice(0, cap);
}

function collectNeedsReviewRows({
  expectedItems,
  actualItems,
  todayIso,
  monthYm,
  seriesById,
} = {}) {
  const actualKeys = new Set();
  for (const tx of actualItems || []) {
    actualKeys.add(needsReviewFlowKey(tx));
  }
  const seenOcc = new Set();
  const rows = [];
  let hadVariableEstimates = false;
  const ym = needsReviewYm(monthYm);
  for (const it of expectedItems || []) {
    if (!it || it.cancelled) continue;
    const iso = needsReviewNormalizeIso(it.date) || "";
    if (!iso) continue;
    if (ym && !isNeedsReviewMonthEligible(iso, ym)) continue;
    const fromVariableSeries = needsReviewItemFromVariableSeries(it, seriesById);
    if (fromVariableSeries) hadVariableEstimates = true;
    if (!it.variable) continue;
    const occKey = needsReviewOccurrenceKey(it);
    if (!occKey || seenOcc.has(occKey)) continue;
    const flow = needsReviewFlowKey({
      date: iso,
      category_id: it.category_id,
      kind: it.kind,
      amount: it.amount,
    });
    if (actualKeys.has(flow)) continue;
    seenOcc.add(occKey);
    rows.push({
      iso,
      daysUntil: needsReviewDaysUntil(iso, todayIso),
      item: it,
    });
  }
  rows.sort(compareNeedsReviewRows);
  return { rows, hadVariableEstimates };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    NEEDS_REVIEW_INITIAL_LIMIT,
    NEEDS_REVIEW_EMPTY_TITLE,
    NEEDS_REVIEW_EMPTY_NONE_TITLE,
    needsReviewAddDays,
    needsReviewDaysUntil,
    needsReviewYm,
    isNeedsReviewMonthEligible,
    needsReviewTodayChanged,
    needsReviewMonthDay,
    needsReviewMonthLabel,
    needsReviewFlowKey,
    needsReviewOccurrenceKey,
    needsReviewItemFromVariableSeries,
    formatNeedsReviewDueLabel,
    formatNeedsReviewMeta,
    parseNeedsReviewAmount,
    formatNeedsReviewAmountInput,
    applyNeedsReviewConfirmLocally,
    buildNeedsReviewConfirmPayload,
    visibleNeedsReviewRows,
    collectNeedsReviewRows,
  };
}
