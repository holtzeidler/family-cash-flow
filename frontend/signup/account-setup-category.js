/** Onboarding income and bills need a category. No network and no DOM. */

var ACCOUNT_SETUP_CATEGORY_REQUIRED_MESSAGE = "Choose a category to continue.";

/**
 * Message to show for the selected category, or "" when it is usable.
 * Empty, "Uncategorized", or a category for the other transaction type is not usable.
 */
function accountSetupCategoryValidationMessage(category, matchesKind) {
  var value = String(category || "").trim();
  if (!value || value.toLowerCase() === "uncategorized" || matchesKind === false) {
    return ACCOUNT_SETUP_CATEGORY_REQUIRED_MESSAGE;
  }
  return "";
}

/**
 * Group for a category created during onboarding, matching the Add Transaction form,
 * so a new bill category is not filed under Income. groupNames maps group id to name.
 */
function onboardingCategoryGroupIdForKind(groupNames, kind) {
  var find = function (pred) {
    var found = null;
    groupNames.forEach(function (name, gid) {
      var n = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (found == null && pred(n)) found = gid;
    });
    return found;
  };
  if (String(kind || "").toLowerCase() === "income") {
    return (
      find(function (n) { return n === "income"; }) ||
      find(function (n) { return n.indexOf("income") >= 0; }) ||
      find(function (n) { return n.indexOf("reimburse") >= 0; })
    );
  }
  return (
    find(function (n) { return n === "miscellaneous"; }) ||
    find(function (n) { return n.indexOf("misc") >= 0; }) ||
    find(function (n) { return n === "other"; }) ||
    find(function (n) { return n.indexOf("other") >= 0; })
  );
}
