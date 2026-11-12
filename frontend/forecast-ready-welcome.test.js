var fs = require("fs");
var path = require("path");
var assert = require("assert");

var app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

function functionBody(src, name) {
  var start = src.indexOf("function " + name + "(");
  assert.ok(start >= 0, name + " exists");
  var next = src.indexOf("\nfunction ", start + 1);
  var nextAsync = src.indexOf("\nasync function ", start + 1);
  var end = [next, nextAsync, src.length].filter(function (i) {
    return i > start;
  }).sort(function (a, b) {
    return a - b;
  })[0];
  return src.slice(start, end);
}

eval(functionBody(app, "forecastReadyWelcomeTagline"));

assert.strictEqual(
  forecastReadyWelcomeTagline({ income: true, expense: true }),
  "See how your income and bills affect your checking balance — and what’s coming next."
);
assert.strictEqual(
  forecastReadyWelcomeTagline({ income: true, expense: false }),
  "Add your upcoming bills from the calendar anytime to see where your checking balance is headed."
);
assert.strictEqual(
  forecastReadyWelcomeTagline({ income: false, expense: true }),
  "Add your upcoming income from the calendar anytime to see where your checking balance is headed."
);
assert.strictEqual(
  forecastReadyWelcomeTagline({ income: false, expense: false }),
  "See how your income and bills affect your checking balance — and what’s coming next."
);
assert.ok(
  !/income and bills/.test(forecastReadyWelcomeTagline({ income: true, expense: false })),
  "income-only copy does not imply bills were entered"
);
assert.ok(
  !/income and bills/.test(forecastReadyWelcomeTagline({ income: false, expense: true })),
  "expense-only copy does not imply income was entered"
);

var showBody = functionBody(app, "maybeShowForecastReadyPopup");
assert.ok(showBody.indexOf("forecastReadyCalendarCanShowWelcome()") >= 0, "welcome waits until the calendar is ready");
assert.ok(showBody.indexOf("applyForecastReadyWelcomeCopy") >= 0, "welcome copy is applied when shown");
assert.ok(showBody.indexOf("preventScroll: true") >= 0, "welcome focus does not jump the page behind the modal");

var canShow = functionBody(app, "forecastReadyCalendarCanShowWelcome");
assert.ok(canShow.indexOf("calendarInitialMonthReady") >= 0, "welcome requires the first month load");
assert.ok(canShow.indexOf("Loading forecast") >= 0, "welcome does not cover the loading ribbon");
assert.ok(canShow.indexOf("aria-busy") >= 0, "welcome waits until calendar loading UI finishes");
assert.ok(canShow.indexOf("bw_onboarding_recovery_pending") >= 0, "welcome waits for onboarding recovery");

assert.ok(
  app.indexOf("window.setTimeout(maybeShowForecastReadyPopup, 60)") < 0,
  "welcome is not shown on a 60ms calendar-page timer"
);

var modalBody = functionBody(app, "ensureForecastReadyModal");
assert.ok(/if \(e\.target === wrap\) skipTourFromModal\(\)/.test(modalBody), "backdrop dismissal records a skip");
assert.ok(
  /Escape[\s\S]*skipTourFromModal\(\)/.test(modalBody),
  "Escape dismissal records a skip"
);
assert.ok(modalBody.indexOf("window.BW.tour.start") >= 0, "tour still starts only from Take the Tour");

var loadBody = functionBody(app, "loadMonthAndCalendar");
assert.ok(loadBody.indexOf("maybeShowForecastReadyPopup()") >= 0, "welcome is offered after the month load");
assert.ok(loadBody.indexOf("calendarInitialMonthReady = true") >= 0, "month-ready flag is set when the load finishes");

console.log("forecast-ready-welcome.test.js ok");
