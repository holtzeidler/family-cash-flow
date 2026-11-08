/*
 * BalanceWhiz Staging access. Staging builds only; production pages never load this file.
 *
 * When the staging API is in password mode, this asks for the shared staging password once
 * per browser, keeps the signed pass the API returns (never the password), and adds it to
 * every API request. The BalanceWhiz session is left alone, so unlocking again after the pass
 * expires keeps the user signed in.
 */
(function () {
  "use strict";

  var STORE_KEY = "bw_staging_access";
  var OPEN_KEY = "bw_staging_access_open";
  var HEADER = "X-Staging-Access";
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  var memoryPass = null;
  var gate = null;
  var rechecking = false;
  var promptShown = false;

  if (!nativeFetch) return;

  function apiBase() {
    var base = window.API_BASE;
    if (!base || base === "__API_BASE__") return "";
    return String(base).replace(/\/+$/, "");
  }

  function readPass() {
    var saved = memoryPass;
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch (_) {}
    if (!saved || !saved.pass || !(Date.parse(saved.expires_at) > Date.now())) return "";
    return String(saved.pass);
  }

  function savePass(pass, expiresAt) {
    memoryPass = { pass: pass, expires_at: expiresAt };
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(memoryPass));
    } catch (_) {}
  }

  function forgetPass() {
    memoryPass = null;
    try {
      window.localStorage.removeItem(STORE_KEY);
      window.sessionStorage.removeItem(OPEN_KEY);
    } catch (_) {}
  }

  function rememberOpen() {
    try {
      window.sessionStorage.setItem(OPEN_KEY, "1");
    } catch (_) {}
  }

  function knownOpen() {
    try {
      return window.sessionStorage.getItem(OPEN_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return String(input || "");
  }

  function targetsApi(url) {
    var base = apiBase();
    return !!base && url.indexOf(base + "/api/") === 0;
  }

  function fetchStatus(pass) {
    var headers = {};
    if (pass) headers[HEADER] = pass;
    return nativeFetch(apiBase() + "/api/staging/access", { headers: headers, credentials: "omit" })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  /* Resolves when API calls may go out. Stays pending while the prompt is up; unlocking reloads. */
  function ensureGate() {
    if (gate) return gate;
    if (readPass() || knownOpen() || !apiBase()) {
      gate = Promise.resolve();
      return gate;
    }
    gate = fetchStatus("").then(function (status) {
      if (status && status.mode === "password") {
        showPrompt();
        return new Promise(function () {});
      }
      if (status && status.mode) rememberOpen();
      return undefined;
    });
    return gate;
  }

  function recheckAfterRefusal() {
    if (rechecking || promptShown) return;
    rechecking = true;
    fetchStatus(readPass()).then(function (status) {
      rechecking = false;
      if (status && status.mode === "password" && !status.pass_valid) {
        forgetPass();
        showPrompt();
      }
    });
  }

  window.fetch = function (input, init) {
    if (!targetsApi(requestUrl(input))) return nativeFetch(input, init);
    return ensureGate().then(function () {
      var options = init ? Object.assign({}, init) : {};
      var pass = readPass();
      if (pass) {
        var headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
        headers.set(HEADER, pass);
        options.headers = headers;
      }
      return nativeFetch(input, options).then(function (res) {
        if (res.status === 403) recheckAfterRefusal();
        return res;
      });
    });
  };

  var STYLES =
    ".bw-staging-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;" +
    "padding:24px 16px;background:rgba(11,61,46,.55);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;}" +
    ".bw-staging-gate__card{width:100%;max-width:400px;box-sizing:border-box;background:#fff;border-radius:14px;" +
    "padding:28px 24px 24px;box-shadow:0 18px 48px rgba(0,0,0,.22);color:#16241f;}" +
    ".bw-staging-gate__eyebrow{margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#0B3D2E;}" +
    ".bw-staging-gate__title{margin:0 0 8px;font-size:22px;line-height:1.25;font-weight:700;}" +
    ".bw-staging-gate__text{margin:0 0 18px;font-size:15px;line-height:1.5;color:#3c4a45;}" +
    ".bw-staging-gate__label{display:block;margin:0 0 6px;font-size:14px;font-weight:600;}" +
    ".bw-staging-gate__input{display:block;width:100%;box-sizing:border-box;min-height:44px;padding:10px 12px;" +
    "font:inherit;font-size:16px;border:1px solid #b8c4bf;border-radius:8px;}" +
    ".bw-staging-gate__input:focus{outline:2px solid #0B3D2E;outline-offset:1px;border-color:#0B3D2E;}" +
    ".bw-staging-gate__error{margin:10px 0 0;font-size:14px;line-height:1.4;color:#b42318;}" +
    ".bw-staging-gate__button{display:block;width:100%;min-height:44px;margin-top:18px;border:0;border-radius:8px;" +
    "background:#0B3D2E;color:#fff;font:inherit;font-size:16px;font-weight:600;cursor:pointer;}" +
    ".bw-staging-gate__button[disabled]{opacity:.7;cursor:progress;}";

  function showPrompt() {
    if (promptShown) return;
    promptShown = true;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", renderPrompt, { once: true });
    } else {
      renderPrompt();
    }
  }

  function renderPrompt() {
    var style = document.createElement("style");
    style.textContent = STYLES;
    document.head.appendChild(style);

    var overlay = document.createElement("div");
    overlay.className = "bw-staging-gate";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "bwStagingGateTitle");
    overlay.innerHTML =
      '<form class="bw-staging-gate__card" novalidate>' +
      '<p class="bw-staging-gate__eyebrow">Test environment</p>' +
      '<h1 class="bw-staging-gate__title" id="bwStagingGateTitle">BalanceWhiz Staging</h1>' +
      '<p class="bw-staging-gate__text">Enter the staging password to continue. ' +
      "You only need to do this once in this browser.</p>" +
      '<label class="bw-staging-gate__label" for="bwStagingGatePassword">Staging password</label>' +
      '<input class="bw-staging-gate__input" id="bwStagingGatePassword" type="password" ' +
      'autocomplete="current-password" autocapitalize="off" spellcheck="false" required />' +
      '<p class="bw-staging-gate__error" role="alert" hidden></p>' +
      '<button class="bw-staging-gate__button" type="submit">Continue</button>' +
      "</form>";
    Array.prototype.forEach.call(document.body.children, function (child) {
      child.setAttribute("inert", "");
    });
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = "hidden";

    var form = overlay.querySelector("form");
    var input = overlay.querySelector("input");
    var error = overlay.querySelector(".bw-staging-gate__error");
    var button = overlay.querySelector("button");
    input.focus();

    function showError(message) {
      error.textContent = message;
      error.hidden = false;
      button.disabled = false;
      button.textContent = "Continue";
      input.focus();
      input.select();
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!input.value.trim()) {
        showError("Enter the staging password.");
        return;
      }
      error.hidden = true;
      button.disabled = true;
      button.textContent = "Checking…";
      nativeFetch(apiBase() + "/api/staging/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ password: input.value }),
      })
        .then(function (res) {
          if (res.ok) {
            return res.json().then(function (body) {
              input.value = "";
              savePass(body.pass, body.expires_at);
              window.location.reload();
            });
          }
          if (res.status === 401) return showError("That password isn't right. Check it and try again.");
          if (res.status === 429) return showError("Too many attempts. Wait 15 minutes and try again.");
          if (res.status === 409) {
            rememberOpen();
            window.location.reload();
            return undefined;
          }
          return showError("Staging didn't respond as expected. Try again in a moment.");
        })
        .catch(function () {
          showError("We couldn't reach staging. Check your connection and try again.");
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureGate, { once: true });
  } else {
    ensureGate();
  }
})();
