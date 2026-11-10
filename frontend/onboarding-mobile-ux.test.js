var fs = require("fs");
var path = require("path");
var assert = require("assert");

var css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
var signup = fs.readFileSync(path.join(__dirname, "signup", "signup.js"), "utf8");
var html = fs.readFileSync(path.join(__dirname, "account-setup", "index.html"), "utf8");

function functionBody(src, name) {
  var start = src.indexOf("function " + name + "(");
  assert.ok(start >= 0, name + " exists");
  var next = src.indexOf("\nfunction ", start + 1);
  var nextAsync = src.indexOf("\nasync function ", start + 1);
  var end = [next, nextAsync, src.length]
    .filter(function (i) {
      return i > start;
    })
    .sort(function (a, b) {
      return a - b;
    })[0];
  return src.slice(start, end);
}

assert.ok(html.indexOf("Check your email") >= 0, "confirmation heading is present");
assert.ok(html.indexOf("accountSetupEmailCheckAddress") >= 0, "confirmation email address is present");
assert.ok(html.indexOf("The link expires in 60 minutes.") >= 0, "expiration notice is present");
assert.ok(html.indexOf("accountSetupResendBtn") >= 0, "resend control is present");
assert.ok(html.indexOf("Use a different email") >= 0, "change-email control is present");
assert.ok(/Check your spam folder/.test(html), "spam reminder is present");

assert.ok(
  css.indexOf("body.account-setup-page .container > .grid:has(#accountSetupEmailCheck:not([hidden]))") >= 0,
  "confirmation grid rule exists"
);
assert.ok(/min\(32rem, calc\(100% - 2rem\)\)/.test(css), "confirmation card is centered with side inset");
assert.ok(
  /grid:has\(#accountSetupEmailCheck:not\(\[hidden\]\)\)[\s\S]{0,280}max-width:\s*32rem/.test(css),
  "confirmation card has a desktop max width"
);

assert.ok(
  /#accountSetupEmailCheck\.email-check[\s\S]{0,400}overflow:\s*visible/.test(css),
  "confirmation card does not clip with overflow hidden"
);
assert.ok(
  /\.email-check__address\{[\s\S]*?overflow-wrap:\s*anywhere/.test(css),
  "long confirmation addresses wrap"
);
assert.ok(
  /\.email-check__resend,[\s\S]{0,80}\.email-check__change\{[\s\S]*?min-height:\s*48px/.test(css),
  "resend and change-email share a tappable height"
);
assert.ok(
  /\.email-check__resend,[\s\S]{0,80}\.email-check__change\{[\s\S]*?display:\s*inline-flex[\s\S]*?align-items:\s*center/.test(css),
  "confirmation actions center their labels"
);
assert.ok(
  /function syncAccountSetupResendButton\(/.test(signup) &&
    signup.indexOf("Resend email (${remain}s)") >= 0,
  "resend countdown behavior is unchanged"
);

assert.ok(
  /#accountSetupWizardPanel1 \.form-row-h__field\{[\s\S]*?min-width:\s*0/.test(css),
  "starting-balance field can shrink inside the card"
);
assert.ok(
  /#accountStartingBalanceDate\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*100%[\s\S]*?min-width:\s*0/.test(css),
  "Balance as of date field is width-constrained"
);
assert.ok(
  /#accountStartingBalanceDate::-webkit-datetime-edit[\s\S]*?min-width:\s*0/.test(css),
  "native date text cannot force the field wider than the card"
);

var continueBtn = css.match(
  /body\.account-setup-page \.account-setup-wizard__shell:has\(#accountSetupWizardPanel2\[data-step3-phase="intro"\]\.account-setup-wizard__panel--active\) \.account-setup-actions__forward #signupBtn\{[\s\S]*?\}/
);
assert.ok(continueBtn, "Step 3 Continue rule exists");
assert.ok(/display:\s*inline-flex/.test(continueBtn[0]), "Step 3 Continue uses flex layout");
assert.ok(/align-items:\s*center/.test(continueBtn[0]), "Step 3 Continue vertically centers its label");
assert.ok(/justify-content:\s*center/.test(continueBtn[0]), "Step 3 Continue horizontally centers its label");
assert.ok(/line-height:\s*1/.test(continueBtn[0]), "Step 3 Continue line-height does not push the label up");

var sharedContinue = css.match(
  /body\.account-setup-page \.account-setup-wizard__shell \.account-setup-actions--shell #signupBtn\{[\s\S]*?\}/
);
assert.ok(sharedContinue, "shared onboarding primary button rule exists");
assert.ok(/display:\s*inline-flex/.test(sharedContinue[0]), "shared onboarding primary uses flex layout");
assert.ok(/align-items:\s*center/.test(sharedContinue[0]), "shared onboarding primary vertically centers its label");

var chip = functionBody(signup, "applyAccountSetupChipSelection");
assert.ok(chip.indexOf('prefix + "Amount"') < 0, "category chips do not look up the Amount field");
assert.ok(!/\.focus\(/.test(chip), "category chips do not move focus after a selection");
assert.ok(chip.indexOf('dispatchEvent(new Event("change"') >= 0, "category chips still dispatch change for recurrence defaults");

var combo = functionBody(signup, "initAccountSetupCategoryCombobox");
var commitStart = combo.indexOf("function commit(");
var commitBody = combo.slice(commitStart, combo.indexOf("function resolveInputOnBlur", commitStart));
assert.ok(commitStart >= 0, "category combobox commit exists");
assert.ok(!/\.focus\(/.test(commitBody), "custom category selection does not steal focus");

assert.ok(
  /function accountSetupTxHubAddIncomeClick[\s\S]*asTxAmount[\s\S]*focus\(/.test(signup),
  "Add income still focuses Amount when the form opens"
);

console.log("onboarding-mobile-ux.test.js ok");
