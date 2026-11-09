const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  cashHealthAddDays,
  cashHealthMonthsInRange,
  summarizeCashHealth,
  cashHealthRunUpRange,
  explainCashHealthRunUp,
  cashHealthHighlightRefs,
  buildCashHealthCopy,
  groupCashHealthDayItems,
} = require("./cash-health-summary.js");

const TODAY = "2026-11-09";

/** Daily rows like calendar-month-daily: flows[iso] = [{kind, amount, label, variable, ref}]. */
function buildRows(startBalance, flows, { from = TODAY, days = 120, verified = {} } = {}) {
  const rows = new Map();
  const itemsByDay = new Map();
  let carry = startBalance;
  for (let i = 0; i < days; i++) {
    const iso = cashHealthAddDays(from, i);
    const items = flows[iso] || [];
    const txNet = items.reduce((s, it) => s + (it.kind === "income" ? it.amount : -it.amount), 0);
    const start = carry;
    const end = verified[iso] != null ? verified[iso] : start + txNet;
    rows.set(iso, { start, txNet, end });
    if (items.length) itemsByDay.set(iso, items);
    carry = end;
  }
  return { rows, itemsByDay };
}

const out = (label, amount, extra = {}) => ({ kind: "expense", amount, label, ref: `tx:${label}`, ...extra });
const inc = (label, amount) => ({ kind: "income", amount, label, ref: `tx:${label}` });

function fullCopy(rows, itemsByDay, minimum, todayIso = TODAY) {
  const summary = summarizeCashHealth(rows, { todayIso, minimum });
  const range = cashHealthRunUpRange(summary, rows);
  const expl = explainCashHealthRunUp(range, itemsByDay, rows);
  return { summary, range, expl, copy: buildCashHealthCopy(summary, expl) };
}

// Window: 90 days including today, across months.
assert.deepStrictEqual(cashHealthMonthsInRange(TODAY, cashHealthAddDays(TODAY, 89)), ["2026-11", "2026-12", "2027-01", "2027-02"]);
assert.strictEqual(cashHealthAddDays("2026-12-31", 1), "2027-01-01");
assert.strictEqual(cashHealthAddDays("2028-02-28", 1), "2028-02-29");

// Healthy with a minimum.
{
  const { rows, itemsByDay } = buildRows(3000, {
    "2026-11-13": [inc("Paycheck", 2100)],
    "2026-11-25": [out("Rent", 1650)],
  });
  const { summary, copy } = fullCopy(rows, itemsByDay, 1000);
  assert.strictEqual(summary.state, "healthy");
  assert.strictEqual(summary.lowest.date, TODAY);
  assert.strictEqual(copy.tone, "healthy");
  assert.strictEqual(copy.headline, "Stays above your $1,000 minimum balance");
  assert.deepStrictEqual(copy.lines, ["Lowest $3,000 today"]);
  assert.strictEqual(copy.footer, "Next 90 days");
  assert.strictEqual(copy.actionIso, null);
}

// A balance exactly at the minimum, or exactly $0, is not a warning (strict comparisons, like the calendar).
{
  const { rows } = buildRows(1500, { "2026-11-20": [out("Bill", 500)] });
  assert.strictEqual(summarizeCashHealth(rows, { todayIso: TODAY, minimum: 1000 }).state, "healthy");
  const zero = buildRows(500, { "2026-11-20": [out("Bill", 500)] });
  assert.strictEqual(summarizeCashHealth(zero.rows, { todayIso: TODAY, minimum: null }).state, "healthy");
  const cent = buildRows(1500, { "2026-11-20": [out("Bill", 500.01)] });
  assert.strictEqual(summarizeCashHealth(cent.rows, { todayIso: TODAY, minimum: 1000 }).state, "below");
}

// Below the minimum, never negative, with a recovery.
{
  const { rows, itemsByDay } = buildRows(2000, {
    "2026-11-19": [out("Car Repair", 1250)],
    "2026-11-20": [out("Credit Card Payment", 100)],
    "2026-11-27": [inc("Paycheck", 2350)],
  });
  const { summary, expl, copy } = fullCopy(rows, itemsByDay, 1000);
  assert.strictEqual(summary.state, "below");
  assert.strictEqual(summary.anchor.date, "2026-11-19");
  assert.strictEqual(summary.lowest.date, "2026-11-20");
  assert.strictEqual(summary.recovery.date, "2026-11-27");
  assert.strictEqual(expl.kind, "named");
  assert.strictEqual(copy.kicker, "Below your minimum balance");
  assert.strictEqual(copy.headline, "Nov 19 · $750");
  assert.strictEqual(copy.lines[0], "Lowest $650 on Nov 20, $350 below your $1,000 minimum balance");
  assert.strictEqual(copy.lines[1], "Largest payment on Nov 19: Car Repair −$1,250");
  assert.strictEqual(copy.footer, "Next 90 days · View Nov 19");
  assert.strictEqual(copy.actionIso, "2026-11-19");
}

// Below minimum first, then much deeper negative in the next month: negative wins and names both large payments.
{
  const flows = {
    "2026-11-27": [inc("Paycheck", 2350), out("Travel", 1480)],
    "2026-11-28": [out("Groceries", 185, { variable: true })],
    "2026-11-29": [out("Kids", 40)],
    "2026-11-30": [inc("Paycheck", 1800), out("Property Tax", 3850)],
    "2026-12-01": [out("Mortgage", 2450)],
    "2026-12-03": [out("Childcare", 1100)],
    "2026-12-09": [out("Holiday Gifts", 1300)],
    "2026-12-18": [inc("Year-end Bonus", 6000)],
  };
  const { rows, itemsByDay } = buildRows(2300, flows);
  const { summary, range, expl, copy } = fullCopy(rows, itemsByDay, 1000);
  assert.strictEqual(summary.state, "negative");
  assert.strictEqual(summary.firstBelow.date, "2026-11-30");
  assert.strictEqual(summary.firstNegative.date, "2026-12-01");
  assert.strictEqual(summary.lowest.date, "2026-12-09");
  assert.strictEqual(summary.recovery.date, "2026-12-18");
  assert.strictEqual(range.startIso, "2026-11-28");
  assert.strictEqual(expl.kind, "named");
  assert.deepStrictEqual(expl.payments.map((p) => p.label), ["Property Tax", "Mortgage"]);
  assert.strictEqual(copy.kicker, "Projected to go below $0");
  assert.strictEqual(copy.headline, "Dec 1 · −$1,555");
  assert.strictEqual(copy.lines[0], "Lowest −$3,955 on Dec 9 · back above $0 on Dec 18");
  assert.strictEqual(copy.lines[1], "Largest payments Nov 28–Dec 1: Property Tax −$3,850 (Nov 30), Mortgage −$2,450 (Dec 1)");
  assert.strictEqual(copy.actionIso, "2026-12-01");
  assert.strictEqual(copy.chip, "Projected to go below $0 Dec 1 · −$1,555");
  assert.deepStrictEqual(cashHealthHighlightRefs(expl), ["tx:Property Tax", "tx:Mortgage"]);
  assert.ok(!/caus/i.test(copy.lines.join(" ")), "never claims a cause");
}

// Negative that never recovers inside the window: no recovery text, lowest still shown.
{
  const { rows, itemsByDay } = buildRows(500, { "2026-11-12": [out("Rent", 900)], "2026-11-20": [out("Car", 300)] });
  const { summary, copy } = fullCopy(rows, itemsByDay, null);
  assert.strictEqual(summary.recovery, null);
  assert.strictEqual(copy.lines[0], "Lowest −$700 on Nov 20");
}

// Many smaller payments together: aggregate wording, no single payment named as the reason.
{
  const late = buildRows(1500, {
    "2026-11-18": [out("Insurance", 120)],
    "2026-11-19": [out("Phone", 100), out("Internet", 90)],
    "2026-11-21": [out("Utilities", 95, { variable: true })],
    "2026-11-22": [out("Groceries", 110)],
    "2026-11-24": [out("Student Loan", 110), out("Gym", 55)],
  });
  const lateCopy = fullCopy(late.rows, late.itemsByDay, 900);
  assert.strictEqual(lateCopy.summary.anchor.date, "2026-11-24");
  assert.strictEqual(lateCopy.expl.kind, "several");
  assert.strictEqual(lateCopy.summary.state, "below");
  assert.strictEqual(lateCopy.copy.lines[1], "7 payments Nov 18–24 total $680 · largest Insurance −$120 (Nov 18)");
  assert.deepStrictEqual(cashHealthHighlightRefs(lateCopy.expl), ["tx:Insurance"]);
  assert.ok(!/largest payments?:/i.test(lateCopy.copy.lines[1]), "no single payment is singled out as the reason");
}

// Variable amounts are labeled as estimates.
{
  const { rows, itemsByDay } = buildRows(1200, { "2026-11-15": [out("Credit Card Payment", 600, { variable: true })] });
  const { copy } = fullCopy(rows, itemsByDay, 1000);
  assert.strictEqual(copy.lines[1], "Largest payment on Nov 15: Credit Card Payment (est.) −$600");
}

// No minimum: only $0 matters; healthy wording names $0.
{
  const { rows, itemsByDay } = buildRows(400, { "2026-11-20": [out("Bill", 300)] });
  const { summary, copy } = fullCopy(rows, itemsByDay, null);
  assert.strictEqual(summary.hasMinimum, false);
  assert.strictEqual(summary.state, "healthy");
  assert.strictEqual(copy.headline, "Stays above $0");
  assert.deepStrictEqual(copy.lines, ["Lowest $100 on Nov 20"]);
  const neg = buildRows(400, { "2026-11-20": [out("Bill", 500)], "2026-11-27": [inc("Paycheck", 900)] });
  const negCopy = fullCopy(neg.rows, neg.itemsByDay, null);
  assert.strictEqual(negCopy.summary.state, "negative");
  assert.strictEqual(negCopy.copy.headline, "Nov 20 · −$100");
  assert.strictEqual(negCopy.copy.lines[0], "Back above $0 on Nov 27");
  assert.strictEqual(negCopy.copy.lines[1], "Largest payment on Nov 20: Bill −$500");
}

// Already negative or below the minimum today: anchor is today, no run-up list.
{
  const { rows, itemsByDay } = buildRows(-120, { "2026-11-12": [out("Phone", 280)], "2026-11-13": [inc("Paycheck", 2100)] });
  const { summary, range, copy } = fullCopy(rows, itemsByDay, 1000);
  assert.strictEqual(summary.state, "negative");
  assert.strictEqual(summary.startsToday, true);
  assert.strictEqual(range, null);
  assert.strictEqual(copy.kicker, "Balance is below $0");
  assert.strictEqual(copy.headline, "Today · −$120");
  assert.strictEqual(copy.lines[0], "Lowest −$400 on Nov 12 · back above $0 on Nov 13");
  assert.strictEqual(copy.lines.length, 1);
  assert.strictEqual(copy.footer, "Next 90 days · View today");
  assert.strictEqual(copy.chip, "Below $0 today · −$120");
  const low = buildRows(640, { "2026-11-13": [inc("Paycheck", 2100)] });
  const lowCopy = fullCopy(low.rows, low.itemsByDay, 1000).copy;
  assert.strictEqual(lowCopy.headline, "Today · $640");
  assert.strictEqual(lowCopy.lines[0], "$360 below your $1,000 minimum balance");
}

// Month boundary: run-up crosses into the previous month; a problem beyond 90 days is out of scope.
{
  const { rows, itemsByDay } = buildRows(1800, {
    "2026-11-30": [out("Property Tax", 900)],
    "2026-12-01": [out("Mortgage", 950)],
  });
  const { range, copy } = fullCopy(rows, itemsByDay, null);
  assert.strictEqual(range.startIso, "2026-11-30");
  assert.deepStrictEqual(copy.lines, ["Largest payments Nov 30–Dec 1: Mortgage −$950 (Dec 1), Property Tax −$900 (Nov 30)"]);
  const far = buildRows(1800, { [cashHealthAddDays(TODAY, 90)]: [out("Tax", 5000)] });
  assert.strictEqual(summarizeCashHealth(far.rows, { todayIso: TODAY, minimum: 1000 }).state, "healthy");
  const edge = buildRows(1800, { [cashHealthAddDays(TODAY, 89)]: [out("Tax", 5000)] });
  assert.strictEqual(summarizeCashHealth(edge.rows, { todayIso: TODAY, minimum: 1000 }).state, "negative");
}

// Missing balance data never produces a reassuring answer.
{
  const { rows } = buildRows(5000, {});
  rows.delete("2026-12-15");
  const summary = summarizeCashHealth(rows, { todayIso: TODAY, minimum: 1000 });
  assert.strictEqual(summary.state, "unavailable");
  assert.strictEqual(buildCashHealthCopy(summary, null), null);
}

// If the listed payments do not add up to the forecast's daily change, fall back to the balance change itself.
{
  const { rows, itemsByDay } = buildRows(1500, { "2026-11-20": [out("Bill", 800)] });
  itemsByDay.set("2026-11-20", []);
  const { expl, copy } = fullCopy(rows, itemsByDay, 1000);
  assert.strictEqual(expl.kind, "aggregate");
  assert.strictEqual(copy.lines[1], "Balance falls $800 on Nov 20");
  assert.deepStrictEqual(cashHealthHighlightRefs(expl), []);
}

// Duplicate occurrences: reuse the calendar's own dedupe so the listed payments match the day cell and the balance.
{
  const appSrc = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const extract = (name) => {
    const start = appSrc.indexOf(`function ${name}(`);
    assert.ok(start !== -1, `missing ${name}`);
    let depth = 0;
    for (let i = appSrc.indexOf("{", start); i < appSrc.length; i++) {
      if (appSrc[i] === "{") depth += 1;
      else if (appSrc[i] === "}" && --depth === 0) return appSrc.slice(start, i + 1);
    }
    throw new Error(`unclosed ${name}`);
  };
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    [extract("normalizeIsoDate"), extract("txnBreakdownDedupeKey"), extract("dedupeCalendarDayTransactions")].join("\n") +
      "\nthis.dedupe = dedupeCalendarDayTransactions;",
    ctx
  );
  const actuals = [{ id: 7, date: "2026-11-20", kind: "expense", amount: "320.00", category_id: 4, description: "Insurance" }];
  const expected = [
    { expected_transaction_id: 3, date: "2026-11-20", occurrence_date: "2026-11-20", kind: "expense", amount: "320.00", category_id: 4, description: "Insurance" },
    { expected_transaction_id: 9, date: "2026-11-20", occurrence_date: "2026-11-20", kind: "expense", amount: "40.00", category_id: 8, description: "Kids" },
    { expected_transaction_id: 10, date: "2026-11-20", occurrence_date: "2026-11-20", kind: "expense", amount: "40.00", category_id: 8, description: "Kids copy" },
    { expected_transaction_id: 11, date: "2026-11-21", occurrence_date: "2026-11-14", kind: "expense", amount: "600", category_id: 5, description: "Card", variable: true },
  ];
  const labelFor = (row) => row.description;
  const both = groupCashHealthDayItems({
    actuals, expected, mode: "both", startIso: "2026-11-20", endIso: "2026-11-21", dedupe: ctx.dedupe, labelFor,
  });
  assert.deepStrictEqual(both.get("2026-11-20").map((it) => it.ref), ["tx:7", "exp:9|2026-11-20"]);
  assert.deepStrictEqual(both.get("2026-11-21").map((it) => [it.ref, it.variable]), [["exp:11|2026-11-14", true]]);
  const expectedOnly = groupCashHealthDayItems({
    actuals, expected, mode: "expected", startIso: "2026-11-20", endIso: "2026-11-21", dedupe: ctx.dedupe, labelFor,
  });
  assert.deepStrictEqual(expectedOnly.get("2026-11-20").map((it) => it.ref), ["exp:3|2026-11-20", "exp:9|2026-11-20"]);
  const actualOnly = groupCashHealthDayItems({
    actuals, expected, mode: "actual", startIso: "2026-11-20", endIso: "2026-11-21", dedupe: ctx.dedupe, labelFor,
  });
  assert.deepStrictEqual([...actualOnly.keys()], ["2026-11-20"]);

  // The deduped items reconcile with a forecast day that counted each flow once.
  const rows = new Map([
    ["2026-11-19", { start: 2000, txNet: 0, end: 2000 }],
    ["2026-11-20", { start: 2000, txNet: -360, end: 1640 }],
  ]);
  const expl = explainCashHealthRunUp({ startIso: "2026-11-20", endIso: "2026-11-20", drop: 360 }, both, rows);
  assert.strictEqual(expl.kind, "named");
}

console.log("cash-health-summary tests passed");
