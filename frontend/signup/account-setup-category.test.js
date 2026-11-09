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
check("calendar recovery passes the transaction type", /categoryIdForOnboardingDraftLabel\(t\.category, t\.kind\)/.test(app));

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

check("old drafts without a category are found", accountSetupDraftCategoryFixIndex([
  { amount: 2500, category: "Paycheck" },
  { amount: 140, category: "Uncategorized" },
]) === 1);
check("blank draft category is found", accountSetupDraftCategoryFixIndex([{ amount: 20, category: "" }]) === 0);
check("draft items with no amount are ignored", accountSetupDraftCategoryFixIndex([{ amount: 0, category: "" }]) === -1);
check("complete drafts pass", accountSetupDraftCategoryFixIndex([{ amount: 20, category: "Utility" }]) === -1);
check("missing drafts pass", accountSetupDraftCategoryFixIndex(null) === -1);

["doSignup", "finishResumeAccountSetup"].forEach(function (name) {
  var body = functionBody(signup, name);
  var gate = body.indexOf("reopenAccountSetupItemNeedingCategory()");
  check(name + " checks saved items before saving anything", gate > 0 && gate < body.indexOf("bwSignupInFlight = true"));
});
check(
  "Continue after the saved list checks saved items",
  functionBody(signup, "accountSetupTxHubContinueClick").indexOf("reopenAccountSetupItemNeedingCategory()") > 0
);
check(
  "a reopened item is replaced on save, not added again",
  /accountSetupCategoryFixIndex[\s\S]{0,300}existing\.map\(/.test(functionBody(signup, "accountSetupSaveIncomeClick"))
);
var comboInit = functionBody(signup, "initAccountSetupCategoryCombobox");
var blurStart = comboInit.indexOf("function resolveInputOnBlur");
var blurBody = comboInit.slice(blurStart, comboInit.indexOf("accountSetupCategoryResolvers.set", blurStart));
check("typed text only counts when it exactly matches a category", blurStart > 0 && blurBody.indexOf("filterCategoriesForSearch") < 0);

/* Behavior: run the real save and recovery code against a fake API. */

function topLevelFunction(src, name) {
  var start = src.indexOf("\nasync function " + name + "(");
  if (start < 0) start = src.indexOf("\nfunction " + name + "(");
  if (start < 0) throw new Error("missing " + name);
  var end = src.indexOf("\n}\n", start);
  return src.slice(start, end + 3);
}
function topLevelConst(src, name) {
  var start = src.indexOf("\nconst " + name + " =");
  if (start < 0) throw new Error("missing " + name);
  return src.slice(start, src.indexOf("\n};\n", start) + 4);
}

function fakeApi(opts) {
  var calls = [];
  var nextId = 100;
  function handle(path, method, body) {
    calls.push({ path: path, method: method, body: body });
    if (method === "GET" && /\/categories$/.test(path)) {
      return { ok: true, status: 200, data: (opts.categories || []).slice() };
    }
    if (method === "POST" && /\/categories$/.test(path)) {
      if (opts.categoryCreateFails) return { ok: false, status: 503, data: null };
      return { ok: true, status: 200, data: { id: nextId++, name: body.name } };
    }
    if (method === "POST" && /\/(transactions|expected-transactions)$/.test(path)) {
      return { ok: true, status: 200, data: { id: nextId++ } };
    }
    return { ok: false, status: 404, data: null };
  }
  return { calls: calls, handle: handle };
}

function txPosts(calls) {
  return calls.filter(function (c) {
    return c.method === "POST" && /\/(transactions|expected-transactions)$/.test(c.path);
  });
}

var seeded = [
  { id: 1, name: "Paycheck", group_id: 1, group_name: "Income" },
  { id: 4, name: "Utilities", group_id: 2, group_name: "Housing & Bills" },
  { id: 13, name: "Other Expense", group_id: 5, group_name: "Other" },
];

var signupSaveCode = [
  "onboardingCategoryLookupKey",
  "signupCategoryIdByKey",
  "ensureOnboardingCategoryId",
  "maybeCreateFirstTransactionFromDraft",
].map(function (n) { return topLevelFunction(signup, n); }).join("\n") + topLevelConst(signup, "ONBOARDING_CATEGORY_ALIAS_KEYS");

function runSignupSave(draft, apiOpts) {
  var fake = fakeApi(apiOpts);
  var make = new Function(
    "request",
    "requestWithRetry",
    "ensureFamilyIdForSignupDraft",
    "accountSetupEffectiveTxDate",
    "onboardingCategoryGroupIdForKind",
    signupSaveCode + "\nreturn maybeCreateFirstTransactionFromDraft;"
  );
  var save = make(
    async function (p, m, b) { return fake.handle(p, m, b); },
    async function (p, m, b) { return fake.handle(p, m, b); },
    async function () { return { ok: true, familyId: 1 }; },
    function (d) { return d; },
    onboardingCategoryGroupIdForKind
  );
  return save(draft, 7, 1).then(function (result) { return { result: result, calls: fake.calls }; });
}

var paycheck = { kind: "income", amount: 2500, category: "Paycheck", date: "2026-11-13", recurring: true, recurrence: "biweekly" };
var daycare = { kind: "expense", amount: 900, category: "Daycare", date: "2026-11-20", recurring: true, recurrence: "monthly" };
var legacyBill = { kind: "expense", amount: 140, category: "Uncategorized", date: "2026-11-20", recurring: false };

var recoveryCode = [
  "onboardingCategoryLookupKey",
  "categoryIdMatchingOnboardingLabel",
  "categoryIdForOnboardingDraftLabel",
  "tryRecoverAccountSetupDraft",
].map(function (n) { return topLevelFunction(app, n); }).join("\n") + topLevelConst(app, "ONBOARDING_CATEGORY_ALIAS_KEYS");

function runRecovery(draft, apiOpts, env) {
  var fake = fakeApi(apiOpts);
  var stored = { draft: JSON.stringify(draft), cleared: false, opened: [] };
  var state = {
    activeFamilyId: 1,
    needsOnboarding: false,
    accounts: [{ id: 7, name: "Checking", starting_balance: 3200, starting_balance_date: "2026-11-09" }],
    categories: (apiOpts.categories || []).slice(),
  };
  async function api(p, m, b) {
    var r = fake.handle(p, m, b);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.data;
  }
  var make = new Function(
    "state", "api", "loadCategories", "loadFamilies", "readAccountSetupDraftJsonRaw", "writeAccountSetupDraftJson",
    "clearAccountSetupDraftJsonStorage", "onboardingRecoveryIsAllowedForDraft", "resolveRecoveryAccountIdFromDraft",
    "categoryGroupIdForNewCategory", "openSetupItemNeedingCategory", "document", "window",
    recoveryCode + "\nreturn tryRecoverAccountSetupDraft;"
  );
  var recover = make(
    state, api, async function () {}, async function () {},
    function () { return stored.draft; },
    function (d) { stored.draft = JSON.stringify(d); },
    function () { stored.cleared = true; stored.draft = ""; },
    function () { return true; },
    function () { return 7; },
    function (kind) { return kind === "income" ? 1 : 5; },
    function (t) { stored.opened.push(t); return Promise.resolve(); },
    { querySelector: function () { return env && env.modalOpen ? {} : null; } },
    {}
  );
  return recover().then(function (returned) {
    return { returned: returned, calls: fake.calls, stored: stored };
  });
}

function everyPostHasCategory(calls) {
  return txPosts(calls).every(function (c) { return Number(c.body.category_id) > 0; });
}

var behaviorCases = [
  runSignupSave({ transactions: [paycheck, daycare] }, { categories: seeded, categoryCreateFails: true }).then(function (r) {
    var posts = txPosts(r.calls);
    check("setup: failed category creation does not save the item", posts.length === 1 && posts[0].body.description === "Paycheck");
    check("setup: saved items always have a category", everyPostHasCategory(r.calls));
    check("setup: failed category creation is reported", r.result.ok === false && r.result.error === "category_unavailable");
    check("setup: only the unsaved item is kept for recovery", (r.result.unsaved || []).length === 1 && (r.result.unsaved || [])[0] === daycare);
  }),
  runSignupSave({ transactions: [paycheck, legacyBill] }, { categories: seeded }).then(function (r) {
    check("setup: an Uncategorized draft item is not saved", txPosts(r.calls).length === 1);
    check("setup: an Uncategorized draft item does not create a category", !r.calls.some(function (c) {
      return c.method === "POST" && /\/categories$/.test(c.path);
    }));
    check("setup: the Uncategorized item is kept", (r.result.unsaved || []).length === 1 && (r.result.unsaved || [])[0] === legacyBill);
  }),
  runSignupSave({ transactions: [paycheck, daycare] }, { categories: seeded }).then(function (r) {
    var cat = r.calls.filter(function (c) { return c.method === "POST" && /\/categories$/.test(c.path); });
    check("setup: a new bill category is created in Other", cat.length === 1 && cat[0].body.group_id === 5);
    check("setup: both items save with categories", txPosts(r.calls).length === 2 && everyPostHasCategory(r.calls));
    check("setup: a full save reports nothing unsaved", r.result.ok === true && (r.result.unsaved || []).length === 0);
  }),
  runRecovery({ account: { name: "Checking" }, transactions: [paycheck, daycare] }, { categories: seeded, categoryCreateFails: true }).then(function (r) {
    check("recovery: failed category creation does not save the item", txPosts(r.calls).length === 1 && everyPostHasCategory(r.calls));
    var left = r.stored.draft ? JSON.parse(r.stored.draft).transactions : [];
    check("recovery: only the unsaved item is retried later", !r.stored.cleared && left.length === 1 && left[0].category === "Daycare");
  }),
  runRecovery({ account: { name: "Checking" }, transactions: [legacyBill] }, { categories: seeded }).then(function (r) {
    check("recovery: an Uncategorized item is not saved", txPosts(r.calls).length === 0);
    check("recovery: an Uncategorized item opens the form to choose a category", r.stored.opened.length === 1 && r.stored.opened[0].amount === 140);
  }),
  runRecovery({ account: { name: "Checking" }, transactions: [legacyBill] }, { categories: seeded }, { modalOpen: true }).then(function (r) {
    var left = r.stored.draft ? JSON.parse(r.stored.draft).transactions : [];
    check("recovery: with another popup open, the item waits for the next visit", r.stored.opened.length === 0 && left.length === 1);
  }),
  runRecovery({ account: { name: "Checking" }, transactions: [paycheck, legacyBill] }, { categories: seeded }).then(function (r) {
    var left = r.stored.draft ? JSON.parse(r.stored.draft).transactions : [];
    check("recovery: saved items are not replayed with the Uncategorized one", txPosts(r.calls).length === 1 && left.length === 1 && left[0].category === "Uncategorized");
    check("recovery: no form opens behind the forecast-ready popup", r.stored.opened.length === 0);
  }),
];

Promise.all(behaviorCases).then(function () {
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}, function (err) {
  console.error(err);
  process.exit(1);
});
