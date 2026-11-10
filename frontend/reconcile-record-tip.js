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

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    finiteMoney,
    reconciledConfirmedBalance,
    adjustedConfirmedBalance,
    adjustedForecastBalance,
    reconcileRecordCaption,
  };
}
