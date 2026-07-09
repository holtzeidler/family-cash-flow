/**
 * Landing hero: simplified crop of the Forecast calendar (5-day strip).
 */
(function () {
  var hub = document.getElementById("landingHeroForecast");
  if (!hub) return;

  var EXPENSE_PILL_BG = "#fde8e8";
  var EXPENSE_PILL_FG = "#7f1d1d";
  var INCOME_PILL_BG = "#dcfce7";
  var INCOME_PILL_FG = "#14532d";

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    return startOfDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  }

  function fmtShort(d) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function fmtBalCell(n, full) {
    if (full || n < 1000) {
      return "$" + n.toLocaleString("en-US");
    }
    if (n >= 10000) {
      return "$" + Math.round(n / 1000) + "k";
    }
    var k = Math.round(n / 100) / 10;
    return "$" + (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + "k";
  }

  function makeTxPill(label, kind) {
    var wrap = document.createElement("span");
    wrap.className = "cal-tx-label-wrap cal-tx-label-wrap--category-fill";
    if (kind === "income") {
      wrap.style.setProperty("--cal-tx-fill-bg", INCOME_PILL_BG);
      wrap.style.setProperty("--cal-tx-fill-fg", INCOME_PILL_FG);
    } else {
      wrap.style.setProperty("--cal-tx-fill-bg", EXPENSE_PILL_BG);
      wrap.style.setProperty("--cal-tx-fill-fg", EXPENSE_PILL_FG);
    }
    var lbl = document.createElement("span");
    lbl.className = "cal-tx-label";
    lbl.textContent = label;
    wrap.appendChild(lbl);
    return wrap;
  }

  function makeLegendRow(label, dateText, kind) {
    var row = document.createElement("div");
    row.className = "cal-day-tx-line landing-hero-cal__txLegendRow";
    row.appendChild(makeTxPill(label, kind));
    var date = document.createElement("span");
    date.className = "landing-hero-cal__txDate";
    date.textContent = dateText;
    row.appendChild(date);
    return row;
  }

  var today = startOfDay(new Date());
  var forecastStart = addDays(today, 2);
  var billDate = addDays(forecastStart, 1);
  var payDate = addDays(forecastStart, 3);

  var dayData = [
    { bal: 4280, tone: "muted" },
    { bal: 3850, bill: true, tone: "bill" },
    { bal: 1020, watch: true, tone: "today" },
    { bal: 3050, pay: true, tone: "pay" },
    { bal: 2890, tone: "muted" },
  ];

  var weekEl = hub.querySelector("#landingHeroCalWeek");
  if (weekEl) {
    weekEl.innerHTML = "";
    for (var i = 0; i < dayData.length; i += 1) {
      var row = dayData[i];
      var date = addDays(forecastStart, i);

      var cell = document.createElement("div");
      cell.className = "cal-cell landing-hero-cal__day landing-hero-cal__day--" + row.tone;
      cell.setAttribute("role", "listitem");

      var dayNum = document.createElement("div");
      dayNum.className = "cal-daynum";

      if (row.watch) {
        var todayBadge = document.createElement("span");
        todayBadge.className = "landing-hero-cal__todayBadge";
        todayBadge.textContent = "Today";
        dayNum.appendChild(todayBadge);
      }

      var dayLabel = document.createElement("span");
      dayLabel.className = "cal-daynum-num" + (row.watch ? " is-today" : "");
      dayLabel.textContent = String(date.getDate());
      dayNum.appendChild(dayLabel);
      cell.appendChild(dayNum);

      var stack = document.createElement("div");
      stack.className = "cal-cell-stack";

      var txns = document.createElement("div");
      txns.className = "cal-day-txns";
      if (row.bill || row.pay) {
        var marker = document.createElement("span");
        marker.className =
          "landing-hero-cal__txMarker landing-hero-cal__txMarker--" + (row.bill ? "bill" : "pay");
        marker.setAttribute("aria-hidden", "true");
        txns.appendChild(marker);
      }
      stack.appendChild(txns);

      var metrics = document.createElement("div");
      metrics.className = "cal-ledger-metrics cal-day-balance-hit";

      var bal = document.createElement("span");
      bal.className = "cal-stat cal-balance";
      if (row.watch) bal.classList.add("cal-balance--watch-zone");
      if (row.tone === "muted") bal.classList.add("cal-balance--quiet");
      bal.textContent = fmtBalCell(row.bal, row.watch);
      metrics.appendChild(bal);
      stack.appendChild(metrics);

      cell.appendChild(stack);
      weekEl.appendChild(cell);
    }
  }

  var legendEl = hub.querySelector("#landingHeroTxLegend");
  if (legendEl) {
    legendEl.innerHTML = "";
    legendEl.appendChild(makeLegendRow("Credit Card", fmtShort(billDate), "expense"));
    legendEl.appendChild(makeLegendRow("Paycheck", fmtShort(payDate), "income"));
  }

  var insight = hub.querySelector("#landingHeroAlertCopy");
  if (insight) {
    insight.textContent = "You\u2019re safe after your " + fmtShort(payDate) + " paycheck.";
  }
})();
