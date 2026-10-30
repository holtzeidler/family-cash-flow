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
check("how it works drops the homepage balance card", learn.indexOf("Balance outlook") === -1);
check("how it works drops the repeated bank comparison", learn.indexOf("$4,862") === -1);
check("how it works menu control stays Menu", learn.indexOf(">Menu<") !== -1);
check("how it works nav uses the page name", learn.indexOf(">How It Works<") !== -1);

check("home hero stays the same", home.indexOf("Never get surprised by your checking account again.") !== -1);
check("home nav uses the page name", home.indexOf('href="/learn/">How It Works<') !== -1);
check("home menu control stays Menu", home.indexOf(">Menu<") !== -1);

check("mobile menu marks the current page", navCss.indexOf('.public-nav__link[aria-current="page"]') !== -1);
check("current mobile item is more than a font-weight change", navCss.indexOf("rgba(255, 255, 255, 0.18)") !== -1);

if (failures.length) {
  throw new Error(failures.join("; "));
}
