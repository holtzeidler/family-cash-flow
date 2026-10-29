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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { categoryListView };
}
