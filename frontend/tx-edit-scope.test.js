const assert = require("assert");
const {
  formatTxEditMonthDay,
  formatTxEditOccurrenceBanner,
  detectTxEditSeriesOnlyChanges,
  formatTxEditSeriesOnlyError,
  formatTxEditApplyScopeCopy,
  formatTxEditDeleteScopeCopy,
} = require("./tx-edit-scope.js");

assert.strictEqual(formatTxEditMonthDay("2026-11-15"), "Nov 15");
assert.strictEqual(formatTxEditMonthDay("2026-09-03"), "Sep 3");

{
  const banner = formatTxEditOccurrenceBanner("2026-11-15");
  assert.strictEqual(banner.title, "Editing Nov 15");
  assert.strictEqual(banner.hint, "");
}
{
  const banner = formatTxEditOccurrenceBanner("2026-11-15", { fromUpcoming: true });
  assert.strictEqual(banner.title, "Editing Nov 15");
  assert.strictEqual(banner.hint, "Starts on the next upcoming occurrence.");
}
{
  const banner = formatTxEditOccurrenceBanner("2026-11-15", { confirmOccurrence: true });
  assert.strictEqual(banner.title, "Confirm Nov 15");
  assert.strictEqual(banner.hint, "");
}

{
  const none = detectTxEditSeriesOnlyChanges(
    { notes: "A", recurrence: "monthly", endsMode: "never", endCount: "", secondDay: "" },
    { notes: "A", recurrence: "monthly", endsMode: "never", endCount: "12", secondDay: "" }
  );
  assert.deepStrictEqual(none, []);
}
{
  const dirty = detectTxEditSeriesOnlyChanges(
    { notes: "", recurrence: "monthly", endsMode: "never", endCount: "", secondDay: "" },
    { notes: "Call utility", recurrence: "biweekly", endsMode: "after_count", endCount: "12", secondDay: "" }
  );
  assert.deepStrictEqual(dirty, ["Notes", "Repeat", "Ends"]);
}

assert.strictEqual(
  formatTxEditSeriesOnlyError(["Notes"]),
  "Notes applies to the series. Choose This and future occurrences, or undo those series changes to save only this date."
);
assert.ok(formatTxEditSeriesOnlyError(["Notes", "Repeat"]).includes("Notes and Repeat apply"));

{
  const copy = formatTxEditApplyScopeCopy({
    openedIso: "2026-11-15",
    editedIso: "2026-11-15",
  });
  assert.strictEqual(copy.instanceTitle, "Only this occurrence");
  assert.strictEqual(copy.seriesTitle, "This and future occurrences");
  assert.strictEqual(copy.recommended, "instance");
  assert.strictEqual(copy.defaultChoice, "instance");
  assert.ok(copy.instanceHint.includes("Nov 15"));
}
{
  const copy = formatTxEditApplyScopeCopy({
    openedIso: "2026-11-15",
    editedIso: "2026-11-17",
  });
  assert.strictEqual(copy.instanceTitle, "Move only Nov 15 to Nov 17");
  assert.strictEqual(copy.seriesTitle, "Change this and future scheduled dates");
  assert.strictEqual(copy.defaultChoice, "instance");
}
{
  const copy = formatTxEditApplyScopeCopy({
    openedIso: "2026-11-15",
    editedIso: "2026-11-15",
    seriesFieldNames: ["Notes"],
  });
  assert.strictEqual(copy.defaultChoice, "series");
  assert.strictEqual(copy.recommended, "series");
  assert.ok(copy.seriesNotice.includes("Notes applies to the series"));
}

{
  const copy = formatTxEditDeleteScopeCopy({ openedIso: "2026-11-15" });
  assert.strictEqual(copy.title, "Skip or end this series");
  assert.strictEqual(copy.instanceTitle, "Skip this occurrence");
  assert.strictEqual(copy.seriesTitle, "End recurring series from this date");
  assert.strictEqual(copy.instanceConfirm, "Skip");
  assert.strictEqual(copy.seriesConfirm, "End series");
  assert.ok(copy.helper.includes("skip Nov 15"));
  assert.ok(copy.instanceHint.includes("Nov 15"));
  assert.ok(!copy.helper.toLowerCase().includes("cannot be undone"));
  assert.ok(!copy.instanceHint.toLowerCase().includes("cannot be undone"));
  assert.ok(!copy.seriesHint.toLowerCase().includes("cannot be undone"));
  assert.ok(!/\bundo\b/i.test(`${copy.helper} ${copy.instanceHint} ${copy.seriesHint}`));
}

console.log("tx-edit-scope.test.js: ok");
