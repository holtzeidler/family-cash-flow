/**
 * Landing hero: 7-day projected balance calendar with bill/pay markers.
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

  var today = startOfDay(new Date());
  var forecastStart = addDays(today, 1);
  var billDate = addDays(forecastStart, 2);
  var payDate = addDays(forecastStart, 3);

  var dayData = [
    { bal: 4280 },
    { bal: 4100 },
    { bal: 3850 },
    { bal: 1020, watch: true, bill: true },
    { bal: 3050, pay: true },
    { bal: 2890 },
    { bal: 2720 },
  ];

  var weekEl = hub.querySelector("#landingHeroCalWeek");
  if (weekEl) {
    weekEl.innerHTML = "";
    for (var i = 0; i < dayData.length; i += 1) {
      var row = dayData[i];
      var date = addDays(forecastStart, i);
      var cell = document.createElement("div");
      cell.className = "landing-hero-viz__cell";
      cell.setAttribute("role", "listitem");
      if (row.watch) cell.classList.add("landing-hero-viz__cell--watch");
      if (row.pay) cell.classList.add("landing-hero-viz__cell--pay");
      if (row.bill) cell.classList.add("landing-hero-viz__cell--bill");

      var dayNum = document.createElement("span");
      dayNum.className = "landing-hero-viz__d";
      dayNum.textContent = fmtShort(date);

      var bal = document.createElement("span");
      bal.className = "landing-hero-viz__b";
      bal.textContent = fmtBalCell(row.bal, row.watch);

      cell.appendChild(dayNum);
      cell.appendChild(bal);

      if (row.watch) {
        var tag = document.createElement("span");
        tag.className = "landing-hero-viz__tag";
        tag.setAttribute("aria-hidden", "true");
        tag.textContent = "\u26A0";
        cell.appendChild(tag);
      } else if (row.pay) {
        var payTag = document.createElement("span");
        payTag.className = "landing-hero-viz__tag landing-hero-viz__tag--pay";
        payTag.setAttribute("aria-hidden", "true");
        payTag.textContent = "Pay";
        cell.appendChild(payTag);
      }

      weekEl.appendChild(cell);
    }
  }

  var billLabel = hub.querySelector("#landingHeroBillLabel");
  if (billLabel) billLabel.textContent = "Credit card \u00B7 " + fmtShort(billDate);

  var payLabel = hub.querySelector("#landingHeroPayLabel");
  if (payLabel) payLabel.textContent = "Paycheck \u00B7 " + fmtShort(payDate);

  var insight = hub.querySelector("#landingHeroAlertCopy");
  if (insight) {
    insight.textContent =
      "Consider waiting until after your " + fmtShort(payDate) + " paycheck before moving extra cash.";
  }

  var reconciled = document.querySelector("#landingPreviewReconciled");
  if (reconciled) reconciled.textContent = "Forecast reconciled through " + fmtShort(today);

  var billList = document.querySelector("#landingPreviewBillList");
  if (billList) {
    var billOffsets = [-2, -1, 0, 2, 4];
    var items = billList.querySelectorAll("li");
    for (var b = 0; b < items.length && b < billOffsets.length; b += 1) {
      var dateSpan = items[b].querySelector("span:last-child");
      if (dateSpan) dateSpan.textContent = fmtShort(addDays(billDate, billOffsets[b]));
    }
  }
})();
