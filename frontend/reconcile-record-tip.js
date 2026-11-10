/**
 * Completed reconciliation popover amounts.
 * Matching days store only a date flag — never treat null as $0.00 (Number(null) === 0).
 */

function finiteMoney(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function reconciledConfirmedBalance(dayBal) {
  if (!dayBal) return null;
  const verified = finiteMoney(dayBal.verifiedAmount);
  if (verified != null) return verified;
  const projected = finiteMoney(dayBal.projectedEnd);
  if (projected != null) return projected;
  return finiteMoney(dayBal.end);
}

function adjustedConfirmedBalance(dayBal) {
  if (!dayBal) return null;
  const verified = finiteMoney(dayBal.verifiedAmount);
  if (verified != null) return verified;
  return finiteMoney(dayBal.end);
}

function adjustedForecastBalance(dayBal, storedProjected) {
  const stored = finiteMoney(storedProjected);
  if (stored != null) return stored;
  if (!dayBal) return null;
  return finiteMoney(dayBal.projectedEnd);
}

function reconcileRecordCaption({ matched, diff, fmtMoney } = {}) {
  if (matched) return "Matched bank balance";
  const n = Number(diff);
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return "Did not match forecast";
  const amt = typeof fmtMoney === "function" ? fmtMoney(Math.abs(n)) : Math.abs(n).toFixed(2);
  if (n > 0) return `Your balance was $${amt} higher than forecast.`;
  return `Your balance was $${amt} lower than forecast.`;
}

function normalizeReconciledIso(raw) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(raw || ""));
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function dropReconciledIso(iso, merged, byMonth) {
  const d = normalizeReconciledIso(iso);
  if (!d) return "";
  if (merged && typeof merged.delete === "function") merged.delete(d);
  const monthSet = byMonth && typeof byMonth.get === "function" ? byMonth.get(d.slice(0, 7)) : null;
  if (monthSet && typeof monthSet.delete === "function") monthSet.delete(d);
  return d;
}

function addReconciledIso(iso, merged, byMonth) {
  const d = normalizeReconciledIso(iso);
  if (!d) return "";
  if (merged && typeof merged.add === "function") merged.add(d);
  if (byMonth && typeof byMonth.get === "function" && typeof byMonth.set === "function") {
    const ym = d.slice(0, 7);
    const monthSet = byMonth.get(ym) || new Set();
    monthSet.add(d);
    byMonth.set(ym, monthSet);
  }
  return d;
}

function isSameReconciledIso(a, b) {
  const x = normalizeReconciledIso(a);
  const y = normalizeReconciledIso(b);
  return !!(x && y && x === y);
}

/** Loading UI belongs only to the date whose action is in flight. */
function shouldKeepBalanceRecordTipBusy(busyIso, shownIso) {
  return isSameReconciledIso(busyIso, shownIso);
}

function shouldHideBalanceRecordTipAfterRemoval(removedIso, shownIso) {
  const shown = normalizeReconciledIso(shownIso);
  return !shown || isSameReconciledIso(removedIso, shown);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    finiteMoney,
    reconciledConfirmedBalance,
    adjustedConfirmedBalance,
    adjustedForecastBalance,
    reconcileRecordCaption,
    normalizeReconciledIso,
    dropReconciledIso,
    addReconciledIso,
    isSameReconciledIso,
    shouldKeepBalanceRecordTipBusy,
    shouldHideBalanceRecordTipAfterRemoval,
  };
}
