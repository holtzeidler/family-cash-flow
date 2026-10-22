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
