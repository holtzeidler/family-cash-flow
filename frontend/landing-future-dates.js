/**
 * Landing future planning: monthly milestone tiles (60–90 day outlook).
 */
(function () {
  var section = document.getElementById("landingFutureSection");
  if (!section) return;

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addMonths(d, n) {
    return new Date(d.getFullYear(), d.getMonth() + n, 1);
  }

  function fmtMonth(d) {
    return d.toLocaleDateString(undefined, { month: "short" });
  }

  function fmtBal(n) {
    if (n < 1000) return "$" + n.toLocaleString("en-US");
    if (n >= 10000) return "$" + Math.round(n / 1000) + "k";
    var k = Math.round(n / 100) / 10;
    return "$" + (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + "k";
  }

  var today = startOfDay(new Date());
  var monthData = [
    { bal: 4800 },
    { bal: 1140, watch: true },
    { bal: 3200 },
    { bal: 4600 },
  ];

  var monthEl = section.querySelector("#landingFutureMonths");
  if (monthEl) {
    monthEl.innerHTML = "";
    for (var i = 0; i < monthData.length; i += 1) {
      var row = monthData[i];
      var date = addMonths(today, i);
      var cell = document.createElement("div");
      cell.className = "landing-hero-viz__cell landing-future-viz__month";
      cell.setAttribute("role", "listitem");
      if (row.watch) cell.classList.add("landing-hero-viz__cell--watch");

      var label = document.createElement("span");
      label.className = "landing-hero-viz__d";
      label.textContent = fmtMonth(date);

      var bal = document.createElement("span");
      bal.className = "landing-hero-viz__b";
      bal.textContent = fmtBal(row.bal);

      cell.appendChild(label);
      cell.appendChild(bal);
      monthEl.appendChild(cell);
    }
  }

  var crunchLabel = section.querySelector("#landingFutureCrunchLabel");
  if (crunchLabel) {
    crunchLabel.textContent = "Property tax payment due Jul 15";
  }

  var insight = section.querySelector("#landingFutureInsightCopy");
  if (insight) {
    insight.textContent = "Property taxes bring your balance within $140 of your safety buffer.";
  }

  var chartLabel = section.querySelector("#landingFutureCrunchChartLabel");
  if (chartLabel) chartLabel.textContent = "Property tax";

  var endLabel = section.querySelector(".landing-future-viz__label--end");
  if (endLabel) endLabel.textContent = fmtMonth(addMonths(today, 3));
})();
