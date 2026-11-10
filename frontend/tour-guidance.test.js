var fs = require("fs");
var path = require("path");
var assert = require("assert");

var css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
var tour = fs.readFileSync(path.join(__dirname, "tour.js"), "utf8");
var calendarHtml = fs.readFileSync(path.join(__dirname, "calendar", "index.html"), "utf8");

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

assert.ok(calendarHtml.indexOf("tour.js?v=28") >= 0, "calendar loads the updated tour script");
assert.ok(calendarHtml.indexOf("styles.css?v=935") >= 0, "calendar loads the updated tour styles");

assert.ok(tour.indexOf('data-bw-tour-arrow') >= 0, "popover includes a caret");
assert.ok(tour.indexOf('data-bw-tour-next') >= 0, "Next control is present");
assert.ok(tour.indexOf('data-bw-tour-back') >= 0, "Back control is present");
assert.ok(tour.indexOf('data-bw-tour-skip-link') >= 0, "Skip tour control is present");
assert.ok(tour.indexOf('aria-label="Skip tour"') >= 0, "close control is present");
assert.ok(tour.indexOf('e.key === "Escape"') >= 0, "Escape still skips the tour");
assert.ok(tour.indexOf('e.key === "ArrowRight"') >= 0, "ArrowRight still advances");
assert.ok(tour.indexOf('e.key === "ArrowLeft"') >= 0, "ArrowLeft still goes back");
assert.ok(tour.indexOf("nextBtn.focus({ preventScroll: true })") >= 0, "step render keeps keyboard focus in the popover");

var cashStep = tour.slice(tour.indexOf('id: "cash-outlook"'), tour.indexOf('id: "reconcile"'));
assert.ok(cashStep.indexOf("Know before your balance gets too low") >= 0, "Cash Health title is unchanged");
assert.ok(cashStep.indexOf("status of your forecast") >= 0, "Cash Health copy names the status");
assert.ok(cashStep.indexOf("lowest projected balance") >= 0, "Cash Health copy names the lowest projected balance");
assert.ok(
  cashStep.indexOf("If a future projected balance would fall below") >= 0,
  "Cash Health copy is conditional, not an accusation"
);
assert.ok(
  cashStep.indexOf("even when things look healthy today") >= 0,
  "Cash Health copy works when the forecast is healthy"
);
assert.ok(cashStep.indexOf("your balance is too low") < 0, "copy does not claim the user currently has a problem");
assert.ok(cashStep.indexOf("findCashHealthTarget") >= 0, "Cash Health step uses the status card target");

var cashTarget = functionBody(tour, "findCashHealthTarget");
assert.ok(cashTarget.indexOf(".cash-health-card__body") >= 0, "Cash Health prefers the status and lowest-balance body");
assert.ok(cashTarget.indexOf("sidebarCashHealthCard") < 0, "Cash Health does not highlight the whole sidebar card");
assert.ok(cashTarget.indexOf("aside.sidebar") < 0, "Cash Health does not highlight the entire sidebar");

var cashFallback = functionBody(tour, "findCashOutlookTarget");
assert.ok(cashFallback.indexOf("sidebarCashHealthCard") < 0, "Cash Health fallback does not use the whole card");
assert.ok(cashFallback.indexOf("aside.sidebar") < 0, "Cash Health fallback does not use the sidebar");
assert.ok(cashFallback.indexOf("return null") >= 0, "Cash Health fallback stops at the banner");

var needsTarget = functionBody(tour, "findNeedsReviewTarget");
assert.ok(needsTarget.indexOf("findFirstPendingReviewItem") >= 0, "Needs Review prefers a pending bill");
assert.ok(needsTarget.indexOf("findAmountVariesExampleTarget") >= 0, "Needs Review can fall back to a specific bill line");

var addTarget = functionBody(tour, "findFutureCalendarCellTarget");
assert.ok(addTarget.indexOf(".cal-cell[data-iso]") >= 0, "Add step still targets a calendar day");

var reconcileTarget = functionBody(tour, "findExpectedCalendarConfirmAnchor");
assert.ok(reconcileTarget.indexOf("sidebarReconcileRow") >= 0, "Reconcile step prefers the Last Reconciled row");

var scrollFn = functionBody(tour, "scrollTargetIntoView");
assert.ok(scrollFn.indexOf("scrollIntoView") >= 0, "each step scrolls its target into view");
assert.ok(scrollFn.indexOf("isScrollableOverflow") >= 0, "nested overflow parents are scrolled on iPhone Safari");
assert.ok(scrollFn.indexOf("stickyHeaderBottom") >= 0, "scroll accounts for the fixed header");

var placeFn = functionBody(tour, "positionTooltip");
assert.ok(placeFn.indexOf("placementsForViewport") >= 0, "placement prefers above/below in the remaining viewport");
assert.ok(placeFn.indexOf("chosen.overlap") >= 0, "placement avoids covering the highlighted target");
assert.ok(placeFn.indexOf("data-bw-tour-arrow") >= 0 || placeFn.indexOf("[data-bw-tour-arrow]") >= 0, "caret is positioned with the popover");

var viewportFn = functionBody(tour, "bindTourViewportListeners");
assert.ok(viewportFn.indexOf("orientationchange") >= 0, "orientation changes recalculate placement");
assert.ok(viewportFn.indexOf("visualViewport") >= 0, "mobile visual viewport changes recalculate placement");
assert.ok(tour.indexOf("unbindTourViewportListeners") >= 0, "viewport listeners are removed when the tour ends");

assert.ok(/\.bw-tour-tooltip\{[\s\S]*?overflow:\s*visible/.test(css), "popover does not clip its caret");
assert.ok(/\.bw-tour-tooltip__arrow\{/.test(css), "caret styles exist");
assert.ok(
  /@media \(max-width:\s*800px\)\{[\s\S]*?\.bw-tour-tooltip__arrow\{[\s\S]*?width:\s*16px/.test(css),
  "mobile caret is large enough to see"
);
assert.ok(
  /@media \(prefers-reduced-motion:\s*reduce\)\{[\s\S]{0,80}\.bw-tour-tooltip\{[\s\S]*?transition:\s*none/.test(css),
  "popover motion respects reduced-motion"
);
assert.ok(
  /@media \(prefers-reduced-motion:\s*reduce\)\{[\s\S]{0,180}bw-tour-support-highlight--pending-item\{[\s\S]*?animation:\s*none/.test(css),
  "pending-item pulse respects reduced-motion"
);
assert.ok(css.indexOf("0 0 28px 6px") < 0 || !/bw-tour-target--cash-outlook\{[\s\S]*?0 0 28px 6px/.test(css), "Cash Health spotlight is not a floodlight");
assert.ok(
  /\.bw-tour-target--cash-outlook\{[\s\S]*?0 0 0 2px/.test(css),
  "Cash Health spotlight uses a tight ring"
);

console.log("tour-guidance.test.js: ok");
