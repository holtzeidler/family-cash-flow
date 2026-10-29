function normalizeCategoryCreateName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function categoryCreateResolution(name, categories, groupId) {
  const wanted = normalizeCategoryCreateName(name);
  const gid = Number(groupId);
  const list = Array.isArray(categories) ? categories : [];
  if (!wanted) return { action: "ignore" };
  const inGroup = list.find((category) => {
    return Number(category && category.group_id) === gid && normalizeCategoryCreateName(category && category.name) === wanted;
  });
  if (inGroup) return { action: "reuse", category: inGroup };
  const anywhere = list.find((category) => normalizeCategoryCreateName(category && category.name) === wanted);
  if (anywhere) return { action: "reuse", category: anywhere };
  return { action: "create" };
}

function beginCategoryCreate(pending, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed || pending) {
    return { started: false, pending: !!pending, name: trimmed, note: pending ? "Creating category…" : "", saveEnabled: !pending, retry: false };
  }
  return {
    started: true,
    pending: true,
    name: trimmed,
    note: "Creating category…",
    saveEnabled: false,
    retry: false,
  };
}

function finishCategoryCreate(session, result) {
  const name = session && session.name ? session.name : "";
  const ok = !!(result && result.ok && result.category);
  if (!ok) {
    const message = (result && result.error) || (name ? `Couldn't create ${name}.` : "Couldn't create that category.");
    return {
      pending: false,
      name,
      note: message,
      saveEnabled: true,
      retry: true,
      selectedId: null,
    };
  }
  const groupLabel = (result && result.groupLabel) || "your list";
  return {
    pending: false,
    name,
    note: `Added ${name} to ${groupLabel}.`,
    saveEnabled: true,
    retry: false,
    selectedId: result.category.id,
  };
}

function categoryNoteAfterTyping(confirmedName, typedName) {
  if (!confirmedName) return "";
  if (normalizeCategoryCreateName(typedName) === normalizeCategoryCreateName(confirmedName)) return null;
  return "";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeCategoryCreateName,
    categoryCreateResolution,
    beginCategoryCreate,
    finishCategoryCreate,
    categoryNoteAfterTyping,
  };
}
