/**
 * Landing hero: 3-day forecast using production cal-cell markup (see renderCalendar in app.js).
 */
(function () {
  var hub = document.getElementById("landingHeroForecast");
  if (!hub) return;

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

  function buildBalanceStrip(bal, opts) {
    opts = opts || {};
    var balParts = ["cal-stat", "cal-balance"];
    var stripCue = "";

    if (opts.watch) {
      balParts.push("cal-balance--watch-zone");
      stripCue = "cal-balance-strip--cue-watch";
    } else if (opts.quiet) {
      balParts.push("cal-balance--quiet");
    }

    var strip = document.createElement("div");
    strip.className = "cal-balance-strip" + (stripCue ? " " + stripCue : "");
    strip.innerHTML =
      '<div class="cal-balance-strip__row">' +
      '<span class="cal-balance-strip__amt">' +
      '<span class="' +
      balParts.join(" ") +
      '" title="Projected end-of-day balance">' +
      fmtBalCell(bal, opts.fullBal) +
      "</span></span></div>";
    return strip;
  }

  /**
   * Build a production cal-cell (same inner structure as renderCalendar).
   */
  function buildCalCell(day) {
    var cell = document.createElement("div");
    cell.className = "cal-cell cal-cell--no-tx";

    if (day.today) cell.classList.add("cal-cell--today");
    if (day.watch) cell.classList.add("cal-cell--bal-watch");

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

    var metricsEl = cell.querySelector(".cal-ledger-metrics");
    metricsEl.appendChild(
      buildBalanceStrip(day.bal, {
        watch: day.watch,
        quiet: !day.watch && !day.today,
        fullBal: day.watch,
      })
    );

    return cell;
  }

  var today = startOfDay(new Date());
  var forecastStart = addDays(today, 2);
  var lowDate = addDays(forecastStart, 2);

  var dayData = [
    { bal: 4280, quiet: true },
    { bal: 3850, quiet: true },
    { bal: 1020, today: true, watch: true },
  ];

  var gridEl = hub.querySelector("#landingHeroCalWeek");
  if (gridEl) {
    gridEl.innerHTML = "";
    for (var i = 0; i < dayData.length; i += 1) {
      var row = dayData[i];
      var date = addDays(forecastStart, i);
      row.label = fmtShort(date);
      gridEl.appendChild(buildCalCell(row));
    }
  }

  var insight = hub.querySelector("#landingHeroAlertCopy");
  if (insight) {
    insight.textContent =
      "Your balance drops to $1,020 on " +
      fmtShort(lowDate) +
      " before your next paycheck puts you back above your target.";
  }
})();
