/**
 * Seven-day public sample. Fictional numbers only, drawn in the browser.
 * Does not load app.js and does not write a forecast.
 */
(function () {
  "use strict";

  // Keep these in step with frontend/preview/preview.js so this week matches the month sample.
  var BUFFER = 1500;
  var OPENING = 4850;
  var LOW_OFFSET = 4;
  var PAY_OFFSET = 6;
  var WEEK_LENGTH = 7;
  var SERIES = [
    { offset: -8, name: "Groceries", amount: -180 },
    { offset: -6, name: "Mortgage", amount: -2400 },
    { offset: -4, name: "Utilities", amount: -210 },
    { offset: 3, name: "Credit card", amount: -660 },
    { offset: 4, name: "Insurance", amount: -1250 },
    { offset: 6, name: "Paycheck", amount: 3400 },
    { offset: 10, name: "Groceries", amount: -190 },
    { offset: 14, name: "Car repair", amount: -420 },
    { offset: 18, name: "Credit card", amount: -650 },
  ];

  function buildWeek() {
    var balance = OPENING;
    SERIES.forEach(function (item) {
      if (item.offset < 0) balance += item.amount;
    });
    var events = {};
    SERIES.forEach(function (item) {
      if (item.offset >= 0 && item.offset < WEEK_LENGTH) events[item.offset] = item;
    });
    var rows = [];
    var offset;
    for (offset = 0; offset < WEEK_LENGTH; offset += 1) {
      var event = events[offset];
      var txns = event ? [{ name: event.name, amount: event.amount }] : [];
      if (event) balance += event.amount;
      var group = "rest";
      if (offset === 0) group = "start";
      else if (offset === PAY_OFFSET) group = "payday";
      else if (offset === LOW_OFFSET) group = "upcoming problem shortage";
      else if (event && event.amount < 0) group = balance < BUFFER ? "upcoming problem" : "upcoming";
      rows.push({
        group: group,
        txns: txns,
        end: balance,
        below: balance < BUFFER && balance >= 0,
        risk: balance < 0,
      });
    }
    return rows;
  }

  var STORY = buildWeek();

  var STARTING_POINT =
    '<span class="cal-balance-status-pills"><span class="cal-balance-status-pill cal-balance-status-pill--starting"><span class="cal-balance-status-pill__icon" aria-hidden="true"><svg class="cal-starting-point-flag" viewBox="0 0 12 14" width="10" height="12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 1.25v11.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="M2 2.75 9.5 6.25 2 9.75V2.75Z" fill="currentColor"/></svg></span> Starting Point</span></span>';

  function longDate(offset) {
    return addDays(today, offset).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  }

  function stepBody(step) {
    return typeof step.body === "function" ? step.body() : step.body;
  }

  var STEPS = [
    {
      title: "Start with your checking balance",
      body: function () {
        return (
          "Your forecast starts with what's actually in your checking account. Here, we're starting with " +
          dollars(STORY[0].end) +
          "."
        );
      },
      spot: '[data-preview~="start"]',
    },
    {
      title: "See upcoming bills",
      body: function () {
        var card = STORY[3].txns[0];
        var insurance = STORY[LOW_OFFSET].txns[0];
        return (
          "Your " +
          dollars(card.amount) +
          " credit card payment and " +
          dollars(insurance.amount) +
          " insurance bill bring your balance from " +
          dollars(STORY[0].end) +
          " down to " +
          dollars(STORY[LOW_OFFSET].end) +
          "."
        );
      },
      spot: '[data-preview~="upcoming"]',
    },
    {
      title: "Spot problems before they happen",
      body: function () {
        return (
          "Your balance drops below your " +
          dollars(BUFFER) +
          " safety cushion, then falls to " +
          dollars(STORY[LOW_OFFSET].end) +
          " on " +
          longDate(LOW_OFFSET) +
          " — before your next paycheck."
        );
      },
      spot: '[data-preview~="problem"]',
      emphasize: '[data-preview~="shortage"]',
    },
    {
      title: "Look ahead to payday",
      body: function () {
        var paycheck = STORY[PAY_OFFSET].txns[0];
        return (
          "Your " +
          dollars(paycheck.amount) +
          " paycheck arrives " +
          longDate(PAY_OFFSET) +
          ", bringing your balance back to " +
          dollars(STORY[PAY_OFFSET].end) +
          ". But now you know about the shortage before it happens."
        );
      },
      spot: '[data-preview~="payday"]',
    },
    {
      title: "Know what's coming. Make decisions with confidence.",
      body: "See whether you can afford a purchase, move money into savings, or need to wait until payday — before making a decision.",
      spot: "",
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

  function dollars(amount) {
    return "$" + Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function money(amount) {
    return amount < 0 ? "(" + dollars(amount) + ")" : dollars(amount);
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
    var pill = day.today ? STARTING_POINT : "";
    var stripClass = "cal-balance-strip" + (pill ? " cal-balance-strip--has-status" : "");
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
      '</div><div class="cal-ledger-metrics"><div class="' +
      stripClass +
      '"><div class="cal-balance-strip__row"><span class="cal-balance-strip__amt"><span class="' +
      balClass +
      '">' +
      money(day.end) +
      "</span></span>" +
      pill +
      "</div></div></div></div></div>"
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
    var signedIn = document.documentElement.getAttribute("data-bw-home-auth") === "in";
    var onboarding = document.documentElement.getAttribute("data-bw-onboarding") || "";
    if (typeof sampleForecastCta === "function") return sampleForecastCta(signedIn, onboarding);
    if (!signedIn) return { href: "/account-setup/?fresh=1", label: "Create my forecast" };
    if (onboarding === "done") return { href: "/calendar/", label: "Go to my forecast" };
    return { href: "/account-setup/?resume=1", label: "Continue setting up my forecast" };
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
      '<button type="button" class="bw-tour-tooltip__cta" id="previewTourNext">Next</button>' +
      "</div>" +
      '<div class="preview-intro-choices" id="previewTourChoices" hidden>' +
      '<a class="bw-tour-tooltip__cta" id="previewTourExplore" href="/preview/month/">Explore a full month</a>' +
      '<a class="bw-tour-tooltip__cta preview-tour-link--quiet" id="previewTourSignup" href="/account-setup/?fresh=1">Create my forecast</a>' +
      '<button type="button" class="bw-tour-tooltip__skip" id="previewTourDismiss">Not now</button>' +
      "</div>";
    document.body.appendChild(dialog);
    document.getElementById("previewTourClose").addEventListener("click", closeTour);
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
      el.classList.remove("bw-tour-target", "bw-tour-target--strong");
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

  function pointed(nodes) {
    return (nodes || []).filter(function (el) {
      return el.classList.contains("bw-tour-target");
    });
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
    var width = Math.min(440, available);
    card.style.width = width + "px";
    var cardHeight = card.offsetHeight || 220;
    var minTop = stickyFloor();
    var maxTop = Math.max(minTop, window.innerHeight - cardHeight - margin);
    var maxLeft = Math.max(margin, window.innerWidth - width - margin);
    var spots = pointed(nodes);
    if (spots.length) {
      var visible = unionRect(spots);
      var reveal = 0;
      if (visible.top < minTop) reveal = visible.top - minTop;
      else if (visible.bottom > window.innerHeight - margin) reveal = visible.bottom - (window.innerHeight - margin);
      var room = Math.max(0, visible.top - minTop);
      if (reveal > room) reveal = room;
      if (Math.abs(reveal) > 2) window.scrollBy(0, reveal);
    }
    var target = nodes && nodes.length ? unionRect(nodes) : null;
    var arrow = card.querySelector(".bw-tour-tooltip__arrow");
    var showArrow = spots.length > 0;

    function clamp(value, min, max) {
      if (max < min) return min;
      return Math.max(min, Math.min(value, max));
    }

    var top;
    var left;
    var side = "";
    if (!target) {
      top = maxTop;
      left = clamp((window.innerWidth - width) / 2, margin, maxLeft);
    } else {
      var below = target.bottom + gap;
      var above = target.top - cardHeight - gap;
      var belowFits = below + cardHeight <= window.innerHeight - margin;
      var aboveFits = above >= minTop;
      if (!belowFits && !aboveFits && spots.length) {
        var needed = target.bottom + gap + cardHeight - (window.innerHeight - margin);
        var shift = Math.min(Math.max(0, needed), Math.max(0, target.top - minTop));
        if (shift > 2) {
          window.scrollBy(0, shift);
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
      var align = showArrow
        ? target.left + Math.min(target.width / 2, 80) - 28
        : target.left + (target.width - width) / 2;
      left = clamp(align, margin, maxLeft);
    }
    card.style.left = Math.round(left) + "px";
    card.style.top = Math.round(top) + "px";
    if (!arrow) return;
    arrow.hidden = !showArrow || !side || !target;
    arrow.style.top = "";
    arrow.style.left = "";
    if (arrow.hidden) return;
    arrow.dataset.side = side;
    var aimNodes = spots.filter(function (el) {
      return el.classList.contains("bw-tour-target--strong");
    });
    var aim = aimNodes.length ? unionRect(aimNodes) : unionRect(spots);
    var anchorX = aim.left + Math.min(Math.max(36, aim.width / 2), aim.width - 16);
    arrow.style.left = Math.round(clamp(anchorX - left, 22, width - 22)) + "px";
  }

  function tourAnchor(nodes) {
    if (nodes && nodes.length) return nodes;
    if (narrowLayout()) return [];
    var calendar = document.getElementById("preview-calendar");
    return calendar ? [calendar] : [];
  }

  function showStep(index) {
    if (index < 0) return;
    open = true;
    finale = index >= STEPS.length;
    stepIndex = finale ? STEPS.length - 1 : index;
    document.getElementById("previewReplay").hidden = true;
    var step = STEPS[stepIndex];
    var selector = finale ? "" : narrowLayout() && step.spotNarrow ? step.spotNarrow : step.spot;
    var nodes = !finale && selector ? spot(selector) : [];
    if (!nodes.length) clearSpot();
    if (!finale && step.emphasize) {
      document.querySelectorAll(step.emphasize).forEach(function (el) {
        el.classList.add("bw-tour-target--strong");
      });
    }
    var counter = document.getElementById("previewTourCounter");
    var title = document.getElementById("previewTourTitle");
    var body = document.getElementById("previewTourBody");
    var actions = document.getElementById("previewTourActions");
    var choices = document.getElementById("previewTourChoices");
    var back = document.getElementById("previewTourBack");
    var next = document.getElementById("previewTourNext");
    if (finale) {
      clearSpot();
      counter.hidden = true;
      title.textContent = "Ready to see what's ahead for your own money?";
      body.textContent =
        "You've seen how BalanceWhiz helps you spot a cash shortage before it happens. Explore a full month of fictional finances, or start forecasting your own money.";
      actions.hidden = true;
      next.hidden = true;
      back.hidden = true;
      choices.hidden = false;
      applySampleSignupLinks();
    } else {
      counter.hidden = false;
      counter.textContent = index + 1 + " of " + STEPS.length;
      title.textContent = step.title;
      body.textContent = stepBody(step);
      actions.hidden = false;
      choices.hidden = true;
      next.hidden = false;
      next.textContent = index === STEPS.length - 1 ? "Finish" : "Next";
      back.hidden = index === 0;
    }
    var anchor = tourAnchor(nodes);
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
    var nodes = !finale && selector ? spot(selector) : [];
    if (!nodes.length) clearSpot();
    if (!finale && step.emphasize) {
      document.querySelectorAll(step.emphasize).forEach(function (el) {
        el.classList.add("bw-tour-target--strong");
      });
    }
    placeDialog(tourAnchor(nodes));
  });
  document.addEventListener("keydown", onKey);
  new MutationObserver(applySampleSignupLinks).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-bw-home-auth", "data-bw-onboarding"],
  });
})();
