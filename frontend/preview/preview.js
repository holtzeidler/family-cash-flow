/**
 * Public sample forecast. Fictional data only, calculated in the browser.
 * Does not load app.js, does not call forecast or transaction APIs, and does not save.
 */
(function () {
  "use strict";

  var BUFFER = 1500;
  var OPENING = 4850;
  var PHONE_QUERY = "(max-width: 900px)";
  // Offsets are days from the visitor's current date. The low point stays 4 days ahead.
  var LOW_OFFSET = 4;
  var PAY_OFFSET = 6;
  var DEMO_OFFSET = -4;
  var RECONCILED_OFFSET = -3;
  var ADJUSTED_OFFSET = 10;
  var DEMO_BANK = 1925;
  var ADJUSTED_BANK = 3240;
  var SERIES = [
    { offset: -8, name: "Groceries", amount: -180, note: "Weekly groceries" },
    { offset: -6, name: "Mortgage", amount: -2400, note: "Monthly mortgage" },
    { offset: -4, name: "Utilities", amount: -210, note: "Electric and water" },
    { offset: 3, name: "Credit card", amount: -660, note: "Card payment" },
    { offset: 4, name: "Insurance", amount: -1250, note: "Auto insurance" },
    { offset: 6, name: "Paycheck", amount: 3400, note: "Payday" },
    { offset: 10, name: "Groceries", amount: -190, note: "Weekly groceries" },
    { offset: 14, name: "Car repair", amount: -420, note: "Occasional repair" },
    { offset: 18, name: "Credit card", amount: -650, note: "Second card payment" },
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
      title: "Keep your forecast accurate",
      body: "When your actual bank balance differs from your forecast, update it here. BalanceWhiz adjusts future projections without changing your history.",
      spot: "#previewReconcile",
      openPanel: "reconcile",
    },
    {
      title: "Explore",
      body: "Try adding an unexpected expense and see how it changes your future balance. It's a safe way to explore — nothing is saved.",
      spot: "#previewExplore",
      openPanel: "explore",
    },
    {
      title: "Now see your own future balance.",
      body: "This was a sample forecast. Your own forecast stays private to your account.",
      signup: true,
    },
  ];

  var todayDate = dateOnly(new Date());
  var lowDate = addDays(todayDate, LOW_OFFSET);
  var year = lowDate.getFullYear();
  var monthIndex = lowDate.getMonth();
  var extra = null;
  var reconciled = false;
  var rangeMode = "agenda";
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

  function dateOnly(value) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  function addDays(value, count) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate() + count);
  }

  function isoOf(value) {
    return isoFor(value.getFullYear(), value.getMonth(), value.getDate());
  }

  function todayIso() {
    return isoOf(todayDate);
  }

  function phoneLayout() {
    return window.matchMedia(PHONE_QUERY).matches;
  }

  function showAgenda() {
    return phoneLayout() && rangeMode !== "month";
  }

  function originDate() {
    var back = addDays(todayDate, -40);
    return new Date(back.getFullYear(), back.getMonth(), 1);
  }

  function parseAmount(raw) {
    var n = Number(String(raw || "").replace(/[$,]/g, "").trim());
    if (!isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100) / 100;
  }

  function eventsByIso() {
    var map = {};
    SERIES.forEach(function (item) {
      map[isoOf(addDays(todayDate, item.offset))] = item;
    });
    return map;
  }

  function walkThrough(endDate) {
    var events = eventsByIso();
    var demoIso = isoOf(addDays(todayDate, DEMO_OFFSET));
    var reconciledIso = isoOf(addDays(todayDate, RECONCILED_OFFSET));
    var adjustedIso = isoOf(addDays(todayDate, ADJUSTED_OFFSET));
    var openingIso = isoOf(originDate());
    var carry = OPENING;
    var days = [];
    var cursor = originDate();
    var endIso = isoOf(endDate);
    var guard = 0;
    while (isoOf(cursor) <= endIso && guard < 500) {
      var iso = isoOf(cursor);
      var txns = [];
      var planned = events[iso];
      if (planned) {
        txns.push({
          name: planned.name,
          amount: planned.amount,
          note: planned.note,
          hypothetical: false,
        });
      }
      if (extra && extra.iso === iso && extra.amount > 0) {
        txns.push({
          name: "Hypothetical expense",
          amount: -extra.amount,
          note: "Demo only. Not saved.",
          hypothetical: true,
        });
      }
      var net = 0;
      txns.forEach(function (txn) {
        net += txn.amount;
      });
      var start = carry;
      var projected = Math.round((start + net) * 100) / 100;
      var sampleVerified = iso === adjustedIso;
      var demoVerified = reconciled && iso === demoIso;
      var verified = sampleVerified || demoVerified;
      var end = sampleVerified ? ADJUSTED_BANK : demoVerified ? DEMO_BANK : projected;
      days.push({
        day: cursor.getDate(),
        date: cursor,
        iso: iso,
        start: start,
        end: end,
        projected: projected,
        verified: verified,
        reconciled: iso === reconciledIso && !verified,
        opening: iso === openingIso,
        net: net,
        txns: txns,
      });
      carry = end;
      cursor = addDays(cursor, 1);
      guard += 1;
    }
    return days;
  }

  function sliceDays(startDate, endDate) {
    var startIso = isoOf(startDate);
    var endIso = isoOf(endDate);
    return walkThrough(endDate).filter(function (day) {
      return day.iso >= startIso && day.iso <= endIso;
    });
  }

  function summarize(days) {
    var low = { end: Infinity, day: 1, date: days.length ? days[0].date : todayDate, iso: "" };
    var income = 0;
    var expense = 0;
    days.forEach(function (day) {
      day.txns.forEach(function (txn) {
        if (txn.amount >= 0) income += txn.amount;
        else expense += Math.abs(txn.amount);
      });
      if (day.end < low.end) low = { end: day.end, day: day.day, date: day.date, iso: day.iso };
    });
    days.forEach(function (day) {
      day.monthLow = day.iso === low.iso;
    });
    return { days: days, low: low, income: income, expense: expense, net: income - expense };
  }

  function project() {
    if (showAgenda()) {
      return summarize(sliceDays(todayDate, addDays(todayDate, 13)));
    }
    var count = daysInMonth(year, monthIndex);
    return summarize(sliceDays(new Date(year, monthIndex, 1), new Date(year, monthIndex, count)));
  }

  function demoDay() {
    var iso = isoOf(addDays(todayDate, DEMO_OFFSET));
    var found = null;
    walkThrough(addDays(todayDate, 21)).forEach(function (day) {
      if (day.iso === iso) found = day;
    });
    return found;
  }

  function groupsFor(day) {
    var groups = ["balances"];
    var lowIso = isoOf(addDays(todayDate, LOW_OFFSET));
    var payIso = isoOf(addDays(todayDate, PAY_OFFSET));
    if (day.opening) groups.push("start");
    if (day.iso < payIso && day.txns.some(function (txn) { return txn.amount < 0 && !txn.hypothetical; })) groups.push("upcoming");
    if (day.iso === lowIso) groups.push("pressure");
    if (day.iso === payIso) groups.push("move");
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
    else if (day.reconciled) classes.push("cal-cell--reconciled");
    if (risk) classes.push("cal-cell--bal-risk");
    else if (below) {
      classes.push("cal-cell--bal-warn");
      if (day.monthLow) classes.push("cal-cell--bal-low");
    }
    else if (!isPast && day.end < BUFFER * 1.25) classes.push("cal-cell--bal-watch");
    if (day.iso === selectedIso) classes.push("preview-cell--selected");
    var mobile = day.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
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
      if (day.monthLow) balClass += " cal-balance--month-low";
      if (isPast) balClass += " cal-balance--past-day";
      icon = warnIcon(true);
    } else if (isPast) balClass += " cal-balance--quiet cal-balance--past-day";
    else if (day.net >= 3200) balClass += " cal-balance--strong-inflow";
    else balClass += " cal-balance--quiet";
    var pills = "";
    if (day.verified) {
      pills +=
        '<span class="cal-balance-status-pill cal-balance-status-pill--adjusted"><span class="cal-balance-status-pill__icon" aria-hidden="true">↺</span> Adjusted</span>';
    }
    if (day.reconciled) {
      pills +=
        '<span class="cal-balance-status-pill cal-balance-status-pill--reconciled"><span class="cal-balance-status-pill__icon" aria-hidden="true">✓</span> Reconciled</span>';
    }
    if (!pills && day.opening) {
      pills =
        '<span class="cal-balance-status-pill cal-balance-status-pill--starting"><span class="cal-balance-status-pill__icon" aria-hidden="true">●</span> Starting Point</span>';
    }
    var pill = pills
      ? '<span class="cal-balance-status-pills">' + pills + "</span>"
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
      groupsFor(day) +
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
    var agenda = showAgenda();
    var narrow = agenda || phoneLayout();
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
    var cells = [];
    if (!agenda) {
      var blanks = new Date(year, monthIndex, 1).getDay();
      var i;
      for (i = 0; i < blanks; i += 1) cells.push(outCell(new Date(year, monthIndex, i - blanks + 1), narrow));
    }
    model.days.forEach(function (day) {
      cells.push(cellHtml(day, narrow));
    });
    if (!agenda) {
      while (cells.length % 7 !== 0) {
        var nextDay = cells.length - blanks + 1;
        cells.push(outCell(new Date(year, monthIndex, nextDay), narrow));
      }
    }
    root.innerHTML = cells.join("");
    root.className = narrow ? "calendar calendar--mobile" : "calendar";
    if (agenda) root.className += " preview-calendar--agenda";
    root.setAttribute(
      "aria-label",
      agenda
        ? "Fictional checking forecast for the next 14 days"
        : "Fictional checking forecast for " +
          new Date(year, monthIndex, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    );
    var agendaBtn = document.getElementById("previewShowAgenda");
    var monthBtn = document.getElementById("previewShowMonth");
    if (agendaBtn && monthBtn) {
      agendaBtn.setAttribute("aria-pressed", agenda ? "true" : "false");
      monthBtn.setAttribute("aria-pressed", agenda ? "false" : "true");
    }
  }

  function warnMark() {
    return (
      '<span class="cash-outlook-icon cash-outlook-icon--warn" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 2 21h20L12 3z"></path><path d="M12 9v5"></path><path d="M12 17h.01"></path></svg></span>'
    );
  }

  function renderCashHealth(model) {
    var banner = document.getElementById("sidebarLowBalanceBanner");
    var when = model.low.date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    var gap = Math.abs(Math.round((model.low.end - BUFFER) * 100) / 100);
    if (model.low.end < BUFFER) {
      banner.className = "calendar-low-balance calendar-low-balance--sidebar calendar-low-balance--inset is-danger";
      banner.innerHTML =
        '<div class="preview-cash">' +
        warnMark() +
        '<div class="preview-cash__body">' +
        '<p class="preview-cash__gap" id="previewCashWarning">Your forecast drops to <strong id="previewLowBalance">' +
        wholeMoney(model.low.end) +
        '</strong> on <span id="previewCashDate">' +
        escapeHtml(when) +
        '</span> — <span id="previewBufferGap">' +
        wholeMoney(gap) +
        " below your " +
        wholeMoney(BUFFER) +
        " safety cushion.</span></p>" +
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
    document.getElementById("previewMonthLabel").textContent = showAgenda()
      ? "Next 14 days"
      : new Date(year, monthIndex, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
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
    document.getElementById("previewDetailTitle").textContent = day.date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
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

  function renderReconcile() {
    var anchor = demoDay();
    var projected = anchor ? anchor.projected : DEMO_BANK;
    var when = addDays(todayDate, DEMO_OFFSET).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    });
    document.getElementById("previewReconcileLead").textContent =
      "Fictional example for " + when + ". This is not your bank balance.";
    document.getElementById("previewReconcileForecast").textContent = wholeMoney(projected);
    document.getElementById("previewReconcileBank").textContent = wholeMoney(DEMO_BANK);
    document.getElementById("previewReconcileDiff").textContent = signedMoney(DEMO_BANK - projected);
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
    renderReconcile();
    renderCalendar(model);
    renderDetail(model);
    syncChrome();
    if (open && dialog && stepIndex >= 0 && stepIndex < STEPS.length && STEPS[stepIndex].spot) {
      var nodes = spot(STEPS[stepIndex].spot);
      placeDialog(nodes);
      keepSpotVisible(nodes);
    } else if (open && dialog) {
      clearSpot();
      placeDialog([]);
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
    var current = Number(select.value || lowDate.getDate());
    var label = new Date(year, monthIndex, 1).toLocaleDateString("en-US", { month: "long" });
    var html = "";
    var day;
    for (day = 1; day <= count; day += 1) html += '<option value="' + day + '">' + label + " " + day + "</option>";
    select.innerHTML = html;
    if (lowDate.getFullYear() === year && lowDate.getMonth() === monthIndex) current = lowDate.getDate();
    else if (current < 1 || current > count) current = 1;
    select.value = String(current);
  }

  function readExtra() {
    var amount = parseAmount(document.getElementById("previewExpenseAmount").value);
    var day = Number(document.getElementById("previewExpenseDay").value);
    if (amount <= 0) return null;
    return { iso: isoFor(year, monthIndex, day), amount: amount };
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
      '<div class="bw-tour-tooltip__arrow" data-side="left" hidden aria-hidden="true"></div>' +
      '<div class="bw-tour-tooltip__head"><span class="bw-tour-tooltip__counter" id="previewTourCounter">1 of 5</span><button type="button" class="bw-tour-tooltip__close" id="previewTourClose" aria-label="Close walkthrough">×</button></div>' +
      '<h2 class="bw-tour-tooltip__title" id="previewTourTitle"></h2><p class="bw-tour-tooltip__body" id="previewTourBody"></p>' +
      '<p class="preview-finale-note" id="previewTourNote" hidden>Free for 14 days · No bank connection required</p>' +
      '<div class="bw-tour-tooltip__actions"><button type="button" class="bw-tour-tooltip__skip preview-back" id="previewTourBack">Back</button>' +
      '<button type="button" class="bw-tour-tooltip__cta" id="previewTourNext">Next</button>' +
      '<a class="bw-tour-tooltip__cta preview-tour-link" id="previewTourStart" href="/account-setup/?fresh=1" hidden>Start my free forecast</a></div>' +
      '<button type="button" class="bw-tour-tooltip__skip" id="previewTourContinue" hidden>Continue exploring</button>';
    document.body.appendChild(dialog);
    document.getElementById("previewTourClose").addEventListener("click", closeTour);
    document.getElementById("previewTourBack").addEventListener("click", function () {
      if (stepIndex > 0) showStep(stepIndex - 1);
    });
    document.getElementById("previewTourNext").addEventListener("click", function () {
      if (stepIndex < STEPS.length - 1) showStep(stepIndex + 1);
    });
    document.getElementById("previewTourContinue").addEventListener("click", closeTour);
    applySampleSignupLinks();
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

  function stickyFloor() {
    var floor = 12;
    [".top-nav", ".preview-mode"].forEach(function (selector) {
      var el = document.querySelector(selector);
      if (!el) return;
      var pos = window.getComputedStyle(el).position;
      if (pos !== "fixed" && pos !== "sticky") return;
      floor = Math.max(floor, el.getBoundingClientRect().bottom + 8);
    });
    return floor;
  }

  function keepSpotVisible(nodes) {
    if (!nodes || !nodes.length) return;
    var rect = nodes[0].getBoundingClientRect();
    var floor = stickyFloor();
    var delta = 0;
    if (rect.top < floor) delta = rect.top - floor;
    else if (rect.bottom > window.innerHeight - 12) delta = Math.min(rect.bottom - (window.innerHeight - 12), rect.top - floor);
    if (Math.abs(delta) > 2) window.scrollBy(0, delta);
  }

  function placeDialog(nodes) {
    var card = ensureDialog();
    card.classList.add("bw-tour-tooltip--open");
    card.style.position = "fixed";
    card.style.bottom = "auto";
    card.style.boxSizing = "border-box";
    var margin = 12;
    var gap = 16;
    var available = Math.max(160, window.innerWidth - margin * 2);
    var cap = Math.min(460, available);
    var floor = Math.min(420, cap);
    card.style.width = cap + "px";
    var copy = document.getElementById("previewTourBody");
    var natural = cap;
    if (copy) {
      var previousSpace = copy.style.whiteSpace;
      copy.style.whiteSpace = "nowrap";
      natural = Math.ceil(copy.scrollWidth + 40);
      copy.style.whiteSpace = previousSpace;
    }
    var width = Math.max(floor, Math.min(cap, natural));
    card.style.width = width + "px";
    var cardHeight = card.offsetHeight || 220;
    var minTop = stickyFloor();
    var maxTop = Math.max(minTop, window.innerHeight - cardHeight - margin);
    var maxLeft = Math.max(margin, window.innerWidth - width - margin);
    var target = nodes && nodes.length ? nodes[0].getBoundingClientRect() : null;
    var arrow = card.querySelector(".bw-tour-tooltip__arrow");

    function clamp(value, min, max) {
      if (max < min) return min;
      return Math.max(min, Math.min(value, max));
    }
    function pointArrow(side, top, left) {
      if (!arrow) return;
      arrow.hidden = !side;
      arrow.style.top = "";
      arrow.style.left = "";
      if (!side || !target) return;
      arrow.dataset.side = side;
      if (side === "left" || side === "right") {
        var anchorY = target.top + Math.min(Math.max(28, target.height / 2), 72);
        arrow.style.top = Math.round(clamp(anchorY - top, 22, cardHeight - 22)) + "px";
      } else {
        var anchorX = target.left + Math.min(target.width / 2, 72);
        arrow.style.left = Math.round(clamp(anchorX - left, 22, width - 22)) + "px";
      }
    }

    var top;
    var left;
    var side = "";
    if (!target || target.width < 2 || target.height < 2) {
      top = clamp((window.innerHeight - cardHeight) / 2, minTop, maxTop);
      left = clamp((window.innerWidth - width) / 2, margin, maxLeft);
    } else if (stepIndex === 0) {
      var inset = 16;
      var fitWidth = Math.min(width, Math.max(200, target.right - margin) - (target.left + inset));
      if (fitWidth >= 200 && fitWidth < width - 1) {
        width = fitWidth;
        card.style.width = width + "px";
        cardHeight = card.offsetHeight || cardHeight;
        maxTop = Math.max(minTop, window.innerHeight - cardHeight - margin);
        maxLeft = Math.max(margin, window.innerWidth - width - margin);
      }
      top = clamp(target.top + inset, minTop, maxTop);
      left = clamp(target.left + inset, margin, maxLeft);
      side = "bottom";
    } else {
      var rightLeft = target.right + gap;
      if (rightLeft + width <= window.innerWidth - margin) {
        var aligned = target.height > cardHeight ? target.top : target.top + (target.height - cardHeight) / 2;
        top = clamp(aligned, minTop, maxTop);
        left = rightLeft;
        side = "left";
      } else {
        var spaceBelow = window.innerHeight - margin - target.bottom - gap;
        var spaceAbove = target.top - gap - minTop;
        if (spaceBelow < cardHeight && spaceAbove < cardHeight) {
          var room = Math.max(0, target.top - minTop);
          var shift = Math.min(room, cardHeight - spaceBelow);
          if (shift > 2) {
            window.scrollBy(0, shift);
            target = nodes[0].getBoundingClientRect();
            spaceBelow = window.innerHeight - margin - target.bottom - gap;
            spaceAbove = target.top - gap - minTop;
          }
        }
        left = clamp(Math.min(target.left, target.right - width), margin, maxLeft);
        if (spaceBelow >= cardHeight || spaceBelow >= spaceAbove) {
          top = clamp(target.bottom + gap, minTop, maxTop);
          side = "top";
        } else {
          top = clamp(target.top - cardHeight - gap, minTop, maxTop);
          side = "bottom";
        }
      }
    }
    card.style.left = Math.round(left) + "px";
    card.style.top = Math.round(top) + "px";
    pointArrow(side, top, left);
  }

  var panelsBeforeTour = null;

  function rememberPanels() {
    if (panelsBeforeTour) return;
    panelsBeforeTour = {
      reconcile: document.getElementById("previewReconcile").open,
      explore: document.getElementById("previewExplore").open,
    };
  }

  function syncTourPanels(step) {
    var which = step && step.openPanel;
    document.getElementById("previewReconcile").open = which === "reconcile";
    document.getElementById("previewExplore").open = which === "explore";
  }

  function restorePanels() {
    var reconcile = document.getElementById("previewReconcile");
    var explore = document.getElementById("previewExplore");
    if (panelsBeforeTour) {
      reconcile.open = panelsBeforeTour.reconcile;
      explore.open = panelsBeforeTour.explore;
    } else {
      reconcile.open = false;
      explore.open = false;
    }
    panelsBeforeTour = null;
  }

  function sampleSignupTarget() {
    if (document.documentElement.getAttribute("data-bw-home-auth") === "in") {
      return { href: "/calendar/", label: "Go to my forecast" };
    }
    return { href: "/account-setup/?fresh=1", label: "Start my free forecast" };
  }

  function applySampleSignupLinks() {
    var target = sampleSignupTarget();
    ["previewSignup", "previewTourStart"].forEach(function (id) {
      var link = document.getElementById(id);
      if (!link) return;
      link.setAttribute("href", target.href);
      link.textContent = target.label;
    });
  }

  function showStep(index) {
    if (index < 0 || index >= STEPS.length) return;
    stepIndex = index;
    open = true;
    rememberPanels();
    var step = STEPS[index];
    var signup = !!step.signup;
    syncTourPanels(step);
    var nodes = step.spot ? spot(step.spot) : [];
    if (!step.spot) clearSpot();
    var counter = document.getElementById("previewTourCounter");
    var title = document.getElementById("previewTourTitle");
    var body = document.getElementById("previewTourBody");
    var note = document.getElementById("previewTourNote");
    var back = document.getElementById("previewTourBack");
    var next = document.getElementById("previewTourNext");
    var start = document.getElementById("previewTourStart");
    var continueBtn = document.getElementById("previewTourContinue");
    counter.hidden = false;
    counter.textContent = index + 1 + " of " + STEPS.length;
    title.textContent = step.title;
    body.textContent = step.body;
    note.hidden = !signup;
    next.hidden = signup;
    next.textContent = "Next";
    start.hidden = !signup;
    continueBtn.hidden = !signup;
    back.hidden = index === 0;
    if (signup) applySampleSignupLinks();
    keepSpotVisible(nodes);
    placeDialog(nodes);
    window.setTimeout(function () {
      if (!open || stepIndex !== index) return;
      var placed = step.spot ? Array.prototype.slice.call(document.querySelectorAll(step.spot)) : [];
      keepSpotVisible(placed);
      placeDialog(placed);
      var focusTarget = signup ? start : next;
      if (focusTarget && !focusTarget.hidden) focusTarget.focus();
    }, 0);
  }

  function closeTour() {
    open = false;
    clearSpot();
    restorePanels();
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
    if (event.key === "ArrowRight" && stepIndex < STEPS.length - 1) {
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
  document.getElementById("previewShowAgenda").addEventListener("click", function () {
    rangeMode = "agenda";
    renderAll();
  });
  document.getElementById("previewShowMonth").addEventListener("click", function () {
    rangeMode = "month";
    renderAll();
  });
  window.addEventListener("resize", function () {
    renderAll();
    if (!open || stepIndex < 0 || stepIndex >= STEPS.length) return;
    var selector = STEPS[stepIndex].spot;
    var nodes = selector ? Array.prototype.slice.call(document.querySelectorAll(selector)) : [];
    placeDialog(nodes);
    keepSpotVisible(nodes);
  });
  document.addEventListener("keydown", onKey);
  var yearSelect = document.getElementById("calendarYear");
  [todayDate.getFullYear() - 1, todayDate.getFullYear(), todayDate.getFullYear() + 1, lowDate.getFullYear()].forEach(function (value) {
    if (yearSelect.querySelector('option[value="' + value + '"]')) return;
    var opt = document.createElement("option");
    opt.value = String(value);
    opt.textContent = String(value);
    yearSelect.appendChild(opt);
  });
  fillDaySelect();
  renderAll();
  applySampleSignupLinks();
  new MutationObserver(applySampleSignupLinks).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-bw-home-auth"],
  });
})();
