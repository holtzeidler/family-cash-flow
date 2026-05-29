/**
 * Landing hero forecast story: dates relative to today (bill today+3, paycheck today+4).
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

  var today = startOfDay(new Date());
  var billDate = addDays(today, 3);
  var payDate = addDays(today, 4);

  var billEl = hub.querySelector("#landingHeroBillDate");
  if (billEl) billEl.textContent = fmtShort(billDate);

  var payEl = hub.querySelector("#landingHeroPayDate");
  if (payEl) payEl.textContent = fmtShort(payDate);

  var alertCopy = hub.querySelector("#landingHeroAlertCopy");
  if (alertCopy) {
    alertCopy.textContent =
      "Your balance drops near $1,000 before your next paycheck arrives.";
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
