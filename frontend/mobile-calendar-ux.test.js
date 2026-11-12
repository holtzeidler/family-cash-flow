var fs = require("fs");
var path = require("path");
var assert = require("assert");

var css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
var app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
var preview = fs.readFileSync(path.join(__dirname, "preview", "preview.js"), "utf8");
var previewHtml = fs.readFileSync(path.join(__dirname, "preview", "month", "index.html"), "utf8");

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

var mobileCss = css.split("@media (max-width: 768px)");
assert.ok(mobileCss.length > 1, "mobile breakpoint exists");

assert.ok(
  !/\.calendar--mobile \.cal-balance-strip__row::before\{[^}]*content:\s*"Balance"/.test(css),
  "mobile day cards do not repeat a Balance label"
);
assert.ok(
  !/\.calendar--mobile [\s\S]{0,220}content:\s*"Reconcile balance"/.test(css),
  "mobile day cards do not repeat Reconcile balance as a row label"
);
assert.ok(
  /\.calendar--mobile \.cal-balance-strip__row\{[^}]*justify-content:\s*flex-end/.test(css),
  "mobile projected amounts stay right-aligned"
);
assert.ok(
  /\.calendar--mobile \.cal-day-tx-line \.cal-tx-label\{[^}]*text-overflow:\s*ellipsis/.test(css),
  "long mobile category names truncate instead of widening the page"
);
assert.ok(
  /\.calendar--mobile \.cal-cell\{[^}]*min-width:\s*0/.test(css),
  "mobile day cards can shrink to the viewport"
);
assert.ok(
  /padding-right:\s*0;[\s\S]{0,180}justify-content:\s*flex-start;[\s\S]{0,80}text-align:\s*left;/.test(css) &&
    css.indexOf(".modal--tx-add .tx-add-form .form-row-h__label") >= 0,
  "mobile add-transaction labels left-align with their fields"
);
assert.ok(
  /body\[data-bw-view="calendar"\] \.sidebar-sticky-head[\s\S]{0,220}position:\s*static/.test(css),
  "mobile summary cards are not in a separate sticky scroll layer"
);

var addBtn = functionBody(app, "ensureCalendarAddTransactionButton");
assert.ok(addBtn.indexOf("Add transaction") >= 0, "calendar toolbar still has an Add transaction control");
assert.ok(
  addBtn.indexOf("openCalendarDayAddTransaction(calendarAddTransactionDate()") >= 0,
  "toolbar Add uses the existing add-transaction modal path"
);
assert.ok(addBtn.indexOf("placeCalendarAddTransactionControl") >= 0, "toolbar Add moves to a mobile row on small screens");
assert.ok(app.indexOf('id = "calAddTxMenuBtn"') >= 0, "desktop add dropdown is preserved");

var addDate = functionBody(app, "calendarAddTransactionDate");
assert.ok(addDate.indexOf("toISODate(new Date())") >= 0, "toolbar Add defaults the date to today");
assert.ok(addDate.indexOf("data-iso") >= 0, "toolbar Add uses a selected calendar date when one exists");

var placeAdd = functionBody(app, "placeCalendarAddTransactionControl");
assert.ok(placeAdd.indexOf("ensureCalendarMobileAddRow") >= 0, "mobile Add sits in a dedicated row above the date cards");
assert.ok(placeAdd.indexOf("cluster.appendChild(split)") >= 0, "desktop Add stays beside Today");
assert.ok(app.indexOf('id = "calMobileAddRow"') >= 0, "mobile Add row is created next to the calendar toolbar");

assert.ok(
  /body\[data-bw-view="calendar"\] \.cal-mobile-add-row:not\(\[hidden\]\)\{[\s\S]*?position:\s*static/.test(css),
  "mobile Add is in document flow, not a floating overlay"
);
assert.ok(
  /body\[data-bw-view="calendar"\] \.cal-mobile-add-row \.cal-add-tx-btn\{[\s\S]*?min-height:\s*44px/.test(css),
  "mobile Add is a 44px control"
);
assert.ok(
  !/\.calendar--mobile \.cal-cell[\s\S]{0,200}Add transaction/.test(css),
  "day cards do not get a repeated Add transaction button"
);
assert.ok(app.indexOf("bindCalendarCellAddTxClick") >= 0, "tapping a calendar date still adds a transaction");

var dismissStart = app.indexOf("function bindTxAddModalDismiss(");
var dismissEnd = app.indexOf("bindTxAddModalDismiss();", dismissStart);
var dismiss = app.slice(dismissStart, dismissEnd);
assert.ok(dismiss.indexOf("function bindTxAddModalDismiss(") === 0, "Cancel dismiss helper exists");
assert.ok(dismiss.indexOf('addEventListener("pointerdown"') < 0, "Cancel does not close the add modal on pointerdown");
assert.ok(dismiss.indexOf("closeTxAddModal()") >= 0, "Cancel still closes on click");
assert.ok(dismiss.indexOf("stopPropagation") >= 0, "Cancel click does not fall through to the calendar");

var panelClick = functionBody(app, "handleCalendarPanelClick");
assert.ok(
  panelClick.indexOf("modal-overlay--open") >= 0,
  "calendar date clicks are ignored while Add transaction is open"
);

var loadBody = functionBody(app, "loadMonthAndCalendar");
assert.ok(
  loadBody.indexOf("state.monthActualItems = []") < 0,
  "month load does not blank transactions before daily-balances return"
);
assert.ok(
  loadBody.indexOf("state.monthDailyBalances = new Map()") < 0,
  "month load does not wipe balances before the API responds"
);
var dailyIdx = loadBody.indexOf("dailyPromise");
var txIdx = loadBody.indexOf("txPromise");
var parallelIdx = loadBody.indexOf("await Promise.all([");
assert.ok(dailyIdx >= 0 && txIdx >= 0 && parallelIdx >= 0, "load sequence markers exist");
assert.ok(dailyIdx < parallelIdx && txIdx < parallelIdx, "daily balances and transactions start together");
assert.ok(loadBody.indexOf("const mobile = isMobileCalendarViewport()") >= 0, "phones wait for a coherent first calendar paint");
assert.ok(loadBody.indexOf("usable-calendar") >= 0, "phones mark a usable calendar as soon as the month can paint");
assert.ok(loadBody.indexOf("cashHealthPromise") >= 0, "Cash Health loads with the month, not after the first paint");
assert.ok(loadBody.indexOf("scheduleMobileForecastTop()") < 0, "month load does not keep issuing top-pin scroll commands");
assert.ok(loadBody.indexOf("maybeShowForecastReadyPopup()") >= 0, "first-forecast welcome still waits on the full load");
var extrasFn = functionBody(app, "loadCalendarExtras");
assert.ok(extrasFn.indexOf("expected-calendar") >= 0 && extrasFn.indexOf("await Promise.all([") >= 0, "wrap-month extras fetch in one round");
var mainFn = functionBody(app, "main");
assert.ok(mainFn.indexOf("Promise.all([accountsPromise, loadMonthAndCalendar()])") >= 0, "accounts do not block the month fetch");
assert.ok(loadBody.indexOf("scheduleMobileCalendarLanding()") < 0, "month load does not auto-scroll to today");
assert.ok(loadBody.indexOf("maybeScrollMobileCalendarToToday()") < 0, "month load does not re-aim at today as data arrives");
assert.ok(
  mainFn.indexOf("computeMonthDailyBalancesLegacy()") < 0,
  "bootstrap does not paint a client-side placeholder calendar"
);

assert.ok(app.indexOf("function keepMobileTodayInPlace(") < 0, "today-follow observer is gone");
assert.ok(app.indexOf("function maybeScrollMobileCalendarToToday(") < 0, "auto-land on today is gone");
assert.ok(app.indexOf('history.scrollRestoration = "manual"') >= 0, "calendar owns the first scroll position");
var calendarHtml = fs.readFileSync(path.join(__dirname, "calendar", "index.html"), "utf8");
assert.ok(calendarHtml.indexOf('data-bw-view="calendar"') >= 0, "calendar HTML first-paints as the forecast view");
assert.ok(
  /id="sidebarCashHealthCard"[^>]*hidden/.test(calendarHtml) === false,
  "Cash Health is in the first HTML layout, not hidden behind Monthly Cash Flow"
);
assert.ok(calendarHtml.indexOf("calendar-panel--loading") >= 0, "the calendar panel starts in its loading state");
assert.ok(calendarHtml.indexOf("sidebar-pending--empty") >= 0, "Needs Review starts compact when empty");
assert.ok(
  /id="sidebarReconcileRow"[^>]*hidden/.test(calendarHtml) === false,
  "Last Reconciled is in the first HTML layout"
);
assert.ok(calendarHtml.indexOf('id="calendarLoadingIndicator" hidden') < 0, "the loading overlay is visible on first paint");
assert.ok(calendarHtml.indexOf('history.scrollRestoration = "manual"') >= 0, "Safari is told not to restore a mid-month scroll before app.js runs");

var topFn = functionBody(app, "pinMobileForecastTop");
assert.ok(topFn.indexOf("scrollTo") >= 0, "bfcache restore can still be corrected back to the top");
assert.ok(topFn.indexOf("calendarMobileUserMoved") >= 0, "a user scroll is not overwritten");
assert.ok(app.indexOf("function scheduleMobileForecastTop(") < 0, "init does not schedule repeated top pins");

var detailFn = functionBody(app, "setCalendarDetailMode");
assert.ok(detailFn.indexOf("monthDailyBalances") >= 0, "toggle does not paint an empty month during script init");

var renderFn = functionBody(app, "renderCalendar");
assert.ok(renderFn.indexOf("renderCalendar-skipped-empty") >= 0, "mobile loading does not paint empty date cards");

var loadingFn = functionBody(app, "setCalendarLoadingUi");
assert.ok(loadingFn.indexOf("calendarLoadingIndicator") >= 0, "the overlay indicator tracks the panel loading class");

var visFn = functionBody(app, "syncSidebarCashHealthCardVisibility");
assert.ok(visFn.indexOf("activeFamilyId") < 0, "Cash Health stays in layout before the family id arrives");

var navIife = app.slice(app.indexOf("(function scrollActiveNavTabIntoView()"), app.indexOf("main().catch"));
assert.ok(navIife.indexOf("scrollIntoView") >= 0 && navIife.indexOf("Never use Element.scrollIntoView") >= 0, "active tab scrolling does not pan the document");
assert.ok(navIife.indexOf("tabs.scrollTo") >= 0, "active tab only scrolls the tab strip");

var todayFn = functionBody(app, "scrollMobileCalendarToToday");
assert.ok(todayFn.indexOf("mobileCalendarScrollTopFor") >= 0, "the Today control still scrolls to today");
assert.ok(app.indexOf("scrollMobileCalendarToToday()") >= 0, "the Today button calls the explicit today scroller");

var skipFn = functionBody(app, "ensureForecastReadyModal");
assert.ok(skipFn.indexOf("scheduleMobileForecastTop()") < 0, "skipping the welcome does not move the page");
assert.ok(skipFn.indexOf("scrollMobileCalendarToToday()") < 0, "skipping the welcome does not jump to today");

var tourEnded = app.slice(app.indexOf('window.addEventListener("bw-tour-ended"'), app.indexOf("let calendarLoadingGuardTimer"));
assert.ok(tourEnded.indexOf("scrollTo") < 0, "ending the tour does not auto-scroll to today");
assert.ok(tourEnded.indexOf("calendarMobileUserMoved = true") >= 0, "ending the tour leaves later loads from moving the page");

var showBody = functionBody(app, "maybeShowForecastReadyPopup");
assert.ok(showBody.indexOf("preventScroll: true") >= 0, "welcome focus does not scroll the forecast");

assert.ok(/body\[data-bw-view="calendar"\]\{[\s\S]*?overflow-anchor:\s*none/.test(css), "inserting Cash Health does not overflow-anchor the page down to today");
assert.ok(
  /body\[data-bw-view="calendar"\] \.sidebar \.card\[data-sidebar-key="month"\]\{[\s\S]*?display:\s*none/.test(css),
  "phones hide Monthly Cash Flow on Forecast; Reports still has it"
);
assert.ok(
  /body\[data-bw-view="calendar"\] \.calendar-panel--loading \.calendar-loading-indicator[\s\S]*?position:\s*static/.test(css),
  "phones use a compact calendar loading placeholder instead of a full-panel overlay"
);

var labelCol = functionBody(app, "applyCalendarDayLabelColumnWidth");
assert.ok(
  labelCol.indexOf("max-width: 768px") >= 0,
  "mobile calendar does not pin a pixel label column that can overflow"
);

assert.ok(
  previewHtml.indexOf("See how an extra purchase could affect your future balance. Nothing is saved.") >= 0,
  "hypothetical copy is short and says nothing is saved"
);
assert.ok(previewHtml.indexOf("See impact") >= 0, "sample forecast has an explicit See impact control");
assert.ok(previewHtml.indexOf("Reset scenario") >= 0, "sample forecast has a Reset scenario control");
assert.ok(previewHtml.indexOf("e.g., 500") >= 0, "amount field uses an example placeholder");
assert.ok(previewHtml.indexOf(">Added<") < 0, "ambiguous Added status is gone");
assert.ok(preview.indexOf("applyHypotheticalExpense") >= 0, "hypothetical expense has an explicit apply path");
assert.ok(
  !/previewExpenseAmount"\)\.addEventListener\("change"/.test(preview),
  "changing the amount does not auto-apply the hypothetical"
);
var amountInputHandler = preview.slice(
  preview.indexOf('previewExpenseAmount").addEventListener("input"'),
  preview.indexOf('previewExpenseAmount").addEventListener("input"') + 180
);
assert.ok(
  amountInputHandler.indexOf("applyHypotheticalExpense") < 0,
  "typing an amount does not apply the hypothetical"
);
assert.ok(
  preview.indexOf('hypothetical: true') >= 0 && preview.indexOf("Demo only. Not saved.") >= 0,
  "hypothetical expenses stay in the browser"
);
assert.ok(preview.indexOf("previewExploreState") < 0, "preview JS no longer toggles an Added state label");

console.log("mobile-calendar-ux.test.js ok");
