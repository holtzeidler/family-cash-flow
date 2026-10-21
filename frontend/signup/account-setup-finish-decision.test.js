if (typeof load === "function") {
  load("frontend/signup/account-setup-finish-decision.js");
} else {
  var fs = require("fs");
  var path = require("path");
  eval(fs.readFileSync(path.join(__dirname, "account-setup-finish-decision.js"), "utf8"));
}

var failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
}

check("verified session finishes onboarding", accountSetupFinishDecision(true) === "complete-onboarding");
check("missing session asks the user to sign in", accountSetupFinishDecision(false) === "sign-in");

check(
  "empty password draft with saved setup opens the finish step",
  accountSetupVerifiedResumeStep({
    wizardStep: 0,
    account: { name: "Checking" },
    transactions: [{ kind: "income" }, { kind: "expense" }],
  }) === 4
);
check(
  "saved checking account opens that step for review",
  accountSetupVerifiedResumeStep({ wizardStep: 0, account: { name: "Checking" }, transactions: [] }) === 1
);
check(
  "in-progress wizard step is kept",
  accountSetupVerifiedResumeStep({ wizardStep: 2, account: { name: "Checking" }, transactions: [{ kind: "income" }] }) === 2
);
check("finish step is kept", accountSetupVerifiedResumeStep({ wizardStep: 4, surveyHelpWith: ["upcoming_bills"] }) === 4);
check("verified user with no draft does not see create-login", accountSetupVerifiedResumeStep(null) === 1);
check("rewound survey still opens the finish step", accountSetupVerifiedResumeStep({ wizardStep: 0, surveyHelpWith: ["avoid_overdrafts"] }) === 4);

check(
  "empty family list keeps the family from onboarding completion",
  accountSetupFamilyIdAfterComplete({ family_id: 8, trial_started: true }, { ok: true, data: [] }) === 8
);
check(
  "failed family list keeps the family from onboarding completion",
  accountSetupFamilyIdAfterComplete({ family_id: 8 }, { ok: false, data: null }) === 8
);
check(
  "delayed family list keeps the family from onboarding completion",
  accountSetupFamilyIdAfterComplete({ family_id: "15" }, null) === 15
);
check(
  "completion without a family id does not create one",
  accountSetupFamilyIdAfterComplete({ trial_started: true }, { ok: true, data: [] }) === null
);
check("a zero family id does not create one", accountSetupFamilyIdAfterComplete({ family_id: 0 }, { ok: false }) === null);

if (failures.length) {
  throw new Error(failures.join("; "));
}
