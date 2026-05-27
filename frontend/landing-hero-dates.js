/**
 * Landing hero forecast demo: dates always relative to today.
 * Card payment today+3, paycheck today+4; calendar week aligned to real weekdays.
 */
(function () {
  var hub = document.getElementById("landingHeroForecast");
  if (!hub) return;

  var COL_X = [10, 74, 138, 202, 266, 330, 394];
  var CELL_W = 58;
  var CELL_H = 48;
  var TEXT_DX = 6;
  var BALANCES = [4280, 3910, 2240, 1020, 3050, 2680, 2310];
  var SVG_NS = "http://www.w3.org/2000/svg";

  function startOfDay(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function addDays(d, n) {
    return startOfDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  }

  function fmtMonthYear(d) {
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  function fmtShort(d) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function fmtMoney(n) {
    return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        el.setAttribute(k, attrs[k]);
      });
    }
    return el;
  }

  function svgText(x, y, text, extra) {
    var t = svgEl("text", Object.assign({ x: String(x), y: String(y) }, extra || {}));
    t.textContent = text;
    return t;
  }

  var today = startOfDay(new Date());
  var watchDate = addDays(today, 3);
  var payDate = addDays(today, 4);
  var storyStart = addDays(watchDate, -3);

  var monthEl = hub.querySelector(".landing-cal-peek__month");
  if (monthEl) monthEl.textContent = fmtMonthYear(watchDate);

  var daysG = hub.querySelector(".landing-hero-forecast__days");
  if (daysG) {
    daysG.innerHTML = "";
    for (var i = 0; i < 7; i += 1) {
      var d = addDays(storyStart, i);
      var col = d.getDay();
      var x = COL_X[col];
      var isWatch = d.getTime() === watchDate.getTime();
      var isPay = d.getTime() === payDate.getTime();
      var cls = "landing-hero-forecast__day";
      if (isWatch) cls += " landing-hero-forecast__day--watch";
      if (isPay) cls += " landing-hero-forecast__day--paycheck";

      var g = svgEl("g", { class: cls, "data-landing-offset": String(i - 3) });
      g.appendChild(
        svgEl("rect", {
          x: String(x),
          y: "40",
          width: String(CELL_W),
          height: String(CELL_H),
          rx: "7",
          fill: "url(#landingCalCell)",
          stroke: "rgba(11,61,46,0.11)",
        })
      );
      g.appendChild(
        svgText(x + TEXT_DX, 56, String(d.getDate()), {
          fill: "rgba(55,65,60,0.58)",
          "font-size": "9.5",
          "font-weight": "600",
        })
      );
      g.appendChild(
        svgText(x + TEXT_DX, 74, fmtMoney(BALANCES[i]), {
          fill: "rgba(11,61,46,0.94)",
          "font-size": "10.5",
          "font-weight": "700",
        })
      );
      if (isWatch) {
        g.appendChild(
          svgText(x + TEXT_DX, 86, "Watch", {
            class: "landing-hero-forecast__dayTag",
            fill: "rgba(146,72,18,0.72)",
            "font-size": "6.5",
            "font-weight": "600",
          })
        );
      }
      if (isPay) {
        g.appendChild(
          svgText(x + TEXT_DX, 86, "\u2191 Paycheck", {
            class: "landing-hero-forecast__dayTag landing-hero-forecast__dayTag--pay",
            fill: "rgba(4,120,87,0.82)",
            "font-size": "6.5",
            "font-weight": "700",
          })
        );
      }
      daysG.appendChild(g);
    }
  }

  var txnCard = hub.querySelector("#landingHeroTxnCard");
  if (txnCard) txnCard.textContent = "Credit card payment \u00b7 " + fmtShort(watchDate);

  var txnPay = hub.querySelector("#landingHeroTxnPaycheck");
  if (txnPay) txnPay.textContent = "Paycheck clears \u00b7 " + fmtShort(payDate);

  var alertCopy = hub.querySelector("#landingHeroAlertCopy");
  if (alertCopy) {
    alertCopy.textContent =
      "Your balance drops near $1,000 after a large card payment on " + fmtShort(watchDate) + ".";
  }

  var reconciled = document.querySelector("#landingPreviewReconciled");
  if (reconciled) reconciled.textContent = "Forecast reconciled through " + fmtShort(storyStart);

  var billList = document.querySelector("#landingPreviewBillList");
  if (billList) {
    var billOffsets = [-2, -1, 0, 2, 4];
    var items = billList.querySelectorAll("li");
    for (var b = 0; b < items.length && b < billOffsets.length; b += 1) {
      var dateSpan = items[b].querySelector("span:last-child");
      if (dateSpan) dateSpan.textContent = fmtShort(addDays(watchDate, billOffsets[b]));
    }
  }
})();
