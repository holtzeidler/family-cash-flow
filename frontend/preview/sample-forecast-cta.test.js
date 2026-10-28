if (typeof load === "function") {
  load("frontend/preview/sample-forecast-cta.js");
} else {
  var fs = require("fs");
  var path = require("path");
  eval(fs.readFileSync(path.join(__dirname, "sample-forecast-cta.js"), "utf8"));
}

var failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
}

var loggedOut = sampleForecastCta(false, "");
check("logged out creates a forecast", loggedOut.label === "Create my forecast");
check("logged out opens account setup", loggedOut.href === "/account-setup/?fresh=1");

var unfinished = sampleForecastCta(true, "needs");
check("unfinished setup continues setup", unfinished.label === "Continue setting up my forecast");
check("unfinished setup resumes the wizard", unfinished.href === "/account-setup/?resume=1");

var unknown = sampleForecastCta(true, "unknown");
check("signed in before status is known resumes setup", unknown.href === "/account-setup/?resume=1");
check("signed in before status is known does not claim the forecast is ready", unknown.label === "Continue setting up my forecast");

var finished = sampleForecastCta(true, "done");
check("finished setup opens the forecast", finished.label === "Go to my forecast");
check("finished setup goes to the calendar", finished.href === "/calendar/");

if (failures.length) {
  throw new Error(failures.join("; "));
}
