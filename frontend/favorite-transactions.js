/** Favorite templates prefill Add transaction. They never create a transaction by themselves. */

function favoriteAmountString(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "";
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return "";
  const parts = text.split(".");
  const frac = (parts[1] || "").padEnd(2, "0").slice(0, 2);
  return `${parts[0]}.${frac}`;
}

function suggestFavoriteName({ categoryName, description, kind, existingName } = {}) {
  const existing = String(existingName || "").trim();
  if (existing) return existing.slice(0, 120);
  const category = String(categoryName || "").trim();
  if (category) return category.slice(0, 120);
  const desc = String(description || "").trim();
  if (desc) return desc.slice(0, 120);
  return String(kind || "").toLowerCase() === "income" ? "Income" : "Expense";
}

function buildFavoritePayload({ name, kind, amount, categoryId, accountId, notes } = {}) {
  const cleanedName = String(name || "").trim();
  const cleanedKind = String(kind || "").toLowerCase() === "income" ? "income" : String(kind || "").toLowerCase() === "expense" ? "expense" : "";
  const amountText = favoriteAmountString(amount);
  const notesText = String(notes || "").trim();
  const categoryNum = categoryId == null || categoryId === "" ? null : Number(categoryId);
  const accountNum = accountId == null || accountId === "" ? null : Number(accountId);
  return {
    ok: !!(cleanedName && cleanedKind && amountText),
    nameError: cleanedName ? "" : "Enter a favorite name.",
    kindError: cleanedKind ? "" : "Choose income or expense.",
    amountError: amountText ? "" : "Enter an amount greater than zero, with at most two decimal places.",
    body: {
      name: cleanedName.slice(0, 120),
      kind: cleanedKind || "expense",
      amount: amountText,
      category_id: Number.isFinite(categoryNum) ? categoryNum : null,
      account_id: Number.isFinite(accountNum) ? accountNum : null,
      notes: notesText ? notesText.slice(0, 500) : null,
    },
  };
}

function planFavoriteFormFill(favorite, { categories, accounts, date, today } = {}) {
  const source = favorite || {};
  const kind = String(source.kind || "").toLowerCase() === "income" ? "income" : "expense";
  const cats = Array.isArray(categories) ? categories : [];
  const accts = Array.isArray(accounts) ? accounts : [];
  const categoryNum = source.category_id == null || source.category_id === "" ? null : Number(source.category_id);
  const accountNum = source.account_id == null || source.account_id === "" ? null : Number(source.account_id);
  const category =
    categoryNum == null
      ? null
      : cats.find((item) => Number(item.id) === categoryNum && !item.archived) || null;
  const account = accountNum == null ? null : accts.find((item) => Number(item.id) === accountNum) || null;
  const notices = [];
  if (categoryNum != null && !category) notices.push("That category is no longer available.");
  if (accountNum != null && !account) notices.push("That account is no longer available.");
  const amount = favoriteAmountString(source.amount) || String(source.amount == null ? "" : source.amount);
  return {
    kind,
    amount,
    notes: source.notes ? String(source.notes) : "",
    date: date || today || "",
    repeat: "",
    variable: false,
    categoryId: category ? Number(category.id) : null,
    accountId: account ? Number(account.id) : null,
    clearAccount: accountNum != null && !account,
    notices,
  };
}

function favoriteMenuDetail(favorite) {
  const kind = String(favorite && favorite.kind).toLowerCase() === "income" ? "Income" : "Expense";
  const amount = favoriteAmountString(favorite && favorite.amount);
  if (!amount) return kind;
  const parts = amount.split(".");
  const whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${kind} · $${whole}.${parts[1]}`;
}

function favoriteLinkId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function addFavoriteLinkForOpen(opts) {
  if (!opts || opts.favorite == null) return null;
  return favoriteLinkId(opts.favorite.id);
}

function favoriteEmptyMessage() {
  return "No favorites yet. Save one from Add or Edit transaction.";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    favoriteAmountString,
    suggestFavoriteName,
    buildFavoritePayload,
    planFavoriteFormFill,
    favoriteMenuDetail,
    favoriteLinkId,
    addFavoriteLinkForOpen,
    favoriteEmptyMessage,
  };
}
