function categoryListView(status, groupCount) {
  const count = Number(groupCount) || 0;
  const loading = status === "loading";
  const failed = status === "error";
  const ready = status === "ready";
  return {
    showLoading: loading,
    showError: failed,
    showEmpty: ready && count === 0,
    showTree: ready && count > 0,
    allowAdd: ready,
  };
}

function categoryUsageIsKnown(summary) {
  return !!(summary && summary.by_category_id && typeof summary.by_category_id === "object");
}

function categoryAssignmentCount(summary, categoryId) {
  if (!categoryUsageIsKnown(summary) || categoryId == null) return 0;
  const map = summary.by_category_id;
  const value = map[String(categoryId)] ?? map[String(Number(categoryId))];
  return Number(value) || 0;
}

/** Unused means the usage summary loaded and nothing references this category. */
function categoryIsUnused(summary, categoryId) {
  if (!categoryUsageIsKnown(summary)) return false;
  return categoryAssignmentCount(summary, categoryId) <= 0;
}

function categoryRowMatchesListFilter(name, unused, query, unusedOnly) {
  if (unusedOnly && !unused) return false;
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return String(name || "").toLowerCase().includes(q);
}

function categoryFilterEmptyMessage({ searching, unusedOnly, unusedTotal, visible, usageKnown }) {
  if (visible > 0) return "";
  if (unusedOnly && usageKnown === false) return "We couldn't check which categories are unused.";
  if (unusedOnly && unusedTotal === 0) return "Every category is in use.";
  if (searching && unusedOnly) return "No unused categories match that search.";
  if (searching) return "No categories match that search.";
  return "";
}

function formatCategoryUnusedSummary(total, unused) {
  if (unused == null || !Number.isFinite(Number(total))) return "";
  const unusedLabel = Number(unused) === 1 ? "1 unused" : `${Number(unused)} unused`;
  const totalLabel = Number(total) === 1 ? "1 category" : `${Number(total)} categories`;
  return `${unusedLabel} of ${totalLabel}`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    categoryListView,
    categoryUsageIsKnown,
    categoryAssignmentCount,
    categoryIsUnused,
    categoryRowMatchesListFilter,
    categoryFilterEmptyMessage,
    formatCategoryUnusedSummary,
  };
}
