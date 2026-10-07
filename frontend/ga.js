/* BalanceWhiz GA4 page tracking.
   Standard gtag.js only. No custom events, no user id, no form fields.
   Page hits use the path only, so query strings and hashes (invite tokens,
   password-reset tokens, checkout session ids) are not sent.
   The Google tag loads only on the production site. */
(function () {
  if (window.__bwGa4Loaded) return;
  window.__bwGa4Loaded = true;

  var host = String(window.location.hostname || "").toLowerCase();
  if (host !== "balancewhiz.com" && host !== "www.balancewhiz.com") return;

  var measurementId = "G-G8J8QHVMHW";
  var script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(measurementId);
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;
  gtag("js", new Date());

  var path = window.location.pathname || "/";
  var params = {
    page_path: path,
    page_location: window.location.origin + path,
  };
  try {
    if (document.referrer) {
      var ref = new URL(document.referrer);
      params.page_referrer = ref.origin + ref.pathname;
    }
  } catch (err) {}

  gtag("config", measurementId, params);
})();
