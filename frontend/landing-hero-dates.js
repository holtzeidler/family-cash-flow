/**
 * Landing hero: vertical focus forecast — one clear "today" moment with bill before and paycheck after.
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

  function fmtBal(n) {
    return "$" + n.toLocaleString("en-US");
  }

  var today = startOfDay(new Date());
  var contextDate = addDays(today, -2);
  var billDate = addDays(today, -1);
  var payDate = addDays(today, 1);

  var timelineEl = hub.querySelector("#landingHeroTimeline");
  if (timelineEl) {
    var rows = [
      { type: "context", date: contextDate, balance: 4300 },
      { type: "bill", date: billDate, label: "Credit Card Payment" },
      { type: "today", date: today, balance: 1020 },
      { type: "pay", date: payDate, balance: 3120, label: "Paycheck" },
    ];

    timelineEl.innerHTML = "";
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var el = document.createElement("div");
      el.className = "landing-hero-focus__row landing-hero-focus__row--" + row.type;
      el.setAttribute("role", "listitem");

      var dateCol = document.createElement("div");
      dateCol.className = "landing-hero-focus__dateCol";

      if (row.type === "today") {
        var star = document.createElement("span");
        star.className = "landing-hero-focus__star";
        star.setAttribute("aria-hidden", "true");
        star.textContent = "\u2605";
        dateCol.appendChild(star);

        var todayLbl = document.createElement("span");
        todayLbl.className = "landing-hero-focus__date landing-hero-focus__date--today";
        todayLbl.textContent = "TODAY";
        dateCol.appendChild(todayLbl);
      } else {
        var dateLbl = document.createElement("span");
        dateLbl.className = "landing-hero-focus__date";
        dateLbl.textContent = fmtShort(row.date);
        dateCol.appendChild(dateLbl);
      }

      var body = document.createElement("div");
      body.className = "landing-hero-focus__body";

      if (row.type === "context" || row.type === "pay") {
        var bal = document.createElement("span");
        bal.className = "landing-hero-focus__balance";
        if (row.type === "pay") bal.classList.add("landing-hero-focus__balance--pay");
        bal.textContent = fmtBal(row.balance);
        body.appendChild(bal);
      }

      if (row.type === "bill") {
        var event = document.createElement("span");
        event.className = "landing-hero-focus__event";
        event.textContent = row.label;
        body.appendChild(event);
      }

      if (row.type === "today") {
        var checkLbl = document.createElement("span");
        checkLbl.className = "landing-hero-focus__todayLabel";
        checkLbl.textContent = "Checking Balance";
        body.appendChild(checkLbl);

        var todayBal = document.createElement("span");
        todayBal.className = "landing-hero-focus__balance landing-hero-focus__balance--hero";
        todayBal.textContent = fmtBal(row.balance);
        body.appendChild(todayBal);
      }

      if (row.type === "pay") {
        var payLbl = document.createElement("span");
        payLbl.className = "landing-hero-focus__event landing-hero-focus__event--pay";
        payLbl.textContent = row.label;
        body.insertBefore(payLbl, body.firstChild);
      }

      el.appendChild(dateCol);
      el.appendChild(body);
      timelineEl.appendChild(el);
    }
  }

  var insight = hub.querySelector("#landingHeroAlertCopy");
  if (insight) {
    insight.textContent = "You\u2019re safe after your " + fmtShort(payDate) + " paycheck.";
  }
})();
