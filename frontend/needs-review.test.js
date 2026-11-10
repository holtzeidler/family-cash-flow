const assert = require("assert");
const {
  NEEDS_REVIEW_INITIAL_LIMIT,
  NEEDS_REVIEW_EMPTY_TITLE,
  NEEDS_REVIEW_EMPTY_NONE_TITLE,
  needsReviewAddDays,
  isNeedsReviewMonthEligible,
  needsReviewTodayChanged,
  needsReviewMonthLabel,
  needsReviewYm,
  formatNeedsReviewDueLabel,
  formatNeedsReviewMeta,
  parseNeedsReviewAmount,
  formatNeedsReviewAmountInput,
  applyNeedsReviewConfirmLocally,
  buildNeedsReviewConfirmPayload,
  visibleNeedsReviewRows,
  collectNeedsReviewRows,
} = require("./needs-review.js");

const TODAY = "2026-11-10";
const NOV = "2026-11";
const DEC = "2026-12";

function exp(extra) {
  return {
    expected_transaction_id: 1,
    date: TODAY,
    occurrence_date: TODAY,
    kind: "expense",
    amount: 95,
    variable: true,
    category_id: 4,
    description: "Utilities",
    ...extra,
  };
}

{
  assert.strictEqual(NEEDS_REVIEW_INITIAL_LIMIT, 5);
  assert.strictEqual(NEEDS_REVIEW_EMPTY_TITLE, "All caught up.");
  assert.strictEqual(NEEDS_REVIEW_EMPTY_NONE_TITLE, "No estimates to review.");
  assert.strictEqual(needsReviewYm("2026-11"), "2026-11");
  assert.strictEqual(needsReviewMonthLabel("2026-11"), "November 2026");
  assert.strictEqual(needsReviewMonthLabel("2026-12"), "December 2026");
  assert.strictEqual(isNeedsReviewMonthEligible("2026-11-09", NOV), true);
  assert.strictEqual(isNeedsReviewMonthEligible("2026-11-30", NOV), true);
  assert.strictEqual(isNeedsReviewMonthEligible("2026-12-11", NOV), false);
  assert.strictEqual(isNeedsReviewMonthEligible("2026-12-11", DEC), true);
  assert.strictEqual(isNeedsReviewMonthEligible("2026-11-07", DEC), false);
  assert.strictEqual(needsReviewTodayChanged("2026-11-10", "2026-11-10"), false);
  assert.strictEqual(needsReviewTodayChanged("2026-11-10", "2026-11-11"), true);
}

{
  assert.strictEqual(formatNeedsReviewDueLabel(0, TODAY), "due today");
  assert.strictEqual(formatNeedsReviewDueLabel(1, "2026-11-11"), "due tomorrow");
  assert.strictEqual(formatNeedsReviewDueLabel(2, "2026-11-12"), "due Nov 12");
  assert.strictEqual(formatNeedsReviewDueLabel(-3, "2026-11-07"), "3 days overdue");
  assert.strictEqual(formatNeedsReviewMeta(95, 0, TODAY), "Est. $95 · due today");
  assert.strictEqual(formatNeedsReviewMeta(80, 31, "2026-12-11"), "Est. $80 · due Dec 11");
}

{
  const collected = collectNeedsReviewRows({
    todayIso: TODAY,
    monthYm: NOV,
    expectedItems: [
      exp({ expected_transaction_id: 1, date: "2026-11-30", occurrence_date: "2026-11-30", description: "Later" }),
      exp({ expected_transaction_id: 2, date: TODAY, occurrence_date: TODAY, description: "Today" }),
      exp({ expected_transaction_id: 3, date: "2026-11-07", occurrence_date: "2026-11-07", amount: 72, description: "Overdue" }),
      exp({ expected_transaction_id: 4, date: "2026-12-11", occurrence_date: "2026-12-11", description: "Credit Card Payment" }),
      exp({ expected_transaction_id: 5, date: TODAY, occurrence_date: TODAY, variable: false, description: "Confirmed" }),
      exp({ expected_transaction_id: 6, date: TODAY, occurrence_date: TODAY, cancelled: true, description: "Skipped" }),
    ],
  });
  assert.deepStrictEqual(
    collected.rows.map((r) => r.item.description),
    ["Overdue", "Today", "Later"]
  );
  assert.strictEqual(collected.hadVariableEstimates, true);
}

{
  const collected = collectNeedsReviewRows({
    todayIso: TODAY,
    monthYm: DEC,
    expectedItems: [
      exp({ expected_transaction_id: 11, date: "2026-11-07", occurrence_date: "2026-11-07", description: "Nov overdue" }),
      exp({
        expected_transaction_id: 12,
        date: "2026-12-11",
        occurrence_date: "2026-12-11",
        amount: 80,
        description: "Credit Card Payment",
      }),
      exp({ expected_transaction_id: 13, date: "2026-12-20", occurrence_date: "2026-12-20", description: "Later Dec" }),
    ],
  });
  assert.deepStrictEqual(
    collected.rows.map((r) => r.item.description),
    ["Credit Card Payment", "Later Dec"]
  );
}

{
  const collected = collectNeedsReviewRows({
    todayIso: TODAY,
    monthYm: NOV,
    expectedItems: [exp({ amount: 95, category_id: 4, kind: "expense" })],
    actualItems: [{ id: 88, date: TODAY, category_id: 4, kind: "expense", amount: 95 }],
  });
  assert.strictEqual(collected.rows.length, 0);
  assert.strictEqual(collected.hadVariableEstimates, true);
}

{
  const collected = collectNeedsReviewRows({
    todayIso: TODAY,
    monthYm: NOV,
    expectedItems: [exp({ amount: 95, category_id: 4 })],
    actualItems: [{ id: 88, date: TODAY, category_id: 4, kind: "expense", amount: 108 }],
  });
  assert.strictEqual(collected.rows.length, 1);
}

{
  const none = collectNeedsReviewRows({
    todayIso: TODAY,
    monthYm: NOV,
    expectedItems: [exp({ variable: false, description: "Rent" })],
  });
  assert.strictEqual(none.rows.length, 0);
  assert.strictEqual(none.hadVariableEstimates, false);

  const caughtUp = collectNeedsReviewRows({
    todayIso: TODAY,
    monthYm: NOV,
    seriesById: new Map([[1, { id: 1, variable: true }]]),
    expectedItems: [exp({ variable: false, description: "Utilities" })],
  });
  assert.strictEqual(caughtUp.rows.length, 0);
  assert.strictEqual(caughtUp.hadVariableEstimates, true);
}

{
  const rows = Array.from({ length: 7 }, (_, i) => ({ iso: `2026-11-0${i + 1}`, item: exp({ expected_transaction_id: i + 1 }) }));
  assert.strictEqual(visibleNeedsReviewRows(rows).length, 5);
  assert.strictEqual(visibleNeedsReviewRows(rows, { expanded: true }).length, 7);
  assert.strictEqual(visibleNeedsReviewRows(rows.slice(0, 5)).length, 5);
}

{
  assert.strictEqual(needsReviewAddDays("2026-11-29", 3), "2026-12-02");
  const collected = collectNeedsReviewRows({
    todayIso: "2026-11-29",
    monthYm: NOV,
    expectedItems: [
      exp({ expected_transaction_id: 21, date: "2026-11-29", occurrence_date: "2026-11-29", description: "Today" }),
      exp({ expected_transaction_id: 22, date: "2026-12-02", occurrence_date: "2026-12-02", description: "Dec 2" }),
    ],
  });
  assert.deepStrictEqual(
    collected.rows.map((r) => r.item.description),
    ["Today"]
  );
}

{
  assert.strictEqual(parseNeedsReviewAmount("95"), 95);
  assert.strictEqual(parseNeedsReviewAmount("108.50"), 108.5);
  assert.strictEqual(parseNeedsReviewAmount("1,080"), 1080);
  assert.strictEqual(parseNeedsReviewAmount("0"), null);
  assert.strictEqual(parseNeedsReviewAmount(""), null);
  const payload = buildNeedsReviewConfirmPayload(
    exp({ account_id: 3, amount: 95, bg_color: "#9EC4A8" }),
    108,
    { account_id: 9, kind: "expense", description: "Utilities", category_id: 4 }
  );
  assert.strictEqual(payload.action, "update");
  assert.strictEqual(payload.account_id, 3);
  assert.strictEqual(payload.amount, 108);
  assert.strictEqual(payload.variable, false);
  assert.strictEqual(payload.moved_to_date, null);
  assert.strictEqual(payload.kind, "expense");
  assert.strictEqual(payload.description, "Utilities");
}

{
  assert.strictEqual(formatNeedsReviewAmountInput(95), "95.00");
  assert.strictEqual(formatNeedsReviewAmountInput(108.5), "108.50");
  assert.strictEqual(formatNeedsReviewAmountInput(1080), "1,080.00");
  assert.strictEqual(formatNeedsReviewAmountInput(0), "");
  assert.strictEqual(parseNeedsReviewAmount(formatNeedsReviewAmountInput(1080)), 1080);
}

{
  const todayItem = exp({ amount: 95, variable: true });
  const extraCopy = exp({ amount: 95, variable: true });
  const future = exp({
    date: "2026-12-09",
    occurrence_date: "2026-12-09",
    amount: 95,
    variable: true,
  });
  applyNeedsReviewConfirmLocally(todayItem, 108, [[extraCopy, future]]);
  assert.strictEqual(todayItem.variable, false);
  assert.strictEqual(todayItem.amount, 108);
  assert.strictEqual(extraCopy.variable, false);
  assert.strictEqual(extraCopy.amount, 108);
  assert.strictEqual(future.variable, true);
  assert.strictEqual(future.amount, 95);
  const nov = collectNeedsReviewRows({
    todayIso: TODAY,
    monthYm: NOV,
    seriesById: new Map([[1, { id: 1, variable: true }]]),
    expectedItems: [todayItem, future],
  });
  assert.strictEqual(nov.rows.length, 0);
  assert.strictEqual(nov.hadVariableEstimates, true);
  const dec = collectNeedsReviewRows({
    todayIso: TODAY,
    monthYm: DEC,
    expectedItems: [todayItem, future],
  });
  assert.strictEqual(dec.rows.length, 1);
  assert.strictEqual(dec.rows[0].item.date, "2026-12-09");
}

console.log("needs-review.test.js: ok");
