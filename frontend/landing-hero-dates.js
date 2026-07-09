/**
 * Landing hero: 5-day forecast using production cal-cell markup (see renderCalendar in app.js).
 */
(function () {
  var hub = document.getElementById("landingHeroForecast");
  if (!hub) return;

  function fmtMoney0(n) {
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtSignedTxAmount(tx) {
    var amt = fmtMoney0(tx.amount);
    if (tx.kind === "income") return "+$" + amt;
    if (tx.kind === "expense") return "-$" + amt;
    return "$" + amt;
  }

  /** Mirrors applyCalendarDayTxCategoryFill — category fill on label column only. */
  function applyTxCategoryFill(labelWrap, tx) {
    if (!labelWrap || !tx || !tx.bg) return;
    labelWrap.classList.add("cal-tx-label-wrap--category-fill");
    labelWrap.style.setProperty("--cal-tx-fill-bg", tx.bg);
    labelWrap.style.setProperty("--cal-tx-fill-fg", tx.fg || "#1f2937");
  }

  function buildTxLine(tx) {
    var line = document.createElement("div");
    line.className = tx.expected
      ? "cal-day-tx-line cal-day-tx-line--expected cal-day-tx-line--primary"
      : "cal-day-tx-line cal-tx-part cal-day-tx-line--primary";
    if (tx.kind === "income") line.classList.add("cal-day-tx-line--flow-in");
    else if (tx.kind === "expense") line.classList.add("cal-day-tx-line--flow-out");

    var labelWrap = document.createElement("span");
    labelWrap.className = "cal-tx-label-wrap";
    var labelSpan = document.createElement("span");
    labelSpan.className = "cal-tx-label";
    labelSpan.textContent = tx.label + " ";
    labelWrap.appendChild(labelSpan);

    var amtSpan = document.createElement("span");
    amtSpan.className = "cal-amt";
    if (tx.kind === "income") amtSpan.classList.add("income");
    else if (tx.kind === "expense") amtSpan.classList.add("expense");
    amtSpan.textContent = fmtSignedTxAmount(tx);

    line.appendChild(labelWrap);
    line.appendChild(amtSpan);
    applyTxCategoryFill(labelWrap, tx);
    return line;
  }

  function buildBalanceStrip(bal, opts) {
    opts = opts || {};
    var balParts = ["cal-stat", "cal-balance"];
    var stripCue = "";

    if (opts.watch) {
      balParts.push("cal-balance--watch-zone");
      stripCue = "cal-balance-strip--cue-watch";
    } else {
      balParts.push("cal-balance--quiet");
    }

    var strip = document.createElement("div");
    strip.className = "cal-balance-strip" + (stripCue ? " " + stripCue : "");
    strip.innerHTML =
      '<div class="cal-balance-strip__row">' +
      '<span class="cal-balance-strip__amt">' +
      '<span class="' +
      balParts.join(" ") +
      '" title="Projected end-of-day balance">$' +
      fmtMoney0(bal) +
      "</span></span></div>";
    return strip;
  }

  /**
   * Build a production cal-cell (same inner structure as renderCalendar).
   */
  function buildCalCell(day) {
    var cell = document.createElement("div");
    cell.className = "cal-cell";

    if (day.today) cell.classList.add("cal-cell--today");
    if (day.watch) cell.classList.add("cal-cell--bal-watch");
    if (day.payday) cell.classList.add("cal-cell--payday");

    var txs = day.txs || [];
    if (txs.length) {
      cell.classList.add("cal-cell--has-activity", "cal-cell--density-sparse");
    } else {
      cell.classList.add("cal-cell--no-tx");
    }

    var dayNumClass = "cal-daynum-num" + (day.today ? " is-today" : "");
    cell.innerHTML =
      '<div class="cal-daynum"><span class="' +
      dayNumClass +
      '">' +
      day.label +
      "</span></div>" +
      '<div class="cal-cell-fill"></div>' +
      '<div class="cal-cell-stack">' +
      '<div class="cal-forecast-note" hidden></div>' +
      '<div class="cal-day-start-balance" hidden></div>' +
      '<div class="cal-day-txns"></div>' +
      '<div class="cal-ledger-metrics"></div>' +
      "</div>";

    var txnsEl = cell.querySelector(".cal-day-txns");
    for (var i = 0; i < txs.length; i += 1) {
      txnsEl.appendChild(buildTxLine(txs[i]));
    }

    var metricsEl = cell.querySelector(".cal-ledger-metrics");
    metricsEl.appendChild(buildBalanceStrip(day.bal, { watch: day.watch }));

    return cell;
  }

  var dayData = [
    { label: "Yesterday", bal: 4280 },
    {
      label: "Today",
      bal: 3850,
      today: true,
      txs: [
        {
          label: "Credit Card",
          amount: 325,
          kind: "expense",
          expected: true,
          bg: "#fde8e8",
          fg: "#7f1d1d",
        },
      ],
    },
    { label: "Tomorrow", bal: 1020, watch: true },
    {
      label: "Fri",
      bal: 3050,
      payday: true,
      txs: [
        {
          label: "Paycheck",
          amount: 2850,
          kind: "income",
          expected: true,
          bg: "#d1fae5",
          fg: "#065f46",
        },
      ],
    },
    { label: "Sat", bal: 2890 },
  ];

  var gridEl = hub.querySelector("#landingHeroCalWeek");
  if (gridEl) {
    gridEl.innerHTML = "";
    for (var d = 0; d < dayData.length; d += 1) {
      gridEl.appendChild(buildCalCell(dayData[d]));
    }
  }

  var insight = hub.querySelector("#landingHeroAlertCopy");
  if (insight) {
    insight.textContent =
      "Your lowest balance is tomorrow. Friday\u2019s paycheck brings you back above your target.";
  }
})();
