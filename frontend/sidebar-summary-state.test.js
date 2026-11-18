var fs = require("fs");
var path = require("path");
var assert = require("assert");

var app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
var calendarHtml = fs.readFileSync(path.join(__dirname, "calendar/index.html"), "utf8");
var txHtml = fs.readFileSync(path.join(__dirname, "transactions/index.html"), "utf8");

function functionBody(src, name) {
  var start = src.indexOf("function " + name + "(");
  assert.ok(start >= 0, name);
  var next = src.indexOf("\nfunction ", start + 1);
  var nextAsync = src.indexOf("\nasync function ", start + 1);
  var end = [next, nextAsync, src.length]
    .filter(function (i) {
      return i > start;
    })
    .sort(function (a, b) {
      return a - b;
    })[0];
  return src.slice(start, end);
}

var present = new Function(functionBody(app, "sidebarSummaryPresentation") + "\nreturn sidebarSummaryPresentation;")();
var phase = new Function(functionBody(app, "reconcileSummaryPhase") + "\nreturn reconcileSummaryPhase;")();

assert.strictEqual(present("loading", "", "Never").kind, "loading");
assert.strictEqual(present("loading", "Nov 16", "Never").kind, "loading");
assert.strictEqual(present("ready", "", "Never").text, "Never");
assert.strictEqual(present("ready", "Nov 16", "Never").text, "Nov 16");
assert.strictEqual(present("error", "", "Never").text, "Unavailable");
assert.strictEqual(present("error", "Nov 16", "Never").text, "Nov 16");
assert.strictEqual(present("ready", "", "No estimates to review.").text, "No estimates to review.");
assert.strictEqual(present("loading", 0, "$0").kind, "loading");

assert.strictEqual(phase("loading", "loading", false), "loading");
assert.strictEqual(phase("ready", "loading", false), "loading");
assert.strictEqual(phase("loading", "ready", true), "loading");
assert.strictEqual(phase("ready", "ready", false), "ready");
assert.strictEqual(phase("ready", "ready", true), "ready");
assert.strictEqual(phase("error", "ready", false), "error");
assert.strictEqual(phase("ready", "error", false), "error");
assert.strictEqual(phase("error", "ready", true), "ready");

assert.ok(calendarHtml.indexOf('sidebar-reconcile__date">Never') < 0, "calendar does not start on Never");
assert.ok(txHtml.indexOf('sidebar-reconcile__date">Never') < 0, "transactions does not start on Never");
var reviewPaint = functionBody(app, "renderSidebarPendingTransactionsForMonth");
assert.ok(reviewPaint.indexOf("sidebarPendingTxCard.hidden = true") >= 0, "empty Needs Review is hidden");
assert.ok(reviewPaint.indexOf("All caught up.") < 0, "a finished empty list is not labeled caught up");
assert.ok(reviewPaint.indexOf("No estimates to review.") < 0, "a finished empty list is not labeled empty");
assert.ok(reviewPaint.indexOf("pending-attn-item") >= 0, "items that need review stay actionable");
assert.ok(reviewPaint.indexOf('setPendingStatus("Unavailable")') >= 0, "a failed load is not shown as complete");
assert.ok(functionBody(app, "paintMonthSummarySkeleton").indexOf("Income") >= 0, "monthly totals keep their labels while the amounts load");
assert.ok(functionBody(app, "paintMonthSummarySkeleton").indexOf("$0") < 0, "monthly totals do not paint zero while loading");

console.log("sidebar-summary-state.test.js ok");
