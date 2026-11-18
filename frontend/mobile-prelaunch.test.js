var fs = require("fs");
var path = require("path");
var assert = require("assert");

var app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
var css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");

function functionBody(src, name) {
  var start = src.indexOf("function " + name + "(");
  assert.ok(start >= 0, name + " exists");
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

var reports = functionBody(app, "initReportsLeftNav");
assert.ok(reports.indexOf("opt.value = it.id") >= 0, "report options use the report id");
assert.ok(reports.indexOf("opt.textContent = it.label") >= 0, "report options use the report label");
assert.ok(reports.indexOf("opt.value = id") < 0, "report options do not stringify the item object");

var summary = functionBody(app, "syncMobileSummary");
assert.ok(summary.indexOf('view === "transactions"') >= 0 && summary.indexOf('view === "reports"') >= 0, "summary collapses on Transactions and Reports");
assert.ok(functionBody(app, "setActiveTopView").indexOf("scrollPhoneViewIntoSight(v)") >= 0, "a phone tab change scrolls to that page");
assert.ok(css.indexOf("mobile-summary-collapsed") >= 0, "collapsed summary is styled");
assert.ok(css.indexOf(":not(#sidebarBalanceThresholdAlerts)") >= 0, "balance warnings stay visible when the summary is collapsed");
assert.ok(css.indexOf(".mobile-summary-toggle{\n  display: none;") >= 0, "the summary toggle stays off the desktop sidebar");

var reveal = functionBody(app, "revealMobileCalendarPlaced");
assert.ok(reveal.indexOf("placeMobileCalendarBeforeReveal(kind)") >= 0, "today is placed after the phone calendar lays out");
assert.ok(reveal.indexOf("mobileCalendarScrollTopFromOffset") < 0, "initial placement does not use a pre-layout offset");

console.log("mobile-prelaunch.test.js ok");
