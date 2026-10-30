var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
}

var learn = fs.readFileSync(path.join(root, "frontend/learn/index.html"), "utf8");
var home = fs.readFileSync(path.join(root, "frontend/index.html"), "utf8");
var navCss = fs.readFileSync(path.join(root, "frontend/public-auth.css"), "utf8");

check("how it works keeps its url", learn.indexOf('href="https://balancewhiz.com/learn/"') !== -1 || learn.indexOf('href="/learn/"') !== -1);
check("how it works is labeled in the introduction", learn.indexOf("How it works.") !== -1);
check("how it works asks for the checking balance", learn.indexOf("Enter your checking balance") !== -1);
check("how it works asks for expected income and expenses", learn.indexOf("Add expected income and expenses") !== -1);
check("how it works shows the projected balance by day", learn.indexOf("View your projected balance by day") !== -1);
check("how it works keeps the longer forecast", learn.indexOf("90-day outlook") !== -1);
check("how it works links the forecasting article", learn.indexOf('href="/forecasting-vs-budgeting/"') !== -1);
check("how it works links the safe-to-spend article", learn.indexOf('href="/safe-to-spend/"') !== -1);
check("how it works links the expenses article", learn.indexOf('href="/recurring-and-irregular-expenses/"') !== -1);
check("how it works keeps a closing call to action", learn.indexOf("Ready to see") !== -1);
check("how it works shortens the planning section", learn.indexOf("Focus on the paychecks, bills, and larger expenses that change your checking balance.") !== -1);
check("how it works states the three planning benefits", learn.indexOf("Recurring income and bills carry forward automatically.") !== -1 && learn.indexOf("Update your actual balance to keep your forecast grounded.") !== -1 && learn.indexOf("when you know they&rsquo;re coming.") !== -1);
check("how it works drops the bordered planning cards", learn.indexOf("learn-rhythm__card") === -1);
check("how it works keeps deeper reading as links", learn.indexOf('href="/forecasting-vs-budgeting/"') !== -1 && learn.indexOf("learn-deeper__list") !== -1);

var plans = fs.readFileSync(path.join(root, "frontend/plans/index.html"), "utf8");
check("pricing leads with simple pricing", plans.indexOf("Simple pricing. A clearer picture of your money.") !== -1);
check("pricing supporting line names what is left", plans.indexOf("See what&rsquo;s coming in, what&rsquo;s going out, and what you&rsquo;ll have left.") !== -1);
check("pricing drops interest-account copy", plans.indexOf("interest") === -1);
check("pricing keeps both prices", plans.indexOf(">5.99<") !== -1 && plans.indexOf(">59.99<") !== -1 && plans.indexOf("Save 17%") !== -1 && plans.indexOf("Equivalent to $5.00/month") !== -1);
check("pricing keeps the signup and sample actions", plans.indexOf('href="/account-setup/?fresh=1"') !== -1 && plans.indexOf('href="/preview/"') !== -1 && plans.indexOf("Start my free forecast") !== -1 && plans.indexOf("Try a sample forecast") !== -1);
check("pricing states the four benefits", plans.indexOf("See your projected checking balance by day") !== -1 && plans.indexOf("Spot low-balance days before they happen") !== -1);
check("pricing keeps one reassurance line", plans.indexOf("No bank connection required · About 10 minutes to set up · Cancel anytime") !== -1 && plans.indexOf("Simple pricing. No surprises.") === -1);
check("pricing still discloses the trial", plans.indexOf("Free for 14 days · No credit card required") !== -1);
check("how it works drops the homepage balance card", learn.indexOf("Balance outlook") === -1);
check("how it works drops the repeated bank comparison", learn.indexOf("$4,862") === -1);
check("how it works menu control stays Menu", learn.indexOf(">Menu<") !== -1);
check("how it works nav uses the page name", learn.indexOf(">How It Works<") !== -1);

check("home hero stays the same", home.indexOf("Never get surprised by your checking account again.") !== -1);
check("home supporting line names what is left", home.indexOf("what you&rsquo;ll have left—before you spend or move money.") !== -1);
check("home drops the five-day outlook", home.indexOf("Balance outlook") === -1);
check("home drops the three-step cards", home.indexOf("Add what you know") === -1);
check("home keeps the bank comparison", home.indexOf("$4,862") !== -1 && home.indexOf("-$2,100") !== -1 && home.indexOf("-$2,000") !== -1 && home.indexOf("$731") !== -1);
check("home links to how it works", home.indexOf('href="/learn/">How It Works<') !== -1);
check("home caption distinguishes the bank from the forecast", home.indexOf("Your bank shows today&rsquo;s balance. BalanceWhiz shows what&rsquo;s ahead.") !== -1);
check("home benefit skips purchase tracking", home.indexOf("Skip tracking every purchase.") !== -1);
check("home keeps one sample forecast link", home.indexOf("Try a sample forecast") !== -1);
check("home menu control stays Menu", home.indexOf(">Menu<") !== -1);

check("mobile menu marks the current page", navCss.indexOf('.public-nav__link[aria-current="page"]') !== -1);
check("current mobile item is more than a font-weight change", navCss.indexOf("rgba(255, 255, 255, 0.18)") !== -1);

if (failures.length) {
  throw new Error(failures.join("; "));
}
