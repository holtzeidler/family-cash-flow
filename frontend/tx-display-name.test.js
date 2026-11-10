const assert = require("assert");
const {
  transactionCustomName,
  transactionDisplayName,
  txDisplayCategoryEchoes,
} = require("./tx-display-name.js");

{
  const unnamed = { description: "", notes: "Do not use this" };
  assert.strictEqual(transactionCustomName(unnamed, "Utilities"), "");
  assert.strictEqual(transactionDisplayName(unnamed, "Utilities"), "Utilities");
}

{
  const echo = { description: "Utilities", notes: "Meter read" };
  assert.strictEqual(transactionCustomName(echo, "Utilities"), "");
  assert.strictEqual(transactionDisplayName(echo, "Utilities"), "Utilities");
}

{
  const grouped = { description: "Housing • Utilities" };
  assert.strictEqual(transactionCustomName(grouped, "Housing • Utilities"), "");
  assert.strictEqual(transactionDisplayName(grouped, "Housing • Utilities"), "Utilities");
}

{
  const named = { description: "ComEd", notes: "Account 4412" };
  assert.strictEqual(transactionCustomName(named, "Utilities"), "ComEd");
  assert.strictEqual(transactionDisplayName(named, "Utilities"), "ComEd");
}

{
  const namedSameCase = { description: "  cell phone  " };
  assert.strictEqual(transactionCustomName(namedSameCase, "Phone"), "cell phone");
  assert.strictEqual(transactionDisplayName(namedSameCase, "Phone"), "cell phone");
}

{
  const notesOnly = { description: "", notes: "Cell Phone" };
  assert.strictEqual(transactionCustomName(notesOnly, "Phone"), "");
  assert.strictEqual(transactionDisplayName(notesOnly, "Phone"), "Phone");
  assert.strictEqual(transactionDisplayName(notesOnly, ""), "Uncategorized");
}

{
  const placeholder = { description: "Scheduled" };
  assert.strictEqual(transactionCustomName(placeholder, "Rent"), "");
  assert.strictEqual(transactionDisplayName(placeholder, "Rent"), "Rent");
}

{
  const existingEmpty = {};
  assert.strictEqual(transactionDisplayName(existingEmpty, "Groceries"), "Groceries");
}

assert.strictEqual(txDisplayCategoryEchoes("utilities", "Utilities"), true);
assert.strictEqual(txDisplayCategoryEchoes("ComEd", "Utilities"), false);

console.log("tx-display-name.test.js: ok");
