const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

function arrayAfter(label) {
  const start = src.indexOf(label);
  assert(start !== -1, "missing " + label);
  const open = src.indexOf("[", start);
  const close = src.indexOf("];", open);
  return JSON.parse(src.slice(open, close + 1).replace(/,\s*]/, "]"));
}

const income = arrayAfter("const TX_ADD_INCOME_CHIP_HINTS = ");
const expense = arrayAfter("const TX_ADD_EXPENSE_CHIP_HINTS = ");

assert(JSON.stringify(income) === JSON.stringify(["Paycheck", "Other Income", "Cash & ATM"]), "income chips");
assert(
  JSON.stringify(expense) ===
    JSON.stringify([
      "Mortgage / Rent",
      "Utilities",
      "Insurance",
      "Subscriptions",
      "Credit Card Payment",
      "Loan Payment",
      "Cash & ATM",
      "Other Expense",
    ]),
  "expense chips"
);
assert(src.includes('if (n === "cash & atm") return true;'), "Cash & ATM follows the selected transaction type");
assert(!src.includes("seed-defaults?force=true"), "load defaults must not replace an existing list");
assert(!src.includes("maybeEnsureSystemUncategorizedGroup"), "do not create an empty Uncategorized group");
assert(src.includes("function withoutEmptyUncategorizedGroup"), "hide an empty Uncategorized group");
assert(src.includes("Add “${safe}” to ${safeGroup}"), "new category row names its group");
assert(src.includes("function categoryMatchesTransactionKind"), "kind matching stays in place");
assert(!src.includes("categoryImpliesMonthlyRecurrence"), "category names do not choose a monthly schedule");
assert(!src.includes("categoryImpliesTwiceMonthlyRecurrence"), "paycheck does not choose a twice-monthly schedule");

console.log("category starter checks ok");
