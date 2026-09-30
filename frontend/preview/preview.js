/**
 * Public sample forecast. Static fictional data only.
 * Does not load app.js, does not call the API, and does not start the signed-in tour.
 */
(function () {
  "use strict";

  var FLOOR = 1500;
  var DAYS = [
    {
      iso: "2026-10-05",
      dow: "Mon",
      day: 5,
      mobile: "Mon, Oct 5",
      today: true,
      start: true,
      group: "start",
      txns: [],
      end: 4850,
    },
    {
      iso: "2026-10-06",
      dow: "Tue",
      day: 6,
      mobile: "Tue, Oct 6",
      group: "upcoming",
      txns: [{ name: "Mortgage", amount: -2400 }],
      end: 2450,
    },
    {
      iso: "2026-10-07",
      dow: "Wed",
      day: 7,
      mobile: "Wed, Oct 7",
      group: "upcoming balances",
      txns: [{ name: "Credit card", amount: -1100 }],
      end: 1350,
      below: true,
    },
    {
      iso: "2026-10-08",
      dow: "Thu",
      day: 8,
      mobile: "Thu, Oct 8",
      group: "upcoming balances pressure",
      txns: [{ name: "Vacation deposit", amount: -1500 }],
      end: -150,
      risk: true,
    },
    {
      iso: "2026-10-09",
      dow: "Fri",
      day: 9,
      mobile: "Fri, Oct 9",
      group: "upcoming balances move",
      txns: [{ name: "Paycheck", amount: 3200 }],
      end: 3050,
    },
    {
      iso: "2026-10-10",
      dow: "Sat",
      day: 10,
      mobile: "Sat, Oct 10",
      group: "balances",
      txns: [],
      end: 3050,
    },
    {
      iso: "2026-10-11",
      dow: "Sun",
      day: 11,
      mobile: "Sun, Oct 11",
      group: "balances",
      txns: [],
      end: 3050,
    },
  ];

  var STEPS = [
    {
      title: "Start with today’s checking balance",
      body: "Start with what’s actually in checking today.",
      spot: '[data-preview~="start"]',
    },
    {
      title: "Add what you know is coming",
      body: "BalanceWhiz uses the bills, income, and other transactions you already know are coming.",
      spot: '[data-preview~="upcoming"]',
    },
    {
      title: "See the future balance",
      body: "BalanceWhiz projects your checking balance forward day by day.",
      spot: '[data-preview~="balances"]',
    },
    {
      title: "Spot the problem before it happens",
      body: "See cash pressure before it becomes a surprise.",
      spot: '[data-preview~="pressure"]',
    },
    {
      title: "Know when you can make your move",
      body: "See when you have room to spend, save, or move money.",
      spot: '[data-preview~="move"]',
    },
  ];

  var stepIndex = 0;
  var open = false;
  var dialog = null;
  var backdrop = null;
  var lastFocus = null;

  function money(amount) {
    var abs = Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 0 });
    return amount < 0 ? "($" + abs + ")" : "$" + abs;
  }

  function txnMoney(amount) {
    var abs = Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 0 });
    return (amount < 0 ? "-" : "+") + "$" + abs;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cellHtml(day) {
    var classes = ["cal-cell", "cal-cell--density-sparse"];
    if (day.today) classes.push("cal-cell--today");
    if (day.txns.length) classes.push("cal-cell--has-activity");
    else classes.push("cal-cell--no-tx");
    if (day.risk) classes.push("cal-cell--bal-risk");
    else if (day.below) classes.push("cal-cell--bal-warn");
    var groups = day.group || "";
    if (day.group && day.group.indexOf("balances") === -1 && day.end != null) groups += " balances";
    var txns = day.txns
      .map(function (txn) {
        var income = txn.amount > 0;
        return (
          '<div class="cal-day-tx-line cal-day-tx-line--expected cal-day-tx-line--primary ' +
          (income ? "cal-day-tx-line--flow-in" : "cal-day-tx-line--flow-out") +
          '"><span class="cal-tx-label-wrap"><span class="cal-tx-label">' +
          escapeHtml(txn.name) +
          '</span></span><span class="cal-amt ' +
          (income ? "income" : "expense") +
          '">' +
          txnMoney(txn.amount) +
          "</span></div>"
        );
      })
      .join("");
    var balClass = "cal-stat cal-balance";
    if (day.risk) balClass += " is-negative cal-balance--risk";
    else if (day.below) balClass += " cal-balance--below-floor";
    else balClass += " cal-balance--quiet";
    var pill = day.start
      ? '<span class="cal-balance-status-pill cal-balance-status-pill--starting"><span class="cal-balance-status-pill__icon" aria-hidden="true">●</span> Starting Point</span>'
      : "";
    var stripCue = day.risk ? " cal-balance-strip--cue-risk" : day.below ? " cal-balance-strip--cue-warn" : "";
    return (
      '<div class="' +
      classes.join(" ") +
      '" data-iso="' +
      day.iso +
      '" data-preview="' +
      escapeHtml(groups.trim()) +
      '"><div class="cal-daynum" data-mobile-label="' +
      escapeHtml(day.mobile) +
      '"><span class="cal-daynum-num' +
      (day.today ? " is-today" : "") +
      '">' +
      day.day +
      '</span></div><div class="cal-cell-fill"></div><div class="cal-cell-stack"><div class="cal-day-txns">' +
      txns +
      '</div><div class="cal-ledger-metrics"><div class="cal-balance-strip' +
      (pill ? " cal-balance-strip--has-status" : "") +
      stripCue +
      '"><div class="cal-balance-strip__row"><span class="cal-balance-strip__amt"><span class="' +
      balClass +
      '">' +
      money(day.end) +
      "</span></span>" +
      pill +
      "</div></div></div></div></div>"
    );
  }

  function renderCalendar() {
    var root = document.getElementById("preview-calendar");
    root.innerHTML = DAYS.map(cellHtml).join("");
    syncMobileLayout();
  }

  function syncMobileLayout() {
    var narrow = window.matchMedia("(max-width: 768px)").matches;
    document.getElementById("preview-calendar").classList.toggle("calendar--mobile", narrow);
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
      '<div class="bw-tour-tooltip__head">' +
      '<span class="bw-tour-tooltip__counter" id="previewTourCounter">1 of 5</span>' +
      '<button type="button" class="bw-tour-tooltip__close" id="previewTourClose" aria-label="Close walkthrough">×</button>' +
      "</div>" +
      '<h2 class="bw-tour-tooltip__title" id="previewTourTitle"></h2>' +
      '<p class="bw-tour-tooltip__body" id="previewTourBody"></p>' +
      '<p class="preview-finale-note" id="previewTourNote" hidden>Free for 14 days · No bank connection required</p>' +
      '<div class="bw-tour-tooltip__actions">' +
      '<button type="button" class="bw-tour-tooltip__skip preview-back" id="previewTourBack">Back</button>' +
      '<button type="button" class="bw-tour-tooltip__cta" id="previewTourNext">Next</button>' +
      '<a class="bw-tour-tooltip__cta preview-tour-link" id="previewTourStart" href="/account-setup/?fresh=1" hidden>Start my free trial</a>' +
      "</div>" +
      '<a class="bw-tour-tooltip__skip" id="previewTourFaq" href="/help.html" hidden>Back to FAQ</a>';
    document.body.appendChild(dialog);
    document.getElementById("previewTourClose").addEventListener("click", closeTour);
    document.getElementById("previewTourBack").addEventListener("click", function () {
      showStep(stepIndex - 1);
    });
    document.getElementById("previewTourNext").addEventListener("click", function () {
      showStep(stepIndex + 1);
    });
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
      var z = el.style.zIndex;
      var pos = el.style.position;
      el.dataset.previewZ = z === "" ? "__unset" : z;
      el.dataset.previewPos = pos === "" ? "__unset" : pos;
      if (window.getComputedStyle(el).position === "static") el.style.position = "relative";
      el.style.zIndex = "9991";
      el.classList.add("bw-tour-target");
    });
    if (nodes[0] && typeof nodes[0].scrollIntoView === "function") {
      nodes[0].scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    return nodes;
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
      card.style.bottom = margin + "px";
      return;
    }
    card.style.bottom = "auto";
    var rect = nodes[0].getBoundingClientRect();
    var top = rect.bottom + 10;
    if (top + card.offsetHeight > window.innerHeight - margin) top = Math.max(margin, rect.top - card.offsetHeight - 10);
    var left = rect.left;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
    card.style.left = Math.max(margin, left) + "px";
    card.style.top = Math.max(margin, top) + "px";
  }

  function showStep(index) {
    stepIndex = index;
    open = true;
    document.getElementById("previewReplay").hidden = true;
    var finale = index >= STEPS.length;
    var step = finale ? null : STEPS[index];
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
      back.textContent = "Back";
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
      back.textContent = "Back";
    }
    placeDialog(nodes);
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
    document.getElementById("previewReplay").hidden = false;
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
    var items = Array.prototype.slice
      .call(dialog.querySelectorAll("button, a"))
      .filter(function (el) {
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

  function trapBackdrop() {
    backdrop = document.createElement("div");
    backdrop.className = "bw-tour-backdrop";
    backdrop.style.zIndex = "9990";
    backdrop.setAttribute("aria-hidden", "true");
    document.body.appendChild(backdrop);
  }

  renderCalendar();
  trapBackdrop();
  document.getElementById("previewReplay").addEventListener("click", openTour);
  window.addEventListener("resize", function () {
    syncMobileLayout();
    if (!open) return;
    var nodes = stepIndex >= STEPS.length ? [] : Array.prototype.slice.call(document.querySelectorAll(STEPS[stepIndex].spot));
    placeDialog(nodes);
  });
  document.addEventListener("keydown", onKey);
  openTour();
})();
