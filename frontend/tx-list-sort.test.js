var fs = require("fs");
var path = require("path");
var assert = require("assert");

var app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
var txHtml = fs.readFileSync(path.join(__dirname, "transactions/index.html"), "utf8");

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

var api = new Function(
  functionBody(app, "tmLedgerIso") + "\n" + functionBody(app, "tmSortLedgerRows") + "\nreturn tmSortLedgerRows;"
)();

function dates(rows) {
  return rows.map(function (row) {
    return row.date;
  });
}

var mixed = [
  { date: "2026-11-18", row_type: "actual", id: 3 },
  { date: "2026-11-17", row_type: "actual", id: 2 },
  { date: "2026-11-19", row_type: "expected", expected_transaction_id: 9, occurrence_date: "2026-11-19" },
  { date: "2026-11-15", row_type: "actual", id: 1 },
  { date: "2026-11-18", row_type: "expected", expected_transaction_id: 4, occurrence_date: "2026-11-18" },
];

assert.deepStrictEqual(dates(api(mixed, "all")), [
  "2026-11-15",
  "2026-11-17",
  "2026-11-18",
  "2026-11-18",
  "2026-11-19",
]);
assert.strictEqual(api(mixed, "all")[2].row_type, "actual", "same-day posted rows stay before planned rows");
assert.deepStrictEqual(dates(api(mixed, "past")), [
  "2026-11-19",
  "2026-11-18",
  "2026-11-18",
  "2026-11-17",
  "2026-11-15",
]);
assert.deepStrictEqual(dates(api(mixed, "upcoming")), [
  "2026-11-15",
  "2026-11-17",
  "2026-11-18",
  "2026-11-18",
  "2026-11-19",
]);

assert.ok(app.indexOf('title: "Forecast hygiene"') < 0 && app.indexOf('"Forecast hygiene"') < 0, "empty forecast hygiene card is not shown");
assert.ok(app.indexOf("Nothing urgent surfaced") < 0, "the calm forecast hygiene message is gone");
assert.ok(app.indexOf("if (latestRec)") >= 0, "Monthly Cash Flow still shows Reconciled through");
assert.ok(app.indexOf("function ensureTransactionsSidebar(") >= 0, "Transactions loads the sidebar instead of leaving it blank");
assert.ok(txHtml.indexOf("Search, review, and manage your past and upcoming transactions.") >= 0, "transactions description");
assert.ok(txHtml.indexOf("tm__quickLabel") >= 0 && txHtml.indexOf("Quick filters") >= 0, "secondary quick filters are labeled");
assert.ok(txHtml.indexOf('data-tm-when="all"') >= 0, "All stays a primary time filter");
assert.ok(txHtml.indexOf("<label for=\"tmStatus\">") < 0, "advanced filters do not repeat the quick-filter status list");
assert.ok(txHtml.indexOf('id="tmStatus"') >= 0, "status select remains for the quick filters");

console.log("tx-list-sort.test.js ok");
