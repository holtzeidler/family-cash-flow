/**
 * Needs Review lists variable expected occurrences that are overdue, due today,
 * or due within a few days — not every estimate on the calendar month.
 */

const NEEDS_REVIEW_UPCOMING_DAYS = 3;
const NEEDS_REVIEW_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function needsReviewNormalizeIso(raw) {
  if (raw == null || raw === "") return "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(raw));
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
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

function isNeedsReviewDateEligible(iso, todayIso, upcomingDays = NEEDS_REVIEW_UPCOMING_DAYS) {
  const days = needsReviewDaysUntil(iso, todayIso);
  if (days == null || !Number.isFinite(days)) return false;
  return days <= Number(upcomingDays);
}

function needsReviewMonthDay(iso) {
  const due = needsReviewNormalizeIso(iso);
  if (!due) return "";
  const m = Number(due.slice(5, 7));
  const d = Number(due.slice(8, 10));
  if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(d)) return due;
  return `${NEEDS_REVIEW_MONTHS[m - 1]} ${d}`;
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

function needsReviewItemMonth(item) {
  return (needsReviewNormalizeIso(item?.date) || "").slice(0, 7);
}

function needsReviewActualKey(tx) {
  const id = Number(tx && tx.id);
  if (Number.isFinite(id) && id > 0) return `id:${id}`;
  return `flow:${needsReviewFlowKey(tx)}`;
}

/** Keep items from months the calendar has not reloaded this navigation. */
function syncNeedsReviewItemCache(cache, items, loadedMonths, keyFn, monthOf) {
  const next = cache instanceof Map ? new Map(cache) : new Map();
  const monthSet = new Set((loadedMonths || []).filter(Boolean));
  if (monthSet.size) {
    for (const [key, it] of next) {
      const ym = monthOf(it);
      if (ym && monthSet.has(ym)) next.delete(key);
    }
  }
  for (const it of items || []) {
    const key = keyFn(it);
    if (!key) continue;
    next.set(key, it);
  }
  return next;
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

function compareNeedsReviewRows(a, b) {
  const aOver = a.daysUntil < 0;
  const bOver = b.daysUntil < 0;
  if (aOver !== bOver) return aOver ? -1 : 1;
  if (a.iso !== b.iso) {
    if (aOver && bOver) return a.iso.localeCompare(b.iso);
    return a.iso.localeCompare(b.iso);
  }
  const aa = Math.abs(Number(a.item?.amount) || 0);
  const bb = Math.abs(Number(b.item?.amount) || 0);
  if (bb !== aa) return bb - aa;
  const an = String(a.item?.description || a.item?.category || "");
  const bn = String(b.item?.description || b.item?.category || "");
  return an.localeCompare(bn);
}

function collectNeedsReviewRows({
  expectedItems,
  actualItems,
  todayIso,
  upcomingDays = NEEDS_REVIEW_UPCOMING_DAYS,
} = {}) {
  const actualKeys = new Set();
  for (const tx of actualItems || []) {
    actualKeys.add(needsReviewFlowKey(tx));
  }
  const seenOcc = new Set();
  const rows = [];
  for (const it of expectedItems || []) {
    if (!it || it.cancelled) continue;
    if (!it.variable) continue;
    const iso = needsReviewNormalizeIso(it.date) || "";
    if (!iso) continue;
    if (!isNeedsReviewDateEligible(iso, todayIso, upcomingDays)) continue;
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
  return rows;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    NEEDS_REVIEW_UPCOMING_DAYS,
    needsReviewAddDays,
    needsReviewDaysUntil,
    isNeedsReviewDateEligible,
    needsReviewMonthDay,
    needsReviewFlowKey,
    needsReviewOccurrenceKey,
    needsReviewItemMonth,
    needsReviewActualKey,
    syncNeedsReviewItemCache,
    formatNeedsReviewDueLabel,
    formatNeedsReviewMeta,
    collectNeedsReviewRows,
  };
}
