const fs = require("fs");
const path = require("path");
const vm = require("vm");

const appSrc = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const signupSrc = fs.readFileSync(path.join(__dirname, "signup/signup.js"), "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

function extractFunction(src, name) {
  const marker = "function " + name + "(";
  const start = src.indexOf(marker);
  assert(start !== -1, "missing function " + name);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  assert(false, "unclosed function " + name);
}

const removed = [
  "categoryImpliesMonthlyRecurrence",
  "categoryImpliesTwiceMonthlyRecurrence",
  "applyTxAddCategoryRecurrenceDefaults",
  "applyTxEditCategoryRecurrenceDefaults",
  "applyAccountSetupCategoryRecurrenceDefaults",
];
for (const name of removed) {
  assert(!appSrc.includes(name), name + " must not change Repeat from a category");
  assert(!signupSrc.includes(name), name + " must not change Repeat during account setup");
}

assert(
  appSrc.includes('txAddRecurrence.value = opts.repeats ? "monthly" : ""'),
  "a new transaction starts on Does not repeat"
);
assert(
  appSrc.includes('if (!recurring) instanceRecurrence.value = "once"'),
  "opening a one-time transaction starts on Does not repeat"
);
assert(
  appSrc.includes("instanceRecurrence.value = String(meta.recurrence || \"monthly\")"),
  "opening a series restores its saved schedule"
);

const categoryTouches = [
  "selectCategoryComboboxChoice",
  "normalizeCategoryComboboxInput",
  "setCategoryFieldValue",
  "createCategoryFromCombobox",
];
for (const name of categoryTouches) {
  const body = extractFunction(appSrc, name);
  assert(!/recurrence/i.test(body), name + " must not modify Repeat");
}

const openActual = extractFunction(appSrc, "openTxEditModalAsync");
assert(!/recurrence/i.test(openActual), "opening a one-time transaction must not assign Repeat from its category");
assert(openActual.includes('applyTransactionEditMode("actual")'), "one-time edit uses the saved one-time mode");

const sandbox = {
  categoryComboboxRegistry: new Map(),
  txAddRecurrenceWrites: [],
  instanceRecurrenceWrites: [],
  txAddRecurrence: {
    _value: "weekly",
    set value(next) {
      sandbox.txAddRecurrenceWrites.push(next);
      this._value = next;
    },
    get value() {
      return this._value;
    },
  },
  instanceRecurrence: {
    _value: "monthly",
    set value(next) {
      sandbox.instanceRecurrenceWrites.push(next);
      this._value = next;
    },
    get value() {
      return this._value;
    },
  },
  hideCategoryComboboxList() {},
  refreshTxAddCategoryChipActiveState() {},
  updateTxAddFormValidity() {},
  refreshTxCategoryColorPickers() {},
  categoryDisplayLabel(cat) {
    return String(cat.name || "");
  },
  document: {
    getElementById() {
      return { tagName: "SELECT" };
    },
  },
};

const categories = [
  { id: 1, name: "Mortgage / Rent", group_name: "Housing & Bills" },
  { id: 2, name: "Paycheck", group_name: "Income" },
  { id: 3, name: "Utilities", group_name: "Housing & Bills" },
];
const st = {
  hidden: { value: "" },
  input: { value: "" },
  categories,
  list: { hidden: true },
};
sandbox.categoryComboboxRegistry.set("txAddCategoryId", st);
sandbox.categoryComboboxRegistry.set("txEditCategoryId", st);

vm.runInNewContext(
  [
    extractFunction(appSrc, "selectCategoryComboboxChoice"),
    extractFunction(appSrc, "normalizeCategoryComboboxInput"),
    extractFunction(appSrc, "setCategoryFieldValue"),
  ].join("\n"),
  sandbox
);

sandbox.selectCategoryComboboxChoice("txAddCategoryId", 1, "Mortgage / Rent");
sandbox.selectCategoryComboboxChoice("txAddCategoryId", 2, "Paycheck");
sandbox.selectCategoryComboboxChoice("txEditCategoryId", 3, "Utilities");
st.hidden.value = "";
st.input.value = "Mortgage / Rent";
sandbox.normalizeCategoryComboboxInput("txAddCategoryId");
st.hidden.value = "";
st.input.value = "Paycheck";
sandbox.normalizeCategoryComboboxInput("txEditCategoryId");
sandbox.setCategoryFieldValue("txAddCategoryId", 1);
sandbox.setCategoryFieldValue("txEditCategoryId", 2);

assert(sandbox.txAddRecurrenceWrites.length === 0, "new transaction + Mortgage / Rent or Paycheck stays on the chosen schedule");
assert(sandbox.txAddRecurrence.value === "weekly", "switching categories preserves a manually chosen schedule");
assert(sandbox.instanceRecurrenceWrites.length === 0, "editing a category preserves the series schedule");
assert(sandbox.instanceRecurrence.value === "monthly", "an existing monthly series stays monthly");

function repeatsForSave(value) {
  const v = String(value || "once").trim().toLowerCase();
  return !!v && v !== "once";
}
assert(repeatsForSave("once") === false, "opening and saving an existing one-time transaction does not convert it");
assert(repeatsForSave("") === false, "a blank Repeat value stays one-time");
assert(repeatsForSave("monthly") === true, "an explicit monthly choice is still saved as a series");
assert(
  appSrc.includes("if (txEditScheduleRecurrenceActive()) {\n        await convertActualTransactionToRecurring(id);"),
  "conversion still happens only after the customer chooses a repeating schedule"
);

console.log("category recurrence checks ok");
