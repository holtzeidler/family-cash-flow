/**
 * Seven-day public sample. Fictional numbers only, drawn in the browser.
 * Does not load app.js and does not write a forecast.
 */
(function () {
  "use strict";

  var FLOOR = 1500;
  var STORY = [
    { group: "start", txns: [], end: 4850 },
    { group: "upcoming", txns: [{ name: "Mortgage", amount: -2400 }], end: 2450 },
    { group: "upcoming problem", txns: [{ name: "Credit card", amount: -1100 }], end: 1350, below: true },
    { group: "problem", txns: [{ name: "Vacation deposit", amount: -1500 }], end: -150, risk: true },
    { group: "payday", txns: [{ name: "Paycheck", amount: 3200 }], end: 3050 },
    { group: "rest", txns: [], end: 3050 },
    { group: "rest", txns: [], end: 3050 },
  ];

  var STEPS = [
    {
      title: "Start with your checking balance",
      body: "Enter what you actually have in checking today.",
      spot: '[data-preview~="start"]',
    },
    {
      title: "See upcoming bills",
      body: "Watch how scheduled expenses affect your balance.",
      spot: '[data-preview~="upcoming"]',
    },
    {
      title: "Spot problems early",
      body: "See when your balance could fall below your safety cushion or become negative.",
      spot: '[data-preview~="problem"]',
    },
    {
      title: "Look ahead to payday",
      body: "Understand when money comes in and how your balance recovers.",
      spot: '[data-preview~="payday"]',
    },
    {
      title: "Take control",
      body: "Use BalanceWhiz to anticipate cash shortages before they happen.",
      spot: "#preview-calendar",
      spotNarrow: '[data-preview~="problem"]',
    },
  ];

  var today = new Date();
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  var stepIndex = 0;
  var open = false;
  var finale = false;
  var dialog = null;
  var backdrop = null;
  var lastFocus = null;

  function addDays(date, count) {
    var next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + count);
    return next;
  }

  function isoOf(date) {
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return date.getFullYear() + "-" + month + "-" + day;
  }

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

  function days() {
    return STORY.map(function (row, index) {
      var date = addDays(today, index);
      return {
        iso: isoOf(date),
        dow: date.toLocaleDateString("en-US", { weekday: "short" }),
        day: date.getDate(),
        mobile: date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        today: index === 0,
        group: row.group,
        txns: row.txns,
        end: row.end,
        below: !!row.below,
        risk: !!row.risk,
      };
    });
  }

  function cellHtml(day) {
    var classes = ["cal-cell", "cal-cell--density-sparse"];
    if (day.today) classes.push("cal-cell--today");
    if (day.txns.length) classes.push("cal-cell--has-activity");
    else classes.push("cal-cell--no-tx");
    if (day.risk) classes.push("cal-cell--bal-risk");
    else if (day.below) classes.push("cal-cell--bal-warn");
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
    return (
      '<div class="' +
      classes.join(" ") +
      '" data-iso="' +
      day.iso +
      '" data-end="' +
      day.end +
      '" data-preview="' +
      escapeHtml(day.group) +
      '"><div class="cal-daynum" data-mobile-label="' +
      escapeHtml(day.mobile) +
      '"><span class="cal-daynum-num' +
      (day.today ? " is-today" : "") +
      '">' +
      day.day +
      '</span></div><div class="cal-cell-fill"></div><div class="cal-cell-stack"><div class="cal-day-txns">' +
      txns +
      '</div><div class="cal-ledger-metrics"><div class="cal-balance-strip"><div class="cal-balance-strip__row"><span class="cal-balance-strip__amt"><span class="' +
      balClass +
      '">' +
      money(day.end) +
      "</span></span></div></div></div></div></div>"
    );
  }

  function narrowLayout() {
    return window.matchMedia("(max-width: 800px)").matches;
  }

  function renderCalendar() {
    var week = days();
    document.getElementById("previewDow").innerHTML = week
      .map(function (day) {
        return '<div class="cal-dow">' + escapeHtml(day.dow) + "</div>";
      })
      .join("");
    var root = document.getElementById("preview-calendar");
    root.innerHTML = week.map(cellHtml).join("");
    root.classList.toggle("calendar--mobile", narrowLayout());
    root.setAttribute(
      "aria-label",
      "Fictional checking forecast for " + week[0].mobile + " to " + week[week.length - 1].mobile
    );
  }

  function sampleSignupTarget() {
    if (document.documentElement.getAttribute("data-bw-home-auth") === "in") {
      return { href: "/calendar/", label: "Go to my forecast" };
    }
    return { href: "/account-setup/?fresh=1", label: "Start my free forecast" };
  }

  function applySampleSignupLinks() {
    var target = sampleSignupTarget();
    ["previewSignup", "previewTourSignup"].forEach(function (id) {
      var link = document.getElementById(id);
      if (!link) return;
      link.setAttribute("href", target.href);
      link.textContent = target.label;
    });
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
      '<div class="bw-tour-tooltip__arrow" data-side="top" hidden aria-hidden="true"></div>' +
      '<div class="bw-tour-tooltip__head"><span class="bw-tour-tooltip__counter" id="previewTourCounter">1 of 5</span>' +
      '<button type="button" class="bw-tour-tooltip__close" id="previewTourClose" aria-label="Close walkthrough">×</button></div>' +
      '<h2 class="bw-tour-tooltip__title" id="previewTourTitle"></h2>' +
      '<p class="bw-tour-tooltip__body" id="previewTourBody"></p>' +
      '<div class="bw-tour-tooltip__actions" id="previewTourActions">' +
      '<button type="button" class="bw-tour-tooltip__skip preview-back" id="previewTourBack">Back</button>' +
      '<button type="button" class="bw-tour-tooltip__skip" id="previewTourSkip">Skip</button>' +
      '<button type="button" class="bw-tour-tooltip__cta" id="previewTourNext">Next</button>' +
      "</div>" +
      '<div class="preview-intro-choices" id="previewTourChoices" hidden>' +
      '<a class="bw-tour-tooltip__cta" id="previewTourExplore" href="/preview/month/">Explore the full forecast</a>' +
      '<a class="bw-tour-tooltip__cta preview-tour-link--quiet" id="previewTourSignup" href="/account-setup/?fresh=1">Start my free forecast</a>' +
      '<button type="button" class="bw-tour-tooltip__skip" id="previewTourDismiss">Not now</button>' +
      "</div>";
    document.body.appendChild(dialog);
    document.getElementById("previewTourClose").addEventListener("click", closeTour);
    document.getElementById("previewTourSkip").addEventListener("click", closeTour);
    document.getElementById("previewTourDismiss").addEventListener("click", closeTour);
    document.getElementById("previewTourBack").addEventListener("click", function () {
      if (finale) showStep(STEPS.length - 1);
      else if (stepIndex > 0) showStep(stepIndex - 1);
    });
    document.getElementById("previewTourNext").addEventListener("click", function () {
      showStep(stepIndex + 1);
    });
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
    if (!selector) return [];
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

  function unionRect(nodes) {
    var rects = nodes.map(function (el) {
      return el.getBoundingClientRect();
    });
    var top = Math.min.apply(null, rects.map(function (rect) { return rect.top; }));
    var left = Math.min.apply(null, rects.map(function (rect) { return rect.left; }));
    var right = Math.max.apply(null, rects.map(function (rect) { return rect.right; }));
    var bottom = Math.max.apply(null, rects.map(function (rect) { return rect.bottom; }));
    return { top: top, left: left, right: right, bottom: bottom, width: right - left, height: bottom - top };
  }

  function stickyFloor() {
    var nav = document.querySelector(".top-nav");
    if (!nav) return 12;
    return Math.max(12, nav.getBoundingClientRect().bottom + 8);
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
      var previous = copy.style.whiteSpace;
      copy.style.whiteSpace = "nowrap";
      natural = Math.ceil(copy.scrollWidth + 40);
      copy.style.whiteSpace = previous;
    }
    var width = Math.max(floor, Math.min(cap, natural));
    card.style.width = width + "px";
    var cardHeight = card.offsetHeight || 220;
    var minTop = stickyFloor();
    var maxTop = Math.max(minTop, window.innerHeight - cardHeight - margin);
    var maxLeft = Math.max(margin, window.innerWidth - width - margin);
    var target = nodes && nodes.length ? unionRect(nodes) : null;
    var arrow = card.querySelector(".bw-tour-tooltip__arrow");

    function clamp(value, min, max) {
      if (max < min) return min;
      return Math.max(min, Math.min(value, max));
    }

    var top;
    var left;
    var side = "";
    if (!target) {
      top = finale ? maxTop : clamp((window.innerHeight - cardHeight) / 2, minTop, maxTop);
      left = clamp((window.innerWidth - width) / 2, margin, maxLeft);
    } else {
      var below = target.bottom + gap;
      var above = target.top - cardHeight - gap;
      var belowFits = below + cardHeight <= window.innerHeight - margin;
      var aboveFits = above >= minTop;
      if (!belowFits && !aboveFits) {
        var shift = Math.min(Math.max(0, target.top - minTop), cardHeight + gap);
        if (shift > 2) {
          window.scrollBy(0, target.bottom + gap + cardHeight - (window.innerHeight - margin));
          target = unionRect(nodes);
          below = target.bottom + gap;
          above = target.top - cardHeight - gap;
          belowFits = below + cardHeight <= window.innerHeight - margin;
          aboveFits = above >= minTop;
        }
      }
      if (belowFits || !aboveFits) {
        top = clamp(below, minTop, maxTop);
        side = "top";
      } else {
        top = clamp(above, minTop, maxTop);
        side = "bottom";
      }
      var align = finale
        ? target.left + (target.width - width) / 2
        : target.left + Math.min(target.width / 2, 80) - 28;
      left = clamp(align, margin, maxLeft);
    }
    card.style.left = Math.round(left) + "px";
    card.style.top = Math.round(top) + "px";
    if (!arrow) return;
    if (finale) {
      arrow.hidden = true;
      return;
    }
    arrow.hidden = !side;
    arrow.style.top = "";
    arrow.style.left = "";
    if (!side || !target) return;
    arrow.dataset.side = side;
    var anchorX = target.left + Math.min(Math.max(36, target.width / 2), target.width - 16);
    arrow.style.left = Math.round(clamp(anchorX - left, 22, width - 22)) + "px";
  }

  function showStep(index) {
    if (index < 0) return;
    open = true;
    finale = index >= STEPS.length;
    stepIndex = finale ? STEPS.length - 1 : index;
    document.getElementById("previewReplay").hidden = true;
    var step = STEPS[stepIndex];
    var selector = finale ? "" : narrowLayout() && step.spotNarrow ? step.spotNarrow : step.spot;
    var nodes = finale ? [] : spot(selector);
    var counter = document.getElementById("previewTourCounter");
    var title = document.getElementById("previewTourTitle");
    var body = document.getElementById("previewTourBody");
    var actions = document.getElementById("previewTourActions");
    var choices = document.getElementById("previewTourChoices");
    var back = document.getElementById("previewTourBack");
    var next = document.getElementById("previewTourNext");
    var skip = document.getElementById("previewTourSkip");
    if (finale) {
      clearSpot();
      counter.hidden = true;
      title.textContent = "See what your money looks like a month from now.";
      body.textContent =
        "You've seen how BalanceWhiz helps you spot a cash shortage before it happens. Want to explore more?";
      actions.hidden = false;
      skip.hidden = true;
      next.hidden = true;
      back.hidden = false;
      choices.hidden = false;
      applySampleSignupLinks();
    } else {
      counter.hidden = false;
      counter.textContent = index + 1 + " of " + STEPS.length;
      title.textContent = step.title;
      body.textContent = step.body;
      actions.hidden = false;
      skip.hidden = false;
      choices.hidden = true;
      next.hidden = false;
      next.textContent = index === STEPS.length - 1 ? "Finish" : "Next";
      back.hidden = index === 0;
    }
    var calendar = document.getElementById("preview-calendar");
    var anchor = finale ? (narrowLayout() || !calendar ? [] : [calendar]) : nodes;
    placeDialog(anchor);
    window.setTimeout(function () {
      if (!open) return;
      placeDialog(anchor);
      var focusTarget = finale ? document.getElementById("previewTourExplore") : next;
      if (focusTarget && !focusTarget.hidden) focusTarget.focus();
    }, 0);
  }

  function closeTour() {
    open = false;
    finale = false;
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
    if (!open || !dialog) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeTour();
      return;
    }
    if (!finale && event.key === "ArrowRight" && stepIndex < STEPS.length) {
      event.preventDefault();
      showStep(stepIndex + 1);
      return;
    }
    if (!finale && event.key === "ArrowLeft" && stepIndex > 0) {
      event.preventDefault();
      showStep(stepIndex - 1);
      return;
    }
    if (event.key !== "Tab") return;
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

  renderCalendar();
  applySampleSignupLinks();
  backdrop = document.createElement("div");
  backdrop.className = "bw-tour-backdrop";
  backdrop.style.zIndex = "9990";
  backdrop.setAttribute("aria-hidden", "true");
  document.body.appendChild(backdrop);
  document.getElementById("previewReplay").addEventListener("click", openTour);
  window.addEventListener("resize", function () {
    renderCalendar();
    if (!open) return;
    var step = STEPS[stepIndex];
    var selector = finale ? "" : narrowLayout() && step.spotNarrow ? step.spotNarrow : step.spot;
    var calendar = document.getElementById("preview-calendar");
    var nodes = finale ? (narrowLayout() || !calendar ? [] : [calendar]) : spot(selector);
    placeDialog(nodes);
  });
  document.addEventListener("keydown", onKey);
  new MutationObserver(applySampleSignupLinks).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-bw-home-auth"],
  });
})();
