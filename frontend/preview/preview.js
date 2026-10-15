/**
 * Public sample forecast. Fictional data only, calculated in the browser.
 * Does not load app.js, does not call forecast or transaction APIs, and does not save.
 */
(function () {
  "use strict";

  var BUFFER = 1500;
  var OPENING = 4850;
  var RECONCILE_DAY = 9;
  var RECONCILE_BANK = 1925;
  // Pre-existing fictional reconciliation. In October this is October 10.
  // The bank balance is $80 below that day's forecast, so later days start here.
  var SAMPLE_ADJUSTED_DAY = 10;
  var SAMPLE_ADJUSTED_BANK = 1980;
  var SERIES = [
    { day: 4, name: "Groceries", amount: -180, note: "Weekly groceries" },
    { day: 6, name: "Mortgage", amount: -2400, note: "Monthly mortgage" },
    { day: 9, name: "Utilities", amount: -210, note: "Electric and water" },
    { day: 11, name: "Credit card", amount: -1750, note: "Card payment" },
    { day: 14, name: "Insurance", amount: -160, note: "Auto insurance" },
    { day: 15, name: "Paycheck", amount: 3400, note: "Payday" },
    { day: 20, name: "Groceries", amount: -190, note: "Weekly groceries" },
    { day: 24, name: "Car repair", amount: -420, note: "Occasional repair" },
    { day: 28, name: "Credit card", amount: -650, note: "Second card payment" },
  ];
  var STEPS = [
    {
      title: "Look ahead",
      body: "See upcoming income, expenses, and the checking balance each day.",
      spot: "#preview-calendar",
    },
    {
      title: "Spot a problem",
      body: "The low point shows up before payday, while there is still time to plan.",
      spot: "#sidebarLowBalanceBanner",
    },
    {
      title: "Reconcile",
      body: "If the bank balance is different, future days start from that balance. Earlier days stay as they were.",
      spot: "#previewReconcile",
      openPanel: "reconcile",
    },
    {
      title: "Explore",
      body: "You can also try a hypothetical expense. That part is only in this demo.",
      spot: "#previewExplore",
      openPanel: "explore",
    },
    {
      title: "Get started",
      body: "Start a 14-day free trial when you want this for your own checking account.",
      spot: "#previewSignup",
    },
  ];

  var now = new Date();
  var year = now.getFullYear();
  var monthIndex = now.getMonth();
  var extra = null;
  var reconciled = false;
  var selectedIso = "";
  var selectedTxn = null;
  var stepIndex = 0;
  var open = false;
  var dialog = null;
  var backdrop = null;
  var lastFocus = null;

  function cents(amount) {
    return Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function balanceMoney(amount) {
    return amount < 0 ? "$(" + cents(amount) + ")" : "$" + cents(amount);
  }

  function txnMoney(amount) {
    return "$" + cents(amount);
  }

  function calendarTxnMoney(amount) {
    return "$" + Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function wholeMoney(amount) {
    var rounded = Math.round(amount);
    var abs = Math.abs(rounded).toLocaleString("en-US", { maximumFractionDigits: 0 });
    return rounded < 0 ? "($" + abs + ")" : "$" + abs;
  }

  function signedMoney(amount) {
    var rounded = Math.round(amount);
    var abs = Math.abs(rounded).toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (rounded < 0) return "−$" + abs;
    if (rounded > 0) return "+$" + abs;
    return "$0";
  }

  function sidebarMoney(amount) {
    var rounded = Math.ceil(amount);
    return "$" + rounded.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function daysInMonth(y, m) {
    return new Date(y, m + 1, 0).getDate();
  }

  function isoFor(y, m, day) {
    return y + "-" + String(m + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }

  function todayIso() {
    var today = new Date();
    return isoFor(today.getFullYear(), today.getMonth(), today.getDate());
  }

  function parseAmount(raw) {
    var n = Number(String(raw || "").replace(/[$,]/g, "").trim());
    if (!isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100) / 100;
  }

  function project() {
    var count = daysInMonth(year, monthIndex);
    var byDay = {};
    SERIES.forEach(function (item) {
      if (item.day > count) return;
      if (!byDay[item.day]) byDay[item.day] = [];
      byDay[item.day].push({
        name: item.name,
        amount: item.amount,
        note: item.note,
        hypothetical: false,
      });
    });
    if (extra && extra.day >= 1 && extra.day <= count && extra.amount > 0) {
      if (!byDay[extra.day]) byDay[extra.day] = [];
      byDay[extra.day].push({
        name: "Hypothetical expense",
        amount: -extra.amount,
        note: "Demo only. Not saved.",
        hypothetical: true,
      });
    }
    var carry = OPENING;
    var days = [];
    var low = { end: Infinity, day: 1 };
    var income = 0;
    var expense = 0;
    for (var day = 1; day <= count; day += 1) {
      var txns = byDay[day] || [];
      var net = 0;
      txns.forEach(function (txn) {
        net += txn.amount;
        if (txn.amount >= 0) income += txn.amount;
        else expense += Math.abs(txn.amount);
      });
      var start = carry;
      var projected = Math.round((start + net) * 100) / 100;
      var sampleVerified = day === SAMPLE_ADJUSTED_DAY;
      var demoVerified = reconciled && day === RECONCILE_DAY;
      var verified = sampleVerified || demoVerified;
      var end = sampleVerified ? SAMPLE_ADJUSTED_BANK : demoVerified ? RECONCILE_BANK : projected;
      if (end < low.end) low = { end: end, day: day };
      days.push({
        day: day,
        iso: isoFor(year, monthIndex, day),
        start: start,
        end: end,
        projected: projected,
        verified: verified,
        net: net,
        txns: txns,
      });
      carry = end;
    }
    return { days: days, low: low, income: income, expense: expense, net: income - expense };
  }

  function groupsFor(day, txns) {
    var groups = ["balances"];
    if (day === 1) groups.push("start");
    if (day < 15 && txns.some(function (txn) { return txn.amount < 0 && !txn.hypothetical; })) groups.push("upcoming");
    if (day === 14) groups.push("pressure");
    if (day === 15) groups.push("move");
    return groups.join(" ");
  }

  function warnIcon(small) {
    var size = small ? 9 : 12;
    return (
      '<span class="' +
      (small ? "cal-balance-warn-icon" : "cal-balance-risk-icon") +
      '" aria-hidden="true"><svg viewBox="0 0 16 16" width="' +
      size +
      '" height="' +
      size +
      '" fill="none"><path d="M8 2.25L14 13.75H2L8 2.25z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M8 6.25v3M8 11.1v.01" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg></span>'
    );
  }

  function cellHtml(day, narrow) {
    var isoToday = todayIso();
    var isToday = day.iso === isoToday;
    var isPast = day.iso < isoToday;
    var below = day.end < BUFFER;
    var risk = day.end < 0;
    var classes = ["cal-cell"];
    var count = day.txns.length;
    classes.push(count >= 4 ? "cal-cell--density-dense" : count === 3 ? "cal-cell--density-normal" : "cal-cell--density-sparse");
    if (isToday) classes.push("cal-cell--today");
    if (isPast) classes.push("cal-cell--past");
    if (count) classes.push("cal-cell--has-activity");
    else classes.push("cal-cell--no-tx");
    if (day.txns.some(function (txn) { return txn.amount >= 3200; })) classes.push("cal-cell--payday");
    if (day.verified) classes.push("cal-cell--adjusted-balance");
    if (risk) classes.push("cal-cell--bal-risk");
    else if (below) classes.push("cal-cell--bal-warn");
    else if (!isPast && day.end < BUFFER * 1.25) classes.push("cal-cell--bal-watch");
    if (day.iso === selectedIso) classes.push("preview-cell--selected");
    var date = new Date(year, monthIndex, day.day);
    var mobile = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    var txns = day.txns
      .map(function (txn, index) {
        var income = txn.amount > 0;
        return (
          '<button type="button" class="cal-day-tx-line cal-day-tx-line--expected cal-day-tx-line--primary ' +
          (income ? "cal-day-tx-line--flow-in" : "cal-day-tx-line--flow-out") +
          (txn.hypothetical ? " cal-day-tx-line--hypothetical" : "") +
          '" data-txn="' +
          index +
          '" title="' +
          escapeHtml(txn.name) +
          '"><span class="cal-tx-label-wrap"><span class="cal-tx-label">' +
          escapeHtml(txn.name) +
          '</span></span><span class="cal-amt ' +
          (income ? "income" : "expense") +
          '">' +
          calendarTxnMoney(txn.amount) +
          "</span></button>"
        );
      })
      .join("");
    var balClass = "cal-stat cal-balance";
    var icon = "";
    if (day.verified) {
      balClass += isPast ? " cal-balance--quiet cal-balance--past-day" : " cal-balance--quiet";
    } else if (risk) {
      balClass += " is-negative cal-balance--risk";
      if (isPast) balClass += " cal-balance--past-day";
      icon = warnIcon(false);
    } else if (below) {
      balClass += " cal-balance--below-floor";
      if (isPast) balClass += " cal-balance--past-day";
      icon = warnIcon(true);
    } else if (isPast) balClass += " cal-balance--quiet cal-balance--past-day";
    else if (day.net >= 3200) balClass += " cal-balance--strong-inflow";
    else balClass += " cal-balance--quiet";
    var pill = day.verified
      ? '<span class="cal-balance-status-pill cal-balance-status-pill--adjusted"><span class="cal-balance-status-pill__icon" aria-hidden="true">↺</span> Adjusted</span>'
      : day.day === 1
        ? '<span class="cal-balance-status-pill cal-balance-status-pill--starting"><span class="cal-balance-status-pill__icon" aria-hidden="true">●</span> Starting Point</span>'
        : "";
    var stripCue = risk ? " cal-balance-strip--cue-risk" : below ? " cal-balance-strip--cue-warn" : "";
    return (
      '<div class="' +
      classes.join(" ") +
      '" data-day="' +
      day.day +
      '" data-iso="' +
      day.iso +
      '" data-end="' +
      day.end +
      '" data-projected="' +
      day.projected +
      '" data-preview="' +
      groupsFor(day.day, day.txns) +
      '"><div class="cal-daynum" data-mobile-label="' +
      escapeHtml(mobile) +
      '"><span class="cal-daynum-num' +
      (isToday ? " is-today" : "") +
      '">' +
      day.day +
      '</span></div><div class="cal-cell-fill"></div><div class="cal-cell-stack"><div class="cal-day-txns">' +
      txns +
      '</div><div class="cal-ledger-metrics"><button type="button" class="cal-balance-strip' +
      (pill ? " cal-balance-strip--has-status" : "") +
      stripCue +
      '"><span class="cal-balance-strip__row"><span class="cal-balance-strip__amt">' +
      icon +
      '<span class="' +
      balClass +
      '" title="' +
      (day.verified ? "Fictional bank balance" : "Projected end-of-day balance") +
      '">' +
      balanceMoney(day.end) +
      "</span></span>" +
      pill +
      "</span></button></div></div></div>"
    );
  }

  function outCell(date, narrow) {
    return (
      '<div class="cal-cell cal-cell--out" aria-hidden="true"><div class="cal-daynum"><span class="cal-daynum-num">' +
      date.getDate() +
      "</span></div></div>"
    );
  }

  function renderCalendar(model) {
    var narrow = window.matchMedia("(max-width: 768px)").matches;
    var root = document.getElementById("preview-calendar");
    var dow = document.getElementById("calendarDow");
    var labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    dow.innerHTML = narrow
      ? ""
      : labels
          .map(function (label) {
            return '<div class="cal-dow">' + label + "</div>";
          })
          .join("");
    var blanks = new Date(year, monthIndex, 1).getDay();
    var cells = [];
    var i;
    for (i = 0; i < blanks; i += 1) cells.push(outCell(new Date(year, monthIndex, i - blanks + 1), narrow));
    model.days.forEach(function (day) {
      cells.push(cellHtml(day, narrow));
    });
    while (cells.length % 7 !== 0) {
      var nextDay = cells.length - blanks + 1;
      cells.push(outCell(new Date(year, monthIndex, nextDay), narrow));
    }
    root.innerHTML = cells.join("");
    root.className = narrow ? "calendar calendar--mobile" : "calendar";
    root.setAttribute(
      "aria-label",
      "Fictional checking forecast for " +
        new Date(year, monthIndex, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    );
  }

  function warnMark() {
    return (
      '<span class="cash-outlook-icon cash-outlook-icon--warn" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 2 21h20L12 3z"></path><path d="M12 9v5"></path><path d="M12 17h.01"></path></svg></span>'
    );
  }

  function renderCashHealth(model) {
    var banner = document.getElementById("sidebarLowBalanceBanner");
    var when = new Date(year, monthIndex, model.low.day).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    var gap = Math.abs(Math.round((model.low.end - BUFFER) * 100) / 100);
    var beforePayday = model.low.day < 15 ? " before payday" : "";
    if (model.low.end < BUFFER) {
      banner.className = "calendar-low-balance calendar-low-balance--sidebar calendar-low-balance--inset is-danger";
      banner.innerHTML =
        '<div class="preview-cash">' +
        warnMark() +
        '<div class="preview-cash__body">' +
        '<p class="preview-cash__kicker">Low balance ahead</p>' +
        '<p class="preview-cash__date"><strong id="previewLowBalance">' +
        wholeMoney(model.low.end) +
        '</strong> on <span id="previewCashDate">' +
        escapeHtml(when) +
        "</span></p>" +
        '<p class="preview-cash__gap" id="previewBufferGap">' +
        wholeMoney(gap) +
        " below your " +
        wholeMoney(BUFFER) +
        " minimum" +
        beforePayday +
        ".</p>" +
        "</div></div>";
    } else {
      banner.className = "calendar-low-balance calendar-low-balance--sidebar calendar-low-balance--inset is-muted is-suggestion";
      banner.innerHTML =
        '<div class="preview-cash"><div class="preview-cash__body">' +
        '<p class="preview-cash__kicker">Within your minimum</p>' +
        '<p class="preview-cash__date"><strong id="previewLowBalance">' +
        wholeMoney(model.low.end) +
        "</strong> on " +
        escapeHtml(when) +
        '</p><p class="preview-cash__gap" id="previewBufferGap">' +
        wholeMoney(gap) +
        " above your " +
        wholeMoney(BUFFER) +
        " minimum.</p></div></div>";
    }
    banner.style.display = "flex";
  }

  function renderSnapshot(model) {
    document.getElementById("previewMonthLabel").textContent = new Date(year, monthIndex, 1).toLocaleDateString(
      "en-US",
      { month: "long", year: "numeric" }
    );
    document.getElementById("totals").innerHTML =
      '<div class="total total--income"><div class="k">Income</div><div class="v ok" id="previewIncome">' +
      sidebarMoney(model.income) +
      '</div></div><div class="total total--expense"><div class="k">Expenses</div><div class="v danger" id="previewExpenses">' +
      sidebarMoney(model.expense) +
      '</div></div><div class="total total--net"><div class="k">Net</div><div class="v ' +
      (model.net >= 0 ? "ok" : "danger") +
      '" id="previewNet">' +
      sidebarMoney(model.net) +
      "</div></div>";
    document.getElementById("calendarMonthNum").value = String(monthIndex + 1);
    ensureYearOption(year);
  }

  function renderDetail(model) {
    var panel = document.getElementById("previewDetail");
    var day = null;
    model.days.forEach(function (item) {
      if (item.iso === selectedIso) day = item;
    });
    if (!day) {
      panel.hidden = true;
      panel.classList.remove("modal-overlay--open");
      return;
    }
    document.getElementById("previewDetailTitle").textContent = new Date(year, monthIndex, day.day).toLocaleDateString(
      "en-US",
      { weekday: "long", month: "long", day: "numeric", year: "numeric" }
    );
    var list = document.getElementById("previewDetailList");
    list.innerHTML = day.txns.length
      ? day.txns
          .map(function (txn, index) {
            var name = selectedTxn === index ? "<strong>" + escapeHtml(txn.name) + "</strong>" : escapeHtml(txn.name);
            return "<li>" + name + " " + txnMoney(txn.amount) + (txn.note ? " — " + escapeHtml(txn.note) : "") + "</li>";
          })
          .join("")
      : "<li>No transactions this day.</li>";
    document.getElementById("previewDetailBalance").textContent = day.verified
      ? "Starting balance " +
        balanceMoney(day.start) +
        ". Forecast was " +
        balanceMoney(day.projected) +
        ". Fictional bank balance " +
        balanceMoney(day.end) +
        ". Ending balance " +
        balanceMoney(day.end) +
        "."
      : "Starting balance " + balanceMoney(day.start) + ". Ending balance " + balanceMoney(day.end) + ".";
    panel.hidden = false;
    panel.classList.add("modal-overlay--open");
  }

  function syncChrome() {
    var nav = document.querySelector(".top-nav");
    var banner = document.querySelector(".preview-mode");
    if (!nav || !banner) return;
    var navH = Math.ceil(nav.getBoundingClientRect().height);
    var bannerStyle = window.getComputedStyle(banner);
    var bannerSpace =
      banner.getBoundingClientRect().height +
      (parseFloat(bannerStyle.marginTop) || 0) +
      (parseFloat(bannerStyle.marginBottom) || 0);
    document.documentElement.style.setProperty("--preview-nav-h", navH + "px");
    document.documentElement.style.setProperty("--preview-stick-top", Math.ceil(navH + bannerSpace) + "px");
  }

  function renderReconcile(model) {
    var anchor = null;
    model.days.forEach(function (day) {
      if (day.day === RECONCILE_DAY) anchor = day;
    });
    var projected = anchor ? anchor.projected : RECONCILE_BANK;
    var when = new Date(year, monthIndex, RECONCILE_DAY).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    });
    document.getElementById("previewReconcileLead").textContent =
      "Fictional example for " + when + ". This is not your bank balance.";
    document.getElementById("previewReconcileForecast").textContent = wholeMoney(projected);
    document.getElementById("previewReconcileBank").textContent = wholeMoney(RECONCILE_BANK);
    document.getElementById("previewReconcileDiff").textContent = signedMoney(RECONCILE_BANK - projected);
    var apply = document.getElementById("previewApplyReconcile");
    apply.disabled = reconciled;
    apply.textContent = reconciled ? "Balance applied" : "Apply this balance";
    document.getElementById("previewReconcileState").hidden = !reconciled;
    document.getElementById("previewExploreState").hidden = !extra;
  }

  function renderAll() {
    var model = project();
    renderCashHealth(model);
    renderSnapshot(model);
    renderReconcile(model);
    renderCalendar(model);
    renderDetail(model);
    syncChrome();
    if (open && dialog) {
      var nodes = stepIndex >= STEPS.length ? [] : spot(STEPS[stepIndex].spot);
      placeDialog(nodes);
      keepSpotVisible(nodes);
    }
  }

  function ensureYearOption(value) {
    var select = document.getElementById("calendarYear");
    if (!select.querySelector('option[value="' + value + '"]')) {
      var opt = document.createElement("option");
      opt.value = String(value);
      opt.textContent = String(value);
      select.appendChild(opt);
    }
    select.value = String(value);
  }

  function fillDaySelect() {
    var select = document.getElementById("previewExpenseDay");
    var count = daysInMonth(year, monthIndex);
    var current = Number(select.value || 14);
    var label = new Date(year, monthIndex, 1).toLocaleDateString("en-US", { month: "long" });
    var html = "";
    var day;
    for (day = 1; day <= count; day += 1) html += '<option value="' + day + '">' + label + " " + day + "</option>";
    select.innerHTML = html;
    if (current < 1 || current > count) current = Math.min(14, count);
    select.value = String(current);
  }

  function readExtra() {
    var amount = parseAmount(document.getElementById("previewExpenseAmount").value);
    var day = Number(document.getElementById("previewExpenseDay").value);
    if (amount <= 0) return null;
    return { day: day, amount: amount };
  }

  function setMonth(nextYear, nextMonth, clearExtra) {
    year = nextYear;
    monthIndex = nextMonth;
    if (clearExtra) {
      extra = null;
      document.getElementById("previewExpenseAmount").value = "";
    }
    selectedIso = "";
    selectedTxn = null;
    fillDaySelect();
    renderAll();
  }

  function shiftMonth(delta) {
    var next = new Date(year, monthIndex + delta, 1);
    setMonth(next.getFullYear(), next.getMonth(), true);
  }

  function selectDay(iso, txnIndex) {
    selectedIso = iso;
    selectedTxn = txnIndex;
    renderAll();
  }

  function closeDetail() {
    selectedIso = "";
    selectedTxn = null;
    renderAll();
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("div");
    dialog.className = "bw-tour-tooltip";
    dialog.id = "previewTourDialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "previewTourTitle");
    dialog.style.zIndex = "9993";
    dialog.innerHTML =
      '<div class="bw-tour-tooltip__head"><span class="bw-tour-tooltip__counter" id="previewTourCounter">1 of 5</span><button type="button" class="bw-tour-tooltip__close" id="previewTourClose" aria-label="Close walkthrough">×</button></div>' +
      '<h2 class="bw-tour-tooltip__title" id="previewTourTitle"></h2><p class="bw-tour-tooltip__body" id="previewTourBody"></p>' +
      '<p class="preview-finale-note" id="previewTourNote" hidden>Free for 14 days · No bank connection required</p>' +
      '<div class="bw-tour-tooltip__actions"><button type="button" class="bw-tour-tooltip__skip preview-back" id="previewTourBack">Back</button>' +
      '<button type="button" class="bw-tour-tooltip__cta" id="previewTourNext">Next</button>' +
      '<a class="bw-tour-tooltip__cta preview-tour-link" id="previewTourStart" href="/account-setup/?fresh=1" hidden>Start my free trial</a></div>' +
      '<a class="bw-tour-tooltip__skip" id="previewTourFaq" href="/help.html" hidden>Back to FAQ</a>';
    document.body.appendChild(dialog);
    document.getElementById("previewTourClose").addEventListener("click", closeTour);
    document.getElementById("previewTourBack").addEventListener("click", function () { showStep(stepIndex - 1); });
    document.getElementById("previewTourNext").addEventListener("click", function () { showStep(stepIndex + 1); });
    return dialog;
  }

  function clearSpot() {
    document.querySelectorAll(".bw-tour-target").forEach(function (el) {
      el.classList.remove("bw-tour-target");
      if (el.dataset.previewZ === "__unset") el.style.removeProperty("z-index");
      else if (el.dataset.previewZ != null) el.style.zIndex = el.dataset.previewZ;
      if (el.dataset.previewPos === "__unset") el.style.removeProperty("position");
      else if (el.dataset.previewPos != null) el.style.position = el.dataset.previewPos;
      delete el.dataset.previewZ;
      delete el.dataset.previewPos;
    });
  }

  function spot(selector) {
    clearSpot();
    var nodes = Array.prototype.slice.call(document.querySelectorAll(selector));
    nodes.forEach(function (el) {
      el.dataset.previewZ = el.style.zIndex === "" ? "__unset" : el.style.zIndex;
      el.dataset.previewPos = el.style.position === "" ? "__unset" : el.style.position;
      if (window.getComputedStyle(el).position === "static") el.style.position = "relative";
      el.style.zIndex = "9991";
      el.classList.add("bw-tour-target");
    });
    return nodes;
  }

  function keepSpotVisible(nodes) {
    if (!nodes || !nodes.length || window.innerWidth > 768) return;
    var el = nodes[0];
    var card = ensureDialog();
    var nav = document.querySelector(".top-nav");
    var gap = 12;
    var cardTop = card.getBoundingClientRect().top;
    var navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
    var rect = el.getBoundingClientRect();
    var delta = 0;
    if (rect.bottom > cardTop - gap) delta = rect.bottom - (cardTop - gap);
    else if (rect.top < navBottom + gap) delta = rect.top - (navBottom + gap);
    if (Math.abs(delta) > 1) window.scrollBy(0, delta);
  }

  function placeDialog(nodes) {
    var card = ensureDialog();
    card.classList.add("bw-tour-tooltip--open");
    card.style.position = "fixed";
    var margin = 12;
    var width = Math.min(360, window.innerWidth - margin * 2);
    card.style.width = width + "px";
    if (!nodes || !nodes.length || window.innerWidth <= 768) {
      card.style.left = Math.max(margin, (window.innerWidth - width) / 2) + "px";
      card.style.top = "auto";
      card.style.bottom = "max(" + margin + "px, env(safe-area-inset-bottom, 0px))";
      return;
    }
    card.style.bottom = "auto";
    var rect = nodes[0].getBoundingClientRect();
    var maxTop = window.innerHeight - card.offsetHeight - margin;
    var top = rect.bottom + 10;
    if (top > maxTop) top = Math.max(margin, rect.top - card.offsetHeight - 10);
    if (top > maxTop) top = Math.max(margin, maxTop);
    var left = rect.left;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
    card.style.left = Math.max(margin, left) + "px";
    card.style.top = Math.max(margin, top) + "px";
  }

  function showStep(index) {
    stepIndex = index;
    open = true;
    var finale = index >= STEPS.length;
    var step = finale ? null : STEPS[index];
    if (step && step.openPanel === "reconcile") document.getElementById("previewReconcile").open = true;
    if (step && step.openPanel === "explore") document.getElementById("previewExplore").open = true;
    var nodes = finale ? [] : spot(step.spot);
    var counter = document.getElementById("previewTourCounter");
    var title = document.getElementById("previewTourTitle");
    var body = document.getElementById("previewTourBody");
    var note = document.getElementById("previewTourNote");
    var back = document.getElementById("previewTourBack");
    var next = document.getElementById("previewTourNext");
    var start = document.getElementById("previewTourStart");
    var faq = document.getElementById("previewTourFaq");
    if (finale) {
      clearSpot();
      counter.hidden = true;
      title.textContent = "Now see your own future balance.";
      body.textContent = "This was a sample forecast. Your own stays private to your account.";
      note.hidden = false;
      next.hidden = true;
      start.hidden = false;
      faq.hidden = false;
      back.hidden = false;
    } else {
      counter.hidden = false;
      counter.textContent = index + 1 + " of " + STEPS.length;
      title.textContent = step.title;
      body.textContent = step.body;
      note.hidden = true;
      next.hidden = false;
      next.textContent = index === STEPS.length - 1 ? "Finish" : "Next";
      start.hidden = true;
      faq.hidden = true;
      back.hidden = index === 0;
    }
    placeDialog(nodes);
    keepSpotVisible(nodes);
    window.setTimeout(function () {
      placeDialog(nodes);
      var focusTarget = finale ? start : next;
      if (focusTarget && !focusTarget.hidden) focusTarget.focus();
    }, 0);
  }

  function closeTour() {
    open = false;
    clearSpot();
    if (dialog) {
      dialog.classList.remove("bw-tour-tooltip--open");
      dialog.style.display = "none";
    }
    if (backdrop) backdrop.classList.remove("bw-tour-backdrop--open");
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function openTour() {
    lastFocus = document.activeElement;
    ensureDialog();
    if (backdrop) backdrop.classList.add("bw-tour-backdrop--open");
    dialog.style.display = "";
    showStep(0);
  }

  function onKey(event) {
    var detail = document.getElementById("previewDetail");
    if (event.key === "Escape" && !detail.hidden) {
      event.preventDefault();
      closeDetail();
      return;
    }
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeTour();
      return;
    }
    if (event.key === "ArrowRight" && stepIndex < STEPS.length) {
      event.preventDefault();
      showStep(stepIndex + 1);
      return;
    }
    if (event.key === "ArrowLeft" && stepIndex > 0) {
      event.preventDefault();
      showStep(stepIndex - 1);
      return;
    }
    if (event.key !== "Tab" || !dialog) return;
    var items = Array.prototype.slice.call(dialog.querySelectorAll("button, a")).filter(function (el) {
      return !el.hidden && el.offsetParent !== null;
    });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  var calendar = document.getElementById("preview-calendar");
  calendar.addEventListener("click", function (event) {
    var line = event.target.closest(".cal-day-tx-line");
    var cell = event.target.closest(".cal-cell[data-iso]");
    if (!cell || cell.classList.contains("cal-cell--out")) return;
    selectDay(cell.getAttribute("data-iso"), line ? Number(line.getAttribute("data-txn")) : null);
  });

  document.getElementById("calendarPrevMonth").addEventListener("click", function () { shiftMonth(-1); });
  document.getElementById("calendarNextMonth").addEventListener("click", function () { shiftMonth(1); });
  document.getElementById("calendarGoToday").addEventListener("click", function () {
    var today = new Date();
    setMonth(today.getFullYear(), today.getMonth(), true);
  });
  document.getElementById("calendarMonthNum").addEventListener("change", function (event) {
    setMonth(year, Number(event.target.value) - 1, true);
  });
  document.getElementById("calendarYear").addEventListener("change", function (event) {
    setMonth(Number(event.target.value), monthIndex, true);
  });
  document.getElementById("previewWhatIfForm").addEventListener("submit", function (event) { event.preventDefault(); });
  document.getElementById("previewApplyReconcile").addEventListener("click", function () {
    reconciled = true;
    renderAll();
  });
  document.getElementById("previewResetReconcile").addEventListener("click", function () {
    reconciled = false;
    renderAll();
  });
  document.getElementById("previewExpenseAmount").addEventListener("input", function () {
    extra = readExtra();
    renderAll();
  });
  document.getElementById("previewExpenseDay").addEventListener("change", function () {
    extra = readExtra();
    renderAll();
  });
  document.getElementById("previewReset").addEventListener("click", function () {
    extra = null;
    document.getElementById("previewExpenseAmount").value = "";
    renderAll();
  });
  document.getElementById("previewDetailClose").addEventListener("click", closeDetail);
  document.getElementById("previewDetail").addEventListener("click", function (event) {
    if (event.target.id === "previewDetail") closeDetail();
  });

  backdrop = document.createElement("div");
  backdrop.className = "bw-tour-backdrop";
  backdrop.style.zIndex = "9990";
  backdrop.setAttribute("aria-hidden", "true");
  document.body.appendChild(backdrop);
  document.getElementById("previewReplay").addEventListener("click", openTour);
  window.addEventListener("resize", function () {
    renderCalendar(project());
    syncChrome();
    if (!open) return;
    var nodes = stepIndex >= STEPS.length ? [] : Array.prototype.slice.call(document.querySelectorAll(STEPS[stepIndex].spot));
    placeDialog(nodes);
    keepSpotVisible(nodes);
  });
  document.addEventListener("keydown", onKey);
  var yearSelect = document.getElementById("calendarYear");
  [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].forEach(function (value) {
    var opt = document.createElement("option");
    opt.value = String(value);
    opt.textContent = String(value);
    yearSelect.appendChild(opt);
  });
  fillDaySelect();
  renderAll();
})();
