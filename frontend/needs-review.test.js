const assert = require("assert");
const {
  NEEDS_REVIEW_UPCOMING_DAYS,
  needsReviewAddDays,
  isNeedsReviewDateEligible,
  formatNeedsReviewDueLabel,
  formatNeedsReviewMeta,
  parseNeedsReviewAmount,
  buildNeedsReviewConfirmPayload,
  collectNeedsReviewRows,
  syncNeedsReviewItemCache,
  needsReviewOccurrenceKey,
  needsReviewItemMonth,
} = require("./needs-review.js");

const TODAY = "2026-11-09";

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
  assert.strictEqual(NEEDS_REVIEW_UPCOMING_DAYS, 3);
  assert.strictEqual(isNeedsReviewDateEligible("2026-11-09", TODAY), true);
  assert.strictEqual(isNeedsReviewDateEligible("2026-11-12", TODAY), true);
  assert.strictEqual(isNeedsReviewDateEligible("2026-11-13", TODAY), false);
  assert.strictEqual(isNeedsReviewDateEligible("2026-11-30", TODAY), false);
  assert.strictEqual(isNeedsReviewDateEligible("2026-11-07", TODAY), true);
}

{
  assert.strictEqual(formatNeedsReviewDueLabel(0, TODAY), "due today");
  assert.strictEqual(formatNeedsReviewDueLabel(1, "2026-11-10"), "due tomorrow");
  assert.strictEqual(formatNeedsReviewDueLabel(2, "2026-11-11"), "due Nov 11");
  assert.strictEqual(formatNeedsReviewDueLabel(-2, "2026-11-07"), "2 days overdue");
  assert.strictEqual(formatNeedsReviewDueLabel(-1, "2026-11-08"), "1 day overdue");
  assert.strictEqual(formatNeedsReviewMeta(95, 0, TODAY), "Est. $95 · due today");
  assert.strictEqual(formatNeedsReviewMeta(108, 1, "2026-11-10"), "Est. $108 · due tomorrow");
}

{
  const rows = collectNeedsReviewRows({
    todayIso: TODAY,
    expectedItems: [
      exp({ expected_transaction_id: 1, date: "2026-11-30", occurrence_date: "2026-11-30", description: "Later" }),
      exp({ expected_transaction_id: 2, date: TODAY, occurrence_date: TODAY, description: "Today" }),
      exp({ expected_transaction_id: 3, date: "2026-11-10", occurrence_date: "2026-11-10", kind: "income", amount: 1800, description: "Paycheck" }),
      exp({ expected_transaction_id: 4, date: "2026-11-07", occurrence_date: "2026-11-07", amount: 72, description: "Overdue" }),
      exp({ expected_transaction_id: 5, date: TODAY, occurrence_date: TODAY, variable: false, description: "Confirmed" }),
      exp({ expected_transaction_id: 6, date: TODAY, occurrence_date: TODAY, cancelled: true, description: "Skipped" }),
    ],
  });
  assert.deepStrictEqual(
    rows.map((r) => r.item.description),
    ["Overdue", "Today", "Paycheck"]
  );
}

{
  const rows = collectNeedsReviewRows({
    todayIso: TODAY,
    expectedItems: [exp({ amount: 95, category_id: 4, kind: "expense" })],
    actualItems: [{ id: 88, date: TODAY, category_id: 4, kind: "expense", amount: 95 }],
  });
  assert.strictEqual(rows.length, 0);
}

{
  const rows = collectNeedsReviewRows({
    todayIso: TODAY,
    expectedItems: [exp({ amount: 95, category_id: 4 })],
    actualItems: [{ id: 88, date: TODAY, category_id: 4, kind: "expense", amount: 108 }],
  });
  assert.strictEqual(rows.length, 1);
}

{
  const nov = exp({ expected_transaction_id: 11, date: "2026-11-09", occurrence_date: "2026-11-09" });
  const dec = exp({ expected_transaction_id: 11, date: "2026-12-09", occurrence_date: "2026-12-09" });
  const rows = collectNeedsReviewRows({
    todayIso: TODAY,
    expectedItems: [nov, dec],
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].item.date, "2026-11-09");
}

{
  assert.strictEqual(needsReviewAddDays("2026-11-29", 3), "2026-12-02");
  assert.strictEqual(isNeedsReviewDateEligible("2026-12-02", "2026-11-29"), true);
  assert.strictEqual(isNeedsReviewDateEligible("2026-12-03", "2026-11-29"), false);
  assert.strictEqual(needsReviewAddDays("2026-12-31", 3), "2027-01-03");
  assert.strictEqual(isNeedsReviewDateEligible("2027-01-03", "2026-12-31"), true);
  const rows = collectNeedsReviewRows({
    todayIso: "2026-12-31",
    expectedItems: [
      exp({ expected_transaction_id: 21, date: "2026-12-31", occurrence_date: "2026-12-31", description: "NYE" }),
      exp({ expected_transaction_id: 22, date: "2027-01-03", occurrence_date: "2027-01-03", description: "Jan 3" }),
      exp({ expected_transaction_id: 23, date: "2027-01-04", occurrence_date: "2027-01-04", description: "Jan 4" }),
    ],
  });
  assert.deepStrictEqual(
    rows.map((r) => r.item.description),
    ["NYE", "Jan 3"]
  );
}

{
  const cache = syncNeedsReviewItemCache(
    new Map(),
    [exp({ expected_transaction_id: 1, date: "2026-10-31", occurrence_date: "2026-10-31" })],
    ["2026-10"],
    needsReviewOccurrenceKey,
    needsReviewItemMonth
  );
  const afterNav = syncNeedsReviewItemCache(
    cache,
    [exp({ expected_transaction_id: 2, date: "2026-11-09", occurrence_date: "2026-11-09" })],
    ["2026-11", "2026-10", "2026-12"],
    needsReviewOccurrenceKey,
    needsReviewItemMonth
  );
  assert.strictEqual(afterNav.size, 1);
  assert.strictEqual([...afterNav.values()][0].expected_transaction_id, 2);

  const keepOverdue = syncNeedsReviewItemCache(
    cache,
    [exp({ expected_transaction_id: 2, date: "2026-11-09", occurrence_date: "2026-11-09" })],
    ["2026-11", "2026-12", "2027-01"],
    needsReviewOccurrenceKey,
    needsReviewItemMonth
  );
  assert.strictEqual(keepOverdue.size, 2);
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

console.log("needs-review.test.js: ok");
