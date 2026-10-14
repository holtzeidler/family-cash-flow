/* BalanceWhiz GA4.
   The Google tag loads only on balancewhiz.com. Staging and local hosts
   never call gtag, so they cannot send hits to the production property.
   Page hits use the path only. Query strings and hashes are removed from
   the page address and the referrer.
   Events: sign_up_click, sign_up, trial_started, onboarding_completed,
   purchase, subscription_started.
   purchase and subscription_started use the public plan price only.
   Stripe invoice ids stay in this browser so the same payment is sent once.
   They are not included in the event. Names, email addresses, account ids,
   balances, and amounts the user entered are not sent. Signup clicks record
   only that a signup link was used.
   Public prices must stay in sync with backend/app/billing_catalog.py. */
(function (root) {
  var MEASUREMENT_ID = "G-G8J8QHVMHW";
  var PUBLIC_PRICE = { monthly: 5.99, annual: 59.99 };
  var ITEM_ID = { monthly: "cash_forecast_monthly", annual: "cash_forecast_annual" };

  function isProductionHost(hostname) {
    var host = String(hostname || "").toLowerCase();
    return host === "balancewhiz.com" || host === "www.balancewhiz.com";
  }

  function originAndPath(urlLike) {
    if (!urlLike) return "";
    try {
      var parsed = new URL(String(urlLike), "https://balancewhiz.com");
      return parsed.origin + (parsed.pathname || "/");
    } catch (err) {
      return "";
    }
  }

  function pageHit(locationLike, referrer) {
    var loc = locationLike || {};
    var path = loc.pathname || "/";
    var origin = loc.origin || "";
    var params = {
      page_path: path,
      page_location: origin + path,
    };
    var ref = originAndPath(referrer);
    if (ref) params.page_referrer = ref;
    if (params.page_location.indexOf("?") !== -1 || params.page_location.indexOf("#") !== -1) {
      params.page_location = origin + path;
    }
    return params;
  }

  function signUpParams() {
    return { method: "email" };
  }

  function signUpClickParams() {
    return { method: "cta" };
  }

  function isSignupHref(href, base) {
    try {
      var parsed = new URL(String(href || ""), base || "https://balancewhiz.com");
      var path = parsed.pathname || "/";
      if (path.charAt(0) !== "/") path = "/" + path;
      if (path.length > 1 && path.charAt(path.length - 1) !== "/") path += "/";
      return path === "/account-setup/" || path === "/signup/";
    } catch (err) {
      return false;
    }
  }

  function accountKey(prefix, userId) {
    var digits = String(userId == null ? "" : userId).replace(/\D/g, "");
    return digits ? prefix + digits : "";
  }

  function browserStorage(persistent) {
    try {
      return persistent ? root.localStorage : root.sessionStorage;
    } catch (err) {
      return null;
    }
  }

  function trialStartedParams() {
    return { method: "email" };
  }

  function onboardingParams() {
    return { method: "account_setup" };
  }

  function paidInvoiceId(record) {
    if (!record || typeof record !== "object") return "";
    var id = String(record.transaction_id || "");
    if (!/^in_[A-Za-z0-9]{8,32}$/.test(id)) return "";
    return id;
  }

  function purchaseParams(record) {
    if (!paidInvoiceId(record)) return null;
    var plan = record.plan === "annual" ? "annual" : record.plan === "monthly" ? "monthly" : "";
    if (!plan) return null;
    var price = PUBLIC_PRICE[plan];
    return {
      value: price,
      currency: "USD",
      items: [
        {
          item_id: ITEM_ID[plan],
          item_name: "Cash Forecast",
          item_category: plan,
          price: price,
          quantity: 1,
        },
      ],
    };
  }

  var ITEM_KEYS = { item_id: true, item_name: true, item_category: true, price: true, quantity: true };

  function privateText(value) {
    return typeof value === "string" && (value.indexOf("@") !== -1 || /^in_/.test(value));
  }

  function cleanItems(items) {
    if (!Array.isArray(items)) return null;
    var cleaned = [];
    items.forEach(function (item) {
      if (!item || typeof item !== "object") return;
      var row = {};
      Object.keys(ITEM_KEYS).forEach(function (key) {
        if (item[key] == null || privateText(item[key])) return;
        row[key] = item[key];
      });
      if (Object.keys(row).length) cleaned.push(row);
    });
    return cleaned;
  }

  function safeParams(params) {
    var allowed = { method: true, value: true, currency: true, items: true };
    var safe = {};
    if (!params || typeof params !== "object") return safe;
    Object.keys(allowed).forEach(function (key) {
      if (params[key] == null || privateText(params[key])) return;
      if (key === "items") {
        var items = cleanItems(params[key]);
        if (items && items.length) safe.items = items;
        return;
      }
      safe[key] = params[key];
    });
    return safe;
  }

  function dispatch(host, gtagFn, name, params) {
    if (!isProductionHost(host) || typeof gtagFn !== "function") return null;
    var safe = safeParams(params);
    gtagFn("event", name, safe);
    return safe;
  }

  function track(name, params) {
    var host = root.location && root.location.hostname;
    return dispatch(host, root.gtag, name, params) != null;
  }

  function trackOnce(storage, key, name, params) {
    try {
      if (storage && storage.getItem(key) === "1") return false;
    } catch (err) {}
    if (!root.bwGa.track(name, params)) return false;
    try {
      if (storage) storage.setItem(key, "1");
    } catch (err) {}
    return true;
  }

  var lastSignupClickAt = 0;

  root.bwGa = {
    measurementId: MEASUREMENT_ID,
    isProductionHost: isProductionHost,
    pageHit: pageHit,
    isSignupHref: isSignupHref,
    signUpParams: signUpParams,
    signUpClickParams: signUpClickParams,
    trialStartedParams: trialStartedParams,
    onboardingParams: onboardingParams,
    purchaseParams: purchaseParams,
    dispatch: dispatch,
    track: track,
    trackOnce: trackOnce,
    noteSignUpClick: function () {
      var now = Date.now();
      if (now - lastSignupClickAt < 800) return false;
      lastSignupClickAt = now;
      return root.bwGa.track("sign_up_click", signUpClickParams());
    },
    noteSignUp: function (userId) {
      var key = accountKey("bw_ga_sign_up_", userId);
      if (!key) return root.bwGa.track("sign_up", signUpParams());
      return trackOnce(browserStorage(true), key, "sign_up", signUpParams());
    },
    noteTrialStarted: function (userId) {
      var key = accountKey("bw_ga_trial_", userId);
      if (!key) return root.bwGa.track("trial_started", trialStartedParams());
      return trackOnce(browserStorage(true), key, "trial_started", trialStartedParams());
    },
    noteOnboardingCompleted: function () {
      return trackOnce(browserStorage(false), "bw_ga_onboarding_completed", "onboarding_completed", onboardingParams());
    },
    notePurchase: function (record) {
      var id = paidInvoiceId(record);
      var params = purchaseParams(record);
      if (!id || !params) return false;
      return root.bwGa.trackOnce(browserStorage(true), "bw_ga_purchase_" + id, "purchase", params);
    },
    noteSubscriptionStarted: function (record) {
      var id = paidInvoiceId(record);
      var params = purchaseParams(record);
      if (!id || !params) return false;
      return root.bwGa.trackOnce(browserStorage(true), "bw_ga_subscription_" + id, "subscription_started", params);
    },
  };

  if (root.document && !root.document.__bwGaSignupClicks) {
    root.document.__bwGaSignupClicks = true;
    root.document.addEventListener(
      "click",
      function (event) {
        var node = event.target;
        while (node && node !== root.document) {
          if (node.tagName === "A" && isSignupHref(node.getAttribute("href"), root.location && root.location.href)) {
            if (root.bwGa && typeof root.bwGa.noteSignUpClick === "function") root.bwGa.noteSignUpClick();
            return;
          }
          node = node.parentNode;
        }
      },
      true
    );
  }

  if (root.__bwGa4Loaded) return;
  root.__bwGa4Loaded = true;
  if (!isProductionHost(root.location && root.location.hostname)) return;

  var script = root.document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(MEASUREMENT_ID);
  root.document.head.appendChild(script);

  root.dataLayer = root.dataLayer || [];
  function gtag() {
    root.dataLayer.push(arguments);
  }
  root.gtag = gtag;
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID, pageHit(root.location, root.document.referrer));
})(window);
