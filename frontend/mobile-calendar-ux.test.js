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
  /\.calendar--mobile \.cal-cell\.cal-cell--no-tx\{[\s\S]*?flex-direction:\s*row/.test(css),
  "empty mobile days put the date and projected balance on one row"
);
assert.ok(
  /\.calendar--mobile \.cal-cell\.cal-cell--no-tx\{[\s\S]*?min-height:\s*64px/.test(css),
  "empty mobile days stay compact"
);
assert.ok(
  /\.calendar--mobile \.cal-cell\.cal-cell--no-tx \.cal-day-txns\{[\s\S]*?display:\s*none/.test(css),
  "empty mobile days do not keep a blank transaction area"
);
assert.ok(
  /\.calendar--mobile \.cal-cell\.cal-cell--no-tx \.cal-daynum::after\{[\s\S]*?display:\s*none/.test(css),
  "empty mobile days drop the date divider"
);
assert.ok(
  /\.calendar--mobile \.cal-cell-stack\{[\s\S]*?gap:\s*4px/.test(css),
  "populated mobile days use tighter vertical gaps"
);
assert.ok(
  !/\.calendar:not\(\.calendar--mobile\) \.cal-cell\.cal-cell--no-tx\{[\s\S]*?flex-direction:\s*row/.test(css),
  "desktop empty days keep the existing column layout"
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
assert.ok(loadBody.indexOf("month-cache-hit") >= 0, "cached months paint without another loading spinner");
assert.ok(loadBody.indexOf("allowCache") >= 0, "month snapshots are reused only when navigating months");
assert.ok(app.indexOf("loadMonthAndCalendar({ allowCache: true })") >= 0, "month buttons reuse warmed adjacent months");
assert.ok(loadBody.indexOf("schedulePrefetchAdjacentCalendarMonths()") >= 0, "phones warm adjacent months after the first usable paint");
assert.ok(loadBody.indexOf("cashHealthPromise") >= 0, "Cash Health still loads on the Forecast path");
assert.ok(loadBody.indexOf("{ adjacent: false }") >= 0, "phones fetch the current month daily balances before adjacent months");
assert.ok(loadBody.indexOf("showCashHealthPendingUi()") >= 0, "phones keep a compact Cash Health loading state until copy is ready");
assert.ok(loadBody.indexOf("prefetchCashHealthDailyMonths()") >= 0, "phones start the 90-day daily months with the current calendar month");
assert.ok(
  loadBody.indexOf("prefetchCashHealthDailyMonths()") < loadBody.indexOf("await Promise.all([dailyPromise"),
  "Cash Health daily months start with the current-month calendar requests"
);
assert.ok(loadBody.indexOf("applyCalendarStatusDecorations()") >= 0, "reconciled markers arrive without rebuilding the calendar");
assert.ok(loadBody.indexOf("secondary-painted") >= 0, "phones mark when extras and Cash Health catch up");
var usableIdx = loadBody.indexOf("usable-calendar");
var deferredIdx = loadBody.indexOf("startDeferredSecondary()");
assert.ok(usableIdx >= 0 && deferredIdx > usableIdx, "phones defer extras until Cash Health has resolved");
assert.ok(
  loadBody.indexOf('runStep("upcoming"') >= 0 && loadBody.indexOf("? Promise.resolve()") >= 0,
  "phones do not fetch the 548-day upcoming list on the first Forecast paint"
);
assert.ok(loadBody.indexOf("revealMobileCalendarPlaced()") >= 0, "phones place today before the calendar is revealed");
assert.ok(loadBody.indexOf("scheduleMobileForecastTop()") < 0, "month load does not keep issuing top-pin scroll commands");
assert.ok(loadBody.indexOf("maybeShowForecastReadyPopup()") >= 0, "first-forecast welcome still waits on the full load");
var extrasFn = functionBody(app, "loadCalendarExtras");
assert.ok(extrasFn.indexOf("requestMonthExpectedCalendar") >= 0 && extrasFn.indexOf("await Promise.all([") >= 0, "wrap-month extras fetch in one round");
var mainFn = functionBody(app, "main");
assert.ok(mainFn.indexOf("Promise.all([accountsPromise, loadMonthAndCalendar()])") >= 0, "accounts do not block the month fetch");
assert.ok(
  mainFn.indexOf("!isMobileCalendarViewport()") >= 0 && mainFn.indexOf("categoriesBootstrap = loadCategories()") >= 0,
  "phones do not start category fetches before the first calendar paint"
);
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
assert.ok(calendarHtml.indexOf("sidebar-cash-health--pending") >= 0, "Cash Health starts in a pending shell so empty sections stay hidden");
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
assert.ok(todayFn.indexOf("mobileCalendarScrollTopFor") >= 0, "desktop Today still has a today scroller");
var chipFn = functionBody(app, "syncCashHealthCalendarChip");
assert.ok(chipFn.indexOf("cashHealthCardIsOnScreen()") >= 0, "phones do not repeat the Cash Health warning above the calendar");
assert.ok(chipFn.indexOf('querySelectorAll(".cal-cash-health-chip")') >= 0, "a leftover calendar warning chip is still removed");
assert.ok(
  functionBody(app, "cashHealthCardIsOnScreen").indexOf("sidebarCashHealthCard.hidden") >= 0,
  "the calendar chip stays away while Cash Health is already in the forecast layout"
);
assert.ok(app.indexOf("cal-earlier-toggle") < 0, "phones do not hide earlier dates behind a control");
assert.ok(app.indexOf("mobileCalendarShowEarlier") < 0, "earlier dates stay in the mobile list");
assert.ok(app.indexOf("function placeMobileCalendarBeforeReveal(") >= 0, "initial today placement happens before reveal");
assert.ok(app.indexOf("function markMobileCalendarPlaceReady(") >= 0, "today placement can keep the month out of flow until it is ready");
assert.ok(
  /calendar-panel--placing:not\(\.calendar-panel--place-ready\) \.calendar-scroll\{[\s\S]*?position:\s*absolute/.test(css),
  "the full month is out of flow until today can be placed"
);
assert.ok(
  /sidebar-cash-health--pending #sidebarPendingTxCard/.test(css),
  "Needs Review stays hidden until Cash Health status is ready"
);
var expectedFn = functionBody(app, "loadExpectedTransactionsUncached");
assert.ok(
  expectedFn.indexOf("cash-health-skip-expected-refresh") >= 0,
  "unchanged expected transactions do not restart Cash Health"
);
assert.ok(
  expectedFn.indexOf("cash-health-invalidate-expected") >= 0,
  "changed expected transactions still refresh Cash Health"
);
assert.ok(app.indexOf("function ensureTransactionsListData(") >= 0, "transactions list has a shared prefetch");
var ensureFn = functionBody(app, "ensureTransactionsListData");
assert.ok(ensureFn.indexOf("loadExpectedTransactions()") >= 0, "list prefetch loads recurring series");
assert.ok(ensureFn.indexOf("loadUpcomingTransactionsPanel()") >= 0, "list prefetch loads 548-day actuals on every viewport");
var prefetchIdx = app.indexOf("const txListPrefetch");
var calendarAwaitIdx = app.indexOf("await Promise.all([accountsPromise, loadMonthAndCalendar()])");
assert.ok(prefetchIdx >= 0 && prefetchIdx < calendarAwaitIdx, "transactions list prefetch starts before the calendar wait");
var mainFn = functionBody(app, "main");
var txWaitIdx = mainFn.indexOf("await txListPrefetch");
var mainCalendarIdx = mainFn.indexOf("await Promise.all([accountsPromise, loadMonthAndCalendar()])");
assert.ok(
  txWaitIdx >= 0 && mainCalendarIdx > txWaitIdx && mainFn.indexOf("isTransactionsView()") < txWaitIdx,
  "Transactions rows settle before Forecast starts"
);
assert.ok(
  mainFn.indexOf("isTransactionsOrReportsView()") >= 0 && mainFn.indexOf("isTransactionsOrReportsView()") < txWaitIdx,
  "Reports still starts its list without waiting to begin Forecast"
);
var monthFn = functionBody(app, "loadMonthAndCalendar");
assert.ok(monthFn.indexOf("upcomingPromise: mobile") >= 0, "Forecast still skips the 548-day upcoming fetch on phones");
var renderCalFn = functionBody(app, "renderCalendar");
assert.ok(renderCalFn.indexOf("appendMobileCalendarMonthContinue(wrapper, year, monthIndex)") >= 0, "phones get a next-month control after the last date");
assert.ok(renderCalFn.indexOf("if (isMobileCalendarLayout) appendMobileCalendarMonthContinue") >= 0, "desktop calendar does not get the next-month control");
assert.ok(app.indexOf("function goMobileCalendarAdjacentMonth(") >= 0, "next-month control uses shared month navigation");
assert.ok(functionBody(app, "goMobileCalendarAdjacentMonth").indexOf("shiftCalendarMonth(delta)") >= 0, "next-month control reuses month arrows");
assert.ok(functionBody(app, "goMobileCalendarAdjacentMonth").indexOf("scrollMobileCalendarToFirstInMonth()") >= 0, "the new month lands on its first date");
assert.ok(
  /@media \(max-width: 768px\)[\s\S]*?\.calendar--mobile \.cal-month-continue\{[\s\S]*?min-height:\s*44px/.test(css),
  "the next-month control is compact and phone-only"
);
assert.ok(
  !/\.calendar:not\(\.calendar--mobile\)[\s\S]{0,80}\.cal-month-continue/.test(css),
  "desktop calendar styles do not add a next-month control"
);
var refreshFn = functionBody(app, "refreshLowBalanceAlert");
var copyIdx = refreshFn.indexOf("buildCashHealthCopy(summary, null)");
var paintIdx = refreshFn.indexOf("renderCashHealth();", copyIdx);
var runUpIdx = refreshFn.indexOf("loadCashHealthRunUpItems");
assert.ok(copyIdx >= 0, "Cash Health status copy does not wait on run-up names");
assert.ok(paintIdx >= 0 && runUpIdx > paintIdx, "run-up names load after Cash Health status paints");
assert.ok(refreshFn.indexOf("void (async () => {") >= 0, "run-up details load without blocking the status paint");
assert.ok(app.indexOf("keepMobileTodayInPlace") < 0, "today-follow observer stays gone");
assert.ok(!/new ResizeObserver/.test(functionBody(app, "placeMobileCalendarBeforeReveal")), "placement does not observe later layout shifts");
assert.ok(app.indexOf('id = "calCashHealthStrip"') >= 0, "phones get a compact Cash Health strip");
assert.ok(app.indexOf("function showCashHealthPendingUi(") >= 0, "Cash Health has a compact pending state");
assert.ok(app.indexOf("function requestMonthTransactions(") >= 0, "month transaction fetches are reused while in flight");
assert.ok(app.indexOf("function apiRequest(") >= 0, "identical GET requests share one in-flight promise");
assert.ok(app.indexOf("function syncCashHealthStrip(") >= 0, "the compact strip paints from the same Cash Health copy");
assert.ok(app.indexOf("mobileCashHealthStripReserve") >= 0, "today sits below the compact strip");
assert.ok(
  /new IntersectionObserver/.test(functionBody(app, "observeCashHealthStrip")),
  "the strip hides with one observer while the full Cash Health card is on screen"
);
assert.ok(!/new ResizeObserver/.test(functionBody(app, "observeCashHealthStrip")), "the strip does not observe layout shifts");
assert.ok(
  /body\[data-bw-view="calendar"\] \.cal-cash-health-strip\.is-active\{[\s\S]*?position:\s*fixed/.test(css),
  "the compact strip stays under the nav without a nested scroller"
);
assert.ok(
  /body\[data-bw-view="calendar"\] \.cal-cash-health-strip\.is-active\{[\s\S]*?max-height:\s*40px/.test(css),
  "the compact strip stays within 40px"
);
assert.ok(
  /body\[data-bw-view="calendar"\] \.cal-cash-health-strip--below\.is-active\{[\s\S]*?background:\s*#f6e6c0/.test(css),
  "below-minimum uses a subtle amber strip"
);
assert.ok(
  /body\[data-bw-view="calendar"\] \.cal-cash-health-strip--negative\.is-active\{[\s\S]*?background:\s*#f8d7da/.test(css),
  "negative balances use a stronger red strip"
);
assert.ok(
  /body\[data-bw-view="calendar"\] \.cal-cash-health-strip\.is-active\{[\s\S]*?background:\s*#eef6f0/.test(css),
  "healthy Cash Health uses a calm green strip"
);
assert.ok(
  /body\[data-bw-view="calendar"\] \.cal-cash-health-strip--pending\.is-active\{[\s\S]*?background:\s*#eef1ee/.test(css),
  "pending Cash Health uses a neutral strip instead of a tone"
);
assert.ok(
  /body\[data-bw-view="calendar"\] \.cal-cash-health-strip__kicker\{[\s\S]*?font-weight:\s*600/.test(css),
  "Below minimum is semibold"
);
assert.ok(app.indexOf("function revealMobileCashHealthDetails(") >= 0, "tapping the strip reveals Cash Health details");
assert.ok(app.indexOf('el.type = "button"') >= 0 && app.indexOf('id = "calCashHealthStrip"') >= 0, "the strip is a button");
assert.ok(
  /body\[data-bw-view="calendar"\]:has\(\.bw-tour-tooltip--open\) \.cal-cash-health-strip/.test(css),
  "the compact strip yields to the guided tour"
);
var dailyReq = functionBody(app, "requestCalendarMonthDaily");
assert.ok(dailyReq.indexOf("calendarMonthDailyCache.get") >= 0, "daily-balance requests reuse cached months");

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
