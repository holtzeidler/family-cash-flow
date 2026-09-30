/**
 * Trial banner under the main navigation.
 * Loaded before app.js so the development preview can render the same
 * functions without starting the signed-in app.
 */
function parseBillingDateTime(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const day = new Date(`${s}T12:00:00`);
    return Number.isNaN(day.getTime()) ? null : day;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function billingLookupIsAnnual(lookupKey) {
  return String(lookupKey || "").trim() === "cash_forecast_annual";
}

function isBillingPaymentRecoveryState(status = cachedBillingStatusForActiveFamily()) {
  if (!status || typeof status !== "object") return false;
  if (status.entitled === true) return false;
  const st = String(status.status || "").toLowerCase();
  const phase = String(status.phase || "").toLowerCase();
  if (st === "incomplete" || st === "incomplete_expired") return false;
  if (!status.stripe_subscription_id) return false;
  return phase === "past_due" || st === "past_due" || st === "unpaid";
}

function isFormerPaidSubscriptionEnded(status = cachedBillingStatusForActiveFamily()) {
  if (!status || typeof status !== "object") return false;
  if (status.entitled === true) return false;
  if (isBillingPaymentRecoveryState(status)) return false;
  if (isBillingTrialPlanScheduled(status)) return false;
  const raw = String(status.status || "").toLowerCase();
  const canceled = raw === "canceled" || raw === "cancelled";
  return canceled && !!status.stripe_subscription_id;
}

function isBillingSubscribed(status = cachedBillingStatusForActiveFamily()) {
  if (!status) return false;
  const phase = String(status.phase || "").toLowerCase();
  if (phase === "active" || phase === "past_due") return true;
  const st = String(status.status || "").toLowerCase();
  // Stripe `trialing` is card-on-file during the free trial — not a paid subscriber.
  return !!status.stripe_subscription_id && (st === "active" || st === "past_due");
}

function isComplimentaryAccessActive(status = cachedBillingStatusForActiveFamily()) {
  if (!status || typeof status !== "object") return false;
  if (status.complimentary_access_active === true) return true;
  return String(status.phase || "").toLowerCase() === "complimentary";
}

function isBillingWriteLocked(status = cachedBillingStatusForActiveFamily()) {
  if (!status || typeof status !== "object") return false;
  if (isComplimentaryAccessActive(status)) return false;
  if (status.entitled === false) return true;
  const phase = String(status.phase || "").toLowerCase();
  return phase === "expired";
}

function trialNoticeEndDate(status) {
  return parseBillingDateTime((status && (status.trial_ends_at || status.trial_ends_on)) || "");
}

function trialNoticeMonthDay(date, now) {
  const opts = { month: "long", day: "numeric", timeZone: "UTC" };
  if (date.getUTCFullYear() !== now.getUTCFullYear()) opts.year = "numeric";
  return date.toLocaleDateString(undefined, opts);
}

function trialNoticeUtcCalendarDays(end, now) {
  const utcDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((utcDay(end) - utcDay(now)) / 86400000);
}

/**
 * Whole UTC calendar days until trial_ends_at.
 * Uses the server's trial_days_remaining when the billing payload has it, so
 * the banner, Billing page, and trial emails count the same day. The 14-day
 * access cutoff is still the exact trial_ends_at timestamp.
 */
function trialNoticeDaysRemaining(status, end, now) {
  const raw = status && status.trial_days_remaining;
  if (raw != null && raw !== "" && Number.isFinite(Number(raw))) {
    return Math.max(0, Math.floor(Number(raw)));
  }
  if (!end) return null;
  return trialNoticeUtcCalendarDays(end, now);
}

/**
 * " · Monthly plan starts October 8" when a plan is already chosen.
 * The date is the billing payload's first charge, which is the trial end.
 */
function trialScheduledPlanSuffix(status, now) {
  if (!isBillingTrialPlanScheduled(status)) return "";
  const name = billingLookupIsAnnual(status.lookup_key) ? "Annual" : "Monthly";
  const start = parseBillingDateTime(
    (status && (status.first_charge_at || status.trial_ends_at || status.first_charge_on || status.trial_ends_on)) || ""
  );
  const label = start ? trialNoticeMonthDay(start, now) : "";
  return label ? ` · ${name} plan starts ${label}` : "";
}

/**
 * One trial-status line under the main navigation.
 * Day wording uses the server's trial_days_remaining (UTC calendar days until
 * trial_ends_at). Access still ends at that exact timestamp, not at midnight.
 * A selected plan keeps the countdown and names the start date, without a
 * subscribe link. Paid, complimentary, and cancel-at-period-end accounts
 * are not trials.
 */
function resolveTrialStatusNotice(status, now = new Date()) {
  if (!status || typeof status !== "object") return null;
  if (isComplimentaryAccessActive(status)) return null;
  if (isBillingSubscribed(status)) return null;
  const phase = String(status.phase || "").toLowerCase();
  if (phase === "complimentary" || phase === "active" || phase === "past_due") return null;
  if (isFormerPaidSubscriptionEnded(status) || isBillingPaymentRecoveryState(status)) return null;

  const end = trialNoticeEndDate(status);
  const inTrial = status.in_app_trial === true || phase === "trial";
  if (inTrial && end && now.getTime() < end.getTime()) {
    const days = trialNoticeDaysRemaining(status, end, now);
    if (days == null || days < 0) return null;
    const planSelected = isBillingTrialPlanScheduled(status);
    const suffix = planSelected ? trialScheduledPlanSuffix(status, now) : "";
    const action = planSelected ? null : "Choose a plan";
    const state = days <= 3 ? "ending" : "countdown";
    let message = `${days} days left in your free trial`;
    if (days === 1) message = "1 day left in your free trial";
    if (days === 0) message = "Your free trial ends today";
    return { state, message: message + suffix, action };
  }

  if (phase === "expired" && status.entitled === false && end && now.getTime() >= end.getTime()) {
    return {
      state: "ended",
      message: "Your free trial has ended",
      action: "Choose a plan",
    };
  }
  return null;
}

function syncTrialStatusNotice(status) {
  const nav = document.querySelector("body[data-bw-view] .container > .top-nav");
  if (!nav) return;
  let el = document.getElementById("trialStatusNotice");
  if (!el) {
    el = document.createElement("div");
    el.id = "trialStatusNotice";
    el.className = "trial-status-notice";
    el.setAttribute("role", "status");
    el.hidden = true;
    nav.insertAdjacentElement("afterend", el);
  }
  const model = resolveTrialStatusNotice(status);
  if (!model) {
    el.hidden = true;
    el.removeAttribute("data-trial-state");
    el.replaceChildren();
    return;
  }
  el.hidden = false;
  el.dataset.trialState = model.state;
  const line = document.createElement("p");
  line.className = "trial-status-notice__line";
  const message = document.createElement("span");
  message.className = "trial-status-notice__message";
  message.textContent = model.message;
  line.appendChild(message);
  if (model.action) {
    const link = document.createElement("a");
    link.className = "trial-status-notice__action";
    link.href = "/settings/?section=billing";
    link.textContent = model.action;
    line.appendChild(link);
  }
  el.replaceChildren(line);
}

function isBillingTrialPlanScheduled(status = cachedBillingStatusForActiveFamily()) {
  if (!status) return false;
  const st = String(status.status || "").toLowerCase();
  return !!status.stripe_subscription_id && st === "trialing";
}

