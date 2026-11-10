/**
 * Optional custom transaction names reuse the existing `description` column.
 * Category-echo and placeholder values are not treated as names, so older
 * records that copied the category into description keep showing the category.
 * Notes are never used as a name.
 */

const TX_PLACEHOLDER_NAMES = new Set([
  "scheduled",
  "transaction",
  "uncategorized",
  "(no description)",
  "(expected)",
  "recurring",
]);

function txDisplayLeafCategoryName(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const parts = s.split("•").map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : s;
}

function txDisplayNormalizeName(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function txDisplayCategoryEchoes(description, categoryName) {
  const desc = txDisplayNormalizeName(description);
  if (!desc) return true;
  const cat = String(categoryName || "").trim();
  if (cat && desc === txDisplayNormalizeName(cat)) return true;
  const leaf = txDisplayLeafCategoryName(cat);
  if (leaf && desc === txDisplayNormalizeName(leaf)) return true;
  return TX_PLACEHOLDER_NAMES.has(desc);
}

function transactionCustomName(tx, categoryName) {
  const desc = String(tx?.description ?? "").trim();
  if (!desc) return "";
  if (txDisplayCategoryEchoes(desc, categoryName)) return "";
  return desc;
}

function transactionDisplayName(tx, categoryName, unnamedFallback) {
  const custom = transactionCustomName(tx, categoryName);
  if (custom) return custom;
  const cat = txDisplayLeafCategoryName(categoryName) || String(categoryName || "").trim();
  if (cat && cat.toLowerCase() !== "none") return cat;
  const fallback = unnamedFallback != null ? String(unnamedFallback) : "";
  return fallback || "Uncategorized";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TX_PLACEHOLDER_NAMES,
    txDisplayLeafCategoryName,
    txDisplayNormalizeName,
    txDisplayCategoryEchoes,
    transactionCustomName,
    transactionDisplayName,
  };
}
