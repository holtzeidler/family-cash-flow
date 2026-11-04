const assert = require("assert");
const {
  favoriteAmountString,
  suggestFavoriteName,
  buildFavoritePayload,
  planFavoriteFormFill,
  favoriteMenuDetail,
  favoriteEmptyMessage,
} = require("./favorite-transactions.js");

assert.strictEqual(favoriteAmountString("86.4"), "86.40");
assert.strictEqual(favoriteAmountString("0"), "");
assert.strictEqual(favoriteAmountString("1.239"), "");
assert.strictEqual(favoriteAmountString("-5"), "");

assert.strictEqual(suggestFavoriteName({ categoryName: "Utilities", kind: "expense" }), "Utilities");
assert.strictEqual(suggestFavoriteName({ description: "Power bill", kind: "expense" }), "Power bill");
assert.strictEqual(suggestFavoriteName({ kind: "income" }), "Income");
assert.strictEqual(
  suggestFavoriteName({ categoryName: "Utilities", existingName: "Winter power", kind: "expense" }),
  "Winter power"
);

const payload = buildFavoritePayload({
  name: "  Electric  ",
  kind: "expense",
  amount: "40",
  categoryId: 3,
  accountId: "",
  notes: "  ",
});
assert.strictEqual(payload.ok, true);
assert.strictEqual(payload.body.name, "Electric");
assert.strictEqual(payload.body.amount, "40.00");
assert.strictEqual(payload.body.category_id, 3);
assert.strictEqual(payload.body.account_id, null);
assert.strictEqual(payload.body.notes, null);
assert.strictEqual(buildFavoritePayload({ name: " ", kind: "expense", amount: "1" }).ok, false);

const categories = [
  { id: 3, name: "Utilities", archived: false },
  { id: 9, name: "Old", archived: true },
];
const accounts = [{ id: 2, name: "Checking" }];
const filled = planFavoriteFormFill(
  { id: 1, kind: "income", amount: "1200.5", category_id: 3, account_id: 2, notes: "Payday" },
  { categories, accounts, date: "2026-11-04", today: "2026-11-01" }
);
assert.strictEqual(filled.kind, "income");
assert.strictEqual(filled.amount, "1200.50");
assert.strictEqual(filled.categoryId, 3);
assert.strictEqual(filled.accountId, 2);
assert.strictEqual(filled.date, "2026-11-04");
assert.strictEqual(filled.repeat, "");
assert.strictEqual(filled.variable, false);
assert.deepStrictEqual(filled.notices, []);

const missing = planFavoriteFormFill(
  { kind: "expense", amount: "10.00", category_id: 9, account_id: 44 },
  { categories, accounts, today: "2026-11-04" }
);
assert.strictEqual(missing.categoryId, null);
assert.strictEqual(missing.accountId, null);
assert.strictEqual(missing.clearAccount, true);
assert.strictEqual(missing.date, "2026-11-04");
assert.ok(missing.notices.some((line) => line.includes("category")));
assert.ok(missing.notices.some((line) => line.includes("account")));
assert.strictEqual(missing.categoryId === 3, false);

const optionalAccount = planFavoriteFormFill(
  { kind: "expense", amount: "8.00", category_id: null, account_id: null },
  { categories, accounts, today: "2026-11-04" }
);
assert.strictEqual(optionalAccount.clearAccount, false);
assert.strictEqual(optionalAccount.accountId, null);

assert.strictEqual(favoriteMenuDetail({ kind: "expense", amount: "86.40" }), "Expense · $86.40");
assert.strictEqual(favoriteMenuDetail({ kind: "income", amount: "1200" }), "Income · $1,200.00");
assert.ok(favoriteEmptyMessage().includes("No favorites yet"));

console.log("favorite transaction checks ok");
