var fs = require("fs");
var path = require("path");

eval(fs.readFileSync(path.join(__dirname, "account-setup-category.js"), "utf8"));

var failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
}

var MSG = "Choose a category to continue.";

check("blank category is rejected", accountSetupCategoryValidationMessage("", true) === MSG);
check("whitespace category is rejected", accountSetupCategoryValidationMessage("   ", true) === MSG);
check("missing category is rejected", accountSetupCategoryValidationMessage(undefined, undefined) === MSG);
check("Uncategorized is rejected", accountSetupCategoryValidationMessage("Uncategorized", true) === MSG);
check("uncategorized in any case is rejected", accountSetupCategoryValidationMessage(" uncategorized ", true) === MSG);
check("a category for the other type is rejected", accountSetupCategoryValidationMessage("Paycheck", false) === MSG);
check("a quick-pick category is accepted", accountSetupCategoryValidationMessage("Utility", true) === "");
check("a custom category is accepted", accountSetupCategoryValidationMessage("Daycare", undefined) === "");

var defaultGroups = new Map([
  [1, "Income"],
  [2, "Housing & Bills"],
  [3, "Debt & Payments"],
  [4, "Savings & Transfers"],
  [5, "Other"],
]);
check("new income category goes to Income", onboardingCategoryGroupIdForKind(defaultGroups, "income") === 1);
check("new bill category goes to Other", onboardingCategoryGroupIdForKind(defaultGroups, "expense") === 5);
check(
  "Miscellaneous is preferred for bills",
  onboardingCategoryGroupIdForKind(new Map([[1, "Income"], [7, "Other"], [9, "Miscellaneous"]]), "expense") === 9
);
check("no matching group leaves the server default", onboardingCategoryGroupIdForKind(new Map([[2, "Bills"]]), "expense") == null);
check("no groups leaves the server default", onboardingCategoryGroupIdForKind(new Map(), "income") == null);

var frontend = path.join(__dirname, "..");
var signup = fs.readFileSync(path.join(__dirname, "signup.js"), "utf8");
var app = fs.readFileSync(path.join(frontend, "app.js"), "utf8");
var html = fs.readFileSync(path.join(frontend, "account-setup", "index.html"), "utf8");

function functionBody(src, name) {
  var start = src.indexOf("function " + name + "(");
  if (start < 0) return "";
  var next = src.indexOf("\nfunction ", start + 1);
  var nextAsync = src.indexOf("\nasync function ", start + 1);
  var end = [next, nextAsync, src.length].filter(function (i) { return i > start; }).sort(function (a, b) { return a - b; })[0];
  return src.slice(start, end);
}

["readAccountSetupTransactionFromInputs", "readAccountSetupExpenseTransactionFromInputs"].forEach(function (name) {
  var body = functionBody(signup, name);
  check(name + " exists", body.length > 0);
  check(name + " never falls back to Uncategorized", body.indexOf("Uncategorized") < 0);
  check(name + " commits typed category text first", body.indexOf("flushAccountSetupCategoryInput(") >= 0);
  check(name + " validates the category", body.indexOf("accountSetupCategoryValidationMessage(") >= 0);
  check(name + " checks the category matches the type", body.indexOf("accountSetupStoredCategoryMatchesKind(") >= 0);
  check(name + " reports a missing category", body.indexOf("categoryMissing: true") >= 0);
});

check(
  "rejected onboarding transactions show the category error",
  /categoryMissing[\s\S]{0,200}showAccountSetupCategoryError/.test(functionBody(signup, "rejectAccountSetupParsedTransaction"))
);
check("onboarding passes the transaction type when creating a category", /ensureOnboardingCategoryId\([^)]*t\.kind\)/.test(signup));
check("onboarding new categories get a group", /group_id:\s*groupId/.test(functionBody(signup, "ensureOnboardingCategoryId")));
check("calendar recovery passes the transaction type", (app.match(/categoryIdForOnboardingDraftLabel\(t\.category, t\.kind\)/g) || []).length === 2);

check("regular form uses the same message", app.indexOf('"' + MSG + '"') >= 0);
check("regular form still requires a category to save", app.indexOf("Category is required") >= 0);

[signup, app].forEach(function (src, i) {
  var label = i === 0 ? "signup.js" : "app.js";
  check(label + " maps Utility to Utilities", /utility:\s*"utilities"/.test(src));
  check(label + " maps Subscription to Subscriptions", /subscription:\s*"subscriptions"/.test(src));
});

var helperAt = html.indexOf("signup/account-setup-category.js");
var signupAt = html.indexOf("signup/signup.js");
check("account setup loads the category helper", helperAt >= 0);
check("category helper loads before signup.js", helperAt >= 0 && signupAt > helperAt);
check("income and bill step has a category error", /id="asTxCategoryError"[^>]*role="alert"/.test(html));
check("bills step has a category error", /id="asExpTxCategoryError"[^>]*role="alert"/.test(html));

if (failures.length) {
  throw new Error(failures.join("; "));
}
