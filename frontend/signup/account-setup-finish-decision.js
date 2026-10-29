/** Decisions for finishing setup after email verification. No network and no trial start. */

function accountSetupFinishDecision(hasVerifiedSession) {
  return hasVerifiedSession ? "complete-onboarding" : "sign-in";
}

/**
 * Family created by onboarding completion.
 * A failed, delayed, or empty family list is ignored. Null means do not create one.
 */
function accountSetupFamilyIdAfterComplete(completeBody, familiesResult) {
  void familiesResult;
  const id = Number(completeBody && completeBody.family_id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

/**
 * Where a verified user with no family should land.
 * Step 0 is the login form, so it is never returned.
 * A saved step is kept. A draft rewound to step 0 opens on the step that
 * shows the saved checking account or the finish step, and is not submitted.
 */
/** Verified people who have not finished setup. Same device may still have a draft. */
var ACCOUNT_SETUP_RESUME_PATH = "/account-setup/?resume=1";

/**
 * Where to go after login. An unfinished setup ignores next, including /calendar,
 * so opening the forecast cannot create a family. A finished customer keeps a
 * same-site next path, or the forecast.
 */
function postLoginPath(needsOnboarding, requestedNext) {
  if (needsOnboarding) return ACCOUNT_SETUP_RESUME_PATH;
  var raw = String(requestedNext || "").trim();
  if (raw.startsWith("/") && !raw.startsWith("//") && raw.indexOf("://") === -1) return raw;
  return "/calendar";
}

/** An existing family opens the forecast only after setup is finished. */
function accountSetupShouldLeaveWizard(needsOnboarding, hasFamily) {
  return !needsOnboarding && !!hasFamily;
}

/** A date the person entered wins. Otherwise keep the saved draft date. Today is only the fallback. */
function accountSetupBalanceDateValue(savedDate, currentValue, today) {
  var current = String(currentValue || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(current)) return current;
  var saved = String(savedDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved;
  return String(today || "").trim();
}

function accountSetupVerifiedResumeStep(draft) {
  const source = draft && typeof draft === "object" ? draft : {};
  const step = Number(source.wizardStep);
  const hasAccount = !!(source.account && String(source.account.name || "").trim());
  const transactions = Array.isArray(source.transactions) ? source.transactions : [];
  const hasTransactions = transactions.length > 0;
  const hasSurvey = Array.isArray(source.surveyHelpWith) && source.surveyHelpWith.length > 0;
  if (Number.isFinite(step) && step >= 1 && step <= 4) return step;
  if (hasTransactions || hasSurvey) return 4;
  if (hasAccount) return 1;
  return 1;
}
