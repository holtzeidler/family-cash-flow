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
assert(src.includes("Create new category “${safe}”"), "new category row asks for a group instead of assigning one");
assert(!src.includes("Add “${safe}” to ${safeGroup}"), "new category row does not name a group up front");
assert(src.includes("function categoryMatchesTransactionKind"), "kind matching stays in place");
const affinityStart = src.indexOf("function categoryFlowAffinity");
const affinityEnd = src.indexOf("function collectRecentCategoryIdsForKind");
assert(affinityStart !== -1 && affinityEnd > affinityStart, "category affinity is defined");
const affinity = src.slice(affinityStart, affinityEnd);
assert(!affinity.includes('includes("transfer")'), "transfer names are not guessed as income");
assert(affinity.includes('"savings transfer"'), "savings transfer works for income or expense shortcuts");
assert(affinity.includes('"investment transfer"'), "investment transfer works for income or expense shortcuts");
assert(affinity.includes('"other transfer"'), "other transfer works for income or expense shortcuts");
assert(affinity.includes('"cash & atm"'), "cash and atm works for income or expense shortcuts");
assert(!src.includes("Browse all"), "the category field is the way to browse every category");
assert(!src.includes("cats-cat__edit-hint"), "category rows rename from the name or menu, without a pencil");
assert(src.includes('mkItem("Rename"'), "category menu still offers rename");
assert(src.includes('mkItem("Move to group"'), "category menu offers move to group");
assert(!src.includes("categoryImpliesMonthlyRecurrence"), "category names do not choose a monthly schedule");
assert(!src.includes("categoryImpliesTwiceMonthlyRecurrence"), "paycheck does not choose a twice-monthly schedule");

console.log("category starter checks ok");
