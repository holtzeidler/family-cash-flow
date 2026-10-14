/* BalanceWhiz GA4.
   The Google tag loads only on balancewhiz.com. Staging and local hosts
   never call gtag, so they cannot send hits to the production property.
   Page hits use the path only. Query strings and hashes are removed from
   the page address and the referrer.
   Events: sign_up, trial_started, onboarding_completed, purchase.
   purchase uses the public plan price and a Stripe invoice id. Names,
   email addresses, balances, and amounts the user entered are not sent.
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

  function trialStartedParams() {
    return { method: "email" };
  }

  function onboardingParams() {
    return { method: "account_setup" };
  }

  function purchaseParams(record) {
    if (!record || typeof record !== "object") return null;
    var id = String(record.transaction_id || "");
    if (!/^in_[A-Za-z0-9]{8,32}$/.test(id)) return null;
    var plan = record.plan === "annual" ? "annual" : record.plan === "monthly" ? "monthly" : "";
    if (!plan) return null;
    var price = PUBLIC_PRICE[plan];
    return {
      transaction_id: id,
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

  function safeParams(params) {
    var allowed = { method: true, transaction_id: true, value: true, currency: true, items: true };
    var safe = {};
    if (!params || typeof params !== "object") return safe;
    Object.keys(allowed).forEach(function (key) {
      if (params[key] != null) safe[key] = params[key];
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
    if (!track(name, params)) return false;
    try {
      if (storage) storage.setItem(key, "1");
    } catch (err) {}
    return true;
  }

  root.bwGa = {
    measurementId: MEASUREMENT_ID,
    isProductionHost: isProductionHost,
    pageHit: pageHit,
    signUpParams: signUpParams,
    trialStartedParams: trialStartedParams,
    onboardingParams: onboardingParams,
    purchaseParams: purchaseParams,
    dispatch: dispatch,
    track: track,
    trackOnce: trackOnce,
    noteSignUp: function () {
      return track("sign_up", signUpParams());
    },
    noteTrialStarted: function () {
      return track("trial_started", trialStartedParams());
    },
    noteOnboardingCompleted: function () {
      var storage = null;
      try {
        storage = root.sessionStorage;
      } catch (err) {}
      return trackOnce(storage, "bw_ga_onboarding_completed", "onboarding_completed", onboardingParams());
    },
    notePurchase: function (record) {
      var params = purchaseParams(record);
      if (!params) return false;
      var storage = null;
      try {
        storage = root.localStorage;
      } catch (err) {}
      return trackOnce(storage, "bw_ga_purchase_" + params.transaction_id, "purchase", params);
    },
  };

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
