const assert = require("assert");
const {
  finiteMoney,
  reconciledConfirmedBalance,
  adjustedConfirmedBalance,
  adjustedForecastBalance,
  reconcileRecordCaption,
  dropReconciledIso,
  addReconciledIso,
} = require("./reconcile-record-tip.js");

function money(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

assert.strictEqual(Number(null), 0, "documents Number(null) === 0");
assert.strictEqual(Number.isFinite(Number(null)), true, "documents the $0.00 display trap");
assert.strictEqual(finiteMoney(null), null);
assert.strictEqual(finiteMoney(undefined), null);
assert.strictEqual(finiteMoney(""), null);
assert.strictEqual(finiteMoney(0), 0);
assert.strictEqual(finiteMoney("13331.75"), 13331.75);

{
  const matchedDay = { verifiedAmount: null, projectedEnd: null, end: 13331.75 };
  assert.strictEqual(reconciledConfirmedBalance(matchedDay), 13331.75, "matching recon uses end-of-day, not $0");
  assert.strictEqual(reconciledConfirmedBalance({ verifiedAmount: null, projectedEnd: null, end: 0 }), 0);
  assert.strictEqual(reconciledConfirmedBalance({ verifiedAmount: 2500, projectedEnd: 2400, end: 2500 }), 2500);
}

{
  const adjusted = { verified: true, verifiedAmount: 12800.5, projectedEnd: 13000, end: 12800.5 };
  assert.strictEqual(adjustedConfirmedBalance(adjusted), 12800.5);
  assert.strictEqual(adjustedForecastBalance(adjusted, 12999.99), 12999.99);
  assert.strictEqual(adjustedForecastBalance(adjusted, null), 13000);
  assert.strictEqual(adjustedForecastBalance({ verifiedAmount: 100, end: 100, projectedEnd: null }, null), null);
}

assert.strictEqual(reconcileRecordCaption({ matched: true }), "Matched bank balance");
assert.strictEqual(reconcileRecordCaption({ matched: false, diff: 68.25, fmtMoney: money }), "Your balance was $68.25 higher than forecast.");
assert.strictEqual(reconcileRecordCaption({ matched: false, diff: -12, fmtMoney: money }), "Your balance was $12.00 lower than forecast.");
assert.strictEqual(reconcileRecordCaption({ matched: false, diff: 0 }), "Did not match forecast");
assert.notStrictEqual(reconcileRecordCaption({ matched: false, diff: 10, fmtMoney: money }), "Matched bank balance");

{
  const merged = new Set(["2026-09-01", "2026-09-08"]);
  const byMonth = new Map([["2026-09", new Set(["2026-09-01", "2026-09-08"])]]);
  assert.strictEqual(dropReconciledIso("2026-09-08", merged, byMonth), "2026-09-08");
  assert.strictEqual(merged.has("2026-09-08"), false);
  assert.strictEqual(merged.has("2026-09-01"), true);
  assert.strictEqual(byMonth.get("2026-09").has("2026-09-08"), false);
  addReconciledIso("2026-09-08", merged, byMonth);
  assert.strictEqual(merged.has("2026-09-08"), true);
  assert.strictEqual(byMonth.get("2026-09").has("2026-09-08"), true);
}

{
  const {
    isSameReconciledIso,
    shouldKeepBalanceRecordTipBusy,
    shouldHideBalanceRecordTipAfterRemoval,
  } = require("./reconcile-record-tip.js");

  assert.strictEqual(isSameReconciledIso("2026-11-10", "2026-11-10"), true);
  assert.strictEqual(isSameReconciledIso("2026-11-10", "2026-11-04"), false);
  assert.strictEqual(isSameReconciledIso("", "2026-11-04"), false);

  assert.strictEqual(shouldKeepBalanceRecordTipBusy("2026-11-10", "2026-11-10"), true);
  assert.strictEqual(
    shouldKeepBalanceRecordTipBusy("2026-11-10", "2026-11-04"),
    false,
    "opening another date must not inherit the in-flight loading state",
  );
  assert.strictEqual(shouldKeepBalanceRecordTipBusy("", "2026-11-04"), false);
  assert.strictEqual(shouldKeepBalanceRecordTipBusy("2026-11-10", ""), false);

  assert.strictEqual(shouldHideBalanceRecordTipAfterRemoval("2026-11-10", "2026-11-10"), true);
  assert.strictEqual(shouldHideBalanceRecordTipAfterRemoval("2026-11-10", ""), true);
  assert.strictEqual(
    shouldHideBalanceRecordTipAfterRemoval("2026-11-10", "2026-11-04"),
    false,
    "removing one date must not close another date's popover",
  );
}

console.log("reconcile-record-tip.test.js: ok");
