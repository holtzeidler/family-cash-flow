const {
  defaultReconcileIso,
  clampReconcileIso,
  sidebarReconcileDaysSince,
  sidebarReconcileTone,
  formatSidebarReconcileDate,
  formatSidebarReconcileElapsed,
  latestIsoFromDateSets,
} = require("./sidebar-reconcile.js");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(defaultReconcileIso("2026-11-09", "2026-11-01") === "2026-11-08", "default yesterday");
assert(defaultReconcileIso("2026-11-01", "2026-11-01") === "2026-11-01", "clamp yesterday to start");
assert(defaultReconcileIso("2026-11-09", "2026-10-15") === "2026-11-08", "yesterday after start");
assert(clampReconcileIso("2026-11-20", "2026-11-09", "2026-11-01") === "2026-11-09", "no future dates");
assert(clampReconcileIso("2026-10-01", "2026-11-09", "2026-11-01") === "2026-11-01", "no dates before start");

assert(sidebarReconcileDaysSince("2026-11-09", "2026-11-09") === 0, "same day");
assert(sidebarReconcileDaysSince("2026-11-03", "2026-11-09") === 6, "six days");
assert(sidebarReconcileDaysSince("2026-11-02", "2026-11-09") === 7, "seven days");
assert(sidebarReconcileTone(6) === "neutral", "six days stays neutral");
assert(sidebarReconcileTone(7) === "stale", "seven days is stale");
assert(sidebarReconcileTone(null) === "none", "missing date is none");

assert(formatSidebarReconcileDate("2026-11-02") === "Nov 2", "short date");
assert(formatSidebarReconcileElapsed(6) === "", "fresh has no elapsed copy");
assert(formatSidebarReconcileElapsed(7) === "7 days ago", "stale elapsed copy");
assert(formatSidebarReconcileElapsed(8) === "8 days ago", "older elapsed copy");

assert(
  latestIsoFromDateSets([new Set(["2026-10-04", "2026-11-01"]), ["2026-09-12"]]) === "2026-11-01",
  "latest from reconciled sets only"
);

console.log("sidebar-reconcile.test.js: ok");
