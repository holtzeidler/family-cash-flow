/**
 * BalanceWhiz first-run tour.
 *
 * A lightweight 4-step spotlight tour shown to a user after they finish account
 * setup. The goal is to teach the BalanceWhiz mental model quickly:
 * where to add items, which bills change month to month, when cash gets tight,
 * and how to lightly maintain the forecast over time.
 *
 * Entry points:
 *   - window.BW.tour.start()        Begin the tour now (called from the
 *                                   "Take the Tour" CTA of the forecast-
 *                                   ready modal, or from Settings/Help).
 *   - window.BW.tour.reset()        Clear the localStorage "seen" flag.
 *   - window.BW.tour.hasSeen()      Returns true if the user has already
 *                                   completed or explicitly skipped the tour.
 *   - window.BW.tour.markSkipped()  Mark the tour as skipped (used by the
 *                                   intro modal's "Explore on My Own" CTA).
 *
 * Visual approach (per design direction):
 *   - A very light backdrop (~18% opacity) instead of heavy darkening.
 *   - Target gets a soft accent-green outline ring; never moves or scales.
 *   - White tooltip card with title, short body copy, optional helper text,
 *     and a single forward CTA. Step counter provides orientation.
 *   - Smooth fade transitions between steps; no big animations.
 */
(function () {
  "use strict";

  const TOUR_SEEN_KEY = "bw_tour_seen_v1";
  const ZINDEX_BACKDROP = 9990;
  const ZINDEX_HIGHLIGHT = 9991;
  const ZINDEX_TOOLTIP = 9993;

  let backdropEl = null;
  let tooltipEl = null;
  let currentTargetEl = null;
  let currentTargetExtraClass = null;
  let currentDimEl = null;
  let currentSupportEls = [];
  let currentStepIdx = -1;
  let resizeHandler = null;
  let scrollHandler = null;
  let onAfterStepEnd = null;
  let repaintObserver = null;

  /**
   * Steps are intentionally short. Each `findTarget()` returns either an
   * existing DOM element (preferred) or null. When null, the step is skipped
   * gracefully and the tour advances.
   */
  /**
   * Tour progression: Input → Variable attention → Awareness → Accuracy.
   *
   * Step 1 (Input)     — calendar grid: add upcoming paychecks, bills, and transfers.
   * Step 2 (Attention) — Needs review: variable amounts and low maintenance.
   * Step 3 (Awareness) — Cash Health: the forecast against the chosen minimum balance.
   * Step 4 (Accuracy)  — balance check-in: lightweight maintenance to close the tour.
   */
  const STEPS = [
    {
      id: "calendar-add",
      findTarget: findFutureCalendarCellTarget,
      title: "Add what’s coming up",
      body:
        "Click any day to add a paycheck, bill, transfer, or other planned expense.\n\nThe more complete your forecast, the more useful it becomes. Start with what you know and keep adding as you go.",
      ctaLabel: "Next",
      placement: ["below", "above", "right", "left"],
      retryable: true,
      targetExtraClass: "bw-tour-target--calendar-add",
    },
    {
      id: "needs-review",
      findTarget: findNeedsReviewTarget,
      title: "Plan for bills that change",
      body:
        "Not every bill is the same each month — that’s okay.\n\nMark an item Amount varies and use your best estimate. BalanceWhiz will remind you to update it when the actual amount is known.",
      helperList: {
        lead: "Great for:",
        items: ["Credit card payments", "Utilities", "Other changing bills"],
      },
      note: "Fixed amounts can stay on autopilot.",
      ctaLabel: "Next",
      placement: ["right", "left", "below", "above"],
      targetExtraClass: "bw-tour-target--needs-review",
      dimSelector: ".sidebar",
      supportHighlights: [
        {
          findEl: findFirstPendingReviewItem,
          className: "bw-tour-support-highlight--pending-item",
        },
      ],
    },
    {
      id: "cash-outlook",
      findTarget: findCashHealthTarget,
      title: "Know when cash gets tight",
      body:
        "BalanceWhiz watches your forecast against the minimum balance you chose.\n\nIf a future day falls below your target, we’ll flag it so you can plan ahead.",
      helperExample: readTourMinimumBalanceExample,
      note: "You can change this anytime.",
      ctaLabel: "Next",
      placement: ["right", "left", "below", "above"],
      targetExtraClass: "bw-tour-target--cash-outlook",
      dimSelector: ".sidebar",
    },
    {
      id: "reconcile",
      findTarget: findExpectedCalendarConfirmAnchor,
      title: "Keep your forecast accurate",
      body:
        "Periodically compare your forecast with your actual checking balance and update anything that’s changed.\n\nIf things get out of sync, that’s okay. Enter your current balance and BalanceWhiz will use it as the new starting point for everything ahead.",
      reconcilePreview: readTourReconcilePreview,
      note: "Stay detailed when you can. Reset and move forward when you need to.",
      ctaLabel: "See My Forecast",
      placement: ["below", "above", "right", "left"],
      retryable: true,
      targetExtraClass: "bw-tour-target--reconcile-head",
    },
  ];

  // ---------------------------------------------------------------------
  // Target discovery
  // ---------------------------------------------------------------------

  /**
   * Step 1 prefers a visible day that already has a planned item (today or
   * later first), then today, then the next future day.
   * Step 3 prefers the Cash Health card, then the low-balance flag inside it.
   */
  function isVisible(el) {
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findCashHealthTarget() {
    const card = document.getElementById("sidebarCashHealthCard");
    if (isVisible(card)) return card;
    return findCashOutlookTarget();
  }

  function findCashOutlookTarget() {
    const low = document.getElementById("sidebarLowBalanceBanner");
    if (isVisible(low)) return low;
    const high = document.getElementById("sidebarHighBalanceBanner");
    if (isVisible(high)) return high;
    const alerts = document.getElementById("sidebarBalanceThresholdAlerts");
    if (isVisible(alerts)) return alerts;
    // Last resort: anchor on the sidebar itself so the educational
    // copy still has a meaningful left-edge anchor.
    const sidebar = document.querySelector("aside.sidebar");
    if (isVisible(sidebar)) return sidebar;
    return null;
  }

  function calendarCellHasPlannedItem(cell) {
    return !!cell.querySelector(".cal-day-tx-line:not(.cal-day-tx-line--start-balance)");
  }

  function findFutureCalendarCellTarget() {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const cells = Array.from(
      document.querySelectorAll(".cal-cell[data-iso]:not(.cal-cell--out):not(.cal-cell--before-start)")
    ).filter((cell) => isVisible(cell));
    if (!cells.length) return null;

    const withItems = cells.filter(calendarCellHasPlannedItem);
    const itemTodayOrLater = withItems.find((cell) => (cell.getAttribute("data-iso") || "") >= todayIso);
    if (itemTodayOrLater) return itemTodayOrLater;
    if (withItems.length) return withItems[0];

    const todayCell = cells.find((cell) => cell.querySelector(".cal-daynum-num.is-today"));
    if (todayCell) return todayCell;
    return cells.find((cell) => (cell.getAttribute("data-iso") || "") > todayIso) || cells[0];
  }

  function findExpectedCalendarRowTarget() {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const expectedRows = Array.from(
      document.querySelectorAll(
        ".cal-cell[data-iso]:not(.cal-cell--out):not(.cal-cell--before-start) .cal-day-tx-line--expected"
      )
    ).filter((row) => isVisible(row));
    const rows = expectedRows.length
      ? expectedRows
      : Array.from(
          document.querySelectorAll(
            ".cal-cell[data-iso]:not(.cal-cell--out):not(.cal-cell--before-start) .cal-day-tx-line:not(.cal-day-tx-line--start-balance)"
          )
        ).filter((row) => isVisible(row));
    if (!rows.length) return null;
    const futureOrToday = rows.find((row) => {
      const iso = row.closest(".cal-cell")?.getAttribute("data-iso") || "";
      return iso >= todayIso;
    });
    return futureOrToday || rows[0];
  }

  function findExpectedCalendarConfirmAnchor() {
    const todayIso = new Date().toISOString().slice(0, 10);
    const balanceHit =
      document.querySelector(
        `.cal-cell[data-iso="${todayIso}"]:not(.cal-cell--out):not(.cal-cell--before-start) .cal-ledger-metrics.cal-day-balance-hit`
      ) ||
      document.querySelector(
        ".cal-cell[data-iso]:not(.cal-cell--out):not(.cal-cell--before-start) .cal-ledger-metrics.cal-day-balance-hit"
      );
    if (balanceHit && isVisible(balanceHit)) return balanceHit;
    const row = findExpectedCalendarRowTarget();
    const fromRow = row
      ? row.closest(".cal-cell")?.querySelector(".cal-ledger-metrics.cal-day-balance-hit")
      : null;
    if (fromRow && isVisible(fromRow)) return fromRow;
    const updateBtn = document.getElementById("forecastConfidenceVerifyBtn");
    if (isVisible(updateBtn)) return updateBtn;
    const checkIn = document.getElementById("forecastConfidenceCard");
    if (isVisible(checkIn)) return checkIn;
    return null;
  }

  function findNeedsReviewTarget() {
    const card = document.getElementById("sidebarPendingTxCard");
    return isVisible(card) ? card : null;
  }

  function findFirstPendingReviewItem() {
    const item = document.querySelector("#sidebarPendingTxList .pending-attn-item");
    return isVisible(item) ? item : null;
  }

  function formatTourMoney(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "";
    const hasCents = Math.abs(num - Math.round(num)) > 0.001;
    return num.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0,
    });
  }

  function readTourMinimumBalanceExample() {
    const st = window.state;
    const fid = Number(st && st.activeFamilyId);
    const fam = (st && st.families ? st.families : []).find((row) => Number(row && row.id) === fid);
    if (!fam || fam.balance_threshold_min == null || fam.balance_threshold_min === "") return null;
    const amount = formatTourMoney(fam.balance_threshold_min);
    if (!amount) return null;
    return { label: "Your minimum balance", amount };
  }

  function readTourReconcilePreview() {
    const map = window.state && window.state.verifiedBalances;
    if (!map || typeof map.forEach !== "function") return null;
    let latest = "";
    let amount = null;
    map.forEach((val, iso) => {
      const key = String(iso || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
      const n = Number(val && val.amount);
      if (!Number.isFinite(n)) return;
      if (!latest || key > latest) {
        latest = key;
        amount = n;
      }
    });
    if (!latest || amount == null) return null;
    const dt = new Date(Number(latest.slice(0, 4)), Number(latest.slice(5, 7)) - 1, Number(latest.slice(8, 10)), 12);
    if (Number.isNaN(dt.getTime())) return null;
    const balance = formatTourMoney(amount);
    if (!balance) return null;
    return {
      dayNum: String(dt.getDate()),
      dayLabel: dt.toLocaleDateString("en-US", { weekday: "short" }),
      status: `Updated ${dt.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`,
      balanceLabel: "Checking balance",
      balance,
    };
  }

  function resolveTourStepValue(value) {
    return typeof value === "function" ? value() : value;
  }

  function renderTourReconcilePreview(container, preview) {
    container.replaceChildren();
    const card = document.createElement("div");
    card.className = "bw-tour-tooltip__reconcile-preview";
    const statusText = `${preview.status || ""}. ${preview.balanceLabel || ""}: ${preview.balance || ""}`;
    card.setAttribute("role", "img");
    card.setAttribute("aria-label", statusText.trim());

    const dayRow = document.createElement("div");
    dayRow.className = "bw-tour-tooltip__reconcile-preview-dayrow";
    const dayGroup = document.createElement("div");
    dayGroup.className = "bw-tour-tooltip__reconcile-preview-day";
    const dayNum = document.createElement("span");
    dayNum.className = "bw-tour-tooltip__reconcile-preview-daynum";
    dayNum.textContent = String(preview.dayNum || "");
    const dayMeta = document.createElement("span");
    dayMeta.className = "bw-tour-tooltip__reconcile-preview-daymeta";
    dayMeta.textContent = String(preview.dayLabel || "");
    dayGroup.append(dayNum, dayMeta);
    const check = document.createElement("span");
    check.className = "bw-tour-tooltip__reconcile-preview-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "✓";
    dayRow.append(dayGroup, check);

    const status = document.createElement("div");
    status.className = "bw-tour-tooltip__reconcile-preview-status";
    status.textContent = String(preview.status || "");

    const balRow = document.createElement("div");
    balRow.className = "bw-tour-tooltip__reconcile-preview-balance";
    const balLabel = document.createElement("span");
    balLabel.className = "bw-tour-tooltip__reconcile-preview-balance-k";
    balLabel.textContent = String(preview.balanceLabel || "");
    const balVal = document.createElement("span");
    balVal.className = "bw-tour-tooltip__reconcile-preview-balance-v";
    balVal.textContent = String(preview.balance || "");
    balRow.append(balLabel, balVal);

    card.append(dayRow, status, balRow);
    container.appendChild(card);
  }

  function renderTourHelperList(container, list) {
    container.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "bw-tour-tooltip__helper-list";
    const lead = document.createElement("div");
    lead.className = "bw-tour-tooltip__helper-list-lead";
    lead.textContent = String(list.lead || "Good for");
    const ul = document.createElement("ul");
    ul.className = "bw-tour-tooltip__helper-list-items";
    for (const item of list.items || []) {
      const li = document.createElement("li");
      li.textContent = String(item);
      ul.appendChild(li);
    }
    wrap.append(lead, ul);
    container.appendChild(wrap);
  }

  // ---------------------------------------------------------------------
  // Backdrop + tooltip element lifecycle
  // ---------------------------------------------------------------------

  function ensureBackdrop() {
    if (backdropEl) return backdropEl;
    backdropEl = document.createElement("div");
    backdropEl.className = "bw-tour-backdrop";
    backdropEl.setAttribute("aria-hidden", "true");
    backdropEl.style.zIndex = String(ZINDEX_BACKDROP);
    document.body.appendChild(backdropEl);
    return backdropEl;
  }

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement("div");
    tooltipEl.className = "bw-tour-tooltip";
    tooltipEl.setAttribute("role", "dialog");
    tooltipEl.setAttribute("aria-modal", "false");
    tooltipEl.setAttribute("aria-labelledby", "bwTourTitle");
    tooltipEl.style.zIndex = String(ZINDEX_TOOLTIP);
    tooltipEl.innerHTML = `
      <div class="bw-tour-tooltip__arrow" data-bw-tour-arrow aria-hidden="true"></div>
      <div class="bw-tour-tooltip__head">
        <span class="bw-tour-tooltip__counter" data-bw-tour-counter>1 of 4</span>
        <button type="button" class="bw-tour-tooltip__close" data-bw-tour-skip aria-label="Skip tour">×</button>
      </div>
      <h3 class="bw-tour-tooltip__title" id="bwTourTitle" data-bw-tour-title></h3>
      <p class="bw-tour-tooltip__context" data-bw-tour-context hidden></p>
      <p class="bw-tour-tooltip__body" data-bw-tour-body></p>
      <p class="bw-tour-tooltip__instruction" data-bw-tour-instruction hidden></p>
      <p class="bw-tour-tooltip__helper" data-bw-tour-helper hidden></p>
      <p class="bw-tour-tooltip__note" data-bw-tour-note hidden></p>
      <div class="bw-tour-tooltip__actions">
        <button type="button" class="bw-tour-tooltip__skip" data-bw-tour-skip-link>Skip tour</button>
        <button type="button" class="bw-tour-tooltip__cta" data-bw-tour-next>Next</button>
      </div>
    `;
    document.body.appendChild(tooltipEl);

    tooltipEl.querySelectorAll("[data-bw-tour-skip], [data-bw-tour-skip-link]").forEach((el) => {
      el.addEventListener("click", () => endTour({ skipped: true }));
    });
    tooltipEl.querySelector("[data-bw-tour-next]").addEventListener("click", advanceStep);
    return tooltipEl;
  }

  function liftElement(el, zIndex, zIndexKey, positionKey) {
    const inlineZ = el.style.zIndex;
    const inlinePos = el.style.position;
    el.dataset[zIndexKey] = inlineZ === "" ? "__unset" : inlineZ;
    el.dataset[positionKey] = inlinePos === "" ? "__unset" : inlinePos;
    const computed = window.getComputedStyle(el);
    if (computed.position === "static") {
      el.style.position = "relative";
    }
    el.style.zIndex = String(zIndex);
  }

  function restoreLiftedElement(el, zIndexKey, positionKey) {
    const prevZ = el.dataset[zIndexKey];
    const prevPos = el.dataset[positionKey];
    if (prevZ === "__unset") el.style.removeProperty("z-index");
    else if (prevZ != null) el.style.zIndex = prevZ;
    if (prevPos === "__unset") el.style.removeProperty("position");
    else if (prevPos != null) el.style.position = prevPos;
    delete el.dataset[zIndexKey];
    delete el.dataset[positionKey];
  }

  function clearTargetHighlight() {
    if (currentTargetEl) {
      currentTargetEl.classList.remove("bw-tour-target");
      if (currentTargetExtraClass) {
        currentTargetEl.classList.remove(currentTargetExtraClass);
      }
      restoreLiftedElement(currentTargetEl, "bwTourPrevZIndex", "bwTourPrevPosition");
      currentTargetEl = null;
    }
    currentTargetExtraClass = null;
    for (const item of currentSupportEls) {
      item.el.classList.remove("bw-tour-support-highlight");
      if (item.className) item.el.classList.remove(item.className);
      restoreLiftedElement(item.el, "bwTourSupportPrevZIndex", "bwTourSupportPrevPosition");
    }
    currentSupportEls = [];
    if (currentDimEl) {
      currentDimEl.classList.remove("bw-tour-sidebar-dim");
      currentDimEl = null;
    }
  }

  function applyTargetHighlight(el, opts) {
    clearTargetHighlight();
    if (!el) return;
    currentTargetEl = el;
    liftElement(el, ZINDEX_HIGHLIGHT, "bwTourPrevZIndex", "bwTourPrevPosition");
    el.classList.add("bw-tour-target");
    if (opts && opts.targetExtraClass) {
      el.classList.add(opts.targetExtraClass);
      currentTargetExtraClass = opts.targetExtraClass;
    }
    if (opts && opts.dimSelector) {
      const dimEl = document.querySelector(opts.dimSelector);
      if (dimEl) {
        dimEl.classList.add("bw-tour-sidebar-dim");
        currentDimEl = dimEl;
      }
    }
  }

  function applySupportHighlights(step) {
    const items = Array.isArray(step?.supportHighlights) ? step.supportHighlights : [];
    currentSupportEls = [];
    for (const item of items) {
      const el = item && typeof item.findEl === "function" ? item.findEl() : null;
      if (!el || el === currentTargetEl) continue;
      liftElement(el, ZINDEX_HIGHLIGHT - 1, "bwTourSupportPrevZIndex", "bwTourSupportPrevPosition");
      el.classList.add("bw-tour-support-highlight");
      if (item.className) el.classList.add(item.className);
      currentSupportEls.push({ el, className: item.className || "" });
    }
  }

  // ---------------------------------------------------------------------
  // Tooltip positioning
  // ---------------------------------------------------------------------

  function clamp(num, min, max) {
    return Math.max(min, Math.min(num, max));
  }

  function normalizePlacements(placement) {
    if (Array.isArray(placement) && placement.length) return placement;
    if (placement === "auto" || !placement) return ["below", "above", "right", "left"];
    return [placement];
  }

  function getPlacementCandidate(placement, tr, tw, th, vw, vh, gap, pad) {
    const targetCenterX = tr.left + tr.width / 2;
    const targetCenterY = tr.top + tr.height / 2;
    let left = 0;
    let top = 0;
    let side = "top";
    if (placement === "right") {
      left = tr.right + gap;
      top = targetCenterY - th / 2;
      side = "left";
    } else if (placement === "left") {
      left = tr.left - tw - gap;
      top = targetCenterY - th / 2;
      side = "right";
    } else if (placement === "above") {
      left = targetCenterX - tw / 2;
      top = tr.top - th - gap;
      side = "bottom";
    } else {
      left = targetCenterX - tw / 2;
      top = tr.bottom + gap;
      side = "top";
    }
    const overflow =
      Math.max(0, pad - left) +
      Math.max(0, pad - top) +
      Math.max(0, left + tw - (vw - pad)) +
      Math.max(0, top + th - (vh - pad));
    return {
      left: clamp(left, pad, Math.max(pad, vw - tw - pad)),
      top: clamp(top, pad, Math.max(pad, vh - th - pad)),
      side,
      overflow,
      targetCenterX,
      targetCenterY,
    };
  }

  function targetIsUsable(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }

  function repositionToLiveTarget() {
    if (currentStepIdx < 0 || !tooltipEl) return;
    const step = STEPS[currentStepIdx];
    if (!step) return;
    const live = step.findTarget();
    if (!targetIsUsable(live)) return;
    if (live !== currentTargetEl) {
      applyTargetHighlight(live, {
        targetExtraClass: step.targetExtraClass,
        dimSelector: step.dimSelector,
      });
      applySupportHighlights(step);
    }
    positionTooltip(live, step.placement || "auto");
  }

  function ensureRepaintWatcher() {
    if (repaintObserver) return;
    const grid = document.getElementById("calendarGrid");
    if (!grid) return;
    repaintObserver = new MutationObserver(() => {
      if (currentStepIdx < 0) return;
      repositionToLiveTarget();
    });
    repaintObserver.observe(grid, { childList: true, subtree: true });
  }

  function stopRepaintWatcher() {
    if (!repaintObserver) return;
    repaintObserver.disconnect();
    repaintObserver = null;
  }

  function positionTooltip(targetEl, placement) {
    if (!tooltipEl || !targetIsUsable(targetEl)) return;
    const gap = 12;
    const pad = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tr = targetEl.getBoundingClientRect();
    const tw = tooltipEl.offsetWidth;
    const th = tooltipEl.offsetHeight;
    if (tw < 2 || th < 2) return;

    const arrow = tooltipEl.querySelector("[data-bw-tour-arrow]");
    const placements = normalizePlacements(placement);
    const candidates = placements.map((place) => getPlacementCandidate(place, tr, tw, th, vw, vh, gap, pad));
    let chosen = candidates.find((item) => item.overflow === 0) || candidates[0];
    for (const item of candidates) {
      if (item.overflow < chosen.overflow) chosen = item;
    }

    tooltipEl.style.left = `${Math.round(chosen.left)}px`;
    tooltipEl.style.top = `${Math.round(chosen.top)}px`;

    if (arrow) {
      arrow.dataset.side = chosen.side;
      if (chosen.side === "left" || chosen.side === "right") {
        const arrowTopWithinTooltip = clamp(chosen.targetCenterY - chosen.top, 20, th - 20);
        arrow.style.top = `${Math.round(arrowTopWithinTooltip)}px`;
        arrow.style.left = "";
      } else {
        const arrowLeftWithinTooltip = clamp(chosen.targetCenterX - chosen.left, 16, tw - 16);
        arrow.style.left = `${Math.round(arrowLeftWithinTooltip)}px`;
        arrow.style.top = "";
      }
    }
  }

  // ---------------------------------------------------------------------
  // Step rendering
  // ---------------------------------------------------------------------

  function renderStep(stepIdx) {
    if (stepIdx < 0 || stepIdx >= STEPS.length) {
      endTour({ completed: true });
      return;
    }
    currentStepIdx = stepIdx;
    const step = STEPS[stepIdx];
    const helperExample = resolveTourStepValue(step.helperExample);
    const helperList = resolveTourStepValue(step.helperList);
    const reconcilePreview = resolveTourStepValue(step.reconcilePreview);
    const target = step.findTarget();
    if (!target) {
      if (step.retryable && (step._retries || 0) < 12) {
        step._retries = (step._retries || 0) + 1;
        window.setTimeout(() => renderStep(stepIdx), 250);
        return;
      }
      // No target found — skip to the next step.
      renderStep(stepIdx + 1);
      return;
    }

    // Make sure the target is in view before highlighting.
    try {
      const rect = target.getBoundingClientRect();
      const margin = 60;
      if (rect.top < margin || rect.bottom > window.innerHeight - margin) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch (_) {}

    ensureBackdrop();
    ensureTooltip();
    backdropEl.classList.add("bw-tour-backdrop--open");
    tooltipEl.classList.add("bw-tour-tooltip--open");

    tooltipEl.querySelector("[data-bw-tour-counter]").textContent = `${stepIdx + 1} of ${STEPS.length}`;
    tooltipEl.querySelector("[data-bw-tour-title]").textContent = step.title;
    tooltipEl.querySelector("[data-bw-tour-body]").textContent = step.body;
    const contextEl = tooltipEl.querySelector("[data-bw-tour-context]");
    if (contextEl) {
      if (step.context) {
        contextEl.textContent = step.context;
        contextEl.hidden = false;
      } else {
        contextEl.textContent = "";
        contextEl.hidden = true;
      }
    }
    const instructionEl = tooltipEl.querySelector("[data-bw-tour-instruction]");
    if (instructionEl) {
      if (step.instruction) {
        instructionEl.textContent = step.instruction;
        instructionEl.hidden = false;
      } else {
        instructionEl.textContent = "";
        instructionEl.hidden = true;
      }
    }
    const helperEl = tooltipEl.querySelector("[data-bw-tour-helper]");
    if (helperEl) {
      helperEl.classList.remove(
        "bw-tour-tooltip__helper--example",
        "bw-tour-tooltip__helper--reconcile-preview",
        "bw-tour-tooltip__helper--list"
      );
      if (reconcilePreview && reconcilePreview.balance && reconcilePreview.dayNum) {
        renderTourReconcilePreview(helperEl, reconcilePreview);
        helperEl.hidden = false;
        helperEl.classList.add("bw-tour-tooltip__helper--reconcile-preview");
      } else if (helperExample && helperExample.amount) {
        helperEl.replaceChildren();
        const wrap = document.createElement("span");
        wrap.className = "bw-tour-tooltip__helper-example";
        const lab = document.createElement("span");
        lab.className = "bw-tour-tooltip__helper-example-label";
        lab.textContent = String(helperExample.label || "Your minimum balance");
        const amt = document.createElement("span");
        amt.className = "bw-tour-tooltip__helper-example-amount";
        amt.textContent = String(helperExample.amount);
        wrap.append(lab, amt);
        helperEl.appendChild(wrap);
        helperEl.hidden = false;
        helperEl.classList.add("bw-tour-tooltip__helper--example");
      } else if (helperList && Array.isArray(helperList.items) && helperList.items.length) {
        renderTourHelperList(helperEl, helperList);
        helperEl.hidden = false;
        helperEl.classList.add("bw-tour-tooltip__helper--list");
      } else if (step.helper) {
        helperEl.textContent = step.helper;
        helperEl.hidden = false;
      } else {
        helperEl.textContent = "";
        helperEl.hidden = true;
      }
    }
    const noteEl = tooltipEl.querySelector("[data-bw-tour-note]");
    if (noteEl) {
      if (step.note) {
        noteEl.textContent = step.note;
        noteEl.hidden = false;
      } else {
        noteEl.textContent = "";
        noteEl.hidden = true;
      }
    }
    tooltipEl.querySelector("[data-bw-tour-next]").textContent = step.ctaLabel || "Next";

    applyTargetHighlight(target, {
      targetExtraClass: step.targetExtraClass,
      dimSelector: step.dimSelector,
    });
    applySupportHighlights(step);
    // Position after a frame so layout (incl. scrollIntoView) settles.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (currentTargetEl) positionTooltip(currentTargetEl, step.placement || "auto");
      });
    });

    ensureRepaintWatcher();
    // Reposition on resize/scroll so the spotlight stays accurate.
    if (!resizeHandler) {
      resizeHandler = () => repositionToLiveTarget();
      window.addEventListener("resize", resizeHandler);
    }
    if (!scrollHandler) {
      scrollHandler = () => repositionToLiveTarget();
      window.addEventListener("scroll", scrollHandler, true);
    }
  }

  function advanceStep() {
    renderStep(currentStepIdx + 1);
  }

  function startTour() {
    // Reset per-tour transient state so a restart from Settings/Help works.
    for (const step of STEPS) delete step._retries;
    currentStepIdx = 0;
    renderStep(currentStepIdx);
  }

  function endTour(opts) {
    clearTargetHighlight();
    if (backdropEl) backdropEl.classList.remove("bw-tour-backdrop--open");
    if (tooltipEl) tooltipEl.classList.remove("bw-tour-tooltip--open");
    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }
    if (scrollHandler) {
      window.removeEventListener("scroll", scrollHandler, true);
      scrollHandler = null;
    }
    stopRepaintWatcher();
    currentStepIdx = -1;
    // Mark as seen for both skip and completion — we don't want to nag users
    // who decided either way. Settings → "Show me around" lets them replay it.
    if (opts && (opts.completed || opts.skipped)) markSeen();
    if (typeof onAfterStepEnd === "function") {
      const fn = onAfterStepEnd;
      onAfterStepEnd = null;
      try { fn(); } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------

  function markSeen() {
    try {
      localStorage.setItem(TOUR_SEEN_KEY, String(Date.now()));
    } catch (_) {}
  }

  function hasSeen() {
    try {
      return !!localStorage.getItem(TOUR_SEEN_KEY);
    } catch (_) {
      return false;
    }
  }

  function reset() {
    try {
      localStorage.removeItem(TOUR_SEEN_KEY);
    } catch (_) {}
  }

  function markSkipped() {
    markSeen();
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  window.BW = window.BW || {};
  window.BW.tour = {
    start: startTour,
    end: () => endTour({ skipped: true }),
    reset,
    hasSeen,
    markSkipped,
  };

  // ---------------------------------------------------------------------
  // Bootstrap: restart links + auto-start from ?tour=1
  // ---------------------------------------------------------------------

  /**
   * Determine whether the current page hosts the calendar DOM the tour
   * needs to highlight. Other pages (Settings, Reports, public Help)
   * can't run the tour locally — they should hop to /calendar/?tour=1.
   */
  function pageCanRunTour() {
    return !!document.getElementById("calendarGrid")
      || !!document.querySelector(".cal-cell")
      || !!document.getElementById("sidebarPendingTxCard");
  }

  function navigateToCalendarWithTour() {
    try {
      const target = "/calendar/?tour=1";
      // If we're already on /calendar, just start the tour in place.
      if (pageCanRunTour() && location.pathname.replace(/\/+$/, "") === "/calendar") {
        startTour();
        return;
      }
      location.href = target;
    } catch (_) {
      try { startTour(); } catch (__) {}
    }
  }

  function wireRestartButtons() {
    const nodes = document.querySelectorAll("[data-bw-tour-restart]");
    nodes.forEach((el) => {
      if (el.dataset.bwTourRestartBound === "1") return;
      el.dataset.bwTourRestartBound = "1";
      el.addEventListener("click", (e) => {
        e.preventDefault();
        navigateToCalendarWithTour();
      });
    });
  }

  /**
   * If the URL contains ?tour=1 and we're on a page that can host the
   * tour, start it once the relevant DOM appears. Strips the query so a
   * refresh doesn't keep re-triggering.
   */
  function maybeAutoStartFromQuery() {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("tour") !== "1") return;
      url.searchParams.delete("tour");
      const cleaned = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") + url.hash;
      window.history.replaceState({}, "", cleaned);
    } catch (_) {
      return;
    }
    if (!pageCanRunTour()) return;
    // Wait until the grid renders at least one cell, then start.
    let attempts = 0;
    const tryStart = () => {
      attempts += 1;
      const hasCells = document.querySelectorAll(".cal-cell").length > 0;
      if (hasCells || attempts > 40) {
        startTour();
        return;
      }
      window.setTimeout(tryStart, 200);
    };
    window.setTimeout(tryStart, 250);
  }

  function bootstrap() {
    wireRestartButtons();
    maybeAutoStartFromQuery();
    // Re-wire in case restart buttons are added later via dynamic UI.
    document.addEventListener("click", (e) => {
      const target = e.target && e.target.closest && e.target.closest("[data-bw-tour-restart]");
      if (target && target.dataset.bwTourRestartBound !== "1") {
        target.dataset.bwTourRestartBound = "1";
        e.preventDefault();
        navigateToCalendarWithTour();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
