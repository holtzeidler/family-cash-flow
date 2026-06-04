function apiBaseUrl() {
  const raw = window.API_BASE && window.API_BASE !== "__API_BASE__" ? String(window.API_BASE).trim() : "";
  return raw.replace(/\/+$/, "");
}

const BW_API_ACCESS_TOKEN_KEY = "bw_api_access_token";

function apiBearerAuthHeaders() {
  try {
    const t = sessionStorage.getItem(BW_API_ACCESS_TOKEN_KEY);
    if (t && String(t).trim()) return { Authorization: `Bearer ${String(t).trim()}` };
  } catch (_) {}
  return {};
}

function isLocalhostHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/** FastAPI may return `detail` as a string, object, or list of validation errors. */
function formatApiDetail(detail) {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = [];
    for (const item of detail) {
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }
      if (item && typeof item === "object") {
        const loc = Array.isArray(item.loc) ? item.loc.filter((x) => x !== "body").join(".") : "";
        const m = item.msg != null ? String(item.msg) : "";
        if (loc && m) parts.push(`${loc}: ${m}`);
        else if (m) parts.push(m);
        else {
          try {
            parts.push(JSON.stringify(item));
          } catch (_) {
            parts.push(String(item));
          }
        }
      }
    }
    return parts.filter(Boolean).join("\n");
  }
  if (typeof detail === "object") {
    try {
      return JSON.stringify(detail);
    } catch (_) {
      return String(detail);
    }
  }
  return String(detail);
}

async function api(path, method = "GET", body) {
  const apiBase = apiBaseUrl();
  const fullPath = `${apiBase}${path}`;
  const hostname = typeof location !== "undefined" ? location.hostname : "";
  const origin = typeof location !== "undefined" ? location.origin : "(unknown)";
  const isLocalhost = isLocalhostHost(hostname);
  const isStaticWebHost = !isLocalhost && origin !== "(unknown)";

  if (!apiBase && isStaticWebHost) {
    const origin = typeof location !== "undefined" ? location.origin : "(unknown)";
    throw new Error(
      "Frontend build is missing API_BASE, so requests are going to the website origin (and will fail).\n\n" +
        "Fix: In the repo → Settings → Secrets and variables → Actions → set secret API_BASE to your Render API URL " +
        "(e.g. https://your-app.onrender.com, no trailing slash), then re-run the workflow that deploys GitHub Pages.\n\n" +
        `Current Origin: ${origin}`
    );
  }
  let res;
  try {
    res = await fetch(fullPath, {
      method,
      headers: {
        ...apiBearerAuthHeaders(),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const origin = typeof location !== "undefined" ? location.origin : "(unknown)";
    const baseHint = apiBase
      ? `Trying API_BASE: ${apiBase}`
      : "API_BASE is empty — requests go to the Pages host (wrong).";
    const corsHint = isStaticWebHost
      ? `Render env CORS_ORIGINS must include exactly: ${origin} (scheme + host, no path). Set ENV=production for login cookies.`
      : "If this is cross-origin, configure CORS on the API for this origin.";
    throw new Error(
      `${msg}\n\n${baseHint}\n${corsHint}\nIf the API is on Render free tier, wait ~1 minute for a cold start and refresh.`
    );
  }

  if (res.status === 401) {
    try {
      sessionStorage.removeItem(BW_API_ACCESS_TOKEN_KEY);
    } catch (_) {}
    window.location.href = "./login.html";
    return null;
  }

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && data.detail != null) {
        const d = formatApiDetail(data.detail);
        if (d) msg = d;
      }
    } catch (_) {}
    throw new Error(msg);
  }

  // Some endpoints may return empty bodies; handle gracefully.
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

// Expose shared helpers for peripheral modules loaded after app.js
// (for example feedback.js) so they use the exact same auth/session logic.
window.api = api;

function show(el, msg) {
  if (!el) return;
  const s =
    msg == null || msg === ""
      ? ""
      : typeof msg === "string"
        ? msg
        : formatApiDetail(msg);
  el.textContent = s;
  el.style.display = s ? "block" : "none";
}

let bwToastHideTimer = null;
/** Lightweight toast for settings and other saves (non-blocking). */
function showBwToast(message, { durationMs = 2800 } = {}) {
  const text = String(message || "").trim();
  if (!text) return;
  let el = document.getElementById("bwToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "bwToast";
    el.className = "bw-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("bw-toast--visible");
  if (bwToastHideTimer) clearTimeout(bwToastHideTimer);
  bwToastHideTimer = window.setTimeout(() => {
    bwToastHideTimer = null;
    el.classList.remove("bw-toast--visible");
  }, durationMs);
}

window.showBwToast = showBwToast;

function expandSidebarSection(key) {
  const card = document.querySelector(`.sidebar-section[data-sidebar-key="${key}"]`);
  if (!card) return null;
  applySidebarSectionCollapsed(card, false);
  return card;
}

function fmtMoney(n) {
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return String(n ?? "");
  // Force comma thousands separators consistently.
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoney0(n) {
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return String(n ?? "");
  return num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** Month summary in left nav: round up to whole dollars (no cents). */
function fmtMoneySidebarSummary(n) {
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return String(n ?? "");
  return fmtMoney0(Math.ceil(num));
}

function fmtMonthYearShort(yyyyMm) {
  try {
    const s = String(yyyyMm || "");
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(5, 7));
    if (!Number.isFinite(y) || !Number.isFinite(m)) return s;
    const dt = new Date(y, Math.max(0, m - 1), 1, 12, 0, 0, 0);
    return dt.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  } catch (_) {
    return String(yyyyMm || "");
  }
}

function fmtMoney0SignedDollar(n) {
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return `$${String(n ?? "")}`;
  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";
  return `${sign}$${fmtMoney0(abs)}`;
}

function fmtMoneyParens(n) {
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return String(n ?? "");
  const abs = Math.abs(num);
  const s = fmtMoney(abs);
  return num < 0 ? `(${s})` : s;
}

function fmtMoneyThreshold(rawInput, n) {
  const raw = String(rawInput ?? "").trim();
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return String(n ?? "");
  const showDecimals = raw.includes(".");
  if (showDecimals) return fmtMoney(num);
  return num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDateMDY(raw) {
  const iso = normalizeIsoDate(raw) || "";
  if (!iso) return String(raw ?? "");
  // iso = YYYY-MM-DD
  const y = iso.slice(0, 4);
  const m = iso.slice(5, 7);
  const d = iso.slice(8, 10);
  if (!y || !m || !d) return String(raw ?? "");
  return `${m}-${d}-${y}`;
}

function fmtMonthDay(raw) {
  const iso = normalizeIsoDate(raw) || "";
  if (!iso) return String(raw ?? "");
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return String(raw ?? "");
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  const mon = dt.toLocaleDateString("en-US", { month: "short" });
  return `${mon} ${d}`;
}

/** Short money for dense tiles, e.g. −$3.7k or $12k */
function fmtMoneyCompactTile(n) {
  const num = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(num)) return "—";
  const neg = num < 0;
  const abs = Math.abs(num);
  let body = "";
  if (abs >= 1_000_000) body = `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  else if (abs >= 1000) body = `${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  else body = fmtMoney0(abs);
  return neg ? `−$${body}` : `$${body}`;
}

/** e.g. "May 11, 2026" — Transaction Manager rows and light status copy */
function fmtDateMedDisplay(raw) {
  const iso = normalizeIsoDate(raw) || "";
  if (!iso) return String(raw ?? "");
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return String(raw ?? "");
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** e.g. "May 10, 2026" — for reconcile modal and other human-facing dates */
function fmtDateLongDisplay(raw) {
  const iso = normalizeIsoDate(raw) || "";
  if (!iso) return String(raw ?? "");
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return String(raw ?? "");
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function toNum(v) {
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

let state = {
  user: null,
  isPlatformAdmin: false,
  families: [],
  activeFamilyId: null,
  activeFamilyAccessMode: "edit",
  activeFamilyIsOwner: false,
  categories: [],
  categoryTree: null,
  categoryUsageSummary: null,
  accounts: [],
  expectedTransactions: [],
  monthActualItems: [],
  upcomingActualItems: [],
  monthExpectedItems: [],
  calendarExtraActualItems: [],
  calendarExtraExpectedItems: [],
  reconciledDates: new Set(),
  monthDailyBalances: new Map(),
  calendarExpandedDays: new Set(),
  calendarDetailMode: "detailed",
};

// Expose state on window so peripheral modules (e.g. feedback.js) can read
// non-sensitive context like the active family id and signed-in user.
window.state = state;

/**
 * Dispatch a beta-pulse milestone event. The feedback module (frontend/feedback.js)
 * listens for "bw:milestone" and shows a one-time prompt for each id.
 * It is safe to call this multiple times for the same id — the listener
 * dedupes via localStorage.
 */
function bwDispatchMilestone(id) {
  if (!id) return;
  try {
    document.dispatchEvent(new CustomEvent("bw:milestone", { detail: { id: String(id) } }));
  } catch (_) {
    /* ignore */
  }
}

let selectedExpectedInstance = null;
let selectedExpectedMovedToDate = null;
let txEditReimbursableValue = false;
let txEditDescriptionSnapshot = "";
/** "actual" = one-time bank txn; "recurring" = expected series / occurrence */
let transactionEditMode = "actual";

const userPill = document.getElementById("userPill");
const familiesErr = document.getElementById("familiesErr");
const txErr = document.getElementById("txErr");
const catErr = document.getElementById("catErr");
const familySelect = document.getElementById("familySelect");
const monthInput = document.getElementById("monthInput");
const totalsEl = document.getElementById("totals");
const txList = document.getElementById("txList");
const txListMain = document.getElementById("txListMain");
const uncatTxErr = document.getElementById("uncatTxErr");
const uncatTxList = document.getElementById("uncatTxList");
const uncatTxSaveBtn = document.getElementById("uncatTxSaveBtn");

/** @type {Map<number, number>} txId -> categoryId */
const uncatPendingCategoryByTxId = new Map();

const categoriesTree = document.getElementById("categoriesTree");
const newCategoryGroupId = document.getElementById("newCategoryGroupId");
const seedDefaultCategoriesBtn = document.getElementById("seedDefaultCategoriesBtn");
const addCategoryGroupBtn = document.getElementById("addCategoryGroupBtn");
const addGroupInline = document.getElementById("addGroupInline");
const newGroupName = document.getElementById("newGroupName");
const saveGroupBtn = document.getElementById("saveGroupBtn");
const cancelGroupBtn = document.getElementById("cancelGroupBtn");

// Category color pickers (tx add/edit)
const txAddCategoryColorRow = document.getElementById("txAddCategoryColorRow");
const txAddCategoryColorSwatches = document.getElementById("txAddCategoryColorSwatches");
const txAddCategoryColorClear = document.getElementById("txAddCategoryColorClear");
const txEditCategoryColorRow = document.getElementById("txEditCategoryColorRow");
const txEditCategoryColorSwatches = document.getElementById("txEditCategoryColorSwatches");
const txEditCategoryColorClear = document.getElementById("txEditCategoryColorClear");

let txAddSelectedBgColor = null;
let txEditSelectedBgColor = null;
let txAddColorTouched = false;
let txEditColorTouched = false;

function normalizeBgColorForSave(bg) {
  const t = bg == null ? "" : String(bg).trim();
  if (!t) return "none";
  if (t.toLowerCase() === "none") return "none";
  return t;
}

function normalizeFgColorForSave(bg) {
  const t = bg == null ? "" : String(bg).trim();
  if (!t || t.toLowerCase() === "none") return "";
  return accessibleTextOnBackground(t);
}

/** Always include on save — backend overwrites colors when omitted. */
function txColorFieldsForSave(bg) {
  return {
    bg_color: normalizeBgColorForSave(bg),
    fg_color: normalizeFgColorForSave(bg),
  };
}

const CATEGORY_COLOR_PALETTE = [
  "#9ECFE0", // cyan
  "#DCC99A", // gold
  "#E0BF94", // orange
  "#C4AED4", // purple
  "#D9A5A5", // red
  "#E6DCA0", // yellow
  "#94C9CF", // aqua
  "#B5BAC2", // gray
  "#A8BECD", // slate
  "#CDBDE0", // lavender
  "#8A919C", // charcoal
  "#9EC4A8", // green
];

function renderCategoryColorPicker({ rowEl, swatchesEl, clearBtn, getCategoryId, getBg, setBg, unhideRow = true }) {
  if (!swatchesEl) return;

  function refresh() {
    // Show the color row whenever the picker refreshes (add + edit modals).
    if (rowEl && unhideRow) rowEl.hidden = false;
    const rawBg = getBg && getBg() ? String(getBg()).trim() : "";
    const overrideNone = !!(rawBg && rawBg.toLowerCase() === "none");
    const activeBg = rawBg && rawBg.toLowerCase() !== "none" ? rawBg : null;
    const cid = getCategoryId ? getCategoryId() : null;
    const catSt = categoryStyleFromId(cid);
    const catBg = catSt && catSt.bg ? String(catSt.bg).trim() : "";
    const categoryTint = !!(catBg && catBg.toLowerCase() !== "none");
    // For highlighting, use the effective displayed color:
    // transaction override if present, otherwise the category default.
    const effectiveBg = overrideNone ? null : activeBg || (categoryTint ? catBg : null);
    // Enable Clear when there is a pending swatch color OR the category would tint the pill
    // (so the user can explicitly save with no color despite the category default).
    const canClear = overrideNone || !!activeBg || categoryTint;
    if (clearBtn) {
      clearBtn.hidden = !canClear;
      clearBtn.disabled = !canClear;
      clearBtn.title = canClear ? "Clear color for this transaction" : "";
    }

    swatchesEl.innerHTML = "";
    const paletteLower = new Set(CATEGORY_COLOR_PALETTE.map((h) => String(h).toLowerCase()));
    const effectiveLower = effectiveBg ? String(effectiveBg).toLowerCase() : "";
    const effectiveIsPalette = !!(effectiveLower && paletteLower.has(effectiveLower));
    for (const hex of CATEGORY_COLOR_PALETTE) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cat-swatch";
      b.style.background = hex;
      b.title = "Set transaction color";
      if (effectiveBg && String(effectiveBg).toLowerCase() === String(hex).toLowerCase()) {
        b.classList.add("is-active");
      }
      b.addEventListener("click", () => {
        if (setBg) setBg(hex);
        refresh();
      });
      swatchesEl.appendChild(b);
    }

    // Custom picker (+)
    const custom = document.createElement("div");
    custom.className = "cat-swatch cat-swatch--custom";
    custom.title = "Custom color";
    const inp = document.createElement("input");
    inp.type = "color";
    // If the saved/selected color is not one of the preset palette values, treat it as "custom"
    // and highlight the "+" swatch.
    const effectiveLooksHex = !!(effectiveBg && String(effectiveBg).trim().startsWith("#"));
    if (effectiveBg && !effectiveIsPalette) custom.classList.add("is-active");
    inp.value = effectiveLooksHex ? String(effectiveBg).trim() : "#0B3D2E";
    // Don't re-render on every 'input' while the native picker is open,
    // or it will close immediately (the <input> gets replaced).
    inp.addEventListener("input", () => {
      if (setBg) setBg(inp.value);
      if (clearBtn) {
        clearBtn.hidden = false;
        clearBtn.disabled = false;
        clearBtn.title = "Clear color for this transaction";
      }
    });
    // Re-render once the user commits/closes the picker.
    inp.addEventListener("change", () => {
      if (setBg) setBg(inp.value);
      refresh();
    });
    custom.appendChild(inp);
    swatchesEl.appendChild(custom);
  }

  if (clearBtn) {
    // Use mousedown preventDefault so the click still fires when another control
    // (category combobox, color input) would otherwise steal focus first.
    clearBtn.addEventListener("mousedown", (e) => {
      if (clearBtn.disabled) return;
      e.preventDefault();
    });
    clearBtn.addEventListener("click", () => {
      if (clearBtn.disabled) return;
      // Use the sentinel to explicitly override category defaults.
      if (setBg) setBg("none");
      refresh();
    });
  }

  return { refresh };
}

// Categories edit modal
const catEditModal = document.getElementById("catEditModal");
const catEditErr = document.getElementById("catEditErr");
const catEditTitle = document.getElementById("catEditTitle");
const catEditKind = document.getElementById("catEditKind");
const catEditId = document.getElementById("catEditId");
const catEditName = document.getElementById("catEditName");
const catEditGroupWrap = document.getElementById("catEditGroupWrap");
const catEditGroupId = document.getElementById("catEditGroupId");
const catEditSave = document.getElementById("catEditSave");
const catEditCancel = document.getElementById("catEditCancel");
const catEditDelete = document.getElementById("catEditDelete");

function openCatEditModal({ kind, id, name, groupId }) {
  if (!catEditModal || !catEditKind || !catEditId || !catEditName) return;
  show(catEditErr, "");
  catEditKind.value = String(kind || "");
  catEditId.value = String(id ?? "");
  catEditName.value = String(name ?? "");

  const isCategory = kind === "category";
  if (catEditTitle) catEditTitle.textContent = isCategory ? "Edit category" : "Edit group";
  if (catEditGroupWrap) catEditGroupWrap.style.display = isCategory ? "block" : "none";
  if (catEditDelete) catEditDelete.style.display = id != null && id !== "" ? "block" : "none";

  if (isCategory && catEditGroupId) {
    catEditGroupId.innerHTML = "";
    for (const g of state.categoryTree?.groups || []) {
      const o = document.createElement("option");
      o.value = String(g.id);
      o.textContent = String(g.name);
      catEditGroupId.appendChild(o);
    }
    if (groupId != null && groupId !== "" && catEditGroupId.querySelector(`option[value="${String(groupId)}"]`)) {
      catEditGroupId.value = String(groupId);
    }
  }

  catEditModal.classList.add("modal-overlay--open");
  catEditModal.setAttribute("aria-hidden", "false");
  // Focus the name field for quick edit.
  try {
    catEditName.focus();
    catEditName.select();
  } catch (_) {}
}

function closeCatEditModal() {
  if (!catEditModal) return;
  catEditModal.classList.remove("modal-overlay--open");
  catEditModal.setAttribute("aria-hidden", "true");
}

if (catEditCancel) catEditCancel.addEventListener("click", () => closeCatEditModal());
if (catEditModal) {
  catEditModal.addEventListener("click", (e) => {
    if (e.target === catEditModal) closeCatEditModal();
  });
}

if (catEditSave) {
  catEditSave.addEventListener("click", async () => {
    try {
      show(catEditErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");
      const kind = String(catEditKind?.value || "");
      const idRaw = String(catEditId?.value || "").trim();
      const id = idRaw ? Number(idRaw) : null;
      const name = String(catEditName?.value || "").trim();
      if (!name) throw new Error("Name is required");

      if (kind === "group") {
        if (name.trim().toLowerCase() === "new group") {
          throw new Error('Please choose a more specific group name (not "New group").');
        }
        // Update DOM group name input, then persist via existing tree layout API.
        const gEl = categoriesTree?.querySelector(
          `.cats-group[data-group-id="${String(id)}"], .cat-group[data-group-id="${String(id)}"]`
        );
        const inp = gEl ? gEl.querySelector("[data-group-name]") : null;
        if (inp) {
          if ("value" in inp) {
            inp.value = name;
          } else {
            inp.textContent = name;
          }
        }
        await persistCategoryTreeFromDom();
        closeCatEditModal();
        return;
      }

      if (kind === "category") {
        const groupId = catEditGroupId ? Number(catEditGroupId.value) : null;
        if (!Number.isFinite(id) || id < 1) throw new Error("Invalid category");
        await api(`/api/families/${state.activeFamilyId}/categories/${id}`, "PUT", { name, group_id: groupId });
        // Refresh categories + dependent UI.
        await loadCategories();
        await loadMonthAndCalendar();
        closeCatEditModal();
        return;
      }

      throw new Error("Unknown edit type");
    } catch (e) {
      show(catEditErr, e.message || "Failed to save");
    }
  });
}

if (catEditDelete) {
  catEditDelete.addEventListener("click", async () => {
    try {
      show(catEditErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");
      const kind = String(catEditKind?.value || "");
      const idRaw = String(catEditId?.value || "").trim();
      const id = idRaw ? Number(idRaw) : null;
      if (!Number.isFinite(id) || id < 1) throw new Error("Invalid selection");

      if (kind === "category") {
        const nm = String(catEditName?.value || "").trim() || "category";
        await deleteCategoryWithOptionalReassign(id, nm);
        return;
      }

      if (kind === "group") {
        const nm = String(catEditName?.value || "").trim() || "group";
        openGroupSimpleDeleteModal({
          id,
          name: nm,
          closeCatEditOnSuccess: true,
        });
        return;
      }

      throw new Error("Unknown edit type");
    } catch (e) {
      show(catEditErr, e.message || "Failed to delete");
    }
  });
}

// Balance threshold alerts (settings + calendar sidebar)
const lowBalanceResult = document.getElementById("lowBalanceResult");
const sidebarLowBalanceBanner = document.getElementById("sidebarLowBalanceBanner");
const sidebarHighBalanceBanner = document.getElementById("sidebarHighBalanceBanner");
const sidebarBalanceThresholdHint = document.getElementById("sidebarBalanceThresholdHint");
const cashOutlookHead = document.getElementById("cashOutlookHead");
// Legacy browser-local keys kept only long enough to migrate older sessions to
// the server-backed family threshold fields.
const BALANCE_THRESHOLD_MIN_KEY = "familyCashFlow_balanceThresholdMin";
const BALANCE_THRESHOLD_MAX_KEY = "familyCashFlow_balanceThresholdMax";
const BALANCE_THRESHOLD_FAMILY_ID_KEY = "familyCashFlow_balanceThresholdFamilyId";
/** @deprecated migrate to BALANCE_THRESHOLD_MIN_KEY */
const LOW_BALANCE_THRESHOLD_KEY = "familyCashFlow_lowBalanceThreshold";
let lowBalanceDebounceTimer = null;
let balanceThresholdPersistTimer = null;
let balanceThresholdSavedHideTimer = null;
/** True while the user has edited threshold fields but not saved yet (blocks hydrate clobber). */
let balanceThresholdFieldsDirty = false;
/** Prevents overlapping explicit Save clicks. */
let balanceThresholdSaveInFlight = false;
/** Used to ignore a pending silent persist that was scheduled before an explicit Save (race on blur/click ordering). */
let lastExplicitBalanceThresholdSaveMs = 0;
let lowBalanceLastQuery = { familyId: null, min: null, max: null, mode: null };

/**
 * Parse threshold field text (min/max). Empty string disables that side.
 * Allows $, commas, and spaces so blur/Save does not wipe user intent like native type="number" can.
 * @returns {{ ok: true, empty: true, canonical: string, num: null } | { ok: true, empty: false, canonical: string, num: number } | { ok: false }}
 */
function parseBalanceThresholdFieldRaw(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: true, empty: true, canonical: "", num: null };
  const cleaned = trimmed.replace(/[$,\s]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return { ok: false };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { ok: false };
  return { ok: true, empty: false, canonical: String(n), num: n };
}

/** Maximum threshold: 0 is treated as "off" (same as blank) so we never persist a misleading ceiling of $0. */
function parseBalanceThresholdMaxFieldRaw(raw) {
  const p = parseBalanceThresholdFieldRaw(raw);
  if (!p.ok || p.empty) return p;
  if (p.num === 0) return { ok: true, empty: true, canonical: "", num: null };
  return p;
}

function balanceThresholdAmountsEqual(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

function formatBalanceThresholdInputValue(num, rawInput) {
  if (!Number.isFinite(num)) return "";
  return fmtMoneyThreshold(String(rawInput ?? ""), num);
}

function showBalanceThresholdNoOpFeedback({ errEl, saveBtn, savedMsg, minVal }) {
  show(errEl, "");
  if (savedMsg) {
    savedMsg.textContent =
      minVal != null
        ? `Minimum balance $${formatBalanceThresholdInputValue(minVal, String(minVal))} is already saved.`
        : "Enter a minimum balance amount, then click Save.";
    savedMsg.hidden = false;
    if (balanceThresholdSavedHideTimer) clearTimeout(balanceThresholdSavedHideTimer);
    balanceThresholdSavedHideTimer = window.setTimeout(() => {
      balanceThresholdSavedHideTimer = null;
      savedMsg.textContent = "";
      savedMsg.hidden = true;
    }, 5000);
  }
  if (saveBtn) {
    const prev =
      saveBtn.dataset.origLabel && saveBtn.dataset.origLabel.length
        ? saveBtn.dataset.origLabel
        : saveBtn.textContent.trim();
    saveBtn.dataset.origLabel = prev;
    saveBtn.textContent = minVal != null ? "Saved" : "Save";
    saveBtn.disabled = !!minVal;
    saveBtn.classList.toggle("is-saved", !!minVal);
    window.setTimeout(() => {
      saveBtn.textContent = saveBtn.dataset.origLabel || prev;
      saveBtn.disabled = false;
      saveBtn.classList.remove("is-saved");
    }, 2200);
  }
}

function parseMoneyRangeField(raw) {
  const p = parseBalanceThresholdFieldRaw(raw);
  if (!p.ok || p.empty) return null;
  const n = Number(p.num);
  return Number.isFinite(n) ? n : null;
}

/** Always read fresh nodes — IDs are unique; use getElementById so inputs are found even if markup moves. */
function balanceThresholdFieldEls() {
  return {
    min: document.getElementById("balanceThresholdMin"),
    max: document.getElementById("balanceThresholdMax"),
    err: document.getElementById("lowBalanceErr"),
    saveBtn: document.getElementById("balanceThresholdSaveBtn"),
    savedMsg: document.getElementById("balanceThresholdSavedMsg"),
  };
}

function activeFamilyIdForBalanceThresholds() {
  let fid = Number(state.activeFamilyId);
  if (familySelect && familySelect.value) {
    const v = Number(familySelect.value);
    if (Number.isFinite(v) && v > 0) fid = v;
  }
  return Number.isFinite(fid) && fid > 0 ? fid : null;
}

function getBalanceThresholdKey(kind, familyId) {
  const fid = Number(familyId || 0);
  if (!Number.isFinite(fid) || fid <= 0) return null;
  if (kind === "min") return `${BALANCE_THRESHOLD_MIN_KEY}:${fid}`;
  if (kind === "max") return `${BALANCE_THRESHOLD_MAX_KEY}:${fid}`;
  return null;
}

function parseBalanceThresholdForKind(kind, raw) {
  return kind === "max" ? parseBalanceThresholdMaxFieldRaw(raw) : parseBalanceThresholdFieldRaw(raw);
}

function findFamilyForBalanceThresholds(familyId = activeFamilyIdForBalanceThresholds()) {
  const fid = Number(familyId || 0);
  if (!Number.isFinite(fid) || fid <= 0) return null;
  return (state.families || []).find((x) => Number(x.id) === fid) || null;
}

function readFamilyBalanceThresholdCanonical(kind, familyId = activeFamilyIdForBalanceThresholds()) {
  const fam = findFamilyForBalanceThresholds(familyId);
  if (!fam) return "";
  const raw = kind === "max" ? fam.balance_threshold_max : fam.balance_threshold_min;
  const parsed = parseBalanceThresholdForKind(kind, raw == null ? "" : String(raw));
  return parsed.ok && !parsed.empty ? parsed.canonical : "";
}

function readFamilyBalanceThresholdNumber(kind, familyId = activeFamilyIdForBalanceThresholds()) {
  const canonical = readFamilyBalanceThresholdCanonical(kind, familyId);
  if (!canonical) return null;
  const num = Number(canonical);
  return Number.isFinite(num) ? num : null;
}

function readEditedBalanceThresholdNumber(kind) {
  const { min, max } = balanceThresholdFieldEls();
  const el = kind === "max" ? max : min;
  if (!el) return null;
  const parsed = parseBalanceThresholdForKind(kind, el.value ?? "");
  return parsed.ok && !parsed.empty && Number.isFinite(parsed.num) ? parsed.num : null;
}

function readLegacyDeviceBalanceThresholdCanonical(kind, familyId = activeFamilyIdForBalanceThresholds()) {
  const fid = Number(familyId || 0);
  if (!Number.isFinite(fid) || fid <= 0) return "";
  try {
    const storedFamilyId = localStorage.getItem(BALANCE_THRESHOLD_FAMILY_ID_KEY) || "";
    const allowLegacy = !storedFamilyId || String(storedFamilyId) === String(fid);
    const scopedKey = getBalanceThresholdKey(kind, fid);
    if (scopedKey) {
      const scopedParsed = parseBalanceThresholdForKind(kind, localStorage.getItem(scopedKey) || "");
      if (scopedParsed.ok && !scopedParsed.empty) return scopedParsed.canonical;
    }
    if (!allowLegacy) return "";
    if (kind === "min") {
      const legacyParsed = parseBalanceThresholdFieldRaw(localStorage.getItem(LOW_BALANCE_THRESHOLD_KEY) || "");
      if (legacyParsed.ok && !legacyParsed.empty) return legacyParsed.canonical;
      const oldParsed = parseBalanceThresholdFieldRaw(localStorage.getItem(BALANCE_THRESHOLD_MIN_KEY) || "");
      return oldParsed.ok && !oldParsed.empty ? oldParsed.canonical : "";
    }
    const oldMaxParsed = parseBalanceThresholdMaxFieldRaw(localStorage.getItem(BALANCE_THRESHOLD_MAX_KEY) || "");
    return oldMaxParsed.ok && !oldMaxParsed.empty ? oldMaxParsed.canonical : "";
  } catch (_) {
    return "";
  }
}

function clearLegacyDeviceBalanceThresholds(familyId = activeFamilyIdForBalanceThresholds()) {
  const fid = Number(familyId || 0);
  if (!Number.isFinite(fid) || fid <= 0) return;
  try {
    const minKey = getBalanceThresholdKey("min", fid);
    const maxKey = getBalanceThresholdKey("max", fid);
    if (minKey) localStorage.removeItem(minKey);
    if (maxKey) localStorage.removeItem(maxKey);
    const storedFamilyId = localStorage.getItem(BALANCE_THRESHOLD_FAMILY_ID_KEY) || "";
    if (!storedFamilyId || storedFamilyId === String(fid)) {
      localStorage.removeItem(LOW_BALANCE_THRESHOLD_KEY);
      localStorage.removeItem(BALANCE_THRESHOLD_MIN_KEY);
      localStorage.removeItem(BALANCE_THRESHOLD_MAX_KEY);
      localStorage.removeItem(BALANCE_THRESHOLD_FAMILY_ID_KEY);
    }
  } catch (_) {}
}

async function migrateLegacyDeviceBalanceThresholdsToAccount() {
  const fid = activeFamilyIdForBalanceThresholds();
  if (!fid) return;
  const serverMin = readFamilyBalanceThresholdCanonical("min", fid);
  const serverMax = readFamilyBalanceThresholdCanonical("max", fid);
  if (serverMin || serverMax) return;
  const legacyMin = readLegacyDeviceBalanceThresholdCanonical("min", fid);
  const legacyMax = readLegacyDeviceBalanceThresholdCanonical("max", fid);
  if (!legacyMin && !legacyMax) return;
  const minParsed = parseBalanceThresholdFieldRaw(legacyMin);
  const maxParsed = parseBalanceThresholdMaxFieldRaw(legacyMax);
  if ((!legacyMin || !minParsed.ok) && (!legacyMax || !maxParsed.ok)) return;
  try {
    const updated = await api(`/api/families/${fid}/forecast-thresholds`, "PATCH", {
      balance_threshold_min: minParsed.ok && !minParsed.empty ? minParsed.num : null,
      balance_threshold_max: maxParsed.ok && !maxParsed.empty ? maxParsed.num : null,
    });
    if (Array.isArray(state.families)) {
      const ix = state.families.findIndex((x) => Number(x.id) === Number(fid));
      if (ix >= 0) state.families[ix] = { ...state.families[ix], ...updated };
    }
    clearLegacyDeviceBalanceThresholds(fid);
  } catch (_) {}
}

function invalidateLowBalanceAlertCache() {
  lowBalanceLastQuery = { familyId: null, min: null, max: null, mode: null };
  invalidateCashOutlookProjectionCache();
}

function cashOutlookWarnIconHtml() {
  return `<span class="cash-outlook-icon cash-outlook-icon--warn" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M12 3L2 21h20L12 3z"></path>
          <path d="M12 9v5"></path>
          <path d="M12 17h.01"></path>
        </svg>
      </span>`;
}

function renderCashOutlookInsightLines(insightLines) {
  const secondary = String(insightLines[0] || "").trim();
  const tertiary = String(insightLines[1] || "").trim();
  let tertiaryHtml = escapeHtml(tertiary);
  const sep = " • ";
  const sepIdx = tertiary.indexOf(sep);
  if (sepIdx !== -1) {
    const before = tertiary.slice(0, sepIdx).trim();
    const after = tertiary.slice(sepIdx + sep.length).trim();
    tertiaryHtml = `${escapeHtml(before)}<span class="cash-outlook-card__sep" aria-hidden="true"> • </span><span class="cash-outlook-card__shortfall">${escapeHtml(
      after
    )}</span>`;
  }
  const rows = [];
  if (secondary) {
    rows.push(
      `<p class="cash-outlook-card__line cash-outlook-card__line--secondary">${escapeHtml(secondary)}</p>`
    );
  }
  if (tertiary) {
    rows.push(
      `<p class="cash-outlook-card__line cash-outlook-card__line--tertiary">${tertiaryHtml}</p>`
    );
  }
  return rows.join("");
}

function buildCashOutlookBannerBodyHtml(bodyRaw) {
  if (!bodyRaw) return "";
  const b = String(bodyRaw).trim();
  const lines = b
    .split("\n")
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  if (!lines.length) return "";

  if (lines[0] === "INSIGHT:") {
    return renderCashOutlookInsightLines(lines.slice(1));
  }

  let bodyHtml = "";
  // Special layout: hero amount + optional details.
  if (lines.length >= 1 && lines[0].startsWith("HERO:")) {
        const hero = lines[0].slice("HERO:".length).trim();
        const heroHtml = `<div class="cash-outlook-hero">${escapeHtml(hero)}</div>`;
        const rest = lines.slice(1);
        if (!rest.length) {
          bodyHtml = heroHtml;
        } else if (rest.length === 1 && !rest[0].includes(":")) {
          bodyHtml = `${heroHtml}<div class="cash-outlook-line cash-outlook-line--single">${escapeHtml(rest[0])}</div>`;
        } else {
          const kv = rest
            .map((l) => {
              const idx = l.indexOf(":");
              if (idx === -1) return `<div class="cash-outlook-kv cash-outlook-kv--single">${escapeHtml(l)}</div>`;
              const k = l.slice(0, idx).trim();
              const v = l.slice(idx + 1).trim();
              return `<div class="cash-outlook-kv"><span class="cash-outlook-k">${escapeHtml(
                k
              )}</span><span class="cash-outlook-v">${escapeHtml(v)}</span></div>`;
            })
            .join("");
          bodyHtml = `${heroHtml}<div class="cash-outlook-details cash-outlook-details--center">${kv}</div>`;
        }
      } else
      if (lines.length >= 2 && lines.slice(1).some((l) => l.includes(":"))) {
        const [subhead, ...rest] = lines;
        const sub = `<span class="cash-outlook-subhead cash-outlook-subhead--inline">${escapeHtml(subhead)}</span>`;
        const kv = rest
          .map((l) => {
            const idx = l.indexOf(":");
            if (idx === -1) return `<div class="cash-outlook-kv cash-outlook-kv--single">${escapeHtml(l)}</div>`;
            const k = l.slice(0, idx).trim();
            const v = l.slice(idx + 1).trim();
            return `<div class="cash-outlook-kv"><span class="cash-outlook-k">${escapeHtml(
              k
            )}</span><span class="cash-outlook-v">${escapeHtml(v)}</span></div>`;
          })
          .join("");
        bodyHtml = `${sub}<div class="cash-outlook-details cash-outlook-details--center">${kv}</div>`;
      } else
      if (b.startsWith("SECONDARY:")) {
        const txt = b.slice("SECONDARY:".length).trim();
        bodyHtml = `<div class="cash-outlook-secondary">${escapeHtml(txt)}</div>`;
      } else if (b.startsWith("CENTER:")) {
        const amt = b.slice("CENTER:".length).trim();
        bodyHtml = `<div class="cash-outlook-line cash-outlook-line--center"><span class="cash-outlook-amt cash-outlook-amt--center">${escapeHtml(
          amt
        )}</span></div>`;
      } else if (b.includes("|")) {
        const [l, r] = b.split("|", 2);
        bodyHtml = `<div class="cash-outlook-line"><span class="cash-outlook-date">${escapeHtml(String(l || "").trim())}</span><span class="cash-outlook-amt">${escapeHtml(String(r || "").trim())}</span></div>`;
      } else {
    bodyHtml = `<div class="cash-outlook-line cash-outlook-line--single">${escapeHtml(b)}</div>`;
  }
  return bodyHtml;
}

function buildCashOutlookBannerHtml(raw) {
  const parts = String(raw).split("\n");
  const headRaw = parts[0] ? String(parts[0]) : "";
  const bodyRaw = parts.slice(1).join("\n");
  const bodyHtml = buildCashOutlookBannerBodyHtml(bodyRaw);
  const warnHead = headRaw.trim().startsWith("⚠");
  const headline = warnHead ? headRaw.trim().replace(/^⚠\s*/, "") : headRaw;

  if (warnHead && bodyRaw.trim().startsWith("INSIGHT:")) {
    return `<div class="cash-outlook-card">
      <div class="cash-outlook-card__row">
        ${cashOutlookWarnIconHtml()}
        <div class="cash-outlook-card__body">
          <p class="cash-outlook-card__headline">${escapeHtml(headline)}</p>
          ${bodyHtml}
        </div>
      </div>
    </div>`;
  }

  let headText = escapeHtml(headRaw);
  if (warnHead) {
    headText = `${cashOutlookWarnIconHtml()}${escapeHtml(headline)}`;
  }
  return [`<strong>${headText}</strong>`, bodyHtml].filter(Boolean).join("");
}

/** @param {"off"|"danger"|"muted"} style */
function setSidebarLowBalanceBanner(text, style = "off") {
  if (!sidebarLowBalanceBanner) return;
  if (!text || style === "off") {
    sidebarLowBalanceBanner.style.display = "none";
    sidebarLowBalanceBanner.textContent = "";
    sidebarLowBalanceBanner.classList.remove("is-danger", "is-muted");
    return;
  }
  sidebarLowBalanceBanner.innerHTML = buildCashOutlookBannerHtml(text);
  sidebarLowBalanceBanner.style.display = "flex";
  sidebarLowBalanceBanner.classList.remove("is-danger", "is-muted");
  sidebarLowBalanceBanner.classList.toggle("is-danger", style === "danger");
  sidebarLowBalanceBanner.classList.toggle("is-muted", style === "muted");
}

/** @param {"off"|"high"|"muted"} style */
function setSidebarHighBalanceBanner(text, style = "off") {
  if (!sidebarHighBalanceBanner) return;
  if (!text || style === "off") {
    sidebarHighBalanceBanner.style.display = "none";
    sidebarHighBalanceBanner.textContent = "";
    sidebarHighBalanceBanner.classList.remove("is-high", "is-muted");
    return;
  }
  {
    const raw = String(text);
    const parts = raw.split("\n");
    const headText = parts[0] ? escapeHtml(parts[0]) : "";
    const bodyRaw = parts.slice(1).join("\n");
    let bodyHtml = "";
    if (bodyRaw) {
      const b = String(bodyRaw).trim();
      const lines = b
        .split("\n")
        .map((s) => String(s || "").trim())
        .filter(Boolean);
      if (lines.length >= 1 && lines[0].startsWith("HERO:")) {
        const hero = lines[0].slice("HERO:".length).trim();
        const heroHtml = `<div class="cash-outlook-hero">${escapeHtml(hero)}</div>`;
        const rest = lines.slice(1);
        if (!rest.length) {
          bodyHtml = heroHtml;
        } else if (rest.length === 1 && !rest[0].includes(":")) {
          bodyHtml = `${heroHtml}<div class="cash-outlook-line cash-outlook-line--single">${escapeHtml(rest[0])}</div>`;
        } else {
          const kv = rest
            .map((l) => {
              const idx = l.indexOf(":");
              if (idx === -1) return `<div class="cash-outlook-kv cash-outlook-kv--single">${escapeHtml(l)}</div>`;
              const k = l.slice(0, idx).trim();
              const v = l.slice(idx + 1).trim();
              return `<div class="cash-outlook-kv"><span class="cash-outlook-k">${escapeHtml(
                k
              )}</span><span class="cash-outlook-v">${escapeHtml(v)}</span></div>`;
            })
            .join("");
          bodyHtml = `${heroHtml}<div class="cash-outlook-details cash-outlook-details--center">${kv}</div>`;
        }
      } else
      if (lines.length >= 2 && lines.slice(1).some((l) => l.includes(":"))) {
        const [subhead, ...rest] = lines;
        const sub = `<span class="cash-outlook-subhead cash-outlook-subhead--inline">${escapeHtml(subhead)}</span>`;
        const kv = rest
          .map((l) => {
            const idx = l.indexOf(":");
            if (idx === -1) return `<div class="cash-outlook-kv cash-outlook-kv--single">${escapeHtml(l)}</div>`;
            const k = l.slice(0, idx).trim();
            const v = l.slice(idx + 1).trim();
            return `<div class="cash-outlook-kv"><span class="cash-outlook-k">${escapeHtml(
              k
            )}</span><span class="cash-outlook-v">${escapeHtml(v)}</span></div>`;
          })
          .join("");
        bodyHtml = `${sub}<div class="cash-outlook-details cash-outlook-details--center">${kv}</div>`;
      } else if (b.startsWith("SECONDARY:")) {
        const txt = b.slice("SECONDARY:".length).trim();
        bodyHtml = `<div class="cash-outlook-secondary">${escapeHtml(txt)}</div>`;
      } else if (b.startsWith("CENTER:")) {
        const amt = b.slice("CENTER:".length).trim();
        bodyHtml = `<div class="cash-outlook-line cash-outlook-line--center"><span class="cash-outlook-amt cash-outlook-amt--center">${escapeHtml(
          amt
        )}</span></div>`;
      } else if (b.includes("|")) {
        const [l, r] = b.split("|", 2);
        bodyHtml = `<div class="cash-outlook-line"><span class="cash-outlook-date">${escapeHtml(String(l || "").trim())}</span><span class="cash-outlook-amt">${escapeHtml(String(r || "").trim())}</span></div>`;
      } else {
        bodyHtml = `<div class="cash-outlook-line cash-outlook-line--single">${escapeHtml(b)}</div>`;
      }
    }
    sidebarHighBalanceBanner.innerHTML = [`<strong>${headText}</strong>`, bodyHtml].filter(Boolean).join("");
  }
  sidebarHighBalanceBanner.style.display = "flex";
  sidebarHighBalanceBanner.classList.remove("is-high", "is-muted");
  sidebarHighBalanceBanner.classList.toggle("is-high", style === "high");
  sidebarHighBalanceBanner.classList.toggle("is-muted", style === "muted");
}

function setSidebarBalanceThresholdHint(text) {
  if (!sidebarBalanceThresholdHint) return;
  if (!text) {
    sidebarBalanceThresholdHint.textContent = "";
    sidebarBalanceThresholdHint.hidden = true;
    return;
  }
  sidebarBalanceThresholdHint.textContent = text;
  sidebarBalanceThresholdHint.hidden = false;

  if (sidebarBalanceThresholdHint.dataset.boundClick !== "1") {
    sidebarBalanceThresholdHint.dataset.boundClick = "1";
    sidebarBalanceThresholdHint.addEventListener("click", () => {
      setActiveTopView("settings");
      // Threshold lives in Forecast Preferences now; jump straight to it.
      activateSettingsSection("preferences");
      const { min: btMin, max: btMax } = balanceThresholdFieldEls();
      const target = btMin || btMax;
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        try {
          target.focus({ preventScroll: true });
        } catch (_) {}
      }
    });
  }
}

function getRadioValue(name, fallback = "") {
  const el = document.querySelector(`input[type="radio"][name="${name}"]:checked`);
  return el && el.value ? el.value : fallback;
}

// Accounts
const accErr = document.getElementById("accErr");
const accountsList = document.getElementById("accountsList");
const accountName = document.getElementById("accountName");
const accountType = document.getElementById("accountType");
const accountStartingBalance = document.getElementById("accountStartingBalance");
const accountStartingBalanceDate = document.getElementById("accountStartingBalanceDate");
const accountEditId = document.getElementById("accountEditId");
const addAccountBtn = document.getElementById("addAccountBtn");
const saveAccountEditBtn = document.getElementById("saveAccountEditBtn");
const cancelAccountEditBtn = document.getElementById("cancelAccountEditBtn");
const openAccountModalBtn = document.getElementById("openAccountModalBtn");
const accountModal = document.getElementById("accountModal");
const accountModalTitle = document.getElementById("accountModalTitle");
const accountEditInfo = document.getElementById("accountEditInfo");
const accountEditFootnote = document.getElementById("accountEditFootnote");

function openAccountModal(mode = "add") {
  const modalEl = accountModal || document.getElementById("accountModal");
  if (!modalEl) return;
  const titleEl = accountModalTitle || document.getElementById("accountModalTitle");
  const addBtnEl = addAccountBtn || document.getElementById("addAccountBtn");
  const saveBtnEl = saveAccountEditBtn || document.getElementById("saveAccountEditBtn");
  const editInfoEl = accountEditInfo || document.getElementById("accountEditInfo");
  const footnoteEl = accountEditFootnote || document.getElementById("accountEditFootnote");
  if (titleEl) titleEl.textContent = mode === "edit" ? "Edit Account" : "Add New Account";
  if (addBtnEl) addBtnEl.style.display = mode === "edit" ? "none" : "";
  if (saveBtnEl) saveBtnEl.style.display = mode === "edit" ? "" : "none";
  if (editInfoEl) editInfoEl.hidden = mode !== "edit";
  if (footnoteEl) footnoteEl.hidden = mode !== "edit";
  modalEl.classList.add("modal-overlay--open");
  modalEl.setAttribute("aria-hidden", "false");
  try {
    (mode === "edit" ? accountStartingBalance : accountName)?.focus?.();
  } catch (_) {}
}

function closeAccountModal() {
  const modalEl = accountModal || document.getElementById("accountModal");
  if (!modalEl) return;
  modalEl.classList.remove("modal-overlay--open");
  modalEl.setAttribute("aria-hidden", "true");
}

function findAccountById(accountId) {
  const id = Number(accountId);
  if (!Number.isFinite(id)) return null;
  return (state.accounts || []).find((a) => Number(a.id) === id) || null;
}

function openAccountEditModalForAccount(account) {
  if (!account) return;
  const editIdEl = accountEditId || document.getElementById("accountEditId");
  const modalEl = accountModal || document.getElementById("accountModal");
  if (!editIdEl || !modalEl) {
    window.alert("Account editor is not available on this page. Open Settings → Accounts to edit.");
    return;
  }
  editIdEl.value = String(account.id);
  const nameEl = accountName || document.getElementById("accountName");
  const typeEl = accountType || document.getElementById("accountType");
  const balEl = accountStartingBalance || document.getElementById("accountStartingBalance");
  const balDateEl = accountStartingBalanceDate || document.getElementById("accountStartingBalanceDate");
  if (nameEl) {
    nameEl.value = account.name || "";
    nameEl.disabled = true;
  }
  if (typeEl) {
    typeEl.value = account.type || "checking";
    typeEl.disabled = true;
  }
  if (balEl) balEl.value = account.starting_balance ?? "";
  if (balDateEl) balDateEl.value = account.starting_balance_date || "";
  const errEl = accErr || document.getElementById("accErr");
  show(errEl, "");
  openAccountModal("edit");
}

function openAccountEditModalForAccountId(accountId) {
  const account = findAccountById(accountId);
  if (account) {
    closeTxAddModal();
    openAccountEditModalForAccount(account);
    return true;
  }
  return false;
}

// Transaction View: upcoming filters
const upcomingKindFilter = document.getElementById("upcomingKindFilter");
const upcomingStartDate = document.getElementById("upcomingStartDate");
const upcomingEndDate = document.getElementById("upcomingEndDate");
const upcomingSourceFilter = document.getElementById("upcomingSourceFilter");
const upcomingRecurrenceWrap = document.getElementById("upcomingRecurrenceWrap");
const upcomingRecurrenceFilter = document.getElementById("upcomingRecurrenceFilter");
const upcomingApplyBtn = document.getElementById("upcomingApplyBtn");

// Transaction Manager (Transaction View) UI
const tmSearch = document.getElementById("tmSearch");
const tmStartDate = document.getElementById("tmStartDate");
const tmEndDate = document.getElementById("tmEndDate");
const tmType = document.getElementById("tmType");
const tmStatus = document.getElementById("tmStatus");
const tmSource = document.getElementById("tmSource");
const tmFrequency = document.getElementById("tmFrequency");
const tmMinAmt = document.getElementById("tmMinAmt");
const tmMaxAmt = document.getElementById("tmMaxAmt");
const tmSummaryLine = document.getElementById("tmSummaryLine");
const tmInsightsEl = document.getElementById("tmInsights");
const tmForecastNote = document.getElementById("tmForecastNote");
const sidebarForecastHints = document.getElementById("sidebarForecastHints");
const sidebarCashInsights = document.getElementById("sidebarCashInsights");
const tmPrimaryAction = document.getElementById("tmPrimaryAction");
const tmCategory = document.getElementById("tmCategory");
const tmMoreFiltersBtn = document.getElementById("tmMoreFiltersBtn");
const tmAdvancedFilters = document.getElementById("tmAdvancedFilters");
const tmChips = document.querySelectorAll?.(".tm-chip") || [];

const TM_ROW_EDIT_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 20h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16.5 3.5a2.12 2.12 0 013 3L9 17l-4 1 1-4 10.5-10.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;

let upcomingFetchDebounce = null;
const variableTodoList = document.getElementById("variableTodoList");
const accountDetailsAccountId = document.getElementById("accountDetailsAccountId");
const accountDetailsType = document.getElementById("accountDetailsType");
const accountDetailsStarting = document.getElementById("accountDetailsStarting");

// Expected transaction series id (unified edit modal)
const expectedEditId = document.getElementById("expectedEditId");
// These IDs existed in the older "series edit" panel; keep bindings so loaders can
// safely check them (they'll be null if not present).
const expectedEditAccountId = document.getElementById("expectedEditAccountId");
const expectedEditDelete = document.getElementById("expectedEditDelete");
let selectedExpectedSeriesTx = null;

// Expected delete choice modal
const expectedDeleteModal = document.getElementById("expectedDeleteModal");
const expectedDeleteErr = document.getElementById("expectedDeleteErr");
const expectedDeleteAllBtn = document.getElementById("expectedDeleteAllBtn");
const expectedDeleteThisBtn = document.getElementById("expectedDeleteThisBtn");
const expectedDeleteFutureBtn = document.getElementById("expectedDeleteFutureBtn");
const expectedDeleteCancelBtn = document.getElementById("expectedDeleteCancelBtn");
let expectedDeleteContext = { expectedId: null, occurrenceDate: null };

// Projection
const projectionStart = document.getElementById("projectionStart");
const runProjectionBtn = document.getElementById("runProjectionBtn");
const projectionSummary = document.getElementById("projectionSummary");
const projectionErr = document.getElementById("projectionErr");
const projectionDailyList = document.getElementById("projectionDailyList");

// Calendar
const calendarMonth = document.getElementById("calendarMonth");
const calendarMonthNum = document.getElementById("calendarMonthNum");
const calendarYear = document.getElementById("calendarYear");
const calendarPrevMonth = document.getElementById("calendarPrevMonth");
const calendarNextMonth = document.getElementById("calendarNextMonth");
const calendarGoToday = document.getElementById("calendarGoToday");
const calendarMode = document.getElementById("calendarMode");
const calendarErr = document.getElementById("calendarErr");
const calendarGrid = document.getElementById("calendarGrid");
const calViewSimplified = document.getElementById("calViewSimplified");
const calViewDetailed = document.getElementById("calViewDetailed");

// 5-year projection collapse
const PROJECTION_COLLAPSED_KEY = "familyCashFlow_projectionCollapsed";
function applyProjectionCollapsed(collapsed) {
  const panel = document.getElementById("projectionPanel");
  const btn = document.getElementById("projectionCollapseBtn");
  if (!panel || !btn) return;
  panel.classList.toggle("projection-panel--collapsed", collapsed);
  btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  btn.title = collapsed ? "Expand projection" : "Collapse projection";
  try {
    localStorage.setItem(PROJECTION_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch (_) {}
}
const projectionCollapseBtn = document.getElementById("projectionCollapseBtn");
if (projectionCollapseBtn) {
  projectionCollapseBtn.addEventListener("click", () => {
    const panel = document.getElementById("projectionPanel");
    if (!panel) return;
    applyProjectionCollapsed(!panel.classList.contains("projection-panel--collapsed"));
  });
  // Collapsed by default on first load
  const stored = localStorage.getItem(PROJECTION_COLLAPSED_KEY);
  applyProjectionCollapsed(stored !== "0");
}

// Chart
const chartStart = document.getElementById("chartStart");
const chartEnd = document.getElementById("chartEnd");
const chartEndWrap = document.getElementById("chartEndWrap");
const chartDaysRange = document.getElementById("chartDaysRange");
const chartDaysLabel = document.getElementById("chartDaysLabel");
const runProjectionChartBtn = document.getElementById("runProjectionChartBtn");
const chartErr = document.getElementById("chartErr");
const projectionChartCanvas = document.getElementById("projectionChartCanvas");
const chartRangeDisplay = document.getElementById("chartRangeDisplay");
const chartRangePopover = document.getElementById("chartRangePopover");
const chartRangeCustomToggle = document.getElementById("chartRangeCustomToggle");
const chartRangeCustomFields = document.getElementById("chartRangeCustomFields");
const chartRangeCustomStart = document.getElementById("chartRangeCustomStart");
const chartRangeCustomEnd = document.getElementById("chartRangeCustomEnd");
const chartRangeApplyBtn = document.getElementById("chartRangeApplyBtn");
const chartRangeCancelBtn = document.getElementById("chartRangeCancelBtn");

let projectionChartInstance = null;
let projectionChartDefaultsApplied = false;

// Reports: Income vs. Expense
const incomeExpenseChartCanvas = document.getElementById("incomeExpenseChartCanvas");
const incomeExpenseEmpty = document.getElementById("incomeExpenseEmpty");
const incomeExpenseErr = document.getElementById("incomeExpenseErr");
const incomeExpenseGroupedBtn = document.getElementById("incomeExpenseGroupedBtn");
const incomeExpenseStackedBtn = document.getElementById("incomeExpenseStackedBtn");
const incomeExpenseNetToggle = document.getElementById("incomeExpenseNetToggle");
const incomeExpenseDownloadBtn = document.getElementById("incomeExpenseDownloadBtn");

let incomeExpenseChartInstance = null;
let incomeExpenseIsStacked = true;
let incomeExpenseShowNet = false;
/** Last weekly aggregation used to draw the income vs expense chart (for cheap toggles). */
let lastIncomeExpenseAggForChart = null;

/** Last projection series used by Reports operational panels (safe transfer, risk map, pressure). */
let lastProjectionDailyForReports = [];
let lastCashInsightsForReports = [];
/** Risk Calendar month view (YYYY-MM) and pooled daily balances for that grid. */
let riskCalendarViewYm = "";
let lastRiskCalendarDaily = [];
let reportsRiskCalendarNavWired = false;
let reportsSafeTransferChartInstance = null;

// Billing (Settings)
const billingPlanHeadlineEl = document.getElementById("billingPlanHeadline");
const billingPlanEl = document.getElementById("billingPlan");
const billingPlanContextEl = document.getElementById("billingPlanContext");
const billingFrequencyEl = document.getElementById("billingFrequency");
const billingNextDateLabelEl = document.getElementById("billingNextDateLabel");
const billingNextDateEl = document.getElementById("billingNextDate");
const billingRenewalMessageEl = document.getElementById("billingRenewalMessage");
const billingAccountStatusEl = document.getElementById("billingAccountStatus");
let billingActionsWired = false;

const BILLING_PLAN_KEY = "bw_billing_plan";
const BILLING_START_KEY = "bw_billing_start";
const BILLING_FREQUENCY_KEY = "bw_billing_frequency";

// Expected instance editing (fields live inside unified #txEditModal)
const instanceExpectedTxId = document.getElementById("instanceExpectedTxId");
const instanceRecurrence = document.getElementById("instanceRecurrence");
const instanceTwiceMonthlyFields = document.getElementById("instanceTwiceMonthlyFields");
const instanceSecondDayOfMonth = document.getElementById("instanceSecondDayOfMonth");
const instanceEndCount = document.getElementById("instanceEndCount");
const instanceAccountId = document.getElementById("instanceAccountId");
const seriesVariable = document.getElementById("seriesVariable");
const txEditRecurringUpdateBtn = document.getElementById("txEditRecurringUpdateBtn");

function updateInstanceTwiceMonthlyVisibility() {
  if (!instanceTwiceMonthlyFields || !instanceRecurrence) return;
  const r = instanceRecurrence.value;
  const on = recurrenceUsesSecondOccurrenceDate(r);
  instanceTwiceMonthlyFields.style.display = on ? "block" : "none";
  updateSecondOccurrenceFieldCopy(instanceTwiceMonthlyFields, r);
  if (on && r === "semiannual") syncInstanceSecondYearlyDateDefault();
  else if (on && r === "twice_monthly") syncInstanceSecondMonthlyDateDefault();
}

const instanceEndsMode = document.getElementById("instanceEndsMode");

/** Keep Ends chrome identical to Repeat; block interaction without native disabled styling. */
function setTxEditEndsModeInteractive(interactive) {
  if (!instanceEndsMode) return;
  instanceEndsMode.disabled = false;
  instanceEndsMode.classList.toggle("tx-field--inactive", !interactive);
  if (interactive) {
    instanceEndsMode.removeAttribute("aria-disabled");
    instanceEndsMode.removeAttribute("tabindex");
  } else {
    instanceEndsMode.setAttribute("aria-disabled", "true");
    instanceEndsMode.tabIndex = -1;
    instanceEndsMode.value = "never";
  }
}

function updateInstanceEndsDetailUi() {
  const row = document.getElementById("txEditEndCountRow");
  if (!row) return;
  const mode = instanceEndsMode?.value || "never";
  if (mode === "after_count") {
    row.hidden = false;
  } else {
    row.hidden = true;
    if (instanceEndCount) instanceEndCount.value = "";
  }
}

if (instanceRecurrence) {
  instanceRecurrence.addEventListener("change", () => {
    updateInstanceTwiceMonthlyVisibility();
    updateTxEditActualScheduleUi();
  });
}
if (instanceEndsMode) {
  instanceEndsMode.addEventListener("change", updateInstanceEndsDetailUi);
  instanceEndsMode.addEventListener("mousedown", (e) => {
    if (instanceEndsMode.classList.contains("tx-field--inactive")) e.preventDefault();
  });
  instanceEndsMode.addEventListener("keydown", (e) => {
    if (!instanceEndsMode.classList.contains("tx-field--inactive")) return;
    if (e.key === " " || e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
    }
  });
}

const txEditModal = document.getElementById("txEditModal");
const txEditInner = document.getElementById("txEditInner");
const txEditIntro = document.getElementById("txEditIntro");
const txEditId = document.getElementById("txEditId");
const txEditDate = document.getElementById("txEditDate");
const txEditKind = null;
const txEditAmount = document.getElementById("txEditAmount");
const txEditNotes = document.getElementById("txEditNotes");
const txEditErr = document.getElementById("txEditErr");
const txEditSave = document.getElementById("txEditSave");
const txEditDelete = document.getElementById("txEditDelete");
const txEditCancel = document.getElementById("txEditCancel");

if (txEditDate) {
  txEditDate.addEventListener("click", () => {
    try {
      if (typeof txEditDate.showPicker === "function") txEditDate.showPicker();
    } catch (_) {}
  });
  const syncTxEditMovedOccurrenceDate = () => {
    if (transactionEditMode !== "recurring" || !selectedExpectedInstance) return;
    const iso = normalizeIsoDate(txEditDate.value);
    if (!iso) return;
    selectedExpectedMovedToDate = iso;
    show(txEditErr, "");
  };
  txEditDate.addEventListener("change", syncTxEditMovedOccurrenceDate);
  txEditDate.addEventListener("input", syncTxEditMovedOccurrenceDate);
  txEditDate.addEventListener("change", () => {
    syncInstanceSecondMonthlyDateDefault();
    syncInstanceSecondYearlyDateDefault();
  });
}

// Reconcile day modal
const reconcileModal = document.getElementById("reconcileModal");
const reconcileErr = document.getElementById("reconcileErr");
const reconcileTitle = document.getElementById("reconcileTitle");
const reconcileBalanceBlock = document.getElementById("reconcileBalanceBlock");
const reconcileForecastBal = document.getElementById("reconcileForecastBal");
const reconcileChecked = document.getElementById("reconcileChecked");
const reconcileSaveBtn = document.getElementById("reconcileSaveBtn");
const reconcileCancelBtn = document.getElementById("reconcileCancelBtn");
let reconcileActiveDate = "";

// Add transaction modal (one-time or recurring from calendar)
const txAddModal = document.getElementById("txAddModal");
const txAddErr = document.getElementById("txAddErr");
const txAddDate = document.getElementById("txAddDate");
const txAddDateLabel = document.getElementById("txAddDateLabel");
const txAddAmount = document.getElementById("txAddAmount");
const txAddNotes = document.getElementById("txAddNotes");
const txAddRecurringBlock = document.getElementById("txAddRecurringBlock");
const txAddRecurrence = document.getElementById("txAddRecurrence");
const txAddEndsMode = document.getElementById("txAddEndsMode");
const txAddEndCount = document.getElementById("txAddEndCount");
const txAddEndDate = document.getElementById("txAddEndDate");
const txAddTwiceMonthlyFields = document.getElementById("txAddTwiceMonthlyFields");
const txAddSecondDayOfMonth = document.getElementById("txAddSecondDayOfMonth");
const txAddAccountId = document.getElementById("txAddAccountId");
const txAddVariable = document.getElementById("txAddVariable");
const txAddSave = document.getElementById("txAddSave");
const txAddCancel = document.getElementById("txAddCancel");
const txAddAmountValidation = document.getElementById("txAddAmountValidation");
const txAddCategoryValidation = document.getElementById("txAddCategoryValidation");
const txAddAccountValidation = document.getElementById("txAddAccountValidation");
const txAddDateValidation = document.getElementById("txAddDateValidation");
let txAddValidationTouched = false;
/** Category hint only after Add is clicked without a category (not when other fields are edited). */
let txAddCategoryValidationShown = false;
let txAddValidationBound = false;
let txAddSaveInFlight = false;
const TX_ADD_SAVE_LABEL = "Add transaction";

function setTxAddSaveBusy(busy) {
  txAddSaveInFlight = !!busy;
  const btn = txAddSave || document.getElementById("txAddSave");
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.textContent.trim() || TX_ADD_SAVE_LABEL;
    btn.textContent = "Adding…";
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
  } else {
    btn.textContent = btn.dataset.origLabel || TX_ADD_SAVE_LABEL;
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
  }
  if (txAddCancel) txAddCancel.disabled = !!busy;
}

function countCategoriesForTxAddKind(kind) {
  return (state.categories || []).filter((c) => categoryMatchesTransactionKind(c, kind)).length;
}

function txAddFormValidationState() {
  const amountVal = txAddAmount?.value || "";
  const amountOk = amountVal !== "" && Number(amountVal) > 0;
  const categoryId = categoryIdFromCategoryField("txAddCategoryId");
  const categoryOk = categoryId != null && Number.isFinite(Number(categoryId));
  const accountOk = !!(txAddAccountId?.value);
  const dateOk = !!(txAddDate?.value);
  return { amountOk, categoryOk, accountOk, dateOk, valid: amountOk && categoryOk && accountOk && dateOk };
}

function setTxAddFieldValidation(el, message) {
  if (!el) return;
  el.textContent = message || "";
}

function resetTxAddFormValidation() {
  txAddValidationTouched = false;
  txAddCategoryValidationShown = false;
  setTxAddFieldValidation(txAddAmountValidation, "");
  setTxAddFieldValidation(txAddCategoryValidation, "");
  setTxAddFieldValidation(txAddAccountValidation, "");
  setTxAddFieldValidation(txAddDateValidation, "");
}

function updateTxAddFormValidity(opts = {}) {
  const forceShow = !!opts.forceShow;
  const showHints = forceShow || txAddValidationTouched;
  const st = txAddFormValidationState();
  if (forceShow && !st.categoryOk) txAddCategoryValidationShown = true;
  if (showHints) {
    setTxAddFieldValidation(txAddAmountValidation, !st.amountOk ? "Enter an amount greater than zero." : "");
    setTxAddFieldValidation(txAddAccountValidation, !st.accountOk ? "Choose an account." : "");
    setTxAddFieldValidation(txAddDateValidation, !st.dateOk ? "Choose a date." : "");
  } else {
    setTxAddFieldValidation(txAddAmountValidation, "");
    setTxAddFieldValidation(txAddAccountValidation, "");
    setTxAddFieldValidation(txAddDateValidation, "");
  }
  setTxAddFieldValidation(
    txAddCategoryValidation,
    txAddCategoryValidationShown && !st.categoryOk ? "Choose a category." : ""
  );
}

function bindTxAddFormValidation() {
  if (txAddValidationBound) return;
  txAddValidationBound = true;
  const markTouched = () => {
    txAddValidationTouched = true;
    updateTxAddFormValidity();
  };
  txAddAmount?.addEventListener("input", markTouched);
  txAddDate?.addEventListener("change", () => {
    markTouched();
    syncTxAddSecondMonthlyDateDefault();
    syncTxAddSecondYearlyDateDefault();
  });
  txAddAccountId?.addEventListener("change", markTouched);
}

function txAddRepeatsActive() {
  return !!(txAddRecurrence && String(txAddRecurrence.value || "").trim() !== "");
}

function updateTxAddTwiceMonthlyVisibility() {
  if (!txAddTwiceMonthlyFields || !txAddRecurrence) return;
  const r = txAddRecurrence.value;
  const on = recurrenceUsesSecondOccurrenceDate(r);
  txAddTwiceMonthlyFields.style.display = on ? "grid" : "none";
  updateSecondOccurrenceFieldCopy(txAddTwiceMonthlyFields, r);
  if (on && r === "twice_monthly") syncTxAddSecondMonthlyDateDefault();
  else if (on && r === "semiannual") syncTxAddSecondYearlyDateDefault();
}

function syncTxAddSecondYearlyDateDefault() {
  if (!txAddSecondDayOfMonth || !txAddDate || txAddRecurrence?.value !== "semiannual") return;
  const start = normalizeIsoDate(txAddDate.value);
  if (!start) return;
  const cur = normalizeIsoDate(txAddSecondDayOfMonth.value);
  if (cur) {
    const sm = Number(start.slice(5, 7));
    const sd = Number(start.slice(8, 10));
    const cm = Number(cur.slice(5, 7));
    const cd = Number(cur.slice(8, 10));
    if (cm !== sm || cd !== sd) return;
  }
  const inferred = inferSecondYearlyIsoFromStart(start);
  if (inferred) txAddSecondDayOfMonth.value = inferred;
}

function syncInstanceSecondMonthlyDateDefault() {
  if (!instanceSecondDayOfMonth || !txEditDate || instanceRecurrence?.value !== "twice_monthly") return;
  const start = normalizeIsoDate(txEditDate.value);
  if (!start) return;
  const startDom = Number(start.slice(8, 10));
  const currentDom = readSecondDayOfMonthFromInput(instanceSecondDayOfMonth);
  if (Number.isFinite(currentDom) && currentDom !== startDom) return;
  const inferred = inferSecondMonthlyIsoFromStart(start);
  if (inferred) instanceSecondDayOfMonth.value = inferred;
}

function syncInstanceSecondYearlyDateDefault() {
  if (!instanceSecondDayOfMonth || !txEditDate || instanceRecurrence?.value !== "semiannual") return;
  const start = normalizeIsoDate(txEditDate.value);
  if (!start) return;
  const cur = normalizeIsoDate(instanceSecondDayOfMonth.value);
  if (cur) {
    const sm = Number(start.slice(5, 7));
    const sd = Number(start.slice(8, 10));
    const cm = Number(cur.slice(5, 7));
    const cd = Number(cur.slice(8, 10));
    if (cm !== sm || cd !== sd) return;
  }
  const inferred = inferSecondYearlyIsoFromStart(start);
  if (inferred) instanceSecondDayOfMonth.value = inferred;
}

/** Mortgage/rent, utilities, and credit card categories usually repeat monthly. */
function categoryImpliesMonthlyRecurrence(cat) {
  if (!cat) return false;
  const n = normalizeNameForCompare(cat.name || "");
  const g = normalizeNameForCompare(cat.group_name || "");
  const d = normalizeNameForCompare(categoryDisplayLabel(cat));
  if (n === "mortgage/rent" || n === "mortgage rent") return true;
  if ((n.includes("mortgage") && n.includes("rent")) || (d.includes("mortgage") && d.includes("rent"))) return true;
  if (g.includes("mortgage") && g.includes("rent")) return true;
  if (n === "credit card payment" || n.includes("credit card")) return true;
  if (d.includes("credit card")) return true;
  if (n === "utility" || n.includes("utility")) return true;
  if (d.includes("utility")) return true;
  if (g.includes("utility") || g.includes("utilities")) return true;
  return false;
}

/** Paycheck income usually repeats twice per month. */
function categoryImpliesTwiceMonthlyRecurrence(cat) {
  if (!cat) return false;
  const n = normalizeNameForCompare(cat.name || "");
  const d = normalizeNameForCompare(categoryDisplayLabel(cat));
  return n === "paycheck" || n.includes("paycheck") || d.includes("paycheck");
}

function resolveCategoryById(categoryId) {
  const id = Number(categoryId);
  if (!Number.isFinite(id)) return null;
  return (state.categories || []).find((c) => Number(c.id) === id) || null;
}

function applyTxAddRecurrenceValue(value) {
  if (!txAddRecurrence) return;
  if (txAddRecurrence.value === value) {
    updateTxAddRepeatingUi();
    return;
  }
  txAddRecurrence.value = value;
  txAddRecurrence.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyTxAddCategoryRecurrenceDefaults(categoryId) {
  if (!txAddRecurrence) return;
  const kind = getRadioValue("txAddKind", "income");
  const cat = resolveCategoryById(categoryId);
  if (kind === "expense" && categoryImpliesMonthlyRecurrence(cat)) {
    applyTxAddRecurrenceValue("monthly");
    return;
  }
  if (kind === "income" && categoryImpliesTwiceMonthlyRecurrence(cat)) {
    applyTxAddRecurrenceValue("twice_monthly");
  }
}

function txEditScheduleRecurrenceActive() {
  const v = String(instanceRecurrence?.value || "once").trim().toLowerCase();
  return !!v && v !== "once";
}

function applyTxEditRecurrenceValue(value) {
  if (!instanceRecurrence) return;
  if (instanceRecurrence.value === value) {
    updateTxEditActualScheduleUi();
    updateInstanceTwiceMonthlyVisibility();
    return;
  }
  instanceRecurrence.value = value;
  instanceRecurrence.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyTxEditCategoryRecurrenceDefaults(categoryId) {
  if (!instanceRecurrence || transactionEditMode !== "actual") return;
  if (txEditScheduleRecurrenceActive()) return;
  const kind = getRadioValue("txEditKind", "expense");
  const cat = resolveCategoryById(categoryId);
  if (kind === "expense" && categoryImpliesMonthlyRecurrence(cat)) {
    applyTxEditRecurrenceValue("monthly");
    return;
  }
  if (kind === "income" && categoryImpliesTwiceMonthlyRecurrence(cat)) {
    applyTxEditRecurrenceValue("twice_monthly");
  }
}

function updateTxEditActualScheduleUi() {
  if (transactionEditMode !== "actual") return;
  const on = txEditScheduleRecurrenceActive();
  const dateLabel = document.getElementById("txEditDateLabel");
  if (dateLabel) dateLabel.textContent = on ? "Start date" : "Date";
  setTxEditEndsModeInteractive(on);
  if (instanceEndCount) instanceEndCount.disabled = !on;
  if (instanceSecondDayOfMonth) instanceSecondDayOfMonth.disabled = !on;
  if (instanceAccountId) {
    instanceAccountId.disabled = !on;
    instanceAccountId.title = on ? "" : "Choose an account when you set this transaction to repeat.";
  }
  const varWrap = document.getElementById("txEditRecurringVariableWrap");
  if (varWrap) varWrap.style.display = on ? "block" : "none";
  const wrapSch = document.getElementById("txEditRecurringScheduleWrap");
  if (wrapSch) wrapSch.classList.remove("tx-edit-schedule--locked");
  try {
    updateInstanceEndsDetailUi();
  } catch (_) {}
  updateInstanceTwiceMonthlyVisibility();
}

function syncTxAddSecondMonthlyDateDefault() {
  if (!txAddSecondDayOfMonth || !txAddDate || txAddRecurrence?.value !== "twice_monthly") return;
  const start = normalizeIsoDate(txAddDate.value);
  if (!start) return;
  const startDom = Number(start.slice(8, 10));
  const currentDom = readSecondDayOfMonthFromInput(txAddSecondDayOfMonth);
  if (Number.isFinite(currentDom) && currentDom !== startDom) return;
  const inferred = inferSecondMonthlyIsoFromStart(start);
  if (inferred) txAddSecondDayOfMonth.value = inferred;
}

function updateTxAddEndsDetailUi() {
  const repeats = txAddRepeatsActive();
  const endsRow = document.getElementById("txAddEndsRow");
  const detail = document.getElementById("txAddEndDetailWrap");
  const endDateWrap = document.getElementById("txAddEndDateWrap");
  const endCountWrap = document.getElementById("txAddEndCountWrap");
  const mode = txAddEndsMode?.value || "never";
  if (!repeats) {
    if (endsRow) endsRow.hidden = true;
    if (detail) detail.hidden = true;
    if (endDateWrap) endDateWrap.hidden = true;
    if (endCountWrap) endCountWrap.hidden = true;
    if (txAddEndsMode) txAddEndsMode.value = "never";
    if (txAddEndDate) txAddEndDate.value = "";
    if (txAddEndCount) txAddEndCount.value = "";
    return;
  }
  if (endsRow) endsRow.hidden = false;
  if (mode === "never") {
    if (detail) detail.hidden = true;
    if (endDateWrap) endDateWrap.hidden = true;
    if (endCountWrap) endCountWrap.hidden = true;
    if (txAddEndDate) txAddEndDate.value = "";
    if (txAddEndCount) txAddEndCount.value = "";
  } else if (mode === "on_date") {
    if (detail) detail.hidden = false;
    if (endDateWrap) endDateWrap.hidden = false;
    if (endCountWrap) endCountWrap.hidden = true;
    if (txAddEndCount) txAddEndCount.value = "";
  } else if (mode === "after_count") {
    if (detail) detail.hidden = false;
    if (endDateWrap) endDateWrap.hidden = true;
    if (endCountWrap) endCountWrap.hidden = false;
    if (txAddEndDate) txAddEndDate.value = "";
  }
}

function updateTxAddRepeatingUi() {
  const repeats = txAddRepeatsActive();
  const twiceMonthly = txAddRecurrence?.value === "twice_monthly";
  if (txAddRecurringBlock) {
    txAddRecurringBlock.style.display = repeats && twiceMonthly ? "block" : "none";
  }
  if (txAddDateLabel) txAddDateLabel.textContent = repeats ? "Start date" : "Date";
  if (txAddRecurrence) txAddRecurrence.disabled = false;
  updateTxAddEndsDetailUi();
  const mode = txAddEndsMode?.value || "never";
  if (txAddEndCount) {
    if (!repeats) txAddEndCount.value = "";
    txAddEndCount.disabled = !repeats || mode !== "after_count";
  }
  if (txAddEndDate) {
    if (!repeats) txAddEndDate.value = "";
    txAddEndDate.disabled = !repeats || mode !== "on_date";
  }
  updateTxAddTwiceMonthlyVisibility();
}

if (txAddRecurrence) {
  txAddRecurrence.addEventListener("change", () => {
    if (!txAddRepeatsActive() && txAddEndsMode) txAddEndsMode.value = "never";
    updateTxAddRepeatingUi();
  });
}
if (txAddEndsMode) {
  txAddEndsMode.addEventListener("change", updateTxAddRepeatingUi);
}
if (txAddEndCount && txAddEndDate) {
  txAddEndCount.addEventListener("input", () => {
    if (String(txAddEndCount.value || "").trim()) txAddEndDate.value = "";
  });
  txAddEndDate.addEventListener("input", () => {
    if (String(txAddEndDate.value || "").trim()) txAddEndCount.value = "";
  });
}
bindTxAddFormValidation();
updateTxAddRepeatingUi();

{
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await api("/api/auth/logout", "POST");
      try {
        sessionStorage.removeItem(BW_API_ACCESS_TOKEN_KEY);
      } catch (_) {}
      clearAccountSetupDraftJsonStorage();
      window.location.href = "/";
    });
  }
}

function setLowBalanceResult(contentHtml, isEmpty = false) {
  if (!lowBalanceResult) return;
  lowBalanceResult.innerHTML = contentHtml || "";
  lowBalanceResult.classList.toggle("is-empty", !!isEmpty);
  lowBalanceResult.style.display = contentHtml ? "block" : "none";
}

const CASH_OUTLOOK_MIN_RECURRING_EXPENSES = 2;

function collectRecurringExpenseSeries() {
  const out = [];
  for (const tx of state.expectedTransactions || []) {
    if (!tx || String(tx.kind || "") !== "expense") continue;
    const recurrence = String(tx.recurrence || "").toLowerCase();
    if (!recurrence || recurrence === "once") continue;
    const amount = Math.abs(Number(tx.amount || 0));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    out.push({
      amount,
      monthly: estimatedMonthlyFromRecurrence(amount, recurrence),
      recurrence,
      description: String(tx.description || "Recurring").trim() || "Recurring",
    });
  }
  return out;
}

function roundSuggestedBalanceThreshold(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 200) return Math.ceil(n / 25) * 25;
  if (n < 2000) return Math.ceil(n / 50) * 50;
  if (n < 10000) return Math.ceil(n / 100) * 100;
  return Math.ceil(n / 250) * 250;
}

function computeSuggestedMinBalanceThreshold() {
  const series = collectRecurringExpenseSeries();
  if (!series.length) {
    return { ok: false, reason: "none", recurringCount: 0 };
  }
  const monthlyAmounts = series.map((s) => s.monthly).filter((n) => Number.isFinite(n) && n > 0);
  if (!monthlyAmounts.length) {
    return { ok: false, reason: "none", recurringCount: series.length };
  }
  const totalMonthly = monthlyAmounts.reduce((sum, n) => sum + n, 0);
  const largestMonthly = Math.max(...monthlyAmounts);
  if (series.length < CASH_OUTLOOK_MIN_RECURRING_EXPENSES && totalMonthly < 75) {
    return { ok: false, reason: "sparse", recurringCount: series.length, totalMonthly };
  }

  const fromLargest = largestMonthly * 1.75;
  const fromWeekly = (totalMonthly / 4.345) * 2;
  const fromMonthlyBlend = totalMonthly * 0.35;
  const raw = Math.max(fromLargest, fromWeekly, fromMonthlyBlend);
  const value = roundSuggestedBalanceThreshold(raw);
  if (!value) {
    return { ok: false, reason: "sparse", recurringCount: series.length, totalMonthly };
  }

  let basis = "your recurring expenses";
  if (fromLargest >= fromWeekly && fromLargest >= fromMonthlyBlend) {
    basis = "about 1.75× your largest monthly bill";
  } else if (fromWeekly >= fromMonthlyBlend) {
    basis = "about two weeks of typical spending";
  }

  return {
    ok: true,
    value,
    basis,
    recurringCount: series.length,
    totalMonthly,
    largestMonthly,
  };
}

function hasUserConfiguredMinBalanceThreshold(fid = activeFamilyIdForBalanceThresholds()) {
  const fam = findFamilyForBalanceThresholds(fid);
  if (fam) {
    const raw = fam.balance_threshold_min;
    if (raw != null && raw !== "") {
      const parsed = parseBalanceThresholdFieldRaw(String(raw));
      if (parsed.ok && !parsed.empty && Number.isFinite(parsed.num) && parsed.num > 0) return true;
    }
  }
  if (readFamilyBalanceThresholdCanonical("min", fid)) return true;
  if (readLegacyDeviceBalanceThresholdCanonical("min", fid)) return true;
  const edited = readEditedBalanceThresholdNumber("min");
  return edited != null && edited > 0;
}

/** Saved minimum only — no auto-suggested buffer (calendar warning colors). */
function readUserConfiguredMinBalanceThreshold(fid = activeFamilyIdForBalanceThresholds()) {
  const edited = readEditedBalanceThresholdNumber("min");
  if (edited != null && edited > 0) return edited;
  const persisted = readFamilyBalanceThresholdNumber("min", fid);
  if (persisted != null && persisted > 0) return persisted;
  const legacy = readLegacyDeviceBalanceThresholdCanonical("min", fid);
  if (legacy) {
    const parsed = parseBalanceThresholdFieldRaw(legacy);
    if (parsed.ok && !parsed.empty && Number.isFinite(parsed.num) && parsed.num > 0) return parsed.num;
  }
  return null;
}

function cashOutlookLowDataMessage(suggestionMeta = {}) {
  const count = Number(suggestionMeta.recurringCount || 0);
  if (count <= 0) {
    return "Add a few recurring bills to unlock cash alerts and transfer guidance.";
  }
  if (count === 1) {
    return "Add another recurring transaction to improve your forecast.";
  }
  return "We'll start generating cash outlook insights once more recurring expenses are added.";
}

let lastOutlookProjectionCache = { familyId: null, fetchedAt: 0, daily: [] };

function invalidateCashOutlookProjectionCache() {
  lastOutlookProjectionCache = { familyId: null, fetchedAt: 0, daily: [] };
}

async function getProjectionDailyForCashOutlook() {
  if (lastProjectionDailyForReports?.length > 1) return lastProjectionDailyForReports;
  const fid = state.activeFamilyId;
  if (!fid) return [];
  const now = Date.now();
  if (
    Number(lastOutlookProjectionCache.familyId) === Number(fid) &&
    now - lastOutlookProjectionCache.fetchedAt < 90_000 &&
    Array.isArray(lastOutlookProjectionCache.daily) &&
    lastOutlookProjectionCache.daily.length > 1
  ) {
    return lastOutlookProjectionCache.daily;
  }
  const startIso = toISODate(new Date());
  try {
    const summary = await api(
      `/api/families/${fid}/projection?start=${encodeURIComponent(startIso)}&days=150&include_accounts=false`,
      "GET"
    );
    const daily = summary?.daily || [];
    lastOutlookProjectionCache = { familyId: Number(fid), fetchedAt: now, daily };
    return daily;
  } catch (_) {
    return [];
  }
}

async function refreshCashOutlookGuidance() {
  const activeFid = activeFamilyIdForBalanceThresholds();
  if (cashOutlookHead) cashOutlookHead.hidden = false;
  setSidebarLowBalanceBanner("", "off");
  setSidebarHighBalanceBanner("", "off");
  setLowBalanceResult("", true);

  const suggestion = computeSuggestedMinBalanceThreshold();
  if (!suggestion.ok) {
    const msg = cashOutlookLowDataMessage(suggestion);
    setSidebarBalanceThresholdHint("Cash outlook");
    setSidebarLowBalanceBanner(`Getting started\nSECONDARY:${msg}`, "muted");
    if (sidebarLowBalanceBanner) sidebarLowBalanceBanner.classList.add("is-suggestion");
    lowBalanceLastQuery = {
      familyId: activeFid,
      min: null,
      max: null,
      mode: calendarMode?.value || "both",
    };
    return;
  }

  const floor = suggestion.value;
  setSidebarBalanceThresholdHint("From your forecast · change in Settings");

  const daily = await getProjectionDailyForCashOutlook();
  const todayIso = toISODate(new Date());
  let bannerText = `Your target buffer: $${fmtMoney0(floor)}\nSECONDARY:Based on ${suggestion.basis}`;
  let bannerStyle = "muted";

  if (daily.length > 1) {
    const rows = getProjectedBalancesByDate(daily);
    const rangeEnd = rows[rows.length - 1]?.date || todayIso;
    const nextLow = getNextBelowFloorDate(rows, floor, todayIso);
    const series = computeSafeToTransferSeries(daily, floor);
    const todayIdx = rows.findIndex((row) => row.date >= todayIso);
    const safeToday = todayIdx >= 0 ? Number(series[todayIdx] || 0) : 0;

    if (nextLow) {
      const bal = Number(nextLow.amount);
      const urgent = bal <= 0 || bal < floor * 0.85;
      bannerStyle = urgent ? "danger" : "muted";
      if (urgent) {
        bannerText = `Consider adding cash before ${fmtMonthDay(nextLow.date)}\nSECONDARY:Projected balance ${fmtMoney0SignedDollar(
          bal
        )} — target buffer $${fmtMoney0(floor)}`;
      } else {
        bannerText = `Balance may be tight on ${fmtMonthDay(nextLow.date)}\nSECONDARY:Could dip near your $${fmtMoney0(
          floor
        )} target buffer`;
      }
    } else if (safeToday >= 75) {
      bannerText = `You could move up to $${fmtMoney0(safeToday)} today\nSECONDARY:With your $${fmtMoney0(
        floor
      )} target buffer held aside`;
    } else {
      const low = getLowestBalanceInRange(rows, todayIso, rangeEnd);
      if (low && low.amount >= floor) {
        bannerText = `Steady through the month\nSECONDARY:Lowest balance ${fmtMoney0SignedDollar(
          low.amount
        )} on ${fmtMonthDay(low.date)} — above your $${fmtMoney0(floor)} target buffer`;
      }
    }

    const transfer = compareSafeToTransferTodayVsFuture(rows, floor, {
      startIso: todayIso,
      endIso: rangeEnd,
      fromIso: todayIso,
    });
    if (transfer && !nextLow) {
      bannerText = `You'll have extra cash available after ${fmtMonthDay(transfer.date)}\nSECONDARY:About $${fmtMoney0(
        transfer.gain
      )} available beyond your target buffer`;
    }
  }

  setSidebarLowBalanceBanner(bannerText, bannerStyle);
  if (sidebarLowBalanceBanner) {
    sidebarLowBalanceBanner.classList.toggle("is-suggestion", bannerStyle !== "danger");
  }
  lowBalanceLastQuery = {
    familyId: activeFid,
    min: floor,
    max: null,
    mode: `suggested:${calendarMode?.value || "both"}`,
  };
}

async function refreshLowBalanceAlert() {
  const { min: btMinEl, max: btMaxEl, err: btErr } = balanceThresholdFieldEls();
  try {
    show(btErr, "");
    const activeFid = activeFamilyIdForBalanceThresholds();
    if (!activeFid) {
      setSidebarLowBalanceBanner("", "off");
      setSidebarHighBalanceBanner("", "off");
      setSidebarBalanceThresholdHint("");
      setLowBalanceResult("", true);
      return;
    }

    const minP = parseBalanceThresholdFieldRaw(btMinEl?.value ?? "");
    const maxP = parseBalanceThresholdMaxFieldRaw(btMaxEl?.value ?? "");
    const minVal = minP.ok && !minP.empty ? minP.num : null;
    const maxVal = maxP.ok && !maxP.empty ? maxP.num : null;
    const minOk = minVal != null && Number.isFinite(minVal);
    const maxOk = maxVal != null && Number.isFinite(maxVal);
    const SHOW_PEAK_BALANCE = false;

    if (!minOk && !maxOk) {
      await refreshCashOutlookGuidance();
      return;
    }
    if (cashOutlookHead) cashOutlookHead.hidden = false;
    if (sidebarLowBalanceBanner) sidebarLowBalanceBanner.classList.remove("is-suggestion");

    const startIso = toISODate(new Date());
    const lowDays = 1825;
    const highDays = 180;
    const mode = calendarMode?.value || "both";
    if (
      lowBalanceLastQuery.familyId === activeFid &&
      lowBalanceLastQuery.min === minVal &&
      lowBalanceLastQuery.max === maxVal &&
      lowBalanceLastQuery.mode === mode
    ) {
      return;
    }
    lowBalanceLastQuery = { familyId: activeFid, min: minVal, max: maxVal, mode };

    setLowBalanceResult('<div class="k">Balance thresholds</div><div class="v">Checking…</div>', true);

    let lowHit = null;
    if (minOk) {
      const data = await api(
        `/api/families/${activeFid}/low-balance-first?threshold=${encodeURIComponent(String(minVal))}&start=${encodeURIComponent(
          startIso
        )}&days=${lowDays}&mode=${encodeURIComponent(mode)}`,
        "GET"
      );
      lowHit = data?.hit_date ? { date: data.hit_date, balance: toNum(data.hit_balance) } : null;
    }

    // Peak balance is intentionally hidden for now (can re-enable later).
    let highHit = null;
    let highFetchErr = null;
    if (!SHOW_PEAK_BALANCE) {
      setSidebarHighBalanceBanner("", "off");
    } else if (maxOk) {
      try {
        const dataHi = await api(
          `/api/families/${activeFid}/high-balance-first?ceiling=${encodeURIComponent(String(maxVal))}&start=${encodeURIComponent(
            startIso
          )}&days=${highDays}&mode=${encodeURIComponent(mode)}`,
          "GET"
        );
        highHit = dataHi?.hit_date ? { date: dataHi.hit_date, balance: toNum(dataHi.hit_balance) } : null;
      } catch (err) {
        highFetchErr = err;
      }
    }

    const todayIso = toISODate(new Date());
    if (lowHit) {
      const lowIso = normalizeIsoDate(lowHit.date);
      if (lowIso && lowIso < todayIso) lowHit = null;
    }
    if (highHit) {
      const highIso = normalizeIsoDate(highHit.date);
      if (highIso && highIso < todayIso) highHit = null;
    }

    const lowBalanceAlertsEnabled = readPrefAlertLowBalanceEnabled();
    const parts = [];
    if (minOk) {
      if (!lowHit) {
        parts.push(
          `<div class="balance-threshold-result-block"><div class="k">First date ≤ $${fmtMoneyThreshold(btMinEl?.value || "", minVal)}</div><div class="v">None in the next ${lowDays} days.</div></div>`
        );
        if (lowBalanceAlertsEnabled) {
          setSidebarLowBalanceBanner("✓ Within your target range", "muted");
        } else {
          setSidebarLowBalanceBanner("", "off");
        }
      } else {
        parts.push(
          `<div class="balance-threshold-result-block"><div class="k">First date ≤ $${fmtMoneyThreshold(btMinEl?.value || "", minVal)}</div><div class="v danger">${fmtDateMDY(lowHit.date)} — $${fmtMoney(lowHit.balance)}</div></div>`
        );
        const bal = Number(lowHit.balance);
        const target = Number(minVal);
        if (!lowBalanceAlertsEnabled) {
          // User opted out of the sidebar warning; the in-pane outlook still
          // surfaces the underlying date/amount above.
          setSidebarLowBalanceBanner("", "off");
        } else if (Number.isFinite(bal) && bal <= 0) {
          setSidebarLowBalanceBanner(
            `⚠ Transfer cash before ${fmtMonthDay(lowHit.date)}\nSECONDARY:Projected balance: ${fmtMoney0SignedDollar(bal)}`,
            "danger"
          );
        } else {
          const shortfall = Math.max(0, target - bal);
          setSidebarLowBalanceBanner(
            `⚠ Below target on ${fmtMonthDay(lowHit.date)}\nINSIGHT:\nMinimum balance: $${fmtMoney0(Math.abs(bal))}\nTarget: $${fmtMoney0(target)} • Short by $${fmtMoney0(shortfall)}`,
            "danger"
          );
        }
      }
    }
    if (SHOW_PEAK_BALANCE && maxOk) {
      if (highFetchErr) {
        const msg = String(highFetchErr.message || "Request failed")
          .slice(0, 160)
          .replace(/</g, "");
        parts.push(
          `<div class="balance-threshold-result-block"><div class="k">Maximum threshold</div><div class="v danger">Could not check: ${msg}</div></div>`
        );
        setSidebarHighBalanceBanner("✓ Peak balance\nCould not check", "muted");
      } else if (!highHit) {
        parts.push(
          `<div class="balance-threshold-result-block"><div class="k">First date ≥ $${fmtMoneyThreshold(btMaxEl?.value || "", maxVal)}</div><div class="v">No dates found in the next ${highDays} days.</div></div>`
        );
        setSidebarHighBalanceBanner("✓ Peak balance\nNone", "muted");
      } else {
        parts.push(
          `<div class="balance-threshold-result-block"><div class="k">First date ≥ $${fmtMoneyThreshold(btMaxEl?.value || "", maxVal)}</div><div class="v">${fmtDateMDY(highHit.date)} — $${fmtMoney(highHit.balance)}</div></div>`
        );
        setSidebarHighBalanceBanner(
          `✓ Peak balance on ${fmtMonthDay(highHit.date)}\nSECONDARY:${fmtMoney0SignedDollar(highHit.balance)}`,
          "high"
        );
      }
    }
    // Ensure the sidebar never shows peak balance while hidden.
    if (!SHOW_PEAK_BALANCE) setSidebarHighBalanceBanner("", "off");

    const hasAlert = (minOk && lowHit) || (SHOW_PEAK_BALANCE && maxOk && highHit && !highFetchErr);
    setLowBalanceResult(parts.join(""), !hasAlert);
  } catch (e) {
    show(btErr, e.message || "Failed to compute balance threshold alerts");
    setLowBalanceResult("", true);
    setSidebarLowBalanceBanner("", "off");
    setSidebarHighBalanceBanner("", "off");
    setSidebarBalanceThresholdHint("");
    lowBalanceLastQuery = { familyId: null, min: null, max: null, mode: null };
  }
}

function scheduleLowBalanceRefresh() {
  const { min, max } = balanceThresholdFieldEls();
  if (!min && !max) return;
  if (lowBalanceDebounceTimer) clearTimeout(lowBalanceDebounceTimer);
  lowBalanceDebounceTimer = setTimeout(() => refreshLowBalanceAlert(), 350);
}

function onBalanceThresholdFieldEdited() {
  balanceThresholdFieldsDirty = true;
  scheduleLowBalanceRefresh();
}

/** Load threshold inputs from the current account-backed family, with legacy device fallback only for migration. */
function hydrateBalanceThresholdInputsFromStorage(force = false) {
  const { min: minEl, max: maxEl } = balanceThresholdFieldEls();
  if (!minEl && !maxEl) return;
  if (!force && balanceThresholdFieldsDirty) return;
  try {
    const fid = activeFamilyIdForBalanceThresholds();
    if (!fid) return;
    const next = readFamilyBalanceThresholdCanonical("min", fid) || readLegacyDeviceBalanceThresholdCanonical("min", fid);
    const next2 = readFamilyBalanceThresholdCanonical("max", fid) || readLegacyDeviceBalanceThresholdCanonical("max", fid);

    if (minEl) {
      // Never wipe a non-empty field due to a storage/family mismatch.
      if (!(next === "" && String(minEl.value || "").trim())) {
        const p = parseBalanceThresholdFieldRaw(next);
        minEl.value =
          p.ok && !p.empty ? formatBalanceThresholdInputValue(p.num, next) : next;
      }
    } else if (minEl) {
      minEl.value = "";
    }

    if (maxEl) {
      if (!(next2 === "" && String(maxEl.value || "").trim())) {
        const p2 = parseBalanceThresholdMaxFieldRaw(next2);
        maxEl.value =
          p2.ok && !p2.empty ? formatBalanceThresholdInputValue(p2.num, next2) : next2;
      }
    } else if (maxEl) {
      maxEl.value = "";
    }
  } catch (_) {}
  invalidateLowBalanceAlertCache();
}

function finishBalanceThresholdSave({
  fidNum,
  minParsed,
  maxParsed,
  minEl,
  maxEl,
  errEl,
  saveBtn,
  savedMsg,
  savedText,
  toastText,
  familyPatch,
  showSavedFeedback = true,
  showToast = true,
}) {
  if (Array.isArray(state.families)) {
    const ix = state.families.findIndex((x) => Number(x.id) === Number(fidNum));
    if (ix >= 0) {
      state.families[ix] = {
        ...state.families[ix],
        ...(familyPatch || {}),
        balance_threshold_min: minParsed.empty ? null : minParsed.num,
        balance_threshold_max: maxParsed.empty ? null : maxParsed.num,
      };
    }
  }
  clearLegacyDeviceBalanceThresholds(fidNum);
  if (minEl) {
    minEl.value = minParsed.empty ? "" : formatBalanceThresholdInputValue(minParsed.num, minEl.value);
  }
  if (maxEl) {
    maxEl.value = maxParsed.empty ? "" : formatBalanceThresholdInputValue(maxParsed.num, maxEl.value);
  }
  state.activeFamilyId = fidNum;
  if (familySelect && Number(fidNum) > 0) {
    try {
      familySelect.value = String(fidNum);
    } catch (_) {}
  }
  lastExplicitBalanceThresholdSaveMs = Date.now();
  balanceThresholdFieldsDirty = false;
  show(errEl, "");
  invalidateLowBalanceAlertCache();
  if (lowBalanceDebounceTimer) clearTimeout(lowBalanceDebounceTimer);
  lowBalanceDebounceTimer = null;
  void refreshLowBalanceAlert();
  refreshCalendarCashInsights();
  if (reportsViewPanel && !reportsViewPanel.hidden && lastProjectionDailyForReports?.length > 1 && projectionChartCanvas) {
    lastCashInsightsForReports = buildCashInsightsForSurface({
      daily: lastProjectionDailyForReports,
      startIso: chartStart?.value || String(lastProjectionDailyForReports[0]?.date || ""),
      endIso:
        chartStart?.value && chartDaysRange?.value
          ? chartRangeEndIso(chartStart.value, Number(chartDaysRange.value || 0) || lastProjectionDailyForReports.length || 1)
          : String(lastProjectionDailyForReports[lastProjectionDailyForReports.length - 1]?.date || ""),
      surface: "reports",
    });
    drawProjectionChart(lastProjectionDailyForReports);
    renderReportsOperationalPanels();
  }
  if (balanceThresholdSavedHideTimer) clearTimeout(balanceThresholdSavedHideTimer);
  if (showSavedFeedback && savedMsg) {
    savedMsg.textContent = savedText;
    savedMsg.hidden = false;
  }
  if (showToast && toastText) showBwToast(toastText);
  if (showSavedFeedback) {
    balanceThresholdSavedHideTimer = window.setTimeout(() => {
      balanceThresholdSavedHideTimer = null;
      if (savedMsg) {
        savedMsg.textContent = "";
        savedMsg.hidden = true;
      }
    }, 5000);
  } else if (savedMsg) {
    savedMsg.textContent = "";
    savedMsg.hidden = true;
  }
  if (showSavedFeedback && saveBtn) {
    const prev =
      saveBtn.dataset.origLabel && saveBtn.dataset.origLabel.length
        ? saveBtn.dataset.origLabel
        : saveBtn.textContent.trim();
    saveBtn.dataset.origLabel = prev;
    saveBtn.textContent = "Saved";
    saveBtn.disabled = true;
    saveBtn.classList.add("is-saved");
    window.setTimeout(() => {
      saveBtn.textContent = saveBtn.dataset.origLabel || prev;
      saveBtn.disabled = false;
      saveBtn.classList.remove("is-saved");
    }, 2200);
  }
}

async function saveBalanceThresholds(opts = {}) {
  const silent = !!opts.silent;
  if (!silent && balanceThresholdSaveInFlight) return;
  if (balanceThresholdPersistTimer) {
    clearTimeout(balanceThresholdPersistTimer);
    balanceThresholdPersistTimer = null;
  }
  if (silent && lastExplicitBalanceThresholdSaveMs) {
    const sinceExplicit = Date.now() - lastExplicitBalanceThresholdSaveMs;
    if (sinceExplicit >= 0 && sinceExplicit < 750) return;
  }
  const { min: minEl, max: maxEl, err: errEl, saveBtn, savedMsg } = balanceThresholdFieldEls();

  const hideThresholdSavedFeedback = () => {
    if (balanceThresholdSavedHideTimer) {
      clearTimeout(balanceThresholdSavedHideTimer);
      balanceThresholdSavedHideTimer = null;
    }
    if (savedMsg) {
      savedMsg.textContent = "";
      savedMsg.hidden = true;
    }
    if (saveBtn) saveBtn.classList.remove("is-saved");
  };

  if (!minEl && !maxEl) return;
  const fidNum = activeFamilyIdForBalanceThresholds();
  if (!fidNum) {
    hideThresholdSavedFeedback();
    if (!silent) show(errEl, "Select an active family to save balance thresholds.");
    return;
  }
  const minParsed = parseBalanceThresholdFieldRaw(minEl?.value ?? "");
  const maxParsed = parseBalanceThresholdMaxFieldRaw(maxEl?.value ?? "");
  if (!minParsed.ok || !maxParsed.ok) {
    hideThresholdSavedFeedback();
    if (!silent) {
      show(
        errEl,
        "Use plain numbers for thresholds (optional $ and commas). Fix invalid entries, or leave a field blank to turn off that alert."
      );
    }
    return;
  }
  const currentMin = readFamilyBalanceThresholdNumber("min", fidNum);
  const currentMax = readFamilyBalanceThresholdNumber("max", fidNum);
  const nextMin = minParsed.empty ? null : minParsed.num;
  const nextMax = maxParsed.empty ? null : maxParsed.num;
  if (!silent && minParsed.empty && currentMin == null) {
    hideThresholdSavedFeedback();
    show(errEl, "Enter a minimum balance amount to save.");
    try {
      errEl?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    } catch (_) {}
    return;
  }
  if (
    balanceThresholdAmountsEqual(currentMin, nextMin) &&
    balanceThresholdAmountsEqual(currentMax, nextMax)
  ) {
    if (!silent) {
      balanceThresholdFieldsDirty = false;
      showBalanceThresholdNoOpFeedback({ errEl, saveBtn, savedMsg, minVal: currentMin });
    }
    invalidateLowBalanceAlertCache();
    if (lowBalanceDebounceTimer) clearTimeout(lowBalanceDebounceTimer);
    lowBalanceDebounceTimer = null;
    void refreshLowBalanceAlert();
    return;
  }

  if (!silent) balanceThresholdSaveInFlight = true;
  try {
    const updated = await api(`/api/families/${fidNum}/forecast-thresholds`, "PATCH", {
      balance_threshold_min: nextMin,
      balance_threshold_max: nextMax,
    });
    finishBalanceThresholdSave({
      fidNum,
      minParsed,
      maxParsed,
      minEl,
      maxEl,
      errEl,
      saveBtn,
      savedMsg,
      savedText: silent ? "" : "Saved for this household.",
      toastText: silent ? "" : "Safe balance threshold saved.",
      familyPatch: updated,
      showSavedFeedback: !silent,
      showToast: !silent,
    });
  } catch (e) {
    if (silent) return;
    hideThresholdSavedFeedback();
    show(errEl, e.message || "Could not save thresholds.");
    try {
      errEl?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    } catch (_) {}
    return;
  } finally {
    if (!silent) balanceThresholdSaveInFlight = false;
  }
}

function initCalendarYearOptions() {
  if (!calendarYear || calendarYear.dataset.populated === "1") return;
  calendarYear.dataset.populated = "1";
  const maxYear = Math.max(2030, new Date().getFullYear() + 1);
  for (let y = 2020; y <= maxYear; y++) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    calendarYear.appendChild(opt);
  }
}

function ensureCalendarYearOption(y) {
  if (!calendarYear) return;
  if (Number(y) < 2020 || Number(y) > 2030) return;
  const ys = String(y);
  if ([...calendarYear.options].some((o) => o.value === ys)) return;
  const opt = document.createElement("option");
  opt.value = ys;
  opt.textContent = ys;
  calendarYear.appendChild(opt);
  const opts = [...calendarYear.options].sort((a, b) => Number(a.value) - Number(b.value));
  calendarYear.innerHTML = "";
  for (const o of opts) calendarYear.appendChild(o);
}

function applyCalendarMonthToPickers(ym) {
  if (!ym || !calendarMonth) return;
  const p = String(ym).split("-");
  const y = Number(p[0]);
  const m = Number(p[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return;
  const ymStr = `${y}-${String(m).padStart(2, "0")}`;
  calendarMonth.value = ymStr;
  if (calendarMonthNum) calendarMonthNum.value = String(m);
  if (calendarYear) {
    ensureCalendarYearOption(y);
    calendarYear.value = String(y);
  }
}

function calendarYmPartsValid(ym) {
  const p = String(ym || "").split("-");
  const y = Number(p[0]);
  const mi = Number(p[1]);
  return Number.isFinite(y) && Number.isFinite(mi) && mi >= 1 && mi <= 12;
}

/** Copy visible month/year selects into hidden fields when they drift (e.g. before first full load). */
function syncCalendarMonthFromPickers() {
  if (!calendarMonthNum || !calendarYear) return;
  const y = String(calendarYear.value || "").trim();
  const m = String(calendarMonthNum.value || "").trim();
  if (!y || !m) return;
  const ym = `${y}-${String(Number(m)).padStart(2, "0")}`;
  if (calendarMonth) calendarMonth.value = ym;
  if (monthInput) monthInput.value = ym;
}

/** YYYY-MM for the calendar: hidden field, sidebar month, or visible pickers; falls back to today. */
function getCalendarViewYm() {
  let month = String((calendarMonth && calendarMonth.value) || (monthInput && monthInput.value) || "").trim();
  if (!month || !calendarYmPartsValid(month)) {
    syncCalendarMonthFromPickers();
    month = String((calendarMonth && calendarMonth.value) || (monthInput && monthInput.value) || "").trim();
  } else {
    // Hidden/sidebar month is authoritative; keep visible pickers aligned (avoids Jan 2020 HTML defaults).
    applyCalendarMonthToPickers(month);
  }
  if (!month || !calendarYmPartsValid(month)) {
    const d = new Date();
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    applyCalendarMonthToPickers(month);
    if (monthInput) monthInput.value = month;
  }
  return month;
}

async function onCalendarPickerChange() {
  if (!calendarMonth || !calendarMonthNum || !calendarYear) return;
  const y = calendarYear.value;
  const m = calendarMonthNum.value;
  const ym = `${y}-${String(Number(m)).padStart(2, "0")}`;
  calendarMonth.value = ym;
  if (monthInput) monthInput.value = ym;
  await loadMonthAndCalendar();
}

async function shiftCalendarMonth(delta) {
  const ym = (calendarMonth && calendarMonth.value) || (monthInput && monthInput.value);
  if (!ym) return;
  const p = String(ym).split("-");
  const y = Number(p[0]);
  const m = Number(p[1]);
  const d = new Date(y, m - 1 + delta, 1);
  const ny = d.getFullYear();
  const nm = d.getMonth() + 1;
  const next = `${ny}-${String(nm).padStart(2, "0")}`;
  applyCalendarMonthToPickers(next);
  if (monthInput) monthInput.value = next;
  await loadMonthAndCalendar();
}

if (monthInput) {
  monthInput.addEventListener("change", async () => {
    if (monthInput.value) applyCalendarMonthToPickers(monthInput.value);
    await loadMonthAndCalendar();
  });
}

if (calendarMonthNum) {
  calendarMonthNum.addEventListener("change", () => onCalendarPickerChange());
}
if (calendarYear) {
  calendarYear.addEventListener("change", () => onCalendarPickerChange());
}
if (calendarPrevMonth) {
  calendarPrevMonth.addEventListener("click", () => shiftCalendarMonth(-1));
}
if (calendarNextMonth) {
  calendarNextMonth.addEventListener("click", () => shiftCalendarMonth(1));
}

if (calendarGoToday) {
  calendarGoToday.addEventListener("click", async () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    applyCalendarMonthToPickers(ym);
    if (monthInput) monthInput.value = ym;
    await loadMonthAndCalendar();
  });
}

// Calendar collapse removed: calendar is always visible.

const CHART_COLLAPSED_KEY = "familyCashFlow_chartCollapsed";

function applyChartCollapsed(collapsed) {
  const panel = document.getElementById("chartPanel");
  const btn = document.getElementById("chartCollapseBtn");
  if (!panel || !btn) return;
  panel.classList.toggle("chart-panel--collapsed", collapsed);
  btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  btn.title = collapsed ? "Expand chart" : "Collapse chart";
  try {
    localStorage.setItem(CHART_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch (_) {}
}

const chartCollapseBtn = document.getElementById("chartCollapseBtn");
if (chartCollapseBtn) {
  chartCollapseBtn.addEventListener("click", () => {
    const panel = document.getElementById("chartPanel");
    if (!panel) return;
    const wasCollapsed = panel.classList.contains("chart-panel--collapsed");
    applyChartCollapsed(!wasCollapsed);
    if (wasCollapsed && projectionChartInstance) {
      requestAnimationFrame(() => projectionChartInstance.resize());
    }
  });
  try {
    if (localStorage.getItem(CHART_COLLAPSED_KEY) === "1") applyChartCollapsed(true);
  } catch (_) {}
}

const SIDEBAR_SECTION_PREFIX = "familyCashFlow_sidebar_";

function applySidebarSectionCollapsed(card, collapsed) {
  const btn = card.querySelector(".sidebar-collapse-btn");
  const key = card.dataset.sidebarKey;
  if (!key || !btn) return;
  card.classList.toggle("sidebar-section--collapsed", collapsed);
  const label = (card.querySelector(".sidebar-section-head h2")?.textContent || "section").trim();
  btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  btn.title = collapsed ? `Expand ${label}` : `Collapse ${label}`;
  try {
    localStorage.setItem(SIDEBAR_SECTION_PREFIX + key, collapsed ? "1" : "0");
  } catch (_) {}
}

document.querySelectorAll(".sidebar-section[data-sidebar-key]").forEach((card) => {
  const btn = card.querySelector(".sidebar-collapse-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    applySidebarSectionCollapsed(card, !card.classList.contains("sidebar-section--collapsed"));
  });
  let stored = null;
  try {
    stored = localStorage.getItem(SIDEBAR_SECTION_PREFIX + card.dataset.sidebarKey);
  } catch (_) {}
  // Default behavior: collapsed unless explicitly stored as expanded ("0").
  // Low Balance Alert should be expanded by default unless the user has explicitly chosen otherwise.
  const key = card.dataset.sidebarKey;
  const userSetKey = SIDEBAR_SECTION_PREFIX + key + "_userSet";
  let userSet = false;
  try {
    userSet = localStorage.getItem(userSetKey) === "1";
  } catch (_) {}

  // If this is lowBalance and the user hasn't explicitly set a preference,
  // force expanded even if older localStorage had it collapsed.
  let collapsed;
  if (key === "addTransaction" && !userSet) {
    collapsed = false;
    try {
      localStorage.setItem(SIDEBAR_SECTION_PREFIX + key, "0");
    } catch (_) {}
  } else {
    const defaultCollapsed = true;
    collapsed = stored == null ? defaultCollapsed : stored !== "0";
  }

  // Mark user-set preference once they toggle the section.
  btn.addEventListener("click", () => {
    try {
      localStorage.setItem(userSetKey, "1");
    } catch (_) {}
  });
  applySidebarSectionCollapsed(card, collapsed);
});

// Top navigation: Calendar View vs Transaction View.
const navCalendarView = document.getElementById("navCalendarView");
const navTransactionView = document.getElementById("navTransactionView");
const navSettingsView = document.getElementById("navSettingsView");
const navReportsView = document.getElementById("navReportsView");
const calendarViewPanel = document.getElementById("calendarViewPanel");
const transactionViewPanel = document.getElementById("transactionViewPanel");
const settingsViewPanel = document.getElementById("settingsViewPanel");
const reportsViewPanel = document.getElementById("reportsViewPanel");
function isChartCustomRangeActive() {
  return !!document.querySelector('.reports-horizon__btn[data-report-days="custom"].is-active');
}

function setReportsChartHorizonActive(btn) {
  document.querySelectorAll(".reports-horizon__btn[data-report-days]").forEach((b) => {
    b.classList.toggle("is-active", btn ? b === btn : false);
  });
}

function ensureChartEndForCustom() {
  if (!chartEnd || !chartStart?.value) return;
  const days = Number(chartDaysRange?.value);
  if (Number.isFinite(days) && days >= 1) {
    chartEnd.value = chartRangeEndIso(chartStart.value, days);
    return;
  }
  if (!chartEnd.value) chartEnd.value = chartRangeEndIso(chartStart.value, 30);
}

function syncReportsChartCustomUi() {
  const custom = isChartCustomRangeActive();
  for (const el of [chartEndWrap, document.getElementById("ieChartEndWrap"), document.getElementById("tbChartEndWrap")]) {
    if (el) el.hidden = !custom;
  }
}

function syncReportsChartDateMirrors() {
  const ieStart = document.getElementById("ieChartStart");
  const ieEnd = document.getElementById("ieChartEnd");
  const tbStart = document.getElementById("tbChartStart");
  const tbEnd = document.getElementById("tbChartEnd");
  if (ieStart && chartStart && ieStart !== chartStart) ieStart.value = chartStart.value;
  if (ieEnd && chartEnd && ieEnd !== chartEnd) ieEnd.value = chartEnd.value;
  if (tbStart && chartStart && tbStart !== chartStart) tbStart.value = chartStart.value;
  if (tbEnd && chartEnd && tbEnd !== chartEnd) tbEnd.value = chartEnd.value;
}

function readReportsDateRange() {
  const start = chartStart?.value || "";
  let endIso = "";
  let days = Number(chartDaysRange?.value);
  if (!Number.isFinite(days) || days < 1) days = 30;
  if (isChartCustomRangeActive() && chartEnd?.value) {
    endIso = chartEnd.value;
    if (start) days = daysInclusiveBetween(start, endIso);
  } else if (start) {
    endIso = chartRangeEndIso(start, days);
  }
  return { start, endIso, days };
}

async function applyReportsChartRange({ refreshBalance = true, refreshIncomeExpense = true, refreshTxnBreakdown = true } = {}) {
  show(chartErr, "");
  show(incomeExpenseErr, "");
  show(document.getElementById("txnBreakdownErr"), "");
  if (isChartCustomRangeActive()) {
    const cs = chartStart?.value;
    const ce = chartEnd?.value;
    if (!cs || !ce) throw new Error("Select start and end dates.");
    if (ce < cs) throw new Error("End date must be on or after start date.");
    const days = daysInclusiveBetween(cs, ce);
    if (days > 4000) throw new Error("Range cannot exceed 4000 days.");
    if (chartDaysRange) chartDaysRange.value = String(days);
    if (chartDaysLabel) chartDaysLabel.textContent = `${days} days`;
  } else if (!chartStart?.value) {
    throw new Error("Start date is required.");
  }
  syncReportsChartDateMirrors();
  syncReportsChartCustomUi();
  syncChartRangeDisplay();
  const tasks = [];
  if (refreshBalance) tasks.push(refreshProjectionChart());
  if (refreshIncomeExpense && incomeExpenseChartCanvas) tasks.push(refreshIncomeExpenseReport());
  if (refreshTxnBreakdown && document.getElementById("txnBreakdownChartCanvas")) {
    tasks.push(refreshTxnBreakdownReport());
  }
  await Promise.all(tasks);
}

function onReportsChartDateInputChanged(changedEl) {
  const ieStart = document.getElementById("ieChartStart");
  const ieEnd = document.getElementById("ieChartEnd");
  const tbStart = document.getElementById("tbChartStart");
  const tbEnd = document.getElementById("tbChartEnd");
  if (changedEl === ieStart && ieStart && chartStart) chartStart.value = ieStart.value;
  else if (changedEl === tbStart && tbStart && chartStart) chartStart.value = tbStart.value;
  else if (changedEl === chartStart && chartStart) {
    if (ieStart) ieStart.value = chartStart.value;
    if (tbStart) tbStart.value = chartStart.value;
  }
  if (changedEl === ieEnd && ieEnd && chartEnd) chartEnd.value = ieEnd.value;
  else if (changedEl === tbEnd && tbEnd && chartEnd) chartEnd.value = tbEnd.value;
  else if (changedEl === chartEnd && chartEnd) {
    if (ieEnd) ieEnd.value = chartEnd.value;
    if (tbEnd) tbEnd.value = chartEnd.value;
  }
  if (isChartCustomRangeActive() && chartStart?.value && chartEnd?.value && chartEnd.value < chartStart.value) {
    chartEnd.value = chartStart.value;
    if (ieEnd) ieEnd.value = chartEnd.value;
    if (tbEnd) tbEnd.value = chartEnd.value;
  }
  applyReportsChartRange({ refreshBalance: true, refreshIncomeExpense: true, refreshTxnBreakdown: true }).catch((err) => {
    const msg = err.message || "Failed to update reports";
    show(chartErr, msg);
    show(incomeExpenseErr, msg);
    show(document.getElementById("txnBreakdownErr"), msg);
  });
}

function wireReportsChartHorizon() {
  const toolbars = document.querySelectorAll(".reports-hub .reports-chart-toolbar");
  for (const toolbar of toolbars) {
    if (toolbar.dataset.bwHorizonBound === "1") continue;
    toolbar.dataset.bwHorizonBound = "1";
    toolbar.addEventListener("click", async (e) => {
      const btn = e.target.closest(".reports-horizon__btn[data-report-days]");
      if (!btn || !toolbar.contains(btn)) return;
      const raw = String(btn.dataset.reportDays || "");
      if (raw === "custom") {
        setReportsChartHorizonActive(btn);
        syncReportsChartCustomUi();
        ensureChartEndForCustom();
        try {
          await applyReportsChartRange({ refreshBalance: true, refreshIncomeExpense: true, refreshTxnBreakdown: true });
        } catch (err) {
          const msg = err.message || "Failed to update chart";
          show(chartErr, msg);
          show(incomeExpenseErr, msg);
          show(document.getElementById("txnBreakdownErr"), msg);
        }
        return;
      }
      const d = Number(raw);
      if (!Number.isFinite(d) || d < 1) return;
      applyReportsHorizonPresetDays(d);
      setReportsChartHorizonActive(btn);
      syncReportsChartCustomUi();
      try {
        await applyReportsChartRange({ refreshBalance: true, refreshIncomeExpense: true, refreshTxnBreakdown: true });
      } catch (err) {
        const msg = err.message || "Failed to update chart";
        show(chartErr, msg);
        show(incomeExpenseErr, msg);
        show(document.getElementById("txnBreakdownErr"), msg);
      }
    });
  }
}
wireReportsChartHorizon();
const settingsSidebarNav = document.getElementById("settingsSidebarNav");
const sidebarPendingTxCard = document.getElementById("sidebarPendingTxCard");
const sidebarPendingTxList = document.getElementById("sidebarPendingTxList");
const sidebarPendingTitle = document.getElementById("sidebarPendingTitle");
const catReportStart = document.getElementById("catReportStart");
const catReportEnd = document.getElementById("catReportEnd");

// After account creation, we show a one-time "forecast is ready" modal on first calendar load.
const BW_FORECAST_READY_POPUP_KEY = "bw_forecast_ready_popup";
const BW_FORECAST_READY_MODAL_VERSION = "8";
const catReportYearSelect = document.getElementById("catReportYearSelect");
const catReportRunBtn = document.getElementById("catReportRunBtn");
const catReportErr = document.getElementById("catReportErr");
const catReportSummary = document.getElementById("catReportSummary");
const catReportTableWrap = document.getElementById("catReportTableWrap");
const catReportPreset30 = document.getElementById("catReportPreset30");
const catReportPresetYtd = document.getElementById("catReportPresetYtd");
const catReportPresetMonth = document.getElementById("catReportPresetMonth");
let catReportYearOptionsPopulated = false;

const ACTIVE_VIEW_KEY = "familyCashFlow_activeView";
const CALENDAR_DETAIL_MODE_KEY = "familyCashFlow_calendarDetailMode"; // "simplified" | "detailed"
const PENDING_ATTENTION_CHECKED_KEY = "familyCashFlow_pendingAttentionChecked"; // JSON array of row keys

// Forecast Preferences (persisted per browser; the explicit landing-page choice
// is consulted only when no URL view= param and no last-active view exist, so
// users who navigate around still land where they left off).
const PREF_DEFAULT_LANDING_KEY = "bw_pref_default_landing"; // "calendar" | "transactions" | "reports"
const PREF_BALANCE_DISPLAY_MODE_KEY = "bw_pref_balance_display_mode"; // "projected" | "safe" | "both"
const PREF_ALERT_LOW_BALANCE_KEY = "bw_pref_alert_low_balance"; // "1" | "0" (default on)

function readPrefDefaultLanding() {
  try {
    const v = String(localStorage.getItem(PREF_DEFAULT_LANDING_KEY) || "").trim().toLowerCase();
    if (v === "calendar" || v === "transactions" || v === "reports") return v;
  } catch (_) {}
  return "";
}

function readPrefAlertLowBalanceEnabled() {
  try {
    const v = localStorage.getItem(PREF_ALERT_LOW_BALANCE_KEY);
    if (v == null) return true;
    return String(v) !== "0";
  } catch (_) {
    return true;
  }
}

function readPrefBalanceDisplayMode() {
  try {
    const v = String(localStorage.getItem(PREF_BALANCE_DISPLAY_MODE_KEY) || "").trim().toLowerCase();
    if (v === "projected" || v === "safe" || v === "both") return v;
  } catch (_) {}
  return "both";
}

/** When Pressure Points is the active report, sidebar threshold alerts tone down (see styles.css). */
function syncReportsPressureViewBodyFlag(activeReportId) {
  try {
    if (typeof document === "undefined" || !document.body) return;
    if (activeReportId === "reportCashPressure") {
      document.body.setAttribute("data-bw-pressure-report", "1");
    } else {
      document.body.removeAttribute("data-bw-pressure-report");
    }
  } catch (_) {}
}

function initReportsLeftNav() {
  if (!reportsViewPanel) return;
  if (reportsViewPanel.dataset.reportsNavInit === "1") return;
  reportsViewPanel.dataset.reportsNavInit = "1";

  const sections = [
    {
      title: "Reports",
      items: [
        { id: "chartPanel", label: "Balance Trendline" },
        { id: "reportCashTiming", label: "Income vs Expense" },
        { id: "reportTxnBreakdown", label: "Transaction Breakdown" },
        { id: "reportSafeTransfer", label: "Safe to Move" },
      ],
    },
    {
      title: "Forecast Risks",
      items: [
        { id: "reportRiskHeatmap", label: "Risk Calendar" },
        { id: "reportObligations", label: "Commitments" },
        { id: "reportCashPressure", label: "Pressure Points" },
      ],
    },
  ]
    .map((section) => ({
      ...section,
      items: section.items.filter((it) => document.getElementById(it.id)),
    }))
    .filter((section) => section.items.length);
  const ids = sections.flatMap((section) => section.items);

  if (!ids.length) return;

  // Render the report menu inside the existing app sidebar, below the
  // threshold notification pillbox.
  const sidebar = document.querySelector(".app-layout .sidebar");
  const thresholdBox = document.getElementById("sidebarBalanceThresholdAlerts");
  if (!sidebar || !thresholdBox) return;

  const existingNav = document.getElementById("reportsLeftNav");
  if (existingNav) existingNav.remove();

  const nav = document.createElement("nav");
  nav.id = "reportsLeftNav";
  nav.className = "card reports-left-nav reports-left-nav--sidebar";
  nav.setAttribute("aria-label", "Reports");

  const list = document.createElement("div");
  list.className = "reports-left-nav__list";
  nav.appendChild(list);

  thresholdBox.insertAdjacentElement("afterend", nav);

  const hub = reportsViewPanel.querySelector(".reports-hub");
  /** @type {HTMLSelectElement | null} */
  let mobileSelect = null;
  if (hub) {
    let mobileWrap = document.getElementById("reportsMobileNav");
    if (!mobileWrap) {
      mobileWrap = document.createElement("div");
      mobileWrap.id = "reportsMobileNav";
      mobileWrap.className = "reports-mobile-nav";
      hub.insertBefore(mobileWrap, hub.firstChild);
    }
    mobileWrap.replaceChildren();
    const mobileInner = document.createElement("div");
    mobileInner.className = "reports-mobile-nav__inner";
    const mobileLbl = document.createElement("label");
    mobileLbl.className = "reports-mobile-nav__label";
    mobileLbl.htmlFor = "reportsMobileNavSelect";
    mobileLbl.textContent = "Report";
    mobileSelect = document.createElement("select");
    mobileSelect.id = "reportsMobileNavSelect";
    mobileSelect.className = "reports-mobile-nav__select";
    mobileSelect.setAttribute("aria-label", "Choose a report");
    mobileInner.appendChild(mobileLbl);
    mobileInner.appendChild(mobileSelect);
    mobileWrap.appendChild(mobileInner);
  }

  const labelForId = new Map();
  for (const section of sections) {
    for (const it of section.items) labelForId.set(it.id, it.label);
  }
  if (mobileSelect) {
    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = labelForId.get(id) || id;
      mobileSelect.appendChild(opt);
    }
  }

  // Hide all other reports and show the selected one.
  const reportEls = new Map();
  for (const it of ids) {
    const card = document.getElementById(it.id);
    if (!card) continue;
    const extras = [];
    // Include the spacer just before the card (the UI uses inline height divs).
    const prev = card.previousElementSibling;
    if (prev && prev.tagName === "DIV") {
      const h = String(prev.style?.height || "").trim();
      if (h) extras.push(prev);
    }
    reportEls.set(it.id, { card, extras });
  }
  function showOnlyReport(targetId) {
    for (const [id, it] of reportEls.entries()) {
      const on = id === targetId;
      it.card.hidden = !on;
      for (const ex of it.extras) ex.hidden = !on;
    }
  }

  function setActiveNav(id) {
    for (const btn of list.querySelectorAll("button[data-target]")) {
      const active = btn.getAttribute("data-target") === id;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-current", active ? "true" : "false");
    }
    syncReportsPressureViewBodyFlag(id);
    if (mobileSelect && mobileSelect.value !== id) mobileSelect.value = id;
  }

  function activateReport(targetId) {
    const el = document.getElementById(targetId);
    if (!el) return;
    setActiveNav(targetId);
    showOnlyReport(targetId);
    requestAnimationFrame(() => {
      try {
        reflowReportChartFor(targetId);
      } catch (_) {}
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (mobileSelect) {
    mobileSelect.addEventListener("change", () => {
      activateReport(mobileSelect.value);
    });
  }

  for (const section of sections) {
    const sectionEl = document.createElement("section");
    sectionEl.className = "reports-left-nav__section";

    const title = document.createElement("div");
    title.className = "reports-left-nav__section-title";
    title.textContent = section.title;
    sectionEl.appendChild(title);

    const group = document.createElement("div");
    group.className = "reports-left-nav__group";
    sectionEl.appendChild(group);

    for (const it of section.items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "reports-left-nav__item";
      btn.textContent = it.label;
      btn.setAttribute("data-target", it.id);
      btn.addEventListener("click", () => {
        activateReport(it.id);
      });
      group.appendChild(btn);
    }

    list.appendChild(sectionEl);
  }

  // Initialize active based on first visible card.
  setActiveNav(ids[0].id);
  showOnlyReport(ids[0].id);

  // Keep active state roughly in sync while scrolling.
  let raf = 0;
  window.addEventListener(
    "scroll",
    () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const topOffset = 90; // approx header + padding
        let best = ids[0]?.id;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const it of ids) {
          const el = document.getElementById(it.id);
          if (!el) continue;
          if (el.hidden) continue;
          const r = el.getBoundingClientRect();
          const dist = Math.abs(r.top - topOffset);
          if (r.bottom > topOffset && dist < bestDist) {
            bestDist = dist;
            best = it.id;
          }
        }
        if (best) setActiveNav(best);
      });
    },
    { passive: true }
  );
}

/*
 * After a report card becomes visible, ensure the chart inside it renders at the
 * right size. If the chart was first drawn while its card was hidden, its
 * internal layout is 0×0 — Chart.js's `resize()` recomputes from the live DOM,
 * and as a hard fallback we redraw from the cached aggregation.
 */
function reflowReportChartFor(reportId) {
  if (reportId === "chartPanel") {
    if (projectionChartInstance) {
      try { projectionChartInstance.resize(); } catch (_) {}
    } else if (state.activeFamilyId) {
      void refreshProjectionChart().catch(() => {});
    }
    return;
  }
  if (reportId === "reportCashTiming") {
    if (incomeExpenseChartInstance) {
      try {
        incomeExpenseChartInstance.resize();
      } catch (_) {}
      // If the chart was first drawn at 0×0 the resize alone may leave it blank;
      // re-issue the draw from the cached aggregation so the bars actually paint.
      if (lastIncomeExpenseAggForChart) {
        try { drawIncomeExpenseChart(lastIncomeExpenseAggForChart); } catch (_) {}
      }
    } else if (state.activeFamilyId) {
      void refreshIncomeExpenseReport().catch(() => {});
    }
    return;
  }
  if (reportId === "reportTxnBreakdown") {
    if (txnBreakdownChartInstance) {
      try { txnBreakdownChartInstance.resize(); } catch (_) {}
    }
    if (lastTxnBreakdownRowsForChart?.length) {
      try { drawTxnBreakdownChart(lastTxnBreakdownRowsForChart); } catch (_) {}
    } else if (state.activeFamilyId) {
      void refreshTxnBreakdownReport().catch(() => {});
    }
    return;
  }
  if (reportId === "reportSafeTransfer") {
    if (reportsSafeTransferChartInstance) {
      try { reportsSafeTransferChartInstance.resize(); } catch (_) {}
      try { drawReportsSafeTransferChart(lastProjectionDailyForReports || []); } catch (_) {}
    } else {
      try { drawReportsSafeTransferChart(lastProjectionDailyForReports || []); } catch (_) {}
    }
    return;
  }
  if (reportId === "reportRiskHeatmap") {
    void refreshRiskCalendarMonth().catch(() => {});
    return;
  }
  if (reportId === "reportObligations") {
    try { renderReportsObligations(); } catch (_) {}
    return;
  }
  if (reportId === "reportCashPressure") {
    try { renderReportsCashPressure(lastProjectionDailyForReports || []); } catch (_) {}
  }
}

function pendingAttentionKey(it) {
  const id = it?.expected_transaction_id ?? it?.id ?? "";
  const iso = normalizeIsoDate(it?.date) || String(it?.date || "");
  return `${String(id)}@${String(iso)}`;
}

function loadPendingAttentionChecked() {
  try {
    const raw = localStorage.getItem(PENDING_ATTENTION_CHECKED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) return new Set(arr.map(String));
  } catch (_) {}
  return new Set();
}

function savePendingAttentionChecked(set) {
  try {
    localStorage.setItem(PENDING_ATTENTION_CHECKED_KEY, JSON.stringify([...set]));
  } catch (_) {}
}

function setActiveTopView(view) {
  const v =
    view === "transactions"
      ? "transactions"
      : view === "settings"
        ? "settings"
        : view === "reports"
          ? "reports"
          : "calendar";
  if (calendarViewPanel) calendarViewPanel.hidden = v !== "calendar";
  if (transactionViewPanel) transactionViewPanel.hidden = v !== "transactions";
  if (settingsViewPanel) settingsViewPanel.hidden = v !== "settings";
  if (reportsViewPanel) reportsViewPanel.hidden = v !== "reports";
  if (settingsSidebarNav) settingsSidebarNav.hidden = v !== "settings";
  if (sidebarPendingTxCard) sidebarPendingTxCard.hidden = !(v === "calendar" || v === "transactions");
  if (v === "transactions" || v === "reports") {
    // Reports use the same upcoming actuals list to power the risk heatmap's
    // "triggered by" detail; load lazily on view entry so we don't fetch on
    // every page load.
    void loadUpcomingTransactionsPanel().then(() => {
      if (v === "reports") {
        void refreshRiskCalendarMonth().catch(() => {});
      }
      if (v === "transactions") {
        try {
          if (sessionStorage.getItem("BW_OPEN_TX_UNCATEGORIZED") === "1") {
            sessionStorage.removeItem("BW_OPEN_TX_UNCATEGORIZED");
            if (typeof tmApplyQuickView === "function") tmApplyQuickView("uncategorized");
            if (typeof tmRefetchAndRender === "function") void tmRefetchAndRender();
          }
        } catch (_) {}
      }
    });
  }
  if (navCalendarView) {
    navCalendarView.classList.toggle("is-active", v === "calendar");
    navCalendarView.setAttribute("aria-selected", v === "calendar" ? "true" : "false");
  }
  if (navTransactionView) {
    navTransactionView.classList.toggle("is-active", v === "transactions");
    navTransactionView.setAttribute("aria-selected", v === "transactions" ? "true" : "false");
  }
  if (navSettingsView) {
    navSettingsView.classList.toggle("is-active", v === "settings");
    navSettingsView.setAttribute("aria-selected", v === "settings" ? "true" : "false");
  }
  if (navReportsView) {
    navReportsView.classList.toggle("is-active", v === "reports");
    navReportsView.setAttribute("aria-selected", v === "reports" ? "true" : "false");
  }
  if (v === "reports") {
    initReportsLeftNav();
    populateCatReportYearSelect();
    ensureCatReportDateDefaults();
    if (projectionChartInstance || reportsSafeTransferChartInstance) {
      requestAnimationFrame(() => {
        try {
          projectionChartInstance?.resize();
          reportsSafeTransferChartInstance?.resize();
        } catch (_) {}
      });
    } else if (projectionChartCanvas && state.activeFamilyId) {
      requestAnimationFrame(() => {
        void refreshProjectionChart().catch(() => {});
      });
    }
    if (incomeExpenseChartCanvas && state.activeFamilyId) {
      requestAnimationFrame(() => {
        void refreshIncomeExpenseReport().catch(() => {});
      });
    }
    if (document.getElementById("txnBreakdownChartCanvas") && state.activeFamilyId) {
      requestAnimationFrame(() => {
        void refreshTxnBreakdownReport().catch(() => {});
      });
    }
    requestAnimationFrame(() => {
      renderReportsOperationalPanels();
    });
    bwDispatchMilestone("first-report-visit");
  }
  if (v === "calendar") {
    lowBalanceLastQuery = { familyId: null, min: null, max: null, mode: null };
    void refreshLowBalanceAlert();
  }
  if (v === "settings") {
    renderAccountDetailsPanel();
    activateSettingsSection("accounts");
  }
  try {
    localStorage.setItem(ACTIVE_VIEW_KEY, v);
  } catch (_) {}
  try {
    document.body.dataset.bwView = v;
    if (v !== "reports") document.body.removeAttribute("data-bw-pressure-report");
  } catch (_) {}
}

if (navCalendarView) {
  navCalendarView.addEventListener("click", (e) => {
    if (e.currentTarget instanceof HTMLAnchorElement && String(e.currentTarget.getAttribute("href") || "").startsWith("/")) return;
    e.preventDefault();
    setActiveTopView("calendar");
  });
}
if (navTransactionView) {
  navTransactionView.addEventListener("click", (e) => {
    if (e.currentTarget instanceof HTMLAnchorElement && String(e.currentTarget.getAttribute("href") || "").startsWith("/")) return;
    e.preventDefault();
    setActiveTopView("transactions");
  });
}
if (navSettingsView) {
  navSettingsView.addEventListener("click", (e) => {
    if (e.currentTarget instanceof HTMLAnchorElement && String(e.currentTarget.getAttribute("href") || "").startsWith("/")) return;
    e.preventDefault();
    setActiveTopView("settings");
  });
}
if (navReportsView) {
  navReportsView.addEventListener("click", (e) => {
    if (e.currentTarget instanceof HTMLAnchorElement && String(e.currentTarget.getAttribute("href") || "").startsWith("/")) return;
    e.preventDefault();
    setActiveTopView("reports");
  });
}

document.querySelectorAll("#settingsViewPanel .settings-nav-item, #settingsSidebarNav .settings-nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const k = btn.dataset.settingsKey;
    if (!k) return;
    activateSettingsSection(k);
  });
});
if (settingsViewPanel) {
  settingsViewPanel.addEventListener("click", (e) => {
    const uncat = e.target && e.target.closest("#categoriesReviewUncatBtn");
    if (uncat) {
      e.preventDefault();
      try {
        sessionStorage.setItem("BW_OPEN_TX_UNCATEGORIZED", "1");
      } catch (_) {}
      setActiveTopView("transactions");
    }
  });
}

function populateCatReportYearSelect() {
  if (!catReportYearSelect || catReportYearOptionsPopulated) return;
  catReportYearOptionsPopulated = true;
  const y0 = new Date().getFullYear();
  for (let yr = y0 - 6; yr <= y0 + 3; yr++) {
    const o = document.createElement("option");
    o.value = String(yr);
    o.textContent = String(yr);
    catReportYearSelect.appendChild(o);
  }
}

function ensureCatReportDateDefaults() {
  if (!catReportStart || !catReportEnd) return;
  if (catReportStart.value || catReportEnd.value) return;
  const t = new Date();
  const y = t.getFullYear();
  catReportStart.value = `${y}-01-01`;
  catReportEnd.value = toISODate(t);
}

function setCatReportRange(startIso, endIso) {
  if (catReportStart) catReportStart.value = startIso;
  if (catReportEnd) catReportEnd.value = endIso;
}

function applyCatReportPreset(preset) {
  const t = new Date();
  const y = t.getFullYear();
  const m = t.getMonth();
  if (preset === "30") {
    const end = toISODate(t);
    const s = new Date(t);
    s.setDate(s.getDate() - 29);
    setCatReportRange(toISODate(s), end);
  } else if (preset === "ytd") {
    setCatReportRange(`${y}-01-01`, toISODate(t));
  } else if (preset === "month") {
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    setCatReportRange(toISODate(start), toISODate(end));
  }
  if (catReportYearSelect) catReportYearSelect.value = "";
}

function nMoney(v) {
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function renderCategoryTotalsReport(data) {
  if (!catReportTableWrap) return;
  const mode = data.mode || "actual";
  const showEst = mode === "actual_plus_estimated";
  const asOf = data.as_of ? fmtDateMDY(data.as_of) : "—";
  if (catReportSummary) {
    const rangeTxt = `${fmtDateMDY(data.start_date)} – ${fmtDateMDY(data.end_date)}`;
    catReportSummary.style.display = "block";
    catReportSummary.textContent = `${rangeTxt} · Split at ${asOf} (UTC) for estimates · Mode: ${showEst ? "actual + future estimates" : "actual only"}`;
  }

  const lines = data.lines || [];
  if (lines.length === 0) {
    catReportTableWrap.innerHTML = '<p class="meta">No category activity in this range.</p>';
    return;
  }

  const thEst = showEst
    ? '<th class="num cat-report-est">Income (est.)</th><th class="num cat-report-est">Expense (est.)</th>'
    : "";
  const rows = lines
    .map((ln) => {
      const estCells = showEst
        ? `<td class="num cat-report-est">${fmtMoney(nMoney(ln.income_estimated))}</td><td class="num cat-report-est">${fmtMoney(nMoney(ln.expense_estimated))}</td>`
        : "";
      const name = String(ln.category_name || "Select Category");
      return `<tr><td>${escapeHtml(name)}</td><td class="num">${fmtMoney(nMoney(ln.income_actual))}</td><td class="num">${fmtMoney(nMoney(ln.expense_actual))}</td>${estCells}</tr>`;
    })
    .join("");

  const footEst = showEst
    ? `<td class="num cat-report-est">${fmtMoney(nMoney(data.sum_income_estimated))}</td><td class="num cat-report-est">${fmtMoney(nMoney(data.sum_expense_estimated))}</td>`
    : "";

  catReportTableWrap.innerHTML = `
    <table class="category-report-table">
      <thead><tr>
        <th>Category</th>
        <th class="num">Income (actual)</th>
        <th class="num">Expense (actual)</th>
        ${thEst}
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td>Total</td>
        <td class="num">${fmtMoney(nMoney(data.sum_income_actual))}</td>
        <td class="num">${fmtMoney(nMoney(data.sum_expense_actual))}</td>
        ${footEst}
      </tr></tfoot>
    </table>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadCategoryTotalsReport() {
  show(catReportErr, "");
  if (!state.activeFamilyId) throw new Error("Choose a family first");
  if (!catReportStart?.value || !catReportEnd?.value) throw new Error("Start and end dates are required");
  const mode = getRadioValue("catReportMode", "actual");
  const q = new URLSearchParams({
    start_date: catReportStart.value,
    end_date: catReportEnd.value,
    mode,
  });
  const data = await api(`/api/families/${state.activeFamilyId}/reports/category-totals?${q.toString()}`, "GET");
  renderCategoryTotalsReport(data);
}

if (catReportPreset30) {
  catReportPreset30.addEventListener("click", () => {
    applyCatReportPreset("30");
  });
}
if (catReportPresetYtd) {
  catReportPresetYtd.addEventListener("click", () => {
    applyCatReportPreset("ytd");
  });
}
if (catReportPresetMonth) {
  catReportPresetMonth.addEventListener("click", () => {
    applyCatReportPreset("month");
  });
}
if (catReportYearSelect) {
  catReportYearSelect.addEventListener("change", () => {
    const yr = catReportYearSelect.value;
    if (!yr) return;
    setCatReportRange(`${yr}-01-01`, `${yr}-12-31`);
  });
}
if (catReportRunBtn) {
  catReportRunBtn.addEventListener("click", async () => {
    try {
      await loadCategoryTotalsReport();
    } catch (e) {
      show(catReportErr, e.message || "Failed to load report");
      if (catReportTableWrap) catReportTableWrap.innerHTML = "";
      if (catReportSummary) catReportSummary.style.display = "none";
    }
  });
}

function getInitialTopViewFromUrlOrStorage() {
  try {
    const forced = window.__BW_FORCE_VIEW ? String(window.__BW_FORCE_VIEW).trim().toLowerCase() : "";
    if (forced === "calendar" || forced === "transactions" || forced === "reports" || forced === "settings") {
      return forced;
    }
  } catch (_) {}
  try {
    const q = new URLSearchParams(window.location.search);
    const urlView = String(q.get("view") || "").trim().toLowerCase();
    if (urlView === "calendar" || urlView === "transactions" || urlView === "reports" || urlView === "settings") {
      return urlView;
    }
  } catch (_) {}
  try {
    const storedView = localStorage.getItem(ACTIVE_VIEW_KEY);
    const v = storedView ? String(storedView) : "";
    if (v === "calendar" || v === "transactions" || v === "reports" || v === "settings") {
      return v;
    }
  } catch (_) {}
  // Honor the user's chosen Default landing page when there's no stored view
  // (fresh device / cleared storage). It deliberately does NOT override the
  // last-active view above, so navigating around still sticks across reloads.
  const prefLanding = readPrefDefaultLanding();
  if (prefLanding) return prefLanding;
  return "calendar";
}

try {
  setActiveTopView(getInitialTopViewFromUrlOrStorage());
} catch (_) {}

try {
  const u = new URL(window.location.href);
  if (u.searchParams.has("view")) {
    u.searchParams.delete("view");
    const qs = u.searchParams.toString();
    window.history.replaceState({}, "", `${u.pathname}${qs ? `?${qs}` : ""}${u.hash}`);
  }
} catch (_) {}

function setCalendarDetailMode(mode) {
  const m = mode === "detailed" ? "detailed" : "simplified";
  state.calendarDetailMode = m;
  if (calViewSimplified) calViewSimplified.classList.toggle("is-active", m === "simplified");
  if (calViewDetailed) calViewDetailed.classList.toggle("is-active", m === "detailed");
  try {
    localStorage.setItem(CALENDAR_DETAIL_MODE_KEY, m);
  } catch (_) {}
  // Detailed-only state should not leak into simplified view.
  if (m !== "detailed" && state.calendarExpandedDays) state.calendarExpandedDays.clear();
  renderCalendar();
}

try {
  const storedMode = localStorage.getItem(CALENDAR_DETAIL_MODE_KEY);
  if (storedMode) state.calendarDetailMode = storedMode === "detailed" ? "detailed" : "simplified";
} catch (_) {}

if (calViewSimplified) calViewSimplified.addEventListener("click", () => setCalendarDetailMode("simplified"));
if (calViewDetailed) calViewDetailed.addEventListener("click", () => setCalendarDetailMode("detailed"));
// Default month before first render so the grid is not cleared with an empty YYYY-MM.
setDefaultMonth();
// Apply initial toggle state
setCalendarDetailMode(state.calendarDetailMode);

// Calendar mode selector is intentionally hidden in the UI (defaults to "both"),
// but keep the handler wired if it is re-enabled later.
if (calendarMode) {
  calendarMode.addEventListener("change", async () => {
    await loadCalendarMonthDaily();
    renderCalendar();
    renderMonthSummaryTotalsFromState();
    await refreshLowBalanceAlert();
    if (document.getElementById("txnBreakdownChartCanvas")) {
      void refreshTxnBreakdownReport().catch(() => {});
    }
  });
}

familySelect.addEventListener("change", async () => {
  state.activeFamilyId = Number(familySelect.value);
  riskCalendarViewYm = "";
  lastRiskCalendarDaily = [];
  syncActiveFamilyFlags();
  balanceThresholdFieldsDirty = false;
  await migrateLegacyDeviceBalanceThresholdsToAccount();
  hydrateBalanceThresholdInputsFromStorage(true);
  await loadCategories();
  await loadAccounts();
  await loadExpectedTransactions();
  await loadMonthAndCalendar();
  if (state.activeFamilyId) {
    try {
      await refreshProjectionChart();
    } catch (e) {
      show(chartErr, e.message || "Failed to load balance chart");
    }
  }
  void refreshLowBalanceAlert();
});

const familyInviteBtn = document.getElementById("familyInviteBtn");
if (familyInviteBtn) {
  familyInviteBtn.addEventListener("click", async () => {
    if (!canManageHouseholdInvites()) return;
    const emailEl = document.getElementById("familyInviteEmail");
    const accessEl = document.getElementById("familyInviteAccess");
    const errEl = document.getElementById("familyMembersErr");
    const email = emailEl ? String(emailEl.value || "").trim() : "";
    const access_mode = accessEl ? String(accessEl.value || "view") : "view";
    if (!email) {
      show(errEl, "Email is required");
      return;
    }
    if (!state.activeFamilyId) {
      show(errEl, "No family selected");
      return;
    }
    try {
      show(errEl, "");
      await api(`/api/families/${state.activeFamilyId}/members`, "POST", { email, access_mode });
      if (emailEl) emailEl.value = "";
      await loadFamilyMembersPanel();
    } catch (e) {
      show(errEl, e.message || String(e));
    }
  });
}

const familySendInviteBtn = document.getElementById("familySendInviteBtn");
if (familySendInviteBtn) {
  familySendInviteBtn.addEventListener("click", async () => {
    if (!canManageHouseholdInvites()) return;
    const emailEl = document.getElementById("familyInviteEmail");
    const accessEl = document.getElementById("familyInviteAccess");
    const errEl = document.getElementById("familyMembersErr");
    const email = emailEl ? String(emailEl.value || "").trim() : "";
    const access_mode = accessEl ? String(accessEl.value || "view") : "view";
    if (!email) {
      show(errEl, "Email is required");
      return;
    }
    if (!state.activeFamilyId) {
      show(errEl, "No family selected");
      return;
    }
    try {
      show(errEl, "");
      const out = await api(`/api/families/${state.activeFamilyId}/invites`, "POST", { email, access_mode });
      let msg = out.email_sent
        ? "Invitation email sent."
        : "Invite created but email was not sent (configure Resend or SMTP on the server). ";
      if (!out.email_sent && out.accept_url) {
        msg += `Share this link manually: ${out.accept_url}`;
      }
      show(errEl, msg);
      await loadFamilyMembersPanel();
    } catch (e) {
      show(errEl, e.message || String(e));
    }
  });
}

/** Series / transaction label on the server (add form has no separate Label field). */
function descriptionForNewTransaction(categoryId, opts = {}) {
  const recurring = !!opts.recurring;
  const cid = categoryId != null ? Number(categoryId) : NaN;
  if (Number.isFinite(cid) && (state.categories || []).length) {
    const c = (state.categories || []).find((x) => Number(x.id) === cid);
    if (c?.name && String(c.name).trim()) return String(c.name).trim().slice(0, 500);
  }
  return recurring ? "Scheduled" : "";
}

function defaultNewCategoryGroupId() {
  const g = state.categoryTree?.groups?.[0];
  return g && Number.isFinite(Number(g.id)) ? Number(g.id) : null;
}

/** Pick a category group for API-created categories based on transaction kind (Income vs expense). */
function categoryGroupIdForNewCategory(kind) {
  const groups = state.categoryTree?.groups || [];
  if (!groups.length) return defaultNewCategoryGroupId();
  const k = String(kind || "").trim().toLowerCase();
  const norm = (s) => normalizeNameForCompare(s);
  const findId = (pred) => {
    for (const g of groups) {
      const n = norm(g?.name);
      if (pred(n)) return Number(g.id);
    }
    return null;
  };
  if (k === "income") {
    const id =
      findId((n) => n === "income") ||
      findId((n) => n.includes("income")) ||
      findId((n) => n.includes("reimburse"));
    if (Number.isFinite(id)) return id;
  } else {
    const id =
      findId((n) => n === "miscellaneous") ||
      findId((n) => n.includes("misc")) ||
      findId((n) => n === "other") ||
      findId((n) => n.includes("other"));
    if (Number.isFinite(id)) return id;
  }
  return defaultNewCategoryGroupId();
}

function categoryKindForComboboxField(fieldId) {
  if (fieldId === "txAddCategoryId") return getRadioValue("txAddKind", "expense");
  if (fieldId === "txEditCategoryId") {
    return String(document.querySelector('input[name="txEditKind"]:checked')?.value || "expense").trim().toLowerCase() || "expense";
  }
  return "expense";
}

const TX_ADD_CATEGORY_CHIP_MAX = 3;
const TX_ADD_INCOME_CHIP_HINTS = ["Paycheck", "Transfer In", "Bonus", "Reimbursement", "Other Income"];
const TX_ADD_EXPENSE_CHIP_HINTS = ["Groceries", "Mortgage", "Utilities", "Credit Card", "Gas", "Subscription"];
let txAddCategoryChipsBound = false;

function categoryMatchesTransactionKind(cat, kind) {
  if (!cat) return false;
  const k = String(kind || "expense").toLowerCase();
  const g = normalizeNameForCompare(cat.group_name || "");
  const n = normalizeNameForCompare(cat.name || "");
  const incomeGroup =
    g === "income" ||
    g.includes("income") ||
    g.includes("reimburse") ||
    (g.includes("transfer") && (g.includes("in") || !g.includes("out")));
  const incomeName =
    n.includes("paycheck") ||
    n.includes("payroll") ||
    n.includes("salary") ||
    n.includes("bonus") ||
    (n.includes("transfer") && n.includes("in"));
  const isIncome = incomeGroup || incomeName;
  if (k === "income") return isIncome;
  return !isIncome;
}

function collectRecentCategoryIdsForKind(kind) {
  const rows = [
    ...(state.monthActualItems || []),
    ...(state.calendarExtraActualItems || []),
    ...(state.monthExpectedItems || []),
    ...(state.calendarExtraExpectedItems || []),
  ];
  const scored = [];
  for (const row of rows) {
    const rowKind = String(row.kind || "").toLowerCase();
    if (rowKind !== String(kind).toLowerCase()) continue;
    const cid = row.category_id;
    if (cid == null || cid === "") continue;
    const iso = normalizeIsoDate(row.date) || row.date || "";
    scored.push({ cid: Number(cid), iso });
  }
  scored.sort((a, b) => String(b.iso).localeCompare(String(a.iso)));
  const seen = new Set();
  const out = [];
  for (const { cid } of scored) {
    if (!Number.isFinite(cid) || seen.has(cid)) continue;
    seen.add(cid);
    const cat = (state.categories || []).find((c) => Number(c.id) === cid);
    if (cat && categoryMatchesTransactionKind(cat, kind)) out.push(cid);
  }
  return out;
}

function findCategoryForChipHint(hint, kind) {
  const cats = (state.categories || []).filter((c) => categoryMatchesTransactionKind(c, kind));
  const h = normalizeNameForCompare(hint);
  if (!h) return null;
  let c = cats.find((x) => normalizeNameForCompare(x.name) === h);
  if (c) return c;
  return (
    cats.find((x) => {
      const n = normalizeNameForCompare(x.name);
      return n.includes(h) || h.includes(n);
    }) || null
  );
}

function computeTxAddCategoryChipSuggestions(kind) {
  const k = String(kind || "expense").toLowerCase();
  const hints = k === "income" ? TX_ADD_INCOME_CHIP_HINTS : TX_ADD_EXPENSE_CHIP_HINTS;
  const picked = [];
  const pickedIds = new Set();

  function pushCat(cat) {
    if (!cat || cat.id == null) return;
    const id = Number(cat.id);
    if (!Number.isFinite(id) || pickedIds.has(id)) return;
    if (!categoryMatchesTransactionKind(cat, k)) return;
    pickedIds.add(id);
    picked.push(cat);
  }

  for (const cid of collectRecentCategoryIdsForKind(k)) {
    if (picked.length >= TX_ADD_CATEGORY_CHIP_MAX) break;
    pushCat((state.categories || []).find((c) => Number(c.id) === cid));
  }

  const freqSorted = (state.categories || [])
    .filter((c) => categoryMatchesTransactionKind(c, k))
    .map((c) => ({ cat: c, n: categoryAssignmentsForCategoryId(c.id) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || String(a.cat.name).localeCompare(String(b.cat.name)));

  for (const { cat } of freqSorted) {
    if (picked.length >= TX_ADD_CATEGORY_CHIP_MAX) break;
    pushCat(cat);
  }

  for (const hint of hints) {
    if (picked.length >= TX_ADD_CATEGORY_CHIP_MAX) break;
    pushCat(findCategoryForChipHint(hint, k));
  }

  return picked.slice(0, TX_ADD_CATEGORY_CHIP_MAX);
}

function refreshTxAddCategoryChipActiveState() {
  const container = document.getElementById("txAddQuickChips");
  if (!container) return;
  const cur = categoryIdFromCategoryField("txAddCategoryId");
  for (const btn of container.querySelectorAll(".tx-quick-chip:not(.tx-quick-chip--browse)")) {
    btn.classList.toggle("is-active", cur != null && Number(btn.dataset.catId) === Number(cur));
  }
}

function syncTxAddQuickChipsEmptyState(container, isEmpty) {
  if (!container) return;
  container.hidden = false;
  container.classList.toggle("is-empty", !!isEmpty);
  container.setAttribute("aria-hidden", isEmpty ? "true" : "false");
}

function appendTxAddBrowseAllChip(container) {
  const kind = getRadioValue("txAddKind", "expense");
  container.querySelector(".tx-quick-chip--browse")?.remove();
  if (countCategoriesForTxAddKind(kind) <= TX_ADD_CATEGORY_CHIP_MAX) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tx-quick-chip tx-quick-chip--browse";
  btn.textContent = "Browse all";
  btn.addEventListener("click", () => {
    const st = categoryComboboxRegistry.get("txAddCategoryId");
    if (st?.input) {
      st.input.focus();
      showCategoryComboboxList(st);
      filterCategoryCombobox("txAddCategoryId");
    }
  });
  container.appendChild(btn);
}

function renderTxAddCategoryChips() {
  const container = document.getElementById("txAddQuickChips");
  if (!container) return;
  const kind = getRadioValue("txAddKind", "expense");
  const suggestions = computeTxAddCategoryChipSuggestions(kind);
  const sig = suggestions.map((c) => c.id).join(",");
  const chipsEmpty =
    suggestions.length === 0 && countCategoriesForTxAddKind(kind) <= TX_ADD_CATEGORY_CHIP_MAX;
  if (container.dataset.kind === kind && container.dataset.sig === sig) {
    refreshTxAddCategoryChipActiveState();
    appendTxAddBrowseAllChip(container);
    syncTxAddQuickChipsEmptyState(container, chipsEmpty);
    return;
  }
  container.dataset.kind = kind;
  container.dataset.sig = sig;
  container.innerHTML = "";
  syncTxAddQuickChipsEmptyState(container, chipsEmpty);
  const cur = categoryIdFromCategoryField("txAddCategoryId");
  for (const cat of suggestions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tx-quick-chip";
    btn.textContent = String(cat.name || "").trim() || "Category";
    btn.dataset.catId = String(cat.id);
    if (cur != null && Number(cur) === Number(cat.id)) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      for (const other of container.querySelectorAll(".tx-quick-chip:not(.tx-quick-chip--browse)")) {
        other.classList.remove("is-active");
      }
      btn.classList.add("is-active");
      selectCategoryComboboxChoice("txAddCategoryId", cat.id, categoryDisplayLabel(cat));
      const st = categoryComboboxRegistry.get("txAddCategoryId");
      if (st?.input) {
        try {
          st.input.classList.add("category-combobox__input--prefilled");
          window.setTimeout(() => st.input.classList.remove("category-combobox__input--prefilled"), 600);
        } catch (_) {}
      }
      refreshTxCategoryColorPickers();
      updateTxAddFormValidity();
    });
    container.appendChild(btn);
  }
  appendTxAddBrowseAllChip(container);
}

function ensureTxAddCategoryChipsUi() {
  if (txAddCategoryChipsBound) return;
  const container = document.getElementById("txAddQuickChips");
  if (!container) return;
  txAddCategoryChipsBound = true;
  for (const r of document.querySelectorAll('input[name="txAddKind"]')) {
    r.addEventListener("change", () => {
      setCategoryFieldValue("txAddCategoryId", null);
      renderTxAddCategoryChips();
      const st = categoryComboboxRegistry.get("txAddCategoryId");
      if (st) hideCategoryComboboxList(st);
      updateTxAddFormValidity();
    });
  }
}

function normalizeNameForCompare(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function hasDuplicateCategoryGroupName(name, exceptGroupId = null) {
  const nm = normalizeNameForCompare(name);
  if (!nm) return false;
  const exceptId = exceptGroupId != null ? Number(exceptGroupId) : NaN;
  const groups = state.categoryTree?.groups || [];
  return groups.some((g) => {
    if (Number.isFinite(exceptId) && Number(g?.id) === exceptId) return false;
    return normalizeNameForCompare(g?.name) === nm;
  });
}

function hasDuplicateCategoryNameInGroup(name, groupId) {
  const nm = normalizeNameForCompare(name);
  const gid = groupId != null ? Number(groupId) : NaN;
  if (!nm || !Number.isFinite(gid)) return false;
  const groups = state.categoryTree?.groups || [];
  const g = groups.find((x) => Number(x?.id) === gid);
  const cats = g?.categories || [];
  return cats.some((c) => normalizeNameForCompare(c?.name) === nm);
}

// Helper used by the per-group inline "+ Add category" form and any
// other surface that needs to add a category to a specific group.
async function addCategoryToGroup(gid, name) {
  if (!state.activeFamilyId) throw new Error("Choose a family first");
  const nm = String(name || "").trim();
  if (!nm) throw new Error("Category name is required");
  const targetGid = Number.isFinite(Number(gid)) ? Number(gid) : defaultNewCategoryGroupId();
  if (hasDuplicateCategoryNameInGroup(nm, targetGid)) {
    const ok = window.confirm(`A category named "${nm}" already exists in this group. Create a duplicate anyway?`);
    if (!ok) return false;
  }
  await api(`/api/families/${state.activeFamilyId}/categories`, "POST", { name: nm, group_id: targetGid });
  await loadCategories();
  await loadMonthAndCalendar();
  return true;
}

// Legacy bottom-of-pane "Add category" form is no longer rendered, but
// keep the listener guarded so any test/dev surface that still has it
// continues to work.
const __legacyAddCategoryBtn = document.getElementById("addCategoryBtn");
if (__legacyAddCategoryBtn) {
  __legacyAddCategoryBtn.addEventListener("click", async () => {
    try {
      show(catErr, "");
      const nameEl = document.getElementById("newCategoryName");
      const name = String(nameEl?.value || "").trim();
      let gid = defaultNewCategoryGroupId();
      if (newCategoryGroupId && newCategoryGroupId.value) {
        const n = Number(newCategoryGroupId.value);
        if (Number.isFinite(n)) gid = n;
      }
      const created = await addCategoryToGroup(gid, name);
      if (created && nameEl) nameEl.value = "";
    } catch (e) {
      show(catErr, e.message || "Failed to add category");
    }
  });
}

if (seedDefaultCategoriesBtn) {
  seedDefaultCategoriesBtn.addEventListener("click", async () => {
    try {
      show(catErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");
      let force = false;
      try {
        await api(`/api/families/${state.activeFamilyId}/categories/seed-defaults`, "POST");
      } catch (e) {
        const msg = String(e.message || "").toLowerCase();
        if (msg.includes("already exist") || msg.includes("409")) {
          if (!window.confirm("Replace all existing category groups and categories with the default list? This cannot be undone.")) return;
          force = true;
          await api(`/api/families/${state.activeFamilyId}/categories/seed-defaults?force=true`, "POST");
        } else {
          throw e;
        }
      }
      await loadCategories();
      await loadMonthAndCalendar();
    } catch (e) {
      show(catErr, e.message || "Failed to load default categories");
    }
  });
}

if (addCategoryGroupBtn) {
  function showAddGroupInline(showIt) {
    if (addGroupInline) addGroupInline.hidden = !showIt;
    if (addCategoryGroupBtn) addCategoryGroupBtn.style.display = showIt ? "none" : "inline-flex";
    const focusNewCatBtn = document.getElementById("focusNewCategoryBtn");
    if (focusNewCatBtn) focusNewCatBtn.style.display = showIt ? "none" : "inline-flex";
    if (showIt && newGroupName) {
      newGroupName.value = "";
      try {
        newGroupName.focus();
      } catch (_) {}
    }
  }

  addCategoryGroupBtn.addEventListener("click", () => {
    show(catErr, "");
    showAddGroupInline(true);
  });

  if (cancelGroupBtn) {
    cancelGroupBtn.addEventListener("click", () => {
      show(catErr, "");
      showAddGroupInline(false);
    });
  }

  // Top-level "+ Add category" toolbar button.
  // The new design has a per-group add input at the bottom of each card.
  // The toolbar button focuses the first group's add input (and opens its
  // collapsed form), so the user gets a single, predictable target.
  const focusNewCategoryBtn = document.getElementById("focusNewCategoryBtn");
  if (focusNewCategoryBtn) {
    focusNewCategoryBtn.addEventListener("click", () => {
      show(catErr, "");
      const firstCard = categoriesTree?.querySelector('.cats-group:not([data-system-group="1"])')
        || categoriesTree?.querySelector(".cats-group");
      if (!firstCard) {
        // No groups yet — guide the user to add a group first.
        if (addCategoryGroupBtn) {
          try {
            addCategoryGroupBtn.click();
          } catch (_) {}
        }
        return;
      }
      const trigger = firstCard.querySelector(".cats-group__add-trigger");
      if (trigger) {
        try {
          trigger.click();
        } catch (_) {}
      }
      const input = firstCard.querySelector(".cats-group__add-input");
      if (input) {
        try {
          input.focus();
          input.select();
          input.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (_) {}
      }
    });
  }

  // Empty-state buttons (rendered only when no groups exist).
  const loadDefaultCategoriesBtn = document.getElementById("loadDefaultCategoriesBtn");
  if (loadDefaultCategoriesBtn) {
    loadDefaultCategoriesBtn.addEventListener("click", async () => {
      try {
        show(catErr, "");
        if (!state.activeFamilyId) throw new Error("Choose a family first");
        await api(`/api/families/${state.activeFamilyId}/categories/seed-defaults`, "POST");
        await loadCategories();
        await loadMonthAndCalendar();
      } catch (e) {
        const msg = String(e?.message || "").toLowerCase();
        if (msg.includes("already exist") || msg.includes("409")) {
          // Defaults are only meant for the empty-state surface, but if
          // the user already has a structure, offer a clear choice
          // before wiping it.
          if (
            window.confirm(
              "You already have category groups. Replace them with the defaults? This cannot be undone."
            )
          ) {
            try {
              await api(`/api/families/${state.activeFamilyId}/categories/seed-defaults?force=true`, "POST");
              await loadCategories();
              await loadMonthAndCalendar();
              return;
            } catch (e2) {
              show(catErr, e2?.message || "Failed to load default categories");
              return;
            }
          }
          return;
        }
        show(catErr, e?.message || "Failed to load default categories");
      }
    });
  }

  const addFirstGroupBtn = document.getElementById("addFirstGroupBtn");
  if (addFirstGroupBtn && addCategoryGroupBtn) {
    addFirstGroupBtn.addEventListener("click", () => {
      try {
        addCategoryGroupBtn.click();
      } catch (_) {}
    });
  }

  if (saveGroupBtn) {
    saveGroupBtn.addEventListener("click", async () => {
      try {
        show(catErr, "");
        if (!state.activeFamilyId) throw new Error("Choose a family first");
        const nm = String(newGroupName?.value || "").trim();
        if (!nm) throw new Error("Group name is required");
        if (nm.trim().toLowerCase() === "new group") {
          throw new Error('Please choose a more specific group name (not "New group").');
        }
        if (isSystemUncategorizedGroupName(nm) && hasDuplicateCategoryGroupName(nm)) {
          throw new Error('"Uncategorized" is reserved for the system fallback group.');
        }
        if (hasDuplicateCategoryGroupName(nm)) {
          const ok = window.confirm(`A group named "${nm}" already exists. Create a duplicate anyway?`);
          if (!ok) return;
        }
        await api(`/api/families/${state.activeFamilyId}/category-groups`, "POST", { name: nm });
        await loadCategories();
        showAddGroupInline(false);
      } catch (e) {
        show(catErr, e.message || "Failed to add group");
      }
    });
  }
}

if (txAddSave) {
  txAddSave.addEventListener("click", async () => {
    if (txAddSaveInFlight) return;
    try {
      show(txAddErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");
      txAddValidationTouched = true;
      updateTxAddFormValidity({ forceShow: true });
      if (!txAddFormValidationState().valid) {
        show(txAddErr, "Complete the required fields below.");
        return;
      }

      setTxAddSaveBusy(true);

      const dateVal = txAddDate?.value || "";
      const notesRaw = txAddNotes?.value?.trim() || "";
      const kind = getRadioValue("txAddKind", "expense");
      const amountVal = txAddAmount?.value || "";
      const categoryId = categoryIdFromCategoryField("txAddCategoryId");
      const repeats = txAddRepeatsActive();
      const desc = descriptionForNewTransaction(categoryId, { recurring: repeats });

      if (!dateVal) throw new Error(repeats ? "Start date is required" : "Date is required");
      if (!amountVal || Number(amountVal) <= 0) throw new Error("Amount must be greater than zero");
      if (categoryId == null || !Number.isFinite(Number(categoryId))) throw new Error("Category is required");
      if (isDateBeforeEarliestStartingBalance(normalizeIsoDate(dateVal) || dateVal)) {
        throw new Error("That date is before your starting balance.");
      }

      if (repeats) {
        const recurrenceVal = txAddRecurrence?.value || "monthly";
        const accountIdVal = txAddAccountId?.value || "";
        if (!accountIdVal) throw new Error("Account is required");

        const endCountRaw = txAddEndCount?.value != null ? String(txAddEndCount.value).trim() : "";
        const endCountVal = endCountRaw === "" ? null : Number(endCountRaw);
        if (endCountVal != null) {
          if (!Number.isFinite(endCountVal) || endCountVal < 1 || Math.floor(endCountVal) !== endCountVal) {
            throw new Error("Ends after must be a whole number ≥ 1");
          }
        }
        const endDateRaw = txAddEndDate?.value != null ? String(txAddEndDate.value).trim() : "";
        const endDateVal = endDateRaw === "" ? null : endDateRaw;
        if (endDateVal != null) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(endDateVal)) throw new Error("Ends on must be a date");
          if (endDateVal < dateVal) throw new Error("Ends on cannot be before the start date");
        }
        if (endCountVal != null && endDateVal != null) {
          throw new Error("Provide only one of Ends after or Ends on");
        }

        let secondDayOfMonth = null;
        let secondOccurrenceMonth = null;
        if (recurrenceUsesSecondOccurrenceDate(recurrenceVal)) {
          const secondErr = validateSecondOccurrenceForSave(recurrenceVal, dateVal, txAddSecondDayOfMonth);
          if (secondErr) throw new Error(secondErr);
          const second = secondOccurrencePayloadFromForm(recurrenceVal, txAddSecondDayOfMonth);
          secondDayOfMonth = second.second_day_of_month;
          secondOccurrenceMonth = second.second_occurrence_month;
        }

        await api(`/api/families/${state.activeFamilyId}/expected-transactions`, "POST", {
          account_id: Number(accountIdVal),
          start_date: dateVal,
          end_date: endDateVal,
          end_count: endDateVal != null ? null : endCountVal,
          recurrence: recurrenceVal,
          second_day_of_month: secondDayOfMonth,
          second_occurrence_month: secondOccurrenceMonth,
          description: desc,
          notes: notesRaw || null,
          kind,
          amount: Number(amountVal),
          variable: !!(txAddVariable && txAddVariable.checked),
          category_id: categoryId,
        ...(txAddColorTouched
          ? {
              bg_color: normalizeBgColorForSave(txAddSelectedBgColor),
              fg_color: normalizeFgColorForSave(txAddSelectedBgColor),
            }
          : {}),
        });

        closeTxAddModal();
      invalidateLowBalanceAlertCache();
        await refreshExpectedCalendarAndMonth();
        bwDispatchMilestone("first-recurring");
        return;
      }

      await api(`/api/families/${state.activeFamilyId}/transactions`, "POST", {
        date: dateVal,
        description: desc,
        notes: notesRaw || null,
        kind,
        amount: Number(amountVal),
        category_id: categoryId,
        ...(txAddColorTouched
          ? {
              bg_color: normalizeBgColorForSave(txAddSelectedBgColor),
              fg_color: normalizeFgColorForSave(txAddSelectedBgColor),
            }
          : {}),
        reimbursable: false,
      });

      closeTxAddModal();
    invalidateLowBalanceAlertCache();
      await loadMonthAndCalendar();
    } catch (e) {
      show(txAddErr, e.message || "Failed to add");
    } finally {
      setTxAddSaveBusy(false);
    }
  });
}

addAccountBtn.addEventListener("click", async () => {
  try {
    show(accErr, "");
    if (!state.activeFamilyId) throw new Error("Choose a family first");

    const name = accountName.value.trim();
    const type = accountType.value;
    const startingBalanceVal = accountStartingBalance.value;
    const startingBalanceDateVal = accountStartingBalanceDate.value;

    if (!name) throw new Error("Account name is required");
    if (startingBalanceVal === "" || Number.isNaN(Number(startingBalanceVal))) throw new Error("Starting balance is required");
    if (!startingBalanceDateVal) throw new Error("Starting balance date is required");

    await api(`/api/families/${state.activeFamilyId}/accounts`, "POST", {
      name,
      type,
      starting_balance: Number(startingBalanceVal),
      starting_balance_date: startingBalanceDateVal,
    });

    clearAccountEdit();
    closeAccountModal();
    await loadAccounts();
    await loadMonthAndCalendar();
    showBwToast("Account added.");
  } catch (e) {
    show(accErr, e.message || "Failed to add account");
  }
});

saveAccountEditBtn.addEventListener("click", async () => {
  try {
    show(accErr, "");
    if (!state.activeFamilyId) throw new Error("Choose a family first");
    if (!accountEditId.value) throw new Error("Select an account to edit first");
    const startingBalanceVal = accountStartingBalance.value;
    const startingBalanceDateVal = accountStartingBalanceDate.value;
    if (startingBalanceVal === "" || Number.isNaN(Number(startingBalanceVal))) throw new Error("Starting balance is required");
    if (!startingBalanceDateVal) throw new Error("Starting balance date is required");
    await api(`/api/families/${state.activeFamilyId}/accounts/${accountEditId.value}`, "PUT", {
      starting_balance: Number(startingBalanceVal),
      starting_balance_date: startingBalanceDateVal,
    });
    clearAccountEdit();
    closeAccountModal();
    await loadAccounts();
    await loadMonthAndCalendar();
    showBwToast("Account updated.");
  } catch (e) {
    show(accErr, e.message || "Failed to update account");
  }
});

cancelAccountEditBtn.addEventListener("click", () => {
  clearAccountEdit();
  closeAccountModal();
});

function renderTxEditCategoryOptions() {
  syncCategoryComboboxCategories("txEditCategoryId", state.categories || []);
}

function applyTransactionEditMode(mode, opts = {}) {
  if (opts.resetting) {
    transactionEditMode = "actual";
    if (txEditInner) txEditInner.classList.remove("modal--expected-edit");
    const modeBanner = document.getElementById("txEditModeBanner");
    if (modeBanner) {
      modeBanner.style.display = "none";
      modeBanner.textContent = "";
    }
    const txEditTopStrip = document.querySelector("#txEditModal .tx-edit-top");
    if (txEditTopStrip) txEditTopStrip.style.display = "";
    if (instanceRecurrence) instanceRecurrence.disabled = false;
    if (instanceAccountId) instanceAccountId.disabled = false;
    if (instanceSecondDayOfMonth) instanceSecondDayOfMonth.disabled = false;
    if (instanceEndCount) instanceEndCount.disabled = false;
    if (instanceEndsMode) {
      setTxEditEndsModeInteractive(true);
      instanceEndsMode.value = "never";
    }
    try { updateInstanceEndsDetailUi(); } catch (_) {}
    const saveRow = document.getElementById("txEditSaveRow");
    if (saveRow) saveRow.style.display = "";
    const txEditDel = document.getElementById("txEditDelete");
    if (txEditDel) txEditDel.style.display = "";
    return;
  }

  transactionEditMode = mode;
  const recurring = mode === "recurring";
  if (txEditInner) {
    if (recurring) txEditInner.classList.add("modal--expected-edit");
    else txEditInner.classList.remove("modal--expected-edit");
  }

  const title = document.getElementById("txEditTitle");
  if (title) {
    title.classList.add("sr-only");
    title.textContent = recurring ? "Recurring transaction" : "Edit Transaction";
  }
  const modeBanner = document.getElementById("txEditModeBanner");
  if (modeBanner) {
    modeBanner.style.display = "block";
    modeBanner.textContent = recurring ? "Recurring transaction" : "Edit Transaction";
  }
  const txEditTopStrip = document.querySelector("#txEditModal .tx-edit-top");
  if (txEditTopStrip) txEditTopStrip.style.display = "";

  const notesLabel = document.getElementById("txEditNotesLabel");
  if (notesLabel) notesLabel.textContent = "Notes";
  const dateLabel = document.getElementById("txEditDateLabel");
  if (dateLabel) dateLabel.textContent = "Date";

  const wrapSch = document.getElementById("txEditRecurringScheduleWrap");
  if (wrapSch) {
    wrapSch.style.display = "block";
    wrapSch.classList.remove("tx-edit-schedule--locked");
  }
  if (instanceRecurrence) {
    if (!recurring) instanceRecurrence.value = "once";
    instanceRecurrence.disabled = false;
    instanceRecurrence.title = "How often this repeats";
  }
  const acctCol = document.getElementById("txEditAccountCol");
  if (acctCol) acctCol.style.display = "block";
  if (recurring) {
    if (instanceSecondDayOfMonth) instanceSecondDayOfMonth.disabled = false;
    if (instanceEndCount) instanceEndCount.disabled = false;
    setTxEditEndsModeInteractive(true);
    try {
      updateInstanceEndsDetailUi();
    } catch (_) {}
    if (instanceAccountId) {
      instanceAccountId.disabled = false;
      instanceAccountId.title = "";
    }
    updateInstanceTwiceMonthlyVisibility();
    const varWrap = document.getElementById("txEditRecurringVariableWrap");
    if (varWrap) varWrap.style.display = "block";
  } else {
    updateTxEditActualScheduleUi();
  }

  const prim = document.getElementById("txEditRecurringPrimaryActions");
  if (prim) prim.style.display = "none";

  const saveRow = document.getElementById("txEditSaveRow");
  if (saveRow) saveRow.style.display = "";
  if (txEditSave) txEditSave.style.display = "";
  if (txEditRecurringUpdateBtn) txEditRecurringUpdateBtn.style.display = "none";
  const txEditDel = document.getElementById("txEditDelete");
  if (txEditDel) txEditDel.style.display = "";

  if (txEditCancel) {
    txEditCancel.textContent = recurring ? "Close" : "Cancel";
    txEditCancel.classList.toggle("tx-edit-dismiss--close", recurring);
  }

  const varWrapEl = document.getElementById("txEditRecurringVariableWrap");
  const schWrap = document.getElementById("txEditRecurringScheduleWrap");
  const panel = document.getElementById("expectedEditInstancePanel");
  if (recurring) {
    if (varWrapEl && schWrap && varWrapEl.parentNode !== schWrap) {
      schWrap.appendChild(varWrapEl);
    }
  } else if (varWrapEl && panel && schWrap && varWrapEl.parentNode === schWrap) {
    panel.appendChild(varWrapEl);
  }
  if (schWrap) {
    schWrap.classList.toggle("tx-edit-recurring-group", recurring);
  }
}

function actualTxEditRecurringValidationError() {
  const dateVal = txEditDate?.value || "";
  if (!dateVal) return "Start date is required";
  const amountVal = txEditAmount?.value;
  if (!amountVal || Number(amountVal) <= 0) return "Amount must be greater than zero";
  const categoryId = categoryIdFromCategoryField("txEditCategoryId");
  if (categoryId == null || !Number.isFinite(Number(categoryId))) return "Category is required";
  const editDateIso = normalizeIsoDate(dateVal) || dateVal;
  if (isDateBeforeEarliestStartingBalance(editDateIso)) return "That date is before your starting balance.";
  const accountIdVal = instanceAccountId?.value || "";
  if (!accountIdVal) return "Account is required";

  const recurrenceVal = instanceRecurrence?.value || "monthly";
  const endCountRaw = instanceEndCount?.value != null ? String(instanceEndCount.value).trim() : "";
  const endCountVal = endCountRaw === "" ? null : Number(endCountRaw);
  if (endCountVal != null) {
    if (!Number.isFinite(endCountVal) || endCountVal < 1 || Math.floor(endCountVal) !== endCountVal) {
      return "Ends after must be a whole number ≥ 1";
    }
  }
  if (recurrenceUsesSecondOccurrenceDate(recurrenceVal)) {
    const secondErr = validateSecondOccurrenceForSave(recurrenceVal, dateVal, instanceSecondDayOfMonth);
    if (secondErr) return secondErr;
  }
  return null;
}

async function convertActualTransactionToRecurring(actualId) {
  const validationErr = actualTxEditRecurringValidationError();
  if (validationErr) throw new Error(validationErr);

  const dateVal = txEditDate.value;
  const amountVal = txEditAmount.value;
  const categoryId = categoryIdFromCategoryField("txEditCategoryId");
  const recurrenceVal = instanceRecurrence?.value || "monthly";
  const accountIdVal = instanceAccountId.value;
  const endCountRaw = instanceEndCount?.value != null ? String(instanceEndCount.value).trim() : "";
  const endCountVal = endCountRaw === "" ? null : Number(endCountRaw);
  const notesRaw = txEditNotes?.value?.trim() || "";
  const desc =
    (txEditDescriptionSnapshot && String(txEditDescriptionSnapshot).trim()) ||
    descriptionForNewTransaction(categoryId, { recurring: true });

  let secondDayOfMonth = null;
  let secondOccurrenceMonth = null;
  if (recurrenceUsesSecondOccurrenceDate(recurrenceVal)) {
    const second = secondOccurrencePayloadFromForm(recurrenceVal, instanceSecondDayOfMonth);
    secondDayOfMonth = second.second_day_of_month;
    secondOccurrenceMonth = second.second_occurrence_month;
  }

  await api(`/api/families/${state.activeFamilyId}/expected-transactions`, "POST", {
    account_id: Number(accountIdVal),
    start_date: dateVal,
    end_date: null,
    end_count: endCountVal,
    recurrence: recurrenceVal,
    second_day_of_month: secondDayOfMonth,
    second_occurrence_month: secondOccurrenceMonth,
    description: desc,
    notes: notesRaw || null,
    kind: getRadioValue("txEditKind", "expense"),
    amount: Number(amountVal),
    variable: !!(seriesVariable && seriesVariable.checked),
    category_id: categoryId,
    ...txColorFieldsForSave(txEditSelectedBgColor),
  });
  await api(`/api/families/${state.activeFamilyId}/transactions/${actualId}`, "DELETE");
}

function openTxEditModal(tx) {
  if (!txEditModal || !txEditId || !txEditDate) return;
  selectedExpectedInstance = null;
  selectedExpectedMovedToDate = null;
  if (expectedEditId) expectedEditId.value = "";
  if (instanceExpectedTxId) instanceExpectedTxId.value = "";
  txEditId.value = String(tx.id);
  txEditDate.value = tx.date;
  applyMinDateToTxEditDateInput();
  {
    const k = tx && tx.kind ? String(tx.kind) : "expense";
    const radio = document.querySelector(`input[type="radio"][name="txEditKind"][value="${k}"]`);
    if (radio) radio.checked = true;
  }
  txEditAmount.value = tx.amount;
  txEditDescriptionSnapshot = String(tx.description || "").trim().slice(0, 500);
  if (txEditNotes) txEditNotes.value = tx.notes || "";
  txEditReimbursableValue = !!tx.reimbursable;
  renderTxEditCategoryOptions();
  setCategoryFieldValue("txEditCategoryId", tx.category_id);
  {
    const bg = tx && tx.bg_color ? String(tx.bg_color).trim() : "";
    txEditSelectedBgColor = bg ? bg : null;
  }
  txEditColorTouched = false;
  refreshTxCategoryColorPickers();
  if (instanceAccountId && state.accounts && state.accounts.length > 0) {
    instanceAccountId.value = String(state.accounts[0].id);
  }
  show(txEditErr, "");
  try { txEditModal.style.display = ""; } catch (_) {}
  txEditModal.classList.add("modal-overlay--open");
  txEditModal.setAttribute("aria-hidden", "false");
  applyTransactionEditMode("actual");
  applyTxEditCategoryRecurrenceDefaults(tx.category_id);
}

let txEditApplyScopeChoice = null;
let txEditDeleteScopeChoice = null;

function resetTxEditApplyScopeSelection() {
  txEditApplyScopeChoice = null;
  const seriesBtn = document.getElementById("txEditApplyScopeSeriesBtn");
  const instanceBtn = document.getElementById("txEditApplyScopeInstanceBtn");
  const saveBtn = document.getElementById("txEditApplyScopeSaveBtn");
  for (const btn of [seriesBtn, instanceBtn]) {
    if (!btn) continue;
    btn.classList.remove("apply-scope-option--selected");
    btn.setAttribute("aria-pressed", "false");
  }
  if (saveBtn) saveBtn.disabled = true;
}

function setTxEditApplyScopeChoice(choice) {
  txEditApplyScopeChoice = choice;
  const seriesBtn = document.getElementById("txEditApplyScopeSeriesBtn");
  const instanceBtn = document.getElementById("txEditApplyScopeInstanceBtn");
  const saveBtn = document.getElementById("txEditApplyScopeSaveBtn");
  if (seriesBtn) {
    const on = choice === "series";
    seriesBtn.classList.toggle("apply-scope-option--selected", on);
    seriesBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  if (instanceBtn) {
    const on = choice === "instance";
    instanceBtn.classList.toggle("apply-scope-option--selected", on);
    instanceBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  if (saveBtn) saveBtn.disabled = false;
}

function resetTxEditDeleteScopeSelection() {
  txEditDeleteScopeChoice = null;
  const futureBtn = document.getElementById("txEditDeleteScopeFutureBtn");
  const instanceBtn = document.getElementById("txEditDeleteScopeInstanceBtn");
  const confirmBtn = document.getElementById("txEditDeleteScopeConfirmBtn");
  for (const btn of [futureBtn, instanceBtn]) {
    if (!btn) continue;
    btn.classList.remove("apply-scope-option--selected");
    btn.setAttribute("aria-pressed", "false");
  }
  if (confirmBtn) confirmBtn.disabled = true;
}

function setTxEditDeleteScopeChoice(choice) {
  txEditDeleteScopeChoice = choice;
  const futureBtn = document.getElementById("txEditDeleteScopeFutureBtn");
  const instanceBtn = document.getElementById("txEditDeleteScopeInstanceBtn");
  const confirmBtn = document.getElementById("txEditDeleteScopeConfirmBtn");
  if (futureBtn) {
    const on = choice === "future";
    futureBtn.classList.toggle("apply-scope-option--selected", on);
    futureBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  if (instanceBtn) {
    const on = choice === "instance";
    instanceBtn.classList.toggle("apply-scope-option--selected", on);
    instanceBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  if (confirmBtn) confirmBtn.disabled = false;
}

function closeTxEditApplyScopeModal() {
  const m = document.getElementById("txEditApplyScopeModal");
  if (!m) return;
  m.classList.remove("modal-overlay--open");
  m.setAttribute("aria-hidden", "true");
  show(document.getElementById("txEditApplyScopeErr"), "");
  resetTxEditApplyScopeSelection();
}

function closeTxEditDeleteScopeModal() {
  const m = document.getElementById("txEditDeleteScopeModal");
  if (!m) return;
  m.classList.remove("modal-overlay--open");
  m.setAttribute("aria-hidden", "true");
  show(document.getElementById("txEditDeleteScopeErr"), "");
  resetTxEditDeleteScopeSelection();
}

function openTxEditApplyScopeModal() {
  closeTxEditDeleteScopeModal();
  const m = document.getElementById("txEditApplyScopeModal");
  if (!m) return;
  show(document.getElementById("txEditApplyScopeErr"), "");
  resetTxEditApplyScopeSelection();
  try {
    m.style.display = "";
  } catch (_) {}
  m.classList.add("modal-overlay--open");
  m.setAttribute("aria-hidden", "false");
  const firstOpt = document.getElementById("txEditApplyScopeSeriesBtn");
  requestAnimationFrame(() => firstOpt?.focus?.());
}

function openTxEditDeleteScopeModal() {
  closeTxEditApplyScopeModal();
  const m = document.getElementById("txEditDeleteScopeModal");
  if (!m) return;
  show(document.getElementById("txEditDeleteScopeErr"), "");
  resetTxEditDeleteScopeSelection();
  try {
    m.style.display = "";
  } catch (_) {}
  m.classList.add("modal-overlay--open");
  m.setAttribute("aria-hidden", "false");
  const firstOpt = document.getElementById("txEditDeleteScopeFutureBtn");
  requestAnimationFrame(() => firstOpt?.focus?.());
}

function closeTxEditModal() {
  if (!txEditModal) return;
  try { closeTxEditApplyScopeModal(); } catch (_) {}
  try { closeTxEditDeleteScopeModal(); } catch (_) {}
  txEditModal.classList.remove("modal-overlay--open");
  txEditModal.setAttribute("aria-hidden", "true");
  // Defensive: force display:none in case a stray class or inline style is keeping the overlay visible.
  try { txEditModal.style.display = "none"; } catch (_) {}
  selectedExpectedInstance = null;
  selectedExpectedMovedToDate = null;
  if (txEditDate) {
    txEditDate.value = "";
    txEditDate.disabled = false;
    txEditDate.readOnly = false;
    txEditDate.removeAttribute("min");
  }
  if (instanceExpectedTxId) instanceExpectedTxId.value = "";
  if (expectedEditId) expectedEditId.value = "";
  txEditSelectedBgColor = null;
  txEditColorTouched = false;
  applyTransactionEditMode("actual", { resetting: true });
}

function mountTxAddFormInModal() {
  const root = document.getElementById("txAddFormRoot");
  const mount = document.getElementById("txAddModalFormMount");
  if (root && mount && root.parentElement !== mount) mount.appendChild(root);
}

function mountTxAddFormInSidebar() {
  const root = document.getElementById("txAddFormRoot");
  const home = document.getElementById("txAddFormHome");
  if (root && home && root.parentElement !== home) home.appendChild(root);
}

function activateSettingsSection(key) {
  // Settings IA: Accounts, Categories, Preferences, Billing.
  let k = String(key || "accounts");
  const LEGACY_KEY_MAP = {
    accountDetails: "accounts",
    familySharing: "collaborators",
    forecastRules: "preferences",
    // Legacy “Forecast setup” routes to Preferences (thresholds, defaults).
    forecastSetup: "preferences",
    notifications: "preferences",
    thresholds: "preferences",
  };
  if (LEGACY_KEY_MAP[k]) k = LEGACY_KEY_MAP[k];

  const canCollaborators = canViewHouseholdSettings();
  if (k === "collaborators" && !canCollaborators) k = "accounts";

  document.querySelectorAll("#settingsViewPanel .settings-nav-item, #settingsSidebarNav .settings-nav-item").forEach((btn) => {
    const on = btn.dataset.settingsKey === k;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const canHousehold = canCollaborators;
  document.querySelectorAll("#settingsViewPanel .settings-pane").forEach((pane) => {
    const paneKey = String(pane.dataset.settingsPane || "");
    if ((paneKey === "collaborators" || paneKey === "familySharing") && !canHousehold) {
      pane.classList.remove("is-active");
      pane.hidden = true;
      return;
    }
    const on = paneKey === k;
    pane.classList.toggle("is-active", on);
    pane.hidden = !on;
  });
  syncHouseholdSettingsUi();
  if (k === "collaborators") {
    loadFamilyMembersPanel().catch((e) => {
      const el = document.getElementById("familyMembersErr");
      show(el, e.message || String(e));
    });
  }
  if (k === "billing") {
    renderBillingPanel();
  }
  if (k === "categories") {
    void loadCategoryUsageSummary().then(() => refreshCategoriesManagerChrome());
  }
}

function openTxAddModal(opts = {}) {
  if (txAddSaveInFlight) return;
  const modalEl = txAddModal || document.getElementById("txAddModal");
  const dateEl = txAddDate || document.getElementById("txAddDate");
  if (!modalEl || !dateEl) {
    window.alert("Add transaction form is not available on this page. Try refreshing.");
    return;
  }
  const dateVal = opts.date || "";
  const dateNorm = dateVal ? normalizeIsoDate(dateVal) || dateVal : "";
  if (dateNorm && isDateBeforeEarliestStartingBalance(dateNorm)) {
    window.alert("That date is before your starting balance.");
    return;
  }
  mountTxAddFormInModal();
  try {
    modalEl.style.display = "";
  } catch (_) {}
  modalEl.classList.add("modal-overlay--open");
  modalEl.setAttribute("aria-hidden", "false");
  applyMinDateToTxAddDateInput();
  dateEl.value = dateVal || toISODate(new Date());
  if (txAddAmount) txAddAmount.value = "";
  if (txAddNotes) txAddNotes.value = "";
  setCategoryFieldValue("txAddCategoryId", null);
  txAddSelectedBgColor = null;
  txAddColorTouched = false;
  if (txAddRecurrence) txAddRecurrence.value = opts.repeats ? "monthly" : "";
  if (txAddEndsMode) txAddEndsMode.value = "never";
  if (txAddEndCount) txAddEndCount.value = "";
  if (txAddEndDate) txAddEndDate.value = "";
  if (txAddSecondDayOfMonth) txAddSecondDayOfMonth.value = "";
  if (txAddVariable) txAddVariable.checked = false;
  if (txAddAccountId) {
    renderAccountSelect(txAddAccountId, state.accounts || []);
    if (state.accounts && state.accounts.length > 0) txAddAccountId.value = String(state.accounts[0].id);
  }
  updateTxAddRepeatingUi();
  refreshTxCategoryColorPickers();
  resetTxAddFormValidation();
  setTxAddSaveBusy(false);
  const kind = opts.kind || "income";
  const radio = document.querySelector(`input[type="radio"][name="txAddKind"][value="${kind}"]`);
  if (radio) radio.checked = true;
  show(txAddErr, "");
  try {
    renderTxAddCategoryChips();
  } catch (err) {
    if (typeof console !== "undefined" && console.warn) console.warn("txAdd chips render failed:", err);
  }
  updateTxAddFormValidity();
  requestAnimationFrame(() => (txAddAmount ? txAddAmount.focus() : dateEl.focus()));
}

function closeTxAddModal() {
  if (!txAddModal) return;
  resetTxAddFormValidation();
  if (!txAddSaveInFlight) setTxAddSaveBusy(false);
  show(txAddErr, "");
  txAddModal.classList.remove("modal-overlay--open");
  txAddModal.setAttribute("aria-hidden", "true");
  mountTxAddFormInSidebar();
  if (txAddDate) txAddDate.removeAttribute("min");
  txAddSelectedBgColor = null;
  txAddColorTouched = false;
}

function bindTxAddModalDismiss() {
  const modal = txAddModal || document.getElementById("txAddModal");
  if (!modal || modal.dataset.txAddDismissBound === "1") return;
  modal.dataset.txAddDismissBound = "1";
  modal.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target.closest("#txAddCancel")) {
        e.preventDefault();
        closeTxAddModal();
      }
    },
    true
  );
}
bindTxAddModalDismiss();

function openReconcileModal(iso) {
  if (!reconcileModal) return;
  const d = normalizeIsoDate(iso) || iso;
  if (alertIfDateBeforeStartingBalance(d)) return;
  reconcileActiveDate = d;
  if (reconcileTitle) {
    reconcileTitle.textContent = reconcileActiveDate
      ? `Reconcile forecast · ${fmtDateLongDisplay(reconcileActiveDate)}`
      : "Reconcile forecast";
  }
  if (reconcileChecked) reconcileChecked.checked = state.reconciledDates?.has(reconcileActiveDate) || false;
  if (reconcileBalanceBlock && reconcileForecastBal) {
    const row = reconcileActiveDate && state.monthDailyBalances ? state.monthDailyBalances.get(reconcileActiveDate) : null;
    const end = row && Number.isFinite(Number(row.end)) ? Number(row.end) : null;
    if (end != null) {
      reconcileBalanceBlock.hidden = false;
      reconcileForecastBal.textContent = `$${fmtMoney(end)}`;
    } else {
      reconcileBalanceBlock.hidden = true;
      reconcileForecastBal.textContent = "—";
    }
  }
  show(reconcileErr, "");
  reconcileModal.classList.add("modal-overlay--open");
  reconcileModal.setAttribute("aria-hidden", "false");
}

function closeReconcileModal() {
  if (!reconcileModal) return;
  reconcileModal.classList.remove("modal-overlay--open");
  reconcileModal.setAttribute("aria-hidden", "true");
  reconcileActiveDate = "";
}

if (txEditSave) {
  txEditSave.addEventListener("click", async () => {
    if (transactionEditMode === "recurring") {
      show(txEditErr, "");
      const pre = validateTxEditBeforeRecurringApply();
      if (pre) {
        show(txEditErr, pre);
        return;
      }
      openTxEditApplyScopeModal();
      return;
    }
    let savedOk = false;
    let savedDateIso = "";
    let convertedToRecurring = false;
    try {
      show(txEditErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");
      const id = txEditId.value;
      if (!id) throw new Error("No transaction selected");
      const amountVal = txEditAmount.value;
      if (!amountVal || Number(amountVal) <= 0) throw new Error("Amount must be > 0");
      const rawDate = txEditDate.value;
      const editDateIso = normalizeIsoDate(rawDate) || rawDate;
      if (isDateBeforeEarliestStartingBalance(editDateIso)) {
        throw new Error("That date is before your starting balance.");
      }
      if (txEditScheduleRecurrenceActive()) {
        await convertActualTransactionToRecurring(id);
        convertedToRecurring = true;
        savedOk = true;
        savedDateIso = editDateIso || "";
      } else {
        await api(`/api/families/${state.activeFamilyId}/transactions/${id}`, "PUT", {
          date: rawDate,
          kind: getRadioValue("txEditKind", "expense"),
          amount: Number(amountVal),
          description: txEditDescriptionSnapshot,
          notes: txEditNotes && txEditNotes.value.trim() ? txEditNotes.value.trim() : null,
          category_id: categoryIdFromCategoryField("txEditCategoryId"),
          ...txColorFieldsForSave(txEditSelectedBgColor),
          reimbursable: txEditReimbursableValue,
        });
        savedOk = true;
        savedDateIso = editDateIso || "";
      }
    } catch (e) {
      show(txEditErr, e.message || "Failed to save");
      return;
    }
    // Close the modal first so the user gets immediate feedback. All
    // post-save refreshes are isolated in a separate try/catch so a refresh
    // failure can never leave the modal stuck open.
    try {
      closeTxEditModal();
    } catch (_) {}
    if (!savedOk) return;
    try {
      invalidateLowBalanceAlertCache();
      const movedYm = savedDateIso ? String(savedDateIso).slice(0, 7) : "";
      const curYm = (calendarMonth?.value || monthInput?.value || "").slice(0, 7);
      if (movedYm && curYm && movedYm !== curYm) {
        if (monthInput) monthInput.value = movedYm;
        applyCalendarMonthToPickers(movedYm);
      }
      if (convertedToRecurring) {
        await refreshExpectedCalendarAndMonth();
        bwDispatchMilestone("first-recurring");
      } else {
        await loadMonthAndCalendar();
      }
    } catch (e) {
      if (typeof console !== "undefined" && console && console.warn) {
        console.warn("Post-save refresh failed:", e);
      }
      if (typeof showBwToast === "function") {
        showBwToast("Saved. Reload the page if changes don't appear.");
      }
    }
  });
}

if (txEditDelete) {
  txEditDelete.addEventListener("click", async () => {
    let deletedOk = false;
    try {
      if (transactionEditMode === "recurring") {
        show(txEditErr, "");
        const pre = validateTxEditBeforeRecurringDelete();
        if (pre) {
          show(txEditErr, pre);
          return;
        }
        openTxEditDeleteScopeModal();
        return;
      }
      show(txEditErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");
      const id = txEditId.value;
      if (!id) throw new Error("No transaction selected");
      if (!confirm("Delete this transaction?")) return;
      await api(`/api/families/${state.activeFamilyId}/transactions/${id}`, "DELETE");
      deletedOk = true;
    } catch (e) {
      show(txEditErr, e.message || "Failed to delete");
      return;
    }
    try {
      closeTxEditModal();
    } catch (_) {}
    if (!deletedOk) return;
    try {
      invalidateLowBalanceAlertCache();
      await loadMonthAndCalendar();
    } catch (e) {
      if (typeof console !== "undefined" && console && console.warn) {
        console.warn("Post-delete refresh failed:", e);
      }
      if (typeof showBwToast === "function") {
        showBwToast("Deleted. Reload the page if changes don't appear.");
      }
    }
  });
}

if (txEditCancel) {
  txEditCancel.addEventListener("click", () => closeTxEditModal());
}

if (txEditModal) {
  txEditModal.addEventListener("click", (e) => {
    if (e.target === txEditModal) closeTxEditModal();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const deleteScope = document.getElementById("txEditDeleteScopeModal");
  if (deleteScope?.classList.contains("modal-overlay--open")) {
    closeTxEditDeleteScopeModal();
    return;
  }
  const scope = document.getElementById("txEditApplyScopeModal");
  if (scope?.classList.contains("modal-overlay--open")) {
    closeTxEditApplyScopeModal();
    return;
  }
  if (txEditModal?.classList.contains("modal-overlay--open")) closeTxEditModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && txAddModal?.classList.contains("modal-overlay--open")) closeTxAddModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && expectedDeleteModal?.classList.contains("modal-overlay--open")) closeExpectedDeleteModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && reconcileModal?.classList.contains("modal-overlay--open")) closeReconcileModal();
});

if (txAddModal) {
  txAddModal.addEventListener("click", (e) => {
    if (e.target === txAddModal) closeTxAddModal();
  });
}

if (reconcileCancelBtn) {
  reconcileCancelBtn.addEventListener("click", () => closeReconcileModal());
}
if (reconcileModal) {
  reconcileModal.addEventListener("click", (e) => {
    if (e.target === reconcileModal) closeReconcileModal();
  });
}

function findExpectedCalendarItem(expectedId, occurrenceIso) {
  const id = Number(expectedId);
  const occ = normalizeIsoDate(occurrenceIso) || occurrenceIso;
  const pools = [...(state.monthExpectedItems || []), ...(state.calendarExtraExpectedItems || [])];
  return (
    pools.find(
      (it) =>
        Number(it.expected_transaction_id) === id &&
        normalizeIsoDate(it.occurrence_date || it.date) === occ,
    ) ||
    pools.find(
      (it) => Number(it.expected_transaction_id) === id && normalizeIsoDate(it.date) === occ,
    ) ||
    null
  );
}

function findActualTransactionById(id) {
  const txId = Number(id);
  if (!Number.isFinite(txId) || txId <= 0) return null;
  return (
    [...(state.monthActualItems || []), ...(state.calendarExtraActualItems || [])].find(
      (t) => Number(t.id) === txId
    ) || null
  );
}

function expectedSeriesMetaStubFromCalendarItem(expectedId, calendarItem) {
  if (!calendarItem) return null;
  const eid = Number(expectedId);
  if (!Number.isFinite(eid) || eid <= 0) return null;
  const occ =
    normalizeIsoDate(calendarItem.occurrence_date || calendarItem.date) ||
    normalizeIsoDate(calendarItem.date) ||
    "";
  return {
    id: eid,
    account_id: calendarItem.account_id,
    kind: calendarItem.kind || "expense",
    amount: calendarItem.amount,
    description: calendarItem.description || "",
    notes: calendarItem.notes ?? null,
    category_id: calendarItem.category_id ?? null,
    reimbursable: !!calendarItem.reimbursable,
    variable: !!calendarItem.variable,
    bg_color: calendarItem.bg_color ?? null,
    fg_color: calendarItem.fg_color ?? null,
    recurrence: "monthly",
    start_date: occ || calendarItem.date,
  };
}

async function resolveExpectedSeriesMeta(expectedId, calendarItem) {
  const eid = Number(expectedId);
  if (!Number.isFinite(eid) || eid <= 0) return null;
  let meta = getExpectedSeriesMeta(eid);
  if (meta) return meta;
  if (state.activeFamilyId) {
    try {
      await loadExpectedTransactions();
    } catch (_) {}
    meta = getExpectedSeriesMeta(eid);
    if (meta) return meta;
  }
  return expectedSeriesMetaStubFromCalendarItem(eid, calendarItem);
}

async function openCalendarActualTransactionById(id) {
  const txId = Number(id);
  if (!Number.isFinite(txId) || txId <= 0) return false;
  let tx = findActualTransactionById(txId);
  if (!tx && state.activeFamilyId) {
    try {
      await loadTransactions();
      await loadCalendarExtras();
      tx = findActualTransactionById(txId);
    } catch (_) {}
  }
  if (tx) {
    openTxEditModal(tx);
    return true;
  }
  window.alert("Could not open this transaction. Try refreshing the page.");
  return false;
}

async function openCalendarExpectedFromLine(expectedLine) {
  const cell = expectedLine.closest(".cal-cell");
  const iso = cell?.dataset?.iso || "";
  if (iso && alertIfDateBeforeStartingBalance(iso)) return false;
  const eid = Number(expectedLine.dataset.expectedId || 0);
  if (!Number.isFinite(eid) || eid <= 0) return false;
  closeTxAddModal();
  const occ =
    normalizeIsoDate(expectedLine.dataset.occurrenceDate) ||
    normalizeIsoDate(iso) ||
    iso;
  const calendarItem =
    findExpectedCalendarItem(eid, occ) ||
    ({
      expected_transaction_id: eid,
      _type: "expected",
      date: occ,
      occurrence_date: occ,
    });
  const meta = await resolveExpectedSeriesMeta(eid, calendarItem);
  if (!meta) {
    window.alert("Could not open this recurring item. Try refreshing the page.");
    return false;
  }
  openExpectedEditModal(meta, { calendarItem });
  return true;
}

function appendCalendarDayStartBalanceLine(row, parentEl, iso) {
  const line = document.createElement("div");
  line.className = "cal-day-tx-line cal-day-tx-line--start-balance";
  line.dataset.accountId = String(row.account_id);
  line.setAttribute("role", "button");
  line.setAttribute("tabindex", "0");
  line.title = "Edit account starting balance";
  const acctLabel = row.account_name ? String(row.account_name).trim() : "account";
  line.setAttribute("aria-label", `Edit starting balance for ${acctLabel}`);

  const labelSpan = document.createElement("span");
  labelSpan.className = "cal-tx-label";
  labelSpan.textContent = "Starting Balance ";

  const labelWrap = document.createElement("span");
  labelWrap.className = "cal-tx-label-wrap";
  const anchor = document.createElement("span");
  anchor.className = "cal-tx-start-anchor";
  anchor.setAttribute("aria-hidden", "true");
  anchor.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 18h14M7 13h10M9 8h6"/></svg>';
  labelWrap.appendChild(anchor);
  labelWrap.appendChild(labelSpan);

  const amtSpan = document.createElement("span");
  amtSpan.className = "cal-amt";
  amtSpan.textContent = `$${fmtMoney(row.amount)}`;

  line.appendChild(labelWrap);
  line.appendChild(amtSpan);

  const openStartBalEdit = (e) => {
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    if (e.type === "keydown") e.preventDefault();
    e.preventDefault();
    e.stopPropagation();
    if (!openAccountEditModalForAccountId(row.account_id)) {
      window.alert("Could not open this account. Try refreshing the page.");
    }
  };
  line.addEventListener("click", openStartBalEdit);
  line.addEventListener("keydown", openStartBalEdit);
  parentEl.appendChild(line);
}

function shouldOpenReconcileFromCalendarClick(target, cell) {
  if (!target || !cell) return false;
  if (cell.classList.contains("cal-cell--before-start")) return false;
  if (cell.classList.contains("cal-cell--out")) return false;
  return !!target.closest(".cal-daynum");
}

function shouldOpenAddTxFromCalendarClick(target, cell) {
  if (!target || !cell) return false;
  if (cell.classList.contains("cal-cell--before-start")) return false;
  if (shouldOpenReconcileFromCalendarClick(target, cell)) return false;
  if (target.closest(".cal-day-reconcile-btn")) return false;
  if (target.closest(".cal-day-tx-line--expected")) return false;
  if (target.closest(".cal-day-start-balance .cal-day-tx-line--start-balance")) return false;
  if (target.closest(".cal-tx-part")) return false;
  if (target.closest(".cal-day-more")) return false;
  return true;
}

function openCalendarDayAddTransaction(iso, e) {
  if (!iso) return;
  if (state.activeFamilyAccessMode === "view") {
    window.alert(
      "You have view-only access to this family. Ask the owner to grant edit access if you need to add transactions."
    );
    return;
  }
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (alertIfDateBeforeStartingBalance(iso)) return;
  openTxAddModal({ date: iso });
}

function bindCalendarCellAddTxClick(cell, iso) {
  if (!cell || !iso || cell.dataset.bwAddTxBound === "1") return;
  cell.dataset.bwAddTxBound = "1";
  if (!cell.classList.contains("cal-cell--before-start")) {
    cell.setAttribute("role", "button");
    cell.setAttribute("tabindex", "0");
    const label = fmtDateMDY(iso);
    cell.setAttribute("aria-label", label ? `Add transaction on ${label}` : "Add transaction on this day");
  }
  const onKeyActivate = (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (!shouldOpenAddTxFromCalendarClick(e.target, cell)) return;
    openCalendarDayAddTransaction(iso, e);
  };
  cell.addEventListener("keydown", onKeyActivate);
}

function handleCalendarPanelClick(e) {
  const grid = document.getElementById("calendarGrid");
  if (!grid || !grid.contains(e.target)) return;

  const expectedLine = e.target.closest(".cal-day-tx-line--expected");
  if (expectedLine && grid.contains(expectedLine)) {
    e.preventDefault();
    e.stopPropagation();
    void openCalendarExpectedFromLine(expectedLine);
    return;
  }

  const startBalLine = e.target.closest(".cal-day-start-balance .cal-day-tx-line--start-balance");
  if (startBalLine && grid.contains(startBalLine)) {
    e.preventDefault();
    e.stopPropagation();
    const aid = startBalLine.dataset.accountId;
    if (!openAccountEditModalForAccountId(aid)) {
      window.alert("Could not open this account. Try refreshing the page.");
    }
    return;
  }

  // Click on an actual transaction line opens the edit modal.
  const part = e.target.closest(".cal-tx-part");
  if (part && grid.contains(part)) {
    const id = Number(part.dataset.txId);
    if (Number.isFinite(id) && id > 0) {
      e.preventDefault();
      e.stopPropagation();
      const tx = findActualTransactionById(id);
      if (tx) openTxEditModal(tx);
      else void openCalendarActualTransactionById(id);
    }
    return;
  }

  const cell = e.target.closest(".cal-cell");
  if (!cell || !cell.closest("#calendarGrid")) return;
  const iso = cell.dataset.iso;
  if (!iso) return;

  if (shouldOpenReconcileFromCalendarClick(e.target, cell)) {
    e.preventDefault();
    e.stopPropagation();
    openReconcileModal(iso);
    return;
  }

  if (!shouldOpenAddTxFromCalendarClick(e.target, cell)) return;
  openCalendarDayAddTransaction(iso, e);
}

function bindCalendarPanelClickRouting() {
  const handler = handleCalendarPanelClick;
  const panel = document.getElementById("calendarPanel");
  if (!panel || panel.dataset.bwCalClickBound === "1") return;
  panel.dataset.bwCalClickBound = "1";
  // Capture phase so day clicks still work when a child stops bubble propagation.
  panel.addEventListener("click", handler, true);
}
bindCalendarPanelClickRouting();

// (Transaction View) recurring filter panel removed; upcoming filters replace it.
function syncUpcomingRecurrenceVisibility() {
  const srcSel = upcomingSourceFilter ? String(upcomingSourceFilter.value || "all") : "all";
  const show = srcSel === "recurring";
  if (upcomingRecurrenceWrap) upcomingRecurrenceWrap.style.display = show ? "" : "none";
  if (upcomingRecurrenceFilter) upcomingRecurrenceFilter.disabled = !show;
}

function initUpcomingDateDefaultsIfEmpty() {
  if (!upcomingStartDate || !upcomingEndDate) return;
  if (upcomingStartDate.value || upcomingEndDate.value) return;
  const todayIso = toISODate(new Date());
  const endCap = new Date();
  endCap.setDate(endCap.getDate() + 548);
  upcomingStartDate.value = todayIso;
  upcomingEndDate.value = toISODate(endCap);
}

function scheduleUpcomingRefetchAndRender() {
  if (upcomingFetchDebounce) clearTimeout(upcomingFetchDebounce);
  upcomingFetchDebounce = setTimeout(() => {
    upcomingFetchDebounce = null;
    void loadUpcomingTransactionsPanel();
    renderUpcomingTransactionsFiltered();
  }, 250);
}

function scheduleUpcomingRenderOnly() {
  if (upcomingFetchDebounce) clearTimeout(upcomingFetchDebounce);
  upcomingFetchDebounce = setTimeout(() => {
    upcomingFetchDebounce = null;
    renderUpcomingTransactionsFiltered();
  }, 120);
}

initUpcomingDateDefaultsIfEmpty();
syncUpcomingRecurrenceVisibility();

if (upcomingApplyBtn) upcomingApplyBtn.addEventListener("click", () => scheduleUpcomingRefetchAndRender());
if (upcomingKindFilter) upcomingKindFilter.addEventListener("change", () => scheduleUpcomingRenderOnly());
if (upcomingSourceFilter) upcomingSourceFilter.addEventListener("change", () => { syncUpcomingRecurrenceVisibility(); scheduleUpcomingRenderOnly(); });
if (upcomingRecurrenceFilter) upcomingRecurrenceFilter.addEventListener("change", () => scheduleUpcomingRenderOnly());
if (upcomingStartDate) upcomingStartDate.addEventListener("change", () => scheduleUpcomingRefetchAndRender());
if (upcomingEndDate) upcomingEndDate.addEventListener("change", () => scheduleUpcomingRefetchAndRender());

// Transaction Manager toolbar drives the legacy filters above.
function tmRenderOnly() {
  tmSyncLegacyFiltersFromToolbar();
  syncUpcomingRecurrenceVisibility();
  scheduleUpcomingRenderOnly();
}
function tmRefetchAndRender() {
  tmSyncLegacyFiltersFromToolbar();
  syncUpcomingRecurrenceVisibility();
  scheduleUpcomingRefetchAndRender();
}

if (tmSearch) tmSearch.addEventListener("input", () => tmRenderOnly());
if (tmMinAmt) tmMinAmt.addEventListener("input", () => {
  tmClearChips();
  tmRenderOnly();
});
if (tmMaxAmt) tmMaxAmt.addEventListener("input", () => {
  tmClearChips();
  tmRenderOnly();
});
if (tmType)
  tmType.addEventListener("change", () => {
    tmClearChips();
    tmRenderOnly();
  });
if (tmStatus)
  tmStatus.addEventListener("change", () => {
    tmClearChips();
    tmRenderOnly();
  });
if (tmSource)
  tmSource.addEventListener("change", () => {
    tmClearChips();
    tmRenderOnly();
  });
if (tmFrequency)
  tmFrequency.addEventListener("change", () => {
    tmClearChips();
    tmRenderOnly();
  });
if (tmCategory)
  tmCategory.addEventListener("change", () => {
    tmClearChips();
    tmRenderOnly();
  });
if (tmStartDate)
  tmStartDate.addEventListener("change", () => {
    tmClearChips();
    tmRefetchAndRender();
  });
if (tmEndDate)
  tmEndDate.addEventListener("change", () => {
    tmClearChips();
    tmRefetchAndRender();
  });

if (tmMoreFiltersBtn && tmAdvancedFilters) {
  tmMoreFiltersBtn.addEventListener("click", () => {
    const willOpen = !!tmAdvancedFilters.hidden;
    tmAdvancedFilters.hidden = !willOpen;
    tmMoreFiltersBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });
}

for (const btn of tmChips || []) {
  try {
    btn.addEventListener("click", () => {
      const v = String(btn?.dataset?.tmView || "");
      if (!v) return;
      const already = btn.classList.contains("is-active");
      if (already) {
        tmApplyQuickView("all");
      } else {
        tmApplyQuickView(v);
      }
      tmRefetchAndRender();
    });
  } catch (_) {}
}

if (tmPrimaryAction) {
  tmPrimaryAction.addEventListener("click", () => {
    const mode = String(tmPrimaryAction.dataset.tmAction || "add");
    if (mode === "uncat") {
      tmApplyQuickView("uncategorized");
      tmRefetchAndRender();
      requestAnimationFrame(() => {
        document.querySelector(".tm__uncat")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } else {
      openTxAddModal({});
    }
  });
}

async function saveUncategorizedAssignments() {
  try {
    if (uncatTxErr) show(uncatTxErr, "");
    if (!state.activeFamilyId) throw new Error("Choose a family first");
    if (!uncatPendingCategoryByTxId.size) return;

    if (uncatTxSaveBtn) {
      uncatTxSaveBtn.disabled = true;
      uncatTxSaveBtn.textContent = "Saving…";
    }

    const byId = new Map();
    for (const t of state.upcomingActualItems || []) {
      const id = Number(t && t.id);
      if (Number.isFinite(id)) byId.set(id, t);
    }

    const ops = [];
    for (const [txId, catId] of uncatPendingCategoryByTxId.entries()) {
      const tx = byId.get(txId);
      if (!tx) continue;
      ops.push({ txId, catId, tx });
    }

    for (const op of ops) {
      const tx = op.tx;
      await api(`/api/families/${state.activeFamilyId}/transactions/${op.txId}`, "PUT", {
        date: tx.date,
        kind: String(tx.kind || "expense"),
        amount: Number(tx.amount),
        description: String(tx.description || "").trim(),
        notes: tx.notes && String(tx.notes).trim() ? String(tx.notes).trim() : null,
        category_id: Number(op.catId),
        reimbursable: !!tx.reimbursable,
        ...txColorFieldsForSave(tx.bg_color),
      });
    }

    uncatPendingCategoryByTxId.clear();
    await loadCategories();
    await loadMonthAndCalendar();
    renderUncategorizedTransactions();
    refreshTmSummaryStrip();
  } catch (e) {
    if (uncatTxErr) show(uncatTxErr, e.message || "Failed to save");
  } finally {
    if (uncatTxSaveBtn) {
      uncatTxSaveBtn.textContent = "Save";
      uncatTxSaveBtn.disabled = uncatPendingCategoryByTxId.size === 0;
    }
  }
}

if (uncatTxSaveBtn) {
  uncatTxSaveBtn.addEventListener("click", () => {
    void saveUncategorizedAssignments();
  });
}

function tmSyncLegacyFiltersFromToolbar() {
  if (tmType && upcomingKindFilter) upcomingKindFilter.value = String(tmType.value || "all");
  if (tmSource && upcomingSourceFilter) upcomingSourceFilter.value = String(tmSource.value || "all");
  if (tmFrequency && upcomingRecurrenceFilter) {
    const v = String(tmFrequency.value || "all");
    upcomingRecurrenceFilter.value = v === "semiannual" ? "semiannual" : v;
  }
  if (tmStartDate && upcomingStartDate) upcomingStartDate.value = String(tmStartDate.value || "");
  if (tmEndDate && upcomingEndDate) upcomingEndDate.value = String(tmEndDate.value || "");
}

function tmApplyQuickView(view) {
  const v = String(view || "all");
  if (tmStatus) tmStatus.value = "all";
  if (tmType) tmType.value = "all";
  if (tmSource) tmSource.value = "all";
  if (tmFrequency) tmFrequency.value = "all";
  if (tmMinAmt) tmMinAmt.value = "";
  if (tmMaxAmt) tmMaxAmt.value = "";
  if (v === "uncategorized") {
    if (tmStatus) tmStatus.value = "uncategorized";
  } else if (v === "recurring") {
    if (tmStatus) tmStatus.value = "recurring";
    if (tmSource) tmSource.value = "recurring";
  } else if (v === "income") {
    if (tmType) tmType.value = "income";
  } else if (v === "expense") {
    if (tmType) tmType.value = "expense";
  } else if (v === "large") {
    if (tmMinAmt) tmMinAmt.value = "500";
  } else if (v === "upcoming30") {
    const start = toISODate(new Date());
    const d = new Date();
    d.setDate(d.getDate() + 30);
    const end = toISODate(d);
    if (tmStartDate) tmStartDate.value = start;
    if (tmEndDate) tmEndDate.value = end;
    if (tmStatus) tmStatus.value = "upcoming";
  } else if (v === "annual") {
    if (tmSource) tmSource.value = "recurring";
    if (tmFrequency) tmFrequency.value = "yearly";
  }

  for (const btn of tmChips || []) {
    try {
      btn.classList.toggle("is-active", String(btn?.dataset?.tmView || "") === v);
    } catch (_) {}
  }
}

function tmClearChips() {
  for (const btn of tmChips || []) {
    try {
      btn.classList.remove("is-active");
    } catch (_) {}
  }
}

function tmQueueExpectedReviewFocus(expectedId, nextIso) {
  const n = Number(expectedId);
  state.tmFocusExpectedTransactionId = Number.isFinite(n) && n > 0 ? n : null;
  state.tmFocusExpectedOccurrenceIso = normalizeIsoDate(nextIso) || "";
}

function tmApplyQueuedReviewFocus() {
  if (!txListMain) return false;
  const queuedId = Number(state.tmFocusExpectedTransactionId);
  if (!Number.isFinite(queuedId) || queuedId <= 0) return false;
  const queuedIso = normalizeIsoDate(state.tmFocusExpectedOccurrenceIso || "") || "";
  let row = queuedIso
    ? txListMain.querySelector(`.tm-row[data-tm-expected-id="${queuedId}"][data-tm-next-iso="${queuedIso}"]`)
    : null;
  if (!row) row = txListMain.querySelector(`.tm-row[data-tm-expected-id="${queuedId}"]`);
  if (!(row instanceof HTMLElement)) return false;
  row.classList.add("tm-row--context");
  if (state.tmFocusHighlightTimer) clearTimeout(state.tmFocusHighlightTimer);
  state.tmFocusHighlightTimer = setTimeout(() => {
    try {
      row.classList.remove("tm-row--context");
    } catch (_) {}
  }, 2200);
  requestAnimationFrame(() => {
    try {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (_) {}
    try {
      row.focus({ preventScroll: true });
    } catch (_) {}
  });
  state.tmFocusExpectedTransactionId = null;
  state.tmFocusExpectedOccurrenceIso = "";
  return true;
}

function tmFocusExpectedReviewItem(it) {
  const searchText = String(it?.description || effectiveTransactionCategoryName(it) || "").trim();
  const itemIso = normalizeIsoDate(it?.date) || "";
  const todayIso = toISODate(new Date());
  tmApplyQuickView("all");
  if (tmSource) tmSource.value = "recurring";
  if (tmSearch) tmSearch.value = searchText;
  if (tmStartDate) tmStartDate.value = todayIso;
  if (tmEndDate) tmEndDate.value = itemIso || "";
  tmQueueExpectedReviewFocus(it?.expected_transaction_id || it?.id, itemIso);
  tmRefetchAndRender();
}

function rebuildTmCategorySelect() {
  if (!tmCategory) return;
  const prev = String(tmCategory.value || "all");
  tmCategory.replaceChildren();
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "All categories";
  tmCategory.appendChild(allOpt);
  const arr = (state.categories || []).slice();
  arr.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
  for (const c of arr) {
    const id = Number(c && c.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const opt = document.createElement("option");
    opt.value = String(id);
    opt.textContent = String(c?.name || "").trim() || "(unnamed)";
    tmCategory.appendChild(opt);
  }
  const ok = [...tmCategory.options].some((o) => o.value === prev);
  tmCategory.value = ok ? prev : "all";
}

function countTmExpectedOccurrencesInNextDays(days) {
  const items = state.expectedTransactions || [];
  if (!items.length) return 0;
  const todayIso = toISODate(new Date());
  const endD = new Date();
  endD.setDate(endD.getDate() + days);
  const endIso = toISODate(endD);
  const byId = new Map();
  for (const tx of items) {
    const id = Number(tx && tx.id);
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, tx);
  }
  let n = 0;
  for (const tx of byId.values()) {
    const nextIso = nextOccurrenceIsoForRecurringList(tx, todayIso);
    if (!nextIso) continue;
    if (nextIso >= todayIso && nextIso <= endIso) n++;
  }
  return n;
}

function tmUniqueExpectedMap() {
  const byId = new Map();
  for (const tx of state.expectedTransactions || []) {
    const id = Number(tx?.id);
    if (id) byId.set(id, tx);
  }
  return byId;
}

function tmCountUncategorizedActual() {
  return (state.upcomingActualItems || []).filter((t) => {
    const cid = t && t.category_id;
    return cid == null || cid === "" || Number(cid) === 0;
  }).length;
}

function tmCountLargeHitsBetween(todayIso, endIso, kindFilter, minAbs) {
  let n = 0;
  for (const t of state.upcomingActualItems || []) {
    const iso = normalizeIsoDate(t?.date) || String(t?.date || "");
    if (!iso || iso < todayIso || iso > endIso) continue;
    if (String(t.kind || "") !== kindFilter) continue;
    if (Math.abs(Number(t.amount) || 0) < minAbs) continue;
    n++;
  }
  const byId = tmUniqueExpectedMap();
  for (const tx of byId.values()) {
    const eff = effectiveNextOccurrenceListFields(tx);
    const nextIso = nextOccurrenceIsoForRecurringList(tx, todayIso);
    if (!nextIso || nextIso < todayIso || nextIso > endIso) continue;
    if (String(eff.kind || "") !== kindFilter) continue;
    if (Math.abs(Number(eff.amount) || 0) < minAbs) continue;
    n++;
  }
  return n;
}

function tmAmtModifierClass(kind, amount) {
  const abs = Math.abs(Number(amount) || 0);
  const k = String(kind || "expense");
  const large = (k === "expense" && abs >= 2000) || (k === "income" && abs >= 3500);
  return large ? "tm-amt--standout" : "tm-amt--calm";
}

function refreshTmChipCounts() {
  if (!tmChips || !tmChips.length) return;
  const today = toISODate(new Date());
  const d30 = new Date();
  d30.setDate(d30.getDate() + 30);
  const end30 = toISODate(d30);
  const end365 = toISODate((() => {
    const x = new Date();
    x.setDate(x.getDate() + 365);
    return x;
  })());

  const uncat = tmCountUncategorizedActual();
  const recurringN = tmUniqueExpectedMap().size;

  let up30 = 0;
  for (const t of state.upcomingActualItems || []) {
    const iso = normalizeIsoDate(t?.date) || String(t?.date || "");
    if (iso && iso >= today && iso <= end30) up30++;
  }
  up30 += countTmExpectedOccurrencesInNextDays(30);

  const annualN = [...tmUniqueExpectedMap().values()].filter((t) => String(t?.recurrence || "") === "yearly").length;

  const largeN = tmCountLargeHitsBetween(today, end365, "expense", 500);

  /** @type {Record<string, number>} */
  const counts = {
    uncategorized: uncat,
    recurring: recurringN,
    upcoming30: up30,
    annual: annualN,
    large: largeN,
  };

  for (const btn of tmChips) {
    const k = String(btn?.dataset?.tmView || "");
    const el = btn.querySelector(".tm-chip__count");
    if (!el) continue;
    const n = counts[k];
    if (n == null || !Number.isFinite(n)) {
      el.textContent = "";
      continue;
    }
    el.textContent = n > 0 ? ` (${n})` : "";
  }
}

function tmDateRangeFromToolbar() {
  const startIso = upcomingStartDate?.value || toISODate(new Date());
  const endIso = upcomingEndDate?.value || startIso;
  return { startIso, endIso };
}

function ymBounds(ym) {
  if (!ym || String(ym).length < 7) return { start: "", end: "" };
  const parts = String(ym).split("-");
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return { start: "", end: "" };
  const last = new Date(y, mo, 0).getDate();
  return { start: `${String(ym).slice(0, 7)}-01`, end: `${String(ym).slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

function tmVariableExpectedCountInRange(startIso, endIso) {
  const todayIso = toISODate(new Date());
  let n = 0;
  for (const tx of tmUniqueExpectedMap().values()) {
    const eff = effectiveNextOccurrenceListFields(tx);
    if (!eff.variable) continue;
    const nextIso = nextOccurrenceIsoForRecurringList(tx, todayIso);
    if (!nextIso || nextIso < startIso || nextIso > endIso) continue;
    n++;
  }
  return n;
}

function tmLargestExpenseInRange(startIso, endIso) {
  let best = null;
  for (const t of state.upcomingActualItems || []) {
    const iso = normalizeIsoDate(t?.date) || String(t?.date || "");
    if (!iso || iso < startIso || iso > endIso) continue;
    if (String(t.kind || "") !== "expense") continue;
    const a = Math.abs(Number(t.amount) || 0);
    if (!best || a > best.amt) best = { amt: a, iso, label: actualTransactionPrimaryLabel(t) };
  }
  const todayIso = toISODate(new Date());
  for (const tx of tmUniqueExpectedMap().values()) {
    const eff = effectiveNextOccurrenceListFields(tx);
    if (String(eff.kind || "") !== "expense") continue;
    const nextIso = nextOccurrenceIsoForRecurringList(tx, todayIso);
    if (!nextIso || nextIso < startIso || nextIso > endIso) continue;
    const a = Math.abs(Number(eff.amount) || 0);
    const label = String(eff.description || "").trim() || "(no description)";
    if (!best || a > best.amt) best = { amt: a, iso: nextIso, label };
  }
  return best;
}

function tmCountDaysBelowFloorInRange(startIso, endIso) {
  const floor = readStoredMinBalanceThresholdForReports();
  if (floor == null || !Number.isFinite(floor) || floor <= 0) return 0;
  if (!state.monthDailyBalances || !state.monthDailyBalances.size) return 0;
  let n = 0;
  for (const [iso, row] of state.monthDailyBalances.entries()) {
    if (!iso || iso < startIso || iso > endIso) continue;
    const endNum = Number(row?.end);
    if (!Number.isFinite(endNum) || endNum < 0) continue;
    if (endNum < floor) n++;
  }
  return n;
}

function tmLatestReconciledIsoBefore(endIso) {
  const s = state.reconciledDates;
  if (!s || !s.size || !endIso) return "";
  let best = "";
  for (const iso of s) {
    if (!iso || iso > endIso) continue;
    if (!best || iso > best) best = iso;
  }
  return best;
}

function tmForecastLowInMonthYm(ym) {
  const { start, end } = ymBounds(ym);
  if (!start || !end || !state.monthDailyBalances || !state.monthDailyBalances.size) return null;
  let low = null;
  for (const [iso, row] of state.monthDailyBalances.entries()) {
    if (!iso || iso < start || iso > end) continue;
    const endNum = Number(row?.end);
    if (!Number.isFinite(endNum)) continue;
    if (low == null || endNum < low.bal) low = { bal: endNum, iso };
  }
  return low;
}

function tmInsightCard(title, body, extraClass = "", opts = {}) {
  const ec = extraClass ? ` ${extraClass}` : "";
  const bodyInner = opts && opts.htmlBody ? body : escapeHtml(body);
  return `<div class="tm-insight-card${ec}"><div class="tm-insight-card__title">${escapeHtml(title)}</div><div class="tm-insight-card__body">${bodyInner}</div></div>`;
}

function refreshTmInsights() {
  if (!tmInsightsEl) return;
  const { startIso, endIso } = tmDateRangeFromToolbar();
  const cards = [];

  let rowCount = 0;
  try {
    rowCount = txListMain ? txListMain.querySelectorAll(".tm-row").length : 0;
  } catch (_) {}

  const varsInRange = tmVariableExpectedCountInRange(startIso, endIso);
  const uncat = tmCountUncategorizedActual();
  const floorDays = tmCountDaysBelowFloorInRange(startIso, endIso);

  /* One primary insight at a time — variable amounts first when actionable */
  if (varsInRange > 0) {
    const lead = `${varsInRange} recurring ${varsInRange === 1 ? "bill still needs" : "bills still need"} real amounts.`;
    const tail = `Update ${varsInRange === 1 ? "it" : "them"} before ${varsInRange === 1 ? "it affects" : "they affect"} your forecast.`;
    cards.push(
      tmInsightCard(
        "Variable amounts",
        `<strong class="tm-insight-card__lead">${escapeHtml(lead)}</strong> <span class="tm-insight-card__tail">${escapeHtml(tail)}</span>`,
        "tm-insight-card--variable",
        { htmlBody: true }
      )
    );
  } else if (uncat > 0) {
    cards.push(
      tmInsightCard(
        "Uncategorized",
        `${uncat} one-time ${uncat === 1 ? "transaction needs" : "transactions need"} a category. Uncategorized lines can blur what is safe to move from checking.`,
        "tm-insight-card--uncat"
      )
    );
  } else if (floorDays > 0) {
    cards.push(
      tmInsightCard(
        "Cash pressure ahead",
        `${floorDays} projected ${floorDays === 1 ? "day" : "days"} in this window dip below your minimum balance. Adjust dates or amounts to restore room.`,
        "tm-insight-card--risk"
      )
    );
  } else if (rowCount > 0) {
    cards.push(
      tmInsightCard(
        "Forecast hygiene",
        "Nothing urgent surfaced for these filters—fine-tune recurring amounts before they hit the calendar.",
        "tm-insight-card--calm"
      )
    );
  }

  if (!cards.length) {
    tmInsightsEl.innerHTML = "";
    tmInsightsEl.hidden = true;
    return;
  }

  const innerClass = cards.length === 1 ? "tm-insight-grid__inner tm-insight-grid__inner--single" : "tm-insight-grid__inner";
  tmInsightsEl.innerHTML = `<div class="${innerClass}">${cards.join("")}</div>`;
  tmInsightsEl.hidden = false;
}

function refreshTmForecastNote() {
  if (!tmForecastNote) return;
  const uncat = tmCountUncategorizedActual();
  const { startIso, endIso } = tmDateRangeFromToolbar();
  const varsInRange = tmVariableExpectedCountInRange(startIso, endIso);
  let rowCount = 0;
  try {
    rowCount = txListMain ? txListMain.querySelectorAll(".tm-row").length : 0;
  } catch (_) {}
  const latest = tmLatestReconciledIsoBefore(toISODate(new Date()));
  tmForecastNote.classList.remove("tm__forecastNote--status", "tm__forecastNote--tip");
  if (!tmInsightsEl?.hidden) {
    tmForecastNote.textContent = "";
    tmForecastNote.hidden = true;
  } else if (rowCount <= 0) {
    tmForecastNote.textContent = "";
    tmForecastNote.hidden = true;
  } else if (uncat > 0) {
    tmForecastNote.textContent = `Start with uncategorized transactions, then review upcoming rows so your forecast stays easy to trust.`;
    tmForecastNote.classList.add("tm__forecastNote--tip");
    tmForecastNote.hidden = false;
  } else if (latest) {
    tmForecastNote.textContent = `Everything in this list is categorized. Your forecast is reconciled through ${fmtDateMedDisplay(latest)}.`;
    tmForecastNote.classList.add("tm__forecastNote--status");
    tmForecastNote.hidden = false;
  } else {
    tmForecastNote.textContent = "Review upcoming rows here, then reconcile your forecast to your real balance after any edits.";
    tmForecastNote.classList.add("tm__forecastNote--tip");
    tmForecastNote.hidden = false;
  }
}

function refreshSidebarForecastHints() {
  if (!sidebarForecastHints) return;
  const ym = monthInput?.value || "";
  const { start: mStart, end: mEnd } = ymBounds(ym);
  const parts = [];
  const low = tmForecastLowInMonthYm(ym);
  if (low) {
    parts.push(
      `<div class="sidebar-fqh__row"><span class="sidebar-fqh__k">Forecast low</span><span class="sidebar-fqh__v">$${fmtMoney(low.bal)} <span class="sidebar-fqh__d">${fmtDateMedDisplay(low.iso)}</span></span></div>`
    );
  }
  const latestRec = mEnd ? tmLatestReconciledIsoBefore(mEnd) : tmLatestReconciledIsoBefore(toISODate(new Date()));
  if (latestRec) {
    parts.push(
      `<div class="sidebar-fqh__row"><span class="sidebar-fqh__k">Reconciled through</span><span class="sidebar-fqh__v">${fmtDateMedDisplay(latestRec)}</span></div>`
    );
  }
  if (mStart && mEnd) {
    const floorDays = tmCountDaysBelowFloorInRange(mStart, mEnd);
    if (floorDays > 0) {
      parts.push(
        `<div class="sidebar-fqh__row"><span class="sidebar-fqh__k">Cash pressure</span><span class="sidebar-fqh__v">${floorDays} ${floorDays === 1 ? "day" : "days"} below your minimum balance</span></div>`
      );
    }
  }
  if (!parts.length) {
    sidebarForecastHints.innerHTML = "";
    sidebarForecastHints.hidden = true;
    return;
  }
  sidebarForecastHints.innerHTML = `<div class="sidebar-fqh">${parts.join("")}</div>`;
  sidebarForecastHints.hidden = false;
}

function refreshTmPrimaryAction() {
  if (!tmPrimaryAction) return;
  const uncat = tmCountUncategorizedActual();
  if (uncat > 0) {
    tmPrimaryAction.dataset.tmAction = "uncat";
    tmPrimaryAction.textContent = "Review uncategorized";
    tmPrimaryAction.title = `${uncat} transaction${uncat === 1 ? "" : "s"} need a category`;
  } else {
    tmPrimaryAction.dataset.tmAction = "add";
    tmPrimaryAction.textContent = "Add transaction";
    tmPrimaryAction.title = "Add a one-time or recurring transaction";
  }
}

function refreshTmSummaryStrip() {
  if (!tmSummaryLine) return;
  refreshTmChipCounts();
  refreshTmInsights();
  refreshTmPrimaryAction();
  refreshTmForecastNote();

  const parts = [];
  let rowCount = 0;
  try {
    rowCount = txListMain ? txListMain.querySelectorAll(".tm-row").length : 0;
  } catch (_) {}
  if (rowCount > 0) parts.push(`${rowCount} in this list`);

  const varN = (state.expectedTransactions || []).filter(
    (t) => t && (!!t.variable || t.next_occurrence_variable === true),
  ).length;
  if (varN > 0) parts.push(`${varN} variable item${varN === 1 ? "" : "s"}`);

  tmSummaryLine.textContent = parts.length
    ? parts.join(" · ")
    : "Nothing flagged for cleanup in this view.";
}

if (runProjectionBtn) {
  runProjectionBtn.addEventListener("click", async () => {
    try {
      show(projectionErr, "");
      projectionSummary.innerHTML = "";
      projectionDailyList.innerHTML = "";

      if (!state.activeFamilyId) throw new Error("Choose a family first");

      const startVal = projectionStart.value;
      if (!startVal) throw new Error("Projection start date is required");

      const summary = await api(
        `/api/families/${state.activeFamilyId}/projection?start=${encodeURIComponent(startVal)}&days=1825&include_accounts=false`,
        "GET"
      );

      renderProjectionSummary(summary);

      const dailyShort = await api(
        `/api/families/${state.activeFamilyId}/projection?start=${encodeURIComponent(startVal)}&days=90&include_accounts=true`,
        "GET"
      );

      renderProjectionDaily(dailyShort?.daily || []);
    } catch (e) {
      show(projectionErr, e.message || "Failed to run projection");
    }
  });
}

if (chartDaysRange && chartDaysLabel) {
  chartDaysRange.addEventListener("input", () => {
    chartDaysLabel.textContent = `${chartDaysRange.value} days`;
    document.querySelectorAll(".chart-duration-btn").forEach((b) => b.classList.remove("is-active"));
    syncChartRangeDisplay();
  });
}
chartStart?.addEventListener("change", () => onReportsChartDateInputChanged(chartStart));
chartEnd?.addEventListener("change", () => {
  if (!isChartCustomRangeActive()) return;
  onReportsChartDateInputChanged(chartEnd);
});
const ieChartStartEl = document.getElementById("ieChartStart");
const ieChartEndEl = document.getElementById("ieChartEnd");
ieChartStartEl?.addEventListener("change", () => onReportsChartDateInputChanged(ieChartStartEl));
ieChartEndEl?.addEventListener("change", () => {
  if (!isChartCustomRangeActive()) return;
  onReportsChartDateInputChanged(ieChartEndEl);
});
const tbChartStartEl = document.getElementById("tbChartStart");
const tbChartEndEl = document.getElementById("tbChartEnd");
tbChartStartEl?.addEventListener("change", () => onReportsChartDateInputChanged(tbChartStartEl));
tbChartEndEl?.addEventListener("change", () => {
  if (!isChartCustomRangeActive()) return;
  onReportsChartDateInputChanged(tbChartEndEl);
});

function getYtdDaysFromChartStart() {
  if (!chartStart?.value) return 365;
  const s = new Date(`${chartStart.value}T12:00:00`);
  if (Number.isNaN(s.getTime())) return 365;
  const y = s.getFullYear();
  const end = new Date(y, 11, 31);
  const days = Math.floor((end - s) / 864e5) + 1;
  return Math.max(1, Math.min(4000, days));
}

function daysForPreset(preset) {
  const map = {
    "1D": 1,
    "5D": 5,
    "1M": 30,
    "6M": 183,
    "1Y": 365,
    "5Y": 1825,
    "MAX": 4000,
  };
  if (preset === "YTD") return getYtdDaysFromChartStart();
  return map[preset] ?? 365;
}

function isoAtNoon(iso) {
  return new Date(`${iso}T12:00:00`);
}

function isoAddDays(iso, delta) {
  const d = isoAtNoon(iso);
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}

function daysInclusiveBetween(startIso, endIso) {
  const a = isoAtNoon(startIso).getTime();
  const b = isoAtNoon(endIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  const n = Math.floor((b - a) / 864e5) + 1;
  return Math.max(1, n);
}

function chartRangeEndIso(startIso, days) {
  return isoAddDays(startIso, days - 1);
}

/** Last N calendar days ending today (inclusive). Used by reports 30/60/90 presets. */
function chartRangeRollingPast(days) {
  const n = Number(days);
  const count = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
  const todayIso = toISODate(new Date());
  return {
    start: isoAddDays(todayIso, -(count - 1)),
    end: todayIso,
    days: count,
  };
}

function applyReportsHorizonPresetDays(days) {
  const { start, end, days: n } = chartRangeRollingPast(days);
  if (chartStart) chartStart.value = start;
  if (chartEnd) chartEnd.value = end;
  if (chartDaysRange) chartDaysRange.value = String(n);
  if (chartDaysLabel) chartDaysLabel.textContent = `${n} days`;
  syncReportsChartDateMirrors();
}

function formatChartRangeLongLabel(iso) {
  const d = isoAtNoon(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function startOfWeekSundayFromDate(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
  const wd = x.getDay();
  x.setDate(x.getDate() - wd);
  return x;
}

function computeChartRangePreset(rangeId) {
  const today = new Date();
  const todayIso = toISODate(today);
  switch (rangeId) {
    case "this_week": {
      const s = startOfWeekSundayFromDate(today);
      return { start: toISODate(s), days: 7 };
    }
    case "last_week": {
      const s0 = startOfWeekSundayFromDate(today);
      s0.setDate(s0.getDate() - 7);
      return { start: toISODate(s0), days: 7 };
    }
    case "rolling_week":
      return { start: isoAddDays(todayIso, -6), days: 7 };
    case "this_month": {
      const y = today.getFullYear();
      const m = today.getMonth();
      const start = toISODate(new Date(y, m, 1));
      const end = toISODate(new Date(y, m + 1, 0));
      return { start, days: daysInclusiveBetween(start, end) };
    }
    case "last_month": {
      const y = today.getFullYear();
      const m = today.getMonth();
      const endD = new Date(y, m, 0);
      const start = toISODate(new Date(endD.getFullYear(), endD.getMonth(), 1));
      const end = toISODate(endD);
      return { start, days: daysInclusiveBetween(start, end) };
    }
    case "rolling_month":
      return { start: isoAddDays(todayIso, -29), days: 30 };
    case "this_quarter": {
      const y = today.getFullYear();
      const q = Math.floor(today.getMonth() / 3);
      const startM = q * 3;
      const start = toISODate(new Date(y, startM, 1));
      const end = toISODate(new Date(y, startM + 3, 0));
      return { start, days: daysInclusiveBetween(start, end) };
    }
    case "last_quarter": {
      let y = today.getFullYear();
      let q = Math.floor(today.getMonth() / 3) - 1;
      if (q < 0) {
        q = 3;
        y -= 1;
      }
      const startM = q * 3;
      const start = toISODate(new Date(y, startM, 1));
      const end = toISODate(new Date(y, startM + 3, 0));
      return { start, days: daysInclusiveBetween(start, end) };
    }
    case "rolling_quarter":
      return { start: isoAddDays(todayIso, -89), days: 90 };
    case "this_year": {
      const y = today.getFullYear();
      const start = `${y}-01-01`;
      const end = `${y}-12-31`;
      return { start, days: daysInclusiveBetween(start, end) };
    }
    case "last_year": {
      const y = today.getFullYear() - 1;
      const start = `${y}-01-01`;
      const end = `${y}-12-31`;
      return { start, days: daysInclusiveBetween(start, end) };
    }
    case "rolling_year":
      return { start: isoAddDays(todayIso, -364), days: 365 };
    default:
      return null;
  }
}

function readCommittedChartRange() {
  const start = chartStart?.value || "";
  let days = Number(chartDaysRange?.value);
  if (!Number.isFinite(days) || days < 1) days = 365;
  return { start, days };
}

let chartRangeDraft = { start: "", days: 365 };
let chartRangeOutsideAbort = null;

function syncChartRangeDisplay() {
  let text = "—";
  if (chartStart?.value) {
    const { start, endIso } = readReportsDateRange();
    if (start && endIso && endIso >= start) {
      text = `${formatChartRangeLongLabel(start)} – ${formatChartRangeLongLabel(endIso)}`;
    }
  }
  document.querySelectorAll("[data-reports-range-display]").forEach((el) => {
    el.textContent = text;
  });
}

function presetMatchesDraft(rangeId) {
  const p = computeChartRangePreset(rangeId);
  if (!p || !chartRangeDraft.start) return false;
  return p.start === chartRangeDraft.start && p.days === chartRangeDraft.days;
}

function setChartRangePresetHighlight() {
  document.querySelectorAll(".chart-range-preset").forEach((btn) => {
    const id = btn.dataset.range;
    btn.classList.toggle("is-active", !!id && presetMatchesDraft(id));
  });
}

function updateChartRangePopoverSummary() {
  const el = document.getElementById("chartRangePopoverSummary");
  if (!el) return;
  const { start, days } = chartRangeDraft;
  if (!start || !Number.isFinite(days) || days < 1) {
    el.textContent = "";
    return;
  }
  const end = chartRangeEndIso(start, days);
  el.replaceChildren();
  const strong = document.createElement("strong");
  strong.textContent = `${formatChartRangeLongLabel(start)} – ${formatChartRangeLongLabel(end)}`;
  el.appendChild(strong);
}

function syncCustomFieldsFromDraft() {
  if (!chartRangeCustomStart || !chartRangeCustomEnd || !chartRangeDraft.start) return;
  const { start, days } = chartRangeDraft;
  chartRangeCustomStart.value = start;
  chartRangeCustomEnd.value = chartRangeEndIso(start, days);
}

function onChartRangeOutsidePointer(e) {
  if (!chartRangePopover || chartRangePopover.hidden) return;
  const t = e.target;
  if (chartRangePopover.contains(t) || chartRangeDisplay?.contains(t)) return;
  closeChartRangePopover();
}

function onChartRangePopoverKeydown(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    closeChartRangePopover();
  }
}

function openChartRangePopover() {
  if (!chartRangePopover || !chartRangeDisplay) return;
  chartRangeDraft = readCommittedChartRange();
  if (chartRangeCustomFields) chartRangeCustomFields.hidden = true;
  updateChartRangePopoverSummary();
  setChartRangePresetHighlight();
  chartRangePopover.hidden = false;
  chartRangeDisplay.setAttribute("aria-expanded", "true");
  if (chartRangeOutsideAbort) chartRangeOutsideAbort.abort();
  chartRangeOutsideAbort = new AbortController();
  const sig = chartRangeOutsideAbort.signal;
  document.addEventListener("pointerdown", onChartRangeOutsidePointer, { capture: true, signal: sig });
  document.addEventListener("keydown", onChartRangePopoverKeydown, { signal: sig });
}

function closeChartRangePopover() {
  if (!chartRangePopover || !chartRangeDisplay) return;
  chartRangePopover.hidden = true;
  chartRangeDisplay.setAttribute("aria-expanded", "false");
  if (chartRangeOutsideAbort) {
    chartRangeOutsideAbort.abort();
    chartRangeOutsideAbort = null;
  }
}

async function applyChartRangeFromPopover() {
  let start = chartRangeDraft.start;
  let days = chartRangeDraft.days;
  const customOpen = chartRangeCustomFields && !chartRangeCustomFields.hidden;
  if (customOpen) {
    const cs = chartRangeCustomStart?.value;
    const ce = chartRangeCustomEnd?.value;
    if (!cs || !ce) {
      show(chartErr, "Select start and end dates.");
      return;
    }
    if (ce < cs) {
      show(chartErr, "End date must be on or after start date.");
      return;
    }
    start = cs;
    days = daysInclusiveBetween(cs, ce);
  }
  if (!start) {
    show(chartErr, "Start date is required.");
    return;
  }
  if (days > 4000) {
    show(chartErr, "Range cannot exceed 4000 days.");
    return;
  }
  show(chartErr, "");
  chartStart.value = start;
  chartDaysRange.value = String(days);
  if (chartDaysLabel) chartDaysLabel.textContent = `${days} days`;
  document.querySelectorAll(".chart-duration-btn").forEach((b) => b.classList.remove("is-active"));
  closeChartRangePopover();
  try {
    await refreshProjectionChart();
  } catch (err) {
    show(chartErr, err.message || "Failed to update chart");
  }
}

function formatProjectionAxisDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatProjectionTooltipDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDateLong(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function addMonthsIso(startIso, deltaMonths) {
  const d = new Date(`${startIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDate();
  d.setMonth(d.getMonth() + deltaMonths);
  // If month roll caused date to shift (e.g. Jan 31 -> Mar 2), clamp back to last day of new month.
  if (d.getDate() !== day) {
    d.setDate(0);
  }
  return toISODate(d);
}

function computeNextBillingDate(startIso, frequency) {
  if (!startIso) return "";
  const freq = String(frequency || "monthly");
  const todayIso = toISODate(new Date());
  if (freq !== "monthly") return "";
  const trialEnd = addDaysIso(startIso, 14);
  let next = trialEnd || addMonthsIso(startIso, 1);
  let guard = 0;
  while (next && next < todayIso && guard < 60) {
    guard += 1;
    next = addMonthsIso(next, 1);
  }
  return next;
}

function getBillingPlanLabel(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "pro") return "Add Budgeting";
  if (p === "base") return "Cash Forecast";
  return "—";
}

function getBillingPlanContext(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "pro") {
    return "Forecasting, reports, recurring cash, plus budgeting.";
  }
  return "Forecast, reports, and recurring cash planning.";
}

function billingStatusPillHtml(status) {
  const s = String(status || "Active").trim() || "Active";
  return `<span class="billing-status-pill billing-status-pill--active"><span class="billing-status-pill__icon" aria-hidden="true">✓</span>${escapeHtml(
    s
  )}</span>`;
}

function wireBillingActionsOnce() {
  if (billingActionsWired) return;
  document.querySelectorAll("[data-billing-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = String(btn.getAttribute("data-billing-action") || "");
      const messages = {
        payment:
          "Updating your card isn’t available here yet—for payment changes, use Contact support.",
        cycle: "Billing cycle changes go through support for now.",
        cancel: "Send this request via support—we’ll help with cancellation.",
        invoices: "Invoices aren’t linked here yet; support can help with receipts or history.",
      };
      showBwToast(messages[action] || "Billing tools are still being connected.");
    });
  });
  billingActionsWired = true;
}

function renderBillingPanel() {
  if (!billingPlanEl || !billingFrequencyEl || !billingNextDateEl) return;
  let plan = "";
  let freq = "monthly";
  let start = "";
  try {
    plan = localStorage.getItem(BILLING_PLAN_KEY) || "";
    freq = localStorage.getItem(BILLING_FREQUENCY_KEY) || "monthly";
    start = localStorage.getItem(BILLING_START_KEY) || "";
  } catch (_) {}
  wireBillingActionsOnce();
  const planLabel = getBillingPlanLabel(plan);
  const frequencyLabel = String(freq || "monthly").toLowerCase() === "monthly" ? "Monthly" : String(freq || "—");
  const todayIso = toISODate(new Date());
  const trialEnd = start ? addDaysIso(start, 14) : "";
  const next = computeNextBillingDate(start, freq);
  const inTrial = !!(trialEnd && trialEnd >= todayIso);
  if (billingPlanHeadlineEl) billingPlanHeadlineEl.textContent = planLabel === "—" ? "Cash Forecast" : planLabel;
  billingPlanEl.textContent = planLabel;
  billingFrequencyEl.textContent = frequencyLabel;
  if (billingPlanContextEl) billingPlanContextEl.textContent = getBillingPlanContext(plan);
  if (billingNextDateLabelEl) billingNextDateLabelEl.textContent = inTrial ? "Trial ends" : "Next renewal";
  billingNextDateEl.textContent = inTrial
    ? formatShortDateLong(trialEnd)
    : next
      ? formatShortDateLong(next)
      : "—";
  if (billingRenewalMessageEl) {
    billingRenewalMessageEl.textContent = inTrial
      ? `Your 14-day trial ends ${formatShortDateLong(trialEnd)}.`
      : next
        ? `Your next renewal is ${formatShortDateLong(next)}.`
        : "Renewal dates appear here once billing is active.";
    billingRenewalMessageEl.classList.toggle("billing-hero__renewal--trial", inTrial);
  }
  if (billingAccountStatusEl) {
    billingAccountStatusEl.innerHTML = billingStatusPillHtml(planLabel === "—" ? "Active" : "Active");
  }
}

function ensureProjectionChartDefaults() {
  if (projectionChartDefaultsApplied || typeof Chart === "undefined") return;
  projectionChartDefaultsApplied = true;
  Chart.defaults.color = "#4b5563";
  Chart.defaults.borderColor = "rgba(0,0,0,0.10)";
  Chart.defaults.font.family =
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  Chart.defaults.font.size = 11;
  registerProjectionAnnotationPlugins();
}

/*
 * Custom Chart.js plugin: draws inline event annotations + a "Today" guide line
 * on the Balance Trendline. Pure canvas drawing so it works without
 * chartjs-plugin-annotation. Annotations come from chart options
 * `plugins.balanceAnnotations.annotations`, today index from
 * `plugins.balanceAnnotations.todayIdx`.
 */
function registerProjectionAnnotationPlugins() {
  if (typeof Chart === "undefined") return;
  if (Chart.__bwBalanceAnnotationsRegistered) return;
  Chart.__bwBalanceAnnotationsRegistered = true;

  Chart.register({
    id: "balanceAnnotations",
    afterDatasetsDraw(chart, _args, opts) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales?.x || !scales?.y) return;
      const xScale = scales.x;
      const yScale = scales.y;

      const todayIdx = opts && Number.isFinite(opts.todayIdx) ? Number(opts.todayIdx) : -1;
      const todayBal = opts && Number.isFinite(opts.todayBal) ? Number(opts.todayBal) : null;
      if (todayIdx >= 0) {
        const x = xScale.getPixelForValue(todayIdx);
        if (x >= chartArea.left && x <= chartArea.right) {
          ctx.save();
          ctx.strokeStyle = "rgba(30, 41, 59, 0.45)";
          ctx.setLineDash([6, 5]);
          ctx.lineWidth = 1.85;
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top + 2);
          ctx.lineTo(x, chartArea.bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          if (todayBal != null) {
            const py = yScale.getPixelForValue(todayBal);
            if (py >= chartArea.top && py <= chartArea.bottom) {
              ctx.beginPath();
              ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
              ctx.strokeStyle = "rgba(51, 65, 85, 0.35)";
              ctx.lineWidth = 1.25;
              ctx.arc(x, py, 4.2, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
              ctx.beginPath();
              ctx.fillStyle =
                todayBal >= 0 ? "rgba(11, 61, 46, 0.88)" : "rgba(185, 28, 28, 0.92)";
              ctx.arc(x, py, 2.1, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          const pillPadX = 8;
          const pillPadY = 4;
          const pillH = 21;
          ctx.font =
            '700 11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
          const tw = ctx.measureText("Today").width;
          const pillW = tw + pillPadX * 2;
          let pillX = Math.min(chartArea.right - pillW - 3, x + 5);
          if (pillX < chartArea.left + 2) pillX = chartArea.left + 2;
          const pillY = chartArea.top + 2;
          drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 6);
          ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
          ctx.fill();
          ctx.strokeStyle = "rgba(17, 24, 39, 0.2)";
          ctx.lineWidth = 1.05;
          ctx.stroke();
          ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("Today", pillX + pillW / 2, pillY + pillH / 2);
          ctx.restore();
        }
      }

      const floor =
        opts && Number.isFinite(opts.floor) ? Number(opts.floor) : null;
      const floorDrawLine = !!(opts && opts.floorDrawLine);
      const floorLabelCustom =
        opts && typeof opts.floorLabel === "string" && opts.floorLabel.trim()
          ? String(opts.floorLabel).trim()
          : "";
      if (floor != null) {
        const y = yScale.getPixelForValue(floor);
        if (y >= chartArea.top && y <= chartArea.bottom) {
          ctx.save();
          if (floorDrawLine) {
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = "rgba(71, 85, 105, 0.48)";
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(chartArea.left, y);
            ctx.lineTo(chartArea.right, y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          const label =
            floorLabelCustom || `Minimum balance $${formatChartMoneyShort(floor)}`;
          ctx.font =
            '700 9.5px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
          ctx.textBaseline = "bottom";
          ctx.textAlign = "right";
          const pad = 6;
          const txtW = ctx.measureText(label).width;
          ctx.fillStyle = "rgba(252, 252, 253, 0.92)";
          ctx.fillRect(chartArea.right - txtW - pad - 5, y - 14, txtW + pad + 6, 14);
          ctx.strokeStyle = "rgba(51, 65, 85, 0.32)";
          ctx.lineWidth = 1;
          ctx.strokeRect(chartArea.right - txtW - pad - 5, y - 14, txtW + pad + 6, 14);
          ctx.fillStyle = "rgba(51, 65, 85, 0.88)";
          ctx.fillText(label, chartArea.right - 4, y - 2);
          ctx.restore();
        }
      }

      const annotations = (opts && Array.isArray(opts.annotations)) ? opts.annotations : [];
      if (!annotations.length) return;
      ctx.save();

      // Track label rectangles so we can dodge collisions between markers.
      const placed = [];
      const PAD_X = 4;
      const GAP = 3;

      for (const ann of annotations) {
        if (!ann) continue;
        const idx = Number(ann.idx);
        const val = Number(ann.value);
        if (!Number.isFinite(idx) || !Number.isFinite(val)) continue;
        const px = xScale.getPixelForValue(idx);
        const py = yScale.getPixelForValue(val);
        if (px < chartArea.left - 4 || px > chartArea.right + 4) continue;

        const isInflow = ann.kind === "inflow";
        const dot = isInflow ? "rgba(4, 120, 87, 0.88)" : "rgba(167, 55, 68, 0.82)";
        const ring = isInflow ? "rgba(4, 120, 87, 0.1)" : "rgba(167, 55, 68, 0.1)";

        // Halo + dot
        ctx.beginPath();
        ctx.fillStyle = ring;
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = dot;
        ctx.arc(px, py, 2.25, 0, Math.PI * 2);
        ctx.fill();

        // Label chip (+ optional framing caption beneath the amount)
        const label = String(ann.label || "");
        if (!label) continue;
        const caption = String(ann.caption || "").trim();
        const fontMain =
          '650 11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        const fontCap =
          '600 8px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.font = fontMain;
        const wLabel = ctx.measureText(label).width;
        let wCap = 0;
        if (caption) {
          ctx.font = fontCap;
          wCap = ctx.measureText(caption).width;
        }
        const txtW = Math.max(wLabel, wCap);
        const chipW = txtW + PAD_X * 2 + 6;
        const chipH = caption ? 32 : 19;
        const radius = caption ? 8 : 8;

        // Keep labels closer to their points so they read as part of the line.
        let chipX = px + 7;
        if (chipX + chipW > chartArea.right - 2) chipX = px - chipW - 7;
        if (chipX < chartArea.left + 2) chipX = chartArea.left + 2;
        let chipY = py + (isInflow ? -chipH - 6 : 6);
        if (chipY < chartArea.top + 2) chipY = py + 6;
        if (chipY + chipH > chartArea.bottom - 2) chipY = py - chipH - 6;

        // Dodge: shift down/up if it overlaps a previously placed chip.
        for (let attempt = 0; attempt < 8; attempt++) {
          const collides = placed.some((r) => {
            return !(
              chipX + chipW + GAP < r.x ||
              chipX > r.x + r.w + GAP ||
              chipY + chipH + GAP < r.y ||
              chipY > r.y + r.h + GAP
            );
          });
          if (!collides) break;
          const dir = attempt % 2 === 0 ? 1 : -1;
          chipY += dir * (chipH + GAP - 1);
          if (chipY < chartArea.top + 2) chipY = chartArea.top + 2;
          if (chipY + chipH > chartArea.bottom - 2) chipY = chartArea.bottom - chipH - 2;
        }
        placed.push({ x: chipX, y: chipY, w: chipW, h: chipH });

        // Subtle leader from the point to the chip.
        ctx.save();
        ctx.strokeStyle = isInflow ? "rgba(4, 120, 87, 0.35)" : "rgba(185, 28, 28, 0.38)";
        ctx.lineWidth = 1.1;
        const chipCx = chipX <= px ? chipX + chipW : chipX;
        const chipCy = chipY + chipH / 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(chipCx, chipCy);
        ctx.stroke();
        ctx.restore();

        // Chip background
        const bg = isInflow ? "rgba(236, 253, 245, 0.96)" : "rgba(254, 242, 242, 0.96)";
        const bd = isInflow ? "rgba(4, 120, 87, 0.28)" : "rgba(185, 28, 28, 0.3)";
        drawRoundedRect(ctx, chipX, chipY, chipW, chipH, radius);
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.strokeStyle = bd;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.textAlign = "center";
        if (caption) {
          ctx.font = fontMain;
          ctx.fillStyle = isInflow ? "rgba(6, 78, 59, 0.92)" : "rgba(127, 29, 29, 0.9)";
          ctx.textBaseline = "middle";
          ctx.fillText(label, chipX + chipW / 2, chipY + 11);
          ctx.font = fontCap;
          ctx.fillStyle = isInflow ? "rgba(6, 95, 70, 0.62)" : "rgba(130, 40, 40, 0.65)";
          ctx.fillText(caption, chipX + chipW / 2, chipY + 23);
        } else {
          ctx.font = fontMain;
          ctx.fillStyle = isInflow ? "rgba(6, 78, 59, 0.92)" : "rgba(127, 29, 29, 0.9)";
          ctx.textBaseline = "middle";
          ctx.fillText(label, chipX + chipW / 2, chipY + chipH / 2);
        }
      }
      ctx.restore();
    },
  });
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function formatChartMoneyShort(v) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1) + "M";
  if (abs >= 10_000) return Math.round(n / 1000) + "k";
  if (abs >= 1_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return Math.round(n).toLocaleString();
}

async function refreshProjectionChart() {
  if (!projectionChartCanvas || !chartDaysRange || !chartStart) return;
  show(chartErr, "");
  projectionChartCanvas.dataset.status = "";
  if (!state.activeFamilyId) throw new Error("Choose a family first");
  if (!chartStart.value) throw new Error("Chart start date is required");
  const daysVal = Number(chartDaysRange.value);
  if (!Number.isFinite(daysVal) || daysVal < 1 || daysVal > 4000) {
    throw new Error("Horizon must be between 1 and 4000 days");
  }
  const summary = await api(
    `/api/families/${state.activeFamilyId}/projection?start=${encodeURIComponent(chartStart.value)}&days=${daysVal}&include_accounts=false`,
    "GET"
  );
  lastProjectionDailyForReports = summary?.daily || [];
  lastCashInsightsForReports = buildCashInsightsForSurface({
    daily: lastProjectionDailyForReports,
    startIso: chartStart.value,
    endIso: chartRangeEndIso(chartStart.value, daysVal),
    surface: "reports",
  });
  drawProjectionChart(lastProjectionDailyForReports);
  syncChartRangeDisplay();
  renderReportsOperationalPanels();
}

function setIncomeExpenseEmpty(msg) {
  if (!incomeExpenseEmpty) return;
  incomeExpenseEmpty.textContent = msg || "";
  incomeExpenseEmpty.style.display = msg ? "flex" : "none";
}

function destroyIncomeExpenseChart() {
  if (incomeExpenseChartInstance) {
    try {
      incomeExpenseChartInstance.destroy();
    } catch (_) {}
    incomeExpenseChartInstance = null;
  }
}

function applyIncomeExpenseToggleUi() {
  if (incomeExpenseGroupedBtn) incomeExpenseGroupedBtn.classList.toggle("is-active", !incomeExpenseIsStacked);
  if (incomeExpenseStackedBtn) incomeExpenseStackedBtn.classList.toggle("is-active", incomeExpenseIsStacked);
  if (incomeExpenseNetToggle) {
    incomeExpenseNetToggle.classList.toggle("is-active", incomeExpenseShowNet);
    incomeExpenseNetToggle.setAttribute("aria-pressed", incomeExpenseShowNet ? "true" : "false");
  }
}

function aggregateIncomeExpenseByMonth(items) {
  /** @type {Map<string,{income:number,expense:number}>} */
  const byMonth = new Map();
  for (const it of items || []) {
    const iso = it && it.date ? String(it.date) : "";
    if (!iso || iso.length < 7) continue;
    const key = iso.slice(0, 7);
    const kind = String(it.kind || "");
    const amt = Number(it.amount || 0);
    if (!Number.isFinite(amt)) continue;
    const row = byMonth.get(key) || { income: 0, expense: 0 };
    if (kind === "income") row.income += amt;
    else if (kind === "expense") row.expense += amt;
    byMonth.set(key, row);
  }
  const months = [...byMonth.keys()].sort();
  return {
    months,
    income: months.map((m) => byMonth.get(m)?.income || 0),
    expense: months.map((m) => byMonth.get(m)?.expense || 0),
  };
}

function fmtWeekStartShort(iso) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Week bucket label for chart axis, e.g. "Apr 6–12" (week starting Monday `iso`). */
function fmtWeekRangeLabel(weekStartIso) {
  const d0 = new Date(`${weekStartIso}T12:00:00`);
  if (Number.isNaN(d0.getTime())) return String(weekStartIso);
  const d1 = new Date(d0);
  d1.setDate(d1.getDate() + 6);
  const a = d0.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const b = d1.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${a}–${b}`;
}

function renderIncomeExpenseInsights(agg) {
  const host = document.getElementById("incomeExpenseInsights");
  if (!host) return;
  const weeks = agg?.weeks || [];
  const income = agg?.income || [];
  const expense = agg?.expense || [];
  if (!weeks.length) {
    host.innerHTML = "";
    host.hidden = true;
    return;
  }
  let maxE = -1;
  let maxEI = -1;
  let maxNet = -Infinity;
  let maxNetI = -1;
  let deficitWeeks = 0;
  for (let i = 0; i < weeks.length; i++) {
    const inc = Number(income[i] || 0);
    const exp = Number(expense[i] || 0);
    const net = inc - exp;
    if (exp > maxE) {
      maxE = exp;
      maxEI = i;
    }
    if (net > maxNet) {
      maxNet = net;
      maxNetI = i;
    }
    if (exp > inc) deficitWeeks++;
  }
  const cards = [];
  if (maxEI >= 0 && maxE > 0) {
    cards.push(`
      <div class="reports-ie-card reports-ie-card--expensepeak" aria-label="Highest expense week">
        <div class="reports-ie-card__label">Highest expense week</div>
        <div class="reports-ie-card__value reports-ie-card__value--out">$${escapeHtml(fmtMoney(maxE))}</div>
        <div class="reports-ie-card__period">${escapeHtml(fmtWeekRangeLabel(weeks[maxEI]))}</div>
      </div>
    `);
  }
  if (maxNetI >= 0 && maxNet > 0) {
    cards.push(`
      <div class="reports-ie-card reports-ie-card--cashpeak" aria-label="Largest positive cash week">
        <div class="reports-ie-card__label">Largest positive cash week</div>
        <div class="reports-ie-card__value reports-ie-card__value--in">+$${escapeHtml(fmtMoney(maxNet))}</div>
        <div class="reports-ie-card__period">${escapeHtml(fmtWeekRangeLabel(weeks[maxNetI]))}</div>
      </div>
    `);
  }
  const note =
    deficitWeeks > 0
      ? `<div class="reports-ie-note">${deficitWeeks} week${deficitWeeks === 1 ? "" : "s"} with expenses above income</div>`
      : "";
  if (!cards.length && !note) {
    host.innerHTML = "";
    host.hidden = true;
    return;
  }
  host.innerHTML = `<div class="reports-ie-cards">${cards.join("")}</div>${note}`;
  host.hidden = false;
}

function drawIncomeExpenseChart(agg) {
  if (!incomeExpenseChartCanvas) return;
  if (typeof Chart === "undefined") return;

  ensureIncomeExpenseChartPlugins();

  const ctx = incomeExpenseChartCanvas.getContext("2d");
  if (!ctx) return;

  const onReportsView = !!(reportsViewPanel && !reportsViewPanel.hidden);

  const useWeeks = Array.isArray(agg?.weeks) && agg.weeks.length > 0;
  const labels = useWeeks
    ? agg.weeks.map((w) => fmtWeekRangeLabel(w))
    : (agg.months || []).map(fmtMonthYearShort);
  const income = agg.income || [];
  const expense = agg.expense || [];
  const net = labels.map((_, i) => Number(income[i] || 0) - Number(expense[i] || 0));

  let maxExpIdx = -1;
  let maxExp = -1;
  const expGtInc = expense.map((e, i) => Number(e || 0) > Number(income[i] || 0));
  if (useWeeks) {
    for (let i = 0; i < expense.length; i++) {
      const e = Number(expense[i] || 0);
      if (e > maxExp) {
        maxExp = e;
        maxExpIdx = i;
      }
    }
  }

  const expenseBg = expense.map((e, i) => {
    if (!useWeeks) return "rgba(167, 55, 68, 0.62)";
    const expv = Number(e || 0);
    if (i === maxExpIdx && maxExp > 0) return "rgba(153, 27, 27, 0.88)";
    if (expGtInc[i]) return "rgba(185, 28, 28, 0.72)";
    return "rgba(167, 55, 68, 0.52)";
  });
  const expenseBorder = expense.map((e, i) => {
    if (!useWeeks) return "rgba(127, 29, 29, 0.82)";
    if (i === maxExpIdx && maxExp > 0) return "rgba(99, 16, 16, 0.95)";
    if (expGtInc[i]) return "rgba(153, 27, 27, 0.9)";
    return "rgba(167, 55, 68, 0.62)";
  });

  const incomeBg = "rgba(6, 95, 70, 0.72)";

  destroyIncomeExpenseChart();
  applyIncomeExpenseToggleUi();

  const datasets = [];
  if (incomeExpenseShowNet) {
    datasets.push({
      type: "line",
      label: "Net",
      data: net,
      borderColor: "rgba(51, 65, 85, 0.42)",
      backgroundColor: "transparent",
      borderWidth: 1.6,
      borderDash: [5, 4],
      pointRadius: 0,
      tension: 0.12,
      yAxisID: "y",
      order: 0,
    });
  }
  datasets.push(
    {
      label: "Income",
      data: income,
      backgroundColor: incomeBg,
      borderColor: "rgba(4, 64, 48, 0.88)",
      borderWidth: 1,
      borderSkipped: false,
      stack: incomeExpenseIsStacked ? "stack" : undefined,
      order: 1,
    },
    {
      label: "Expense",
      data: expense,
      backgroundColor: expenseBg,
      borderColor: expenseBorder,
      borderWidth: 1,
      stack: incomeExpenseIsStacked ? "stack" : undefined,
      order: 1,
    }
  );

  const lastBarDatasetIndex = datasets.length - 1;

  incomeExpenseChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        incomeExpenseHighlight: {
          highlightIndex: useWeeks && maxExpIdx >= 0 && maxExp > 0 ? maxExpIdx : -1,
        },
        incomeExpenseDivider: {
          stacked: !!incomeExpenseIsStacked,
        },
        legend: {
          display: true,
          position: "top",
          align: "end",
          labels: {
            boxWidth: 8,
            boxHeight: 8,
            padding: 6,
            font: { size: 9, weight: "500" },
            color: "rgba(100, 116, 139, 0.55)",
            usePointStyle: true,
            pointStyle: "rectRounded",
          },
        },
        tooltip: {
          displayColors: false,
          padding: 10,
          filter: (tooltipItem) => tooltipItem.dataset.label === "Expense",
          titleFont: { size: 12, weight: "700" },
          bodyFont: { size: 11.5, weight: "500" },
          callbacks: {
            title: (items) => {
              const i = items[0]?.dataIndex ?? 0;
              if (useWeeks && agg.weeks[i]) return `Week of ${fmtWeekRangeLabel(agg.weeks[i])}`;
              return items[0]?.label || "";
            },
            label: (ctx) => {
              if (ctx.datasetIndex !== lastBarDatasetIndex) return null;
              const i = ctx.dataIndex ?? 0;
              const inc = Number(income[i] || 0);
              const expv = Number(expense[i] || 0);
              const nf = Number(inc) - Number(expv);
              const netStr =
                nf >= 0
                  ? `+$${fmtMoney(nf)}`
                  : `−$${fmtMoney(Math.abs(nf))}`;
              return [`Income: $${fmtMoney(inc)}`, `Expenses: $${fmtMoney(expv)}`, `Net: ${netStr}`];
            },
          },
        },
      },
      scales: {
        x: {
          stacked: !!incomeExpenseIsStacked,
          grid: { display: false },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 14,
            font: { size: 10, weight: "600" },
            color: onReportsView ? "rgba(71, 85, 105, 0.78)" : "rgba(100, 116, 139, 0.62)",
          },
        },
        y: {
          stacked: !!incomeExpenseIsStacked,
          grid: {
            color: onReportsView ? "rgba(100, 116, 139, 0.1)" : "rgba(0,0,0,0.045)",
            drawBorder: false,
          },
          ticks: {
            font: { size: 9.75, weight: "600" },
            color: onReportsView ? "rgba(71, 85, 105, 0.76)" : "rgba(100, 116, 139, 0.58)",
            callback: (value) => "$" + fmtMoney0(value),
          },
        },
      },
    },
  });
}

async function refreshIncomeExpenseReport() {
  if (!incomeExpenseChartCanvas) return;
  if (!state.activeFamilyId) return;
  show(incomeExpenseErr, "");
  setIncomeExpenseEmpty("");
  const insightsEl = document.getElementById("incomeExpenseInsights");
  const clearInsights = () => {
    if (insightsEl) {
      insightsEl.innerHTML = "";
      insightsEl.hidden = true;
    }
  };
  try {
    const { start, endIso } = readReportsDateRange();
    if (!start || !endIso) throw new Error("Select a valid date range.");
    const items = await fetchIncomeExpenseReportItems(start, endIso);
    if (!Array.isArray(items) || items.length === 0) {
      destroyIncomeExpenseChart();
      lastIncomeExpenseAggForChart = null;
      const mode = calendarMode?.value || "both";
      const hint =
        mode === "actual"
          ? "No posted transactions in this range. Switch Forecast to “Both” or “Expected” to include scheduled items."
          : "No income or expense activity in this range.";
      setIncomeExpenseEmpty(hint);
      clearInsights();
      return;
    }
    const aggRaw = aggregateIncomeExpenseByWeek(items);
    if (!aggRaw.weeks.length) {
      destroyIncomeExpenseChart();
      lastIncomeExpenseAggForChart = null;
      setIncomeExpenseEmpty("No data for this range.");
      clearInsights();
      return;
    }
    const agg = filterIncomeExpenseWeeksWithoutActivity(aggRaw);
    if (!agg.weeks.length) {
      destroyIncomeExpenseChart();
      lastIncomeExpenseAggForChart = null;
      setIncomeExpenseEmpty("No income or expense activity in weekly buckets for this range.");
      clearInsights();
      return;
    }
    lastIncomeExpenseAggForChart = agg;
    renderIncomeExpenseInsights(agg);
    drawIncomeExpenseChart(agg);
  } catch (e) {
    destroyIncomeExpenseChart();
    lastIncomeExpenseAggForChart = null;
    clearInsights();
    show(incomeExpenseErr, e.message || "Failed to load income vs expense report");
  }
}

runProjectionChartBtn?.addEventListener("click", async () => {
  try {
    document.querySelectorAll(".chart-duration-btn").forEach((b) => b.classList.remove("is-active"));
    await refreshProjectionChart();
  } catch (e) {
    show(chartErr, e.message || "Failed to update chart");
  }
});

document.querySelector(".chart-duration-bar")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".chart-duration-btn");
  if (!btn) return;
  try {
    const preset = btn.dataset.preset;
    if (!preset) return;
    const d = daysForPreset(preset);
    chartDaysRange.value = String(d);
    if (chartDaysLabel) chartDaysLabel.textContent = `${d} days`;
    document.querySelectorAll(".chart-duration-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
    await refreshProjectionChart();
  } catch (err) {
    show(chartErr, err.message || "Failed to update chart");
  }
});

if (incomeExpenseGroupedBtn) {
  incomeExpenseGroupedBtn.addEventListener("click", () => {
    incomeExpenseIsStacked = false;
    applyIncomeExpenseToggleUi();
    void refreshIncomeExpenseReport().catch(() => {});
  });
}
if (incomeExpenseStackedBtn) {
  incomeExpenseStackedBtn.addEventListener("click", () => {
    incomeExpenseIsStacked = true;
    applyIncomeExpenseToggleUi();
    void refreshIncomeExpenseReport().catch(() => {});
  });
}
if (incomeExpenseDownloadBtn) {
  incomeExpenseDownloadBtn.addEventListener("click", () => {
    try {
      if (!incomeExpenseChartInstance) return;
      const a = document.createElement("a");
      a.download = "income-vs-expense.png";
      a.href = incomeExpenseChartInstance.toBase64Image("image/png", 1);
      a.click();
    } catch (_) {}
  });
}
if (incomeExpenseNetToggle) {
  incomeExpenseNetToggle.addEventListener("click", () => {
    incomeExpenseShowNet = !incomeExpenseShowNet;
    applyIncomeExpenseToggleUi();
    if (lastIncomeExpenseAggForChart) {
      drawIncomeExpenseChart(lastIncomeExpenseAggForChart);
      return;
    }
    void refreshIncomeExpenseReport().catch(() => {});
  });
}

if (chartRangeDisplay && chartRangePopover) {
  chartRangeDisplay.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (chartRangePopover.hidden) openChartRangePopover();
    else closeChartRangePopover();
  });
  document.querySelectorAll(".chart-range-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.range;
      const p = id ? computeChartRangePreset(id) : null;
      if (!p) return;
      chartRangeDraft = { start: p.start, days: p.days };
      if (chartRangeCustomFields) chartRangeCustomFields.hidden = true;
      updateChartRangePopoverSummary();
      setChartRangePresetHighlight();
    });
  });
  chartRangeCustomToggle?.addEventListener("click", () => {
    if (!chartRangeCustomFields) return;
    const on = chartRangeCustomFields.hidden;
    chartRangeCustomFields.hidden = !on;
    if (!chartRangeCustomFields.hidden) syncCustomFieldsFromDraft();
  });
  chartRangeCustomStart?.addEventListener("change", () => {
    const cs = chartRangeCustomStart.value;
    const ce = chartRangeCustomEnd?.value;
    if (!cs || !ce || ce < cs) return;
    chartRangeDraft = { start: cs, days: daysInclusiveBetween(cs, ce) };
    updateChartRangePopoverSummary();
    document.querySelectorAll(".chart-range-preset").forEach((b) => b.classList.remove("is-active"));
  });
  chartRangeCustomEnd?.addEventListener("change", () => {
    const cs = chartRangeCustomStart?.value;
    const ce = chartRangeCustomEnd.value;
    if (!cs || !ce || ce < cs) return;
    chartRangeDraft = { start: cs, days: daysInclusiveBetween(cs, ce) };
    updateChartRangePopoverSummary();
    document.querySelectorAll(".chart-range-preset").forEach((b) => b.classList.remove("is-active"));
  });
  chartRangeApplyBtn?.addEventListener("click", () => {
    applyChartRangeFromPopover();
  });
  chartRangeCancelBtn?.addEventListener("click", () => {
    closeChartRangePopover();
  });
}

function validateTxEditBeforeRecurringApply() {
  if (!state.activeFamilyId) return "Choose a family first";
  if (!selectedExpectedInstance) return "Select an occurrence from the calendar for this series.";
  const amountVal = txEditAmount?.value;
  const amount = amountVal ? Number(amountVal) : null;
  if (!amount || Number.isNaN(amount) || amount <= 0) return "Amount must be > 0";
  if (!instanceAccountId?.value) return "Account is required";
  return null;
}

function validateTxEditBeforeRecurringDelete() {
  if (!state.activeFamilyId) return "Choose a family first";
  if (!selectedExpectedInstance) return "Select an occurrence from the calendar for this series.";
  return null;
}

async function deleteExpectedThisOccurrenceOnlyFromModal() {
  if (!state.activeFamilyId) throw new Error("Choose a family first");
  if (!selectedExpectedInstance) throw new Error("Select an expected occurrence from the calendar");
  const cancelOcc = normalizeIsoDate(selectedExpectedInstance.occurrence_date) || selectedExpectedInstance.occurrence_date;
  await api(
    `/api/families/${state.activeFamilyId}/expected-transactions/${selectedExpectedInstance.expected_transaction_id}/instances/${cancelOcc}`,
    "POST",
    { action: "cancel" }
  );
  closeTxEditDeleteScopeModal();
  closeTxEditModal();
  await refreshExpectedCalendarAndMonth();
}

async function deleteExpectedThisAndFutureFromModal() {
  if (!state.activeFamilyId) throw new Error("Choose a family first");
  if (!selectedExpectedInstance) throw new Error("Select an expected occurrence from the calendar");
  const meta = getExpectedSeriesMeta(selectedExpectedInstance.expected_transaction_id);
  if (!meta || meta.recurrence === "once") {
    throw new Error("This series is not recurring.");
  }
  const occ = normalizeIsoDate(selectedExpectedInstance.occurrence_date);
  if (!occ) throw new Error("Invalid occurrence date");
  await api(
    `/api/families/${state.activeFamilyId}/expected-transactions/${selectedExpectedInstance.expected_transaction_id}/end-from-occurrence/${occ}`,
    "POST"
  );
  closeTxEditDeleteScopeModal();
  closeTxEditModal();
  await refreshExpectedCalendarAndMonth();
}

function txEditEditedOccurrenceIso() {
  return normalizeIsoDate(txEditDate?.value || "") || null;
}

/** Keep series end_date valid when rescheduling start_date earlier. */
function safeSeriesEndDateForReschedule(endDate, startDateIso) {
  if (!endDate || !startDateIso) return endDate || null;
  const end = normalizeIsoDate(endDate);
  const start = normalizeIsoDate(startDateIso);
  if (end && start && end < start) return null;
  return endDate || null;
}

function buildExpectedSeriesPutPayload({
  accountId,
  amount,
  recurrenceVal,
  secondDayVal,
  secondMonthVal,
  endCountVal,
  notesVal,
  categoryId,
  meta,
  startDateIso,
}) {
  const startIso = normalizeIsoDate(startDateIso) || startDateIso;
  let endDate = meta.end_date || null;
  if (recurrenceVal === "once" && meta.start_date) {
    const metaStart = normalizeIsoDate(meta.start_date);
    const metaEnd = normalizeIsoDate(endDate);
    if (metaStart && metaEnd && metaStart === metaEnd) {
      endDate = startIso;
    }
  }
  endDate = safeSeriesEndDateForReschedule(endDate, startIso);
  return {
    account_id: Number(accountId),
    start_date: startIso,
    end_date: endDate,
    end_count: endCountVal,
    recurrence: recurrenceVal,
    second_day_of_month:
      recurrenceVal === "twice_monthly" || recurrenceVal === "semiannual" ? secondDayVal : null,
    second_occurrence_month: recurrenceVal === "semiannual" ? secondMonthVal : null,
    description: expectedSaveDescription(),
    notes: notesVal,
    kind: getRadioValue("txEditKind", "expense"),
    amount: Number(amount),
    variable: !!(seriesVariable && seriesVariable.checked),
    category_id: categoryId,
    ...txColorFieldsForSave(txEditSelectedBgColor),
  };
}

/** Reload forecast calendar data after any transaction edit (amount, date, recurrence, etc.). */
async function refreshForecastAfterTransactionEdit(iso) {
  const ym = iso ? String(iso).slice(0, 7) : "";
  const curYm = (calendarMonth?.value || monthInput?.value || "").slice(0, 7);
  if (ym && curYm && ym !== curYm) {
    if (monthInput) monthInput.value = ym;
    applyCalendarMonthToPickers(ym);
  }
  invalidateLowBalanceAlertCache();
  await loadMonthAndCalendar();
}

async function navigateCalendarToIsoMonthIfNeeded(iso) {
  await refreshForecastAfterTransactionEdit(iso);
}

async function saveExpectedInstanceOverride() {
  show(txEditErr, "");
  if (!state.activeFamilyId) throw new Error("Choose a family first");
  if (!selectedExpectedInstance) throw new Error("Select an expected occurrence from the calendar");

  const amountVal = txEditAmount.value;
  const amount = amountVal ? Number(amountVal) : null;
  if (!amount || Number.isNaN(amount) || amount <= 0) throw new Error("Amount must be > 0");

  const accountId = instanceAccountId.value;
  if (!accountId) throw new Error("Account is required");

  const categoryId = categoryIdFromCategoryField("txEditCategoryId");

  const occ = normalizeIsoDate(selectedExpectedInstance.occurrence_date);
  if (!occ) throw new Error("Invalid occurrence date");
  // If the user moves the occurrence back onto its original occurrence_date,
  // clear moved_to_date so it shows only once on that day.
  let movedTo = normalizeIsoDate(selectedExpectedMovedToDate || txEditEditedOccurrenceIso() || "") || null;
  if (movedTo && movedTo === occ) movedTo = null;
  if (movedTo && isDateBeforeEarliestStartingBalance(movedTo)) {
    throw new Error("That date is before your starting balance.");
  }

  const payload = {
    action: "update",
    account_id: Number(accountId),
    kind: getRadioValue("txEditKind", "expense"),
    amount,
    description: expectedSaveDescription(),
    category_id: categoryId,
    ...txColorFieldsForSave(txEditSelectedBgColor),
    moved_to_date: movedTo,
    variable: !!(seriesVariable && seriesVariable.checked),
  };
  await api(
    `/api/families/${state.activeFamilyId}/expected-transactions/${selectedExpectedInstance.expected_transaction_id}/instances/${occ}`,
    "POST",
    payload
  );

  closeTxEditModal();
  await navigateCalendarToIsoMonthIfNeeded(movedTo);
}

async function saveExpectedSeriesFromInstance() {
  show(txEditErr, "");
  if (!state.activeFamilyId) throw new Error("Choose a family first");
  const seriesId = selectedExpectedInstance
    ? Number(selectedExpectedInstance.expected_transaction_id)
    : Number(expectedEditId?.value || 0);
  if (!seriesId) throw new Error("No recurring transaction selected");

  const meta = selectedExpectedSeriesTx || getExpectedSeriesMeta(seriesId);
  if (!meta) throw new Error("Could not load series details");

  const amountVal = txEditAmount?.value;
  const amount = amountVal ? Number(amountVal) : null;
  if (!amount || Number.isNaN(amount) || amount <= 0) throw new Error("Amount must be > 0");

  const accountId = instanceAccountId?.value;
  if (!accountId) throw new Error("Account is required");

  const categoryId = categoryIdFromCategoryField("txEditCategoryId");
  const notesVal = txEditNotes ? txEditNotes.value.trim() || null : null;

  const recurrenceVal = instanceRecurrence?.value || meta.recurrence || "monthly";
  const occRaw = selectedExpectedInstance
    ? normalizeIsoDate(selectedExpectedInstance.occurrence_date) || selectedExpectedInstance.occurrence_date
    : null;
  if (!occRaw) {
    throw new Error("Pick an occurrence from the calendar or recurring list to update this date and all future ones.");
  }
  const editedIso = txEditEditedOccurrenceIso();
  if (editedIso && isDateBeforeEarliestStartingBalance(editedIso)) {
    throw new Error("That date is before your starting balance.");
  }
  const dateMoved = !!(editedIso && editedIso !== occRaw);
  const endCountRaw = instanceEndCount?.value != null ? String(instanceEndCount.value).trim() : "";
  const endCountVal = endCountRaw === "" ? null : Number(endCountRaw);
  if (endCountVal != null) {
    if (!Number.isFinite(endCountVal) || endCountVal < 1 || Math.floor(endCountVal) !== endCountVal) {
      throw new Error("Ends after must be a whole number ≥ 1");
    }
  }
  let secondDayVal = meta.second_day_of_month != null ? Number(meta.second_day_of_month) : null;
  let secondMonthVal = meta.second_occurrence_month != null ? Number(meta.second_occurrence_month) : null;
  if (recurrenceVal === "twice_monthly") {
    const n = readSecondDayOfMonthFromInput(instanceSecondDayOfMonth);
    if (!Number.isFinite(n) || n < 1 || n > 31) throw new Error("Second monthly date is required");
    const startIso = normalizeIsoDate(meta.start_date || "") || meta.start_date || "";
    const startDom = startIso && String(startIso).length >= 10 ? Number(String(startIso).slice(8, 10)) : NaN;
    // When applying from a specific occurrence, the backend treats that occurrence date as the
    // new series start. For twice-monthly series, the "second day" must differ from the *apply*
    // occurrence day. If we're applying from the existing second day, automatically swap days
    // so the schedule stays the same (just flips which day is considered "start" vs "second").
    const anchorDom = dateMoved && editedIso ? Number(String(editedIso).slice(8, 10)) : Number(String(occRaw).slice(8, 10));
    const occDom = Number.isFinite(anchorDom) ? anchorDom : NaN;
    if (Number.isFinite(occDom) && n === occDom) {
      if (Number.isFinite(startDom) && startDom !== occDom) {
        secondDayVal = startDom;
      } else {
        throw new Error("Second day of month must be different than the selected occurrence day");
      }
    } else {
      // Apply-from-occurrence validates second day against the occurrence date (e.g. 29),
      // not the original series start_date day (e.g. 31) — both days can appear in one series.
      secondDayVal = n;
    }
    secondMonthVal = null;
  } else if (recurrenceVal === "semiannual") {
    const secondErr = validateSecondOccurrenceForSave(recurrenceVal, editedIso || meta.start_date || occRaw, instanceSecondDayOfMonth);
    if (secondErr) throw new Error(secondErr);
    const second = secondOccurrencePayloadFromForm(recurrenceVal, instanceSecondDayOfMonth);
    secondDayVal = second.second_day_of_month;
    secondMonthVal = second.second_occurrence_month;
  } else {
    secondDayVal = null;
    secondMonthVal = null;
  }

  const putPayload = buildExpectedSeriesPutPayload({
    accountId,
    amount,
    recurrenceVal,
    secondDayVal,
    secondMonthVal,
    endCountVal,
    notesVal,
    categoryId,
    meta,
    startDateIso: editedIso || meta.start_date || occRaw,
  });

  if (String(meta.recurrence || "") === "once") {
    await api(`/api/families/${state.activeFamilyId}/expected-transactions/${seriesId}`, "PUT", putPayload);
  } else {
    const applyBody = {
      account_id: Number(accountId),
      kind: getRadioValue("txEditKind", "expense"),
      amount: Number(amount),
      description: expectedSaveDescription(),
      reimbursable: !!meta.reimbursable,
      category_id: categoryId,
      notes: notesVal,
      recurrence: recurrenceVal,
      variable: !!(seriesVariable && seriesVariable.checked),
      end_count: endCountVal,
      ...txColorFieldsForSave(txEditSelectedBgColor),
    };
    if (recurrenceVal === "twice_monthly" || recurrenceVal === "semiannual") {
      applyBody.second_day_of_month = secondDayVal;
    }
    if (recurrenceVal === "semiannual") applyBody.second_occurrence_month = secondMonthVal;
    if (dateMoved && editedIso) applyBody.effective_start_date = editedIso;
    await api(
      `/api/families/${state.activeFamilyId}/expected-transactions/${seriesId}/apply-from-occurrence/${encodeURIComponent(occRaw)}`,
      "POST",
      applyBody
    );
  }

  closeTxEditModal();
  await navigateCalendarToIsoMonthIfNeeded(dateMoved ? editedIso : null);
}

function bindTxEditApplyScopeOption(btn) {
  if (!btn) return;
  btn.addEventListener("click", () => {
    const scope = btn.dataset.applyScope;
    if (scope === "series" || scope === "instance") setTxEditApplyScopeChoice(scope);
  });
}
bindTxEditApplyScopeOption(document.getElementById("txEditApplyScopeSeriesBtn"));
bindTxEditApplyScopeOption(document.getElementById("txEditApplyScopeInstanceBtn"));

const txEditApplyScopeSaveBtn = document.getElementById("txEditApplyScopeSaveBtn");
if (txEditApplyScopeSaveBtn) {
  txEditApplyScopeSaveBtn.addEventListener("click", async () => {
    if (!txEditApplyScopeChoice) return;
    try {
      show(document.getElementById("txEditApplyScopeErr"), "");
      if (txEditApplyScopeChoice === "instance") await saveExpectedInstanceOverride();
      else await saveExpectedSeriesFromInstance();
      closeTxEditApplyScopeModal();
    } catch (e) {
      const msg =
        txEditApplyScopeChoice === "instance"
          ? e.message || "Failed to save override"
          : e.message || "Failed to save";
      show(document.getElementById("txEditApplyScopeErr"), msg);
    }
  });
}

const txEditApplyScopeCancelBtn = document.getElementById("txEditApplyScopeCancelBtn");
if (txEditApplyScopeCancelBtn) {
  txEditApplyScopeCancelBtn.addEventListener("click", () => closeTxEditApplyScopeModal());
}

const txEditApplyScopeModal = document.getElementById("txEditApplyScopeModal");
if (txEditApplyScopeModal) {
  txEditApplyScopeModal.addEventListener("click", (e) => {
    if (e.target === txEditApplyScopeModal) closeTxEditApplyScopeModal();
  });
}

const txEditDeleteScopeModal = document.getElementById("txEditDeleteScopeModal");
if (txEditDeleteScopeModal) {
  txEditDeleteScopeModal.addEventListener("click", (e) => {
    if (e.target === txEditDeleteScopeModal) closeTxEditDeleteScopeModal();
  });
}

function bindTxEditDeleteScopeOption(btn) {
  if (!btn) return;
  btn.addEventListener("click", () => {
    const scope = btn.dataset.deleteScope;
    if (scope === "future" || scope === "instance") setTxEditDeleteScopeChoice(scope);
  });
}
bindTxEditDeleteScopeOption(document.getElementById("txEditDeleteScopeFutureBtn"));
bindTxEditDeleteScopeOption(document.getElementById("txEditDeleteScopeInstanceBtn"));

const txEditDeleteScopeConfirmBtn = document.getElementById("txEditDeleteScopeConfirmBtn");
if (txEditDeleteScopeConfirmBtn) {
  txEditDeleteScopeConfirmBtn.addEventListener("click", async () => {
    if (!txEditDeleteScopeChoice) return;
    try {
      show(document.getElementById("txEditDeleteScopeErr"), "");
      if (txEditDeleteScopeChoice === "instance") await deleteExpectedThisOccurrenceOnlyFromModal();
      else await deleteExpectedThisAndFutureFromModal();
    } catch (e) {
      const msg =
        txEditDeleteScopeChoice === "instance"
          ? e.message || "Failed to remove occurrence"
          : e.message || "Failed to delete future occurrences";
      show(document.getElementById("txEditDeleteScopeErr"), msg);
    }
  });
}

const txEditDeleteScopeCancelBtn = document.getElementById("txEditDeleteScopeCancelBtn");
if (txEditDeleteScopeCancelBtn) {
  txEditDeleteScopeCancelBtn.addEventListener("click", () => closeTxEditDeleteScopeModal());
}

async function loadMe() {
  const data = await api("/api/auth/me", "GET");
  if (!data?.user) throw new Error("Not logged in");
  state.user = data.user;
  state.isPlatformAdmin = !!data.is_platform_admin;
  const adminLink = document.getElementById("platformAdminLink");
  if (adminLink) adminLink.hidden = !state.isPlatformAdmin;
  syncPlatformAdminOnlyUi();

  // Transaction View and Reports are available to every signed-in user.
  // Older builds restricted them behind isPlatformAdmin; we leave the elements
  // visible and clear any stale `.admin-only-tab` class / `hidden` attribute
  // that might still ship in someone's cached HTML.
  for (const el of document.querySelectorAll(".admin-only-tab")) {
    el.classList.remove("admin-only-tab");
    el.hidden = false;
  }
  const tv = document.getElementById("navTransactionView");
  const rv = document.getElementById("navReportsView");
  if (tv) tv.hidden = false;
  if (rv) rv.hidden = false;
}

function syncActiveFamilyFlags() {
  const f = (state.families || []).find((x) => Number(x.id) === Number(state.activeFamilyId));
  state.activeFamilyAccessMode = f && String(f.access_mode || "").toLowerCase() === "view" ? "view" : "edit";
  state.activeFamilyIsOwner = !!(f && f.is_family_owner);
  const banner = document.getElementById("viewOnlyBanner");
  if (banner) {
    const ro = state.activeFamilyAccessMode === "view";
    banner.hidden = !ro;
    banner.textContent = ro
      ? "You have view-only access to this family. Ask the owner to grant edit access if you need to make changes."
      : "";
  }
  syncHouseholdSettingsUi();
}

function activeFamilyMembership() {
  if (!state.activeFamilyId) return null;
  return (state.families || []).find((x) => Number(x.id) === Number(state.activeFamilyId)) || null;
}

/** Experimental / internal controls (Starting screen, Balance display, etc.). */
function syncPlatformAdminOnlyUi() {
  const show = !!state.isPlatformAdmin;
  document.querySelectorAll("[data-platform-admin-only]").forEach((el) => {
    el.hidden = !show;
    el.setAttribute("aria-hidden", show ? "false" : "true");
    if (!show) {
      try {
        el.style.display = "none";
      } catch (_) {}
    } else {
      try {
        el.style.removeProperty("display");
      } catch (_) {}
    }
  });
}

/** Collaborators settings: family role `admin` only (not platform admin, not owner alone). */
function canViewHouseholdSettings() {
  const fam = activeFamilyMembership();
  if (!fam) return false;
  if (String(fam.access_mode || "edit").toLowerCase() === "view") return false;
  return String(fam.role || "").trim().toLowerCase() === "admin";
}

/** Invite / add-member controls: family owner or family role `admin`. */
function canManageHouseholdInvites() {
  const fam = activeFamilyMembership();
  if (!fam) return false;
  if (String(fam.access_mode || "edit").toLowerCase() === "view") return false;
  if (fam.is_family_owner) return true;
  return String(fam.role || "").trim().toLowerCase() === "admin";
}

function getActiveSettingsSectionKey() {
  const pane = document.querySelector("#settingsViewPanel .settings-pane.is-active");
  return pane ? String(pane.dataset.settingsPane || "accounts") : "accounts";
}

/** Collaborators nav + pane: family role `admin` only. */
function syncHouseholdSettingsUi() {
  const canHousehold = canViewHouseholdSettings();
  const canInvite = canManageHouseholdInvites();
  document.querySelectorAll("[data-settings-nav-collaborators]").forEach((btn) => {
    btn.hidden = !canHousehold;
    btn.setAttribute("aria-hidden", canHousehold ? "false" : "true");
  });
  document.querySelectorAll('[data-settings-pane="collaborators"], [data-settings-pane="familySharing"]').forEach((pane) => {
    if (!canHousehold) {
      pane.hidden = true;
      pane.classList.remove("is-active");
    }
  });
  if (!canHousehold && getActiveSettingsSectionKey() === "collaborators") {
    try {
      activateSettingsSection("accounts");
    } catch (_) {}
  }
  document.querySelectorAll(".family-invite-wrap, [data-household-invites-only]").forEach((el) => {
    el.hidden = !canInvite;
    el.setAttribute("aria-hidden", canInvite ? "false" : "true");
    if (!canInvite) {
      try {
        el.style.display = "none";
      } catch (_) {}
    } else {
      try {
        el.style.removeProperty("display");
      } catch (_) {}
    }
  });
}

function syncSettingsFamilySharingNav() {
  syncHouseholdSettingsUi();
}

async function loadFamilyMembersPanel() {
  const errEl = document.getElementById("familyMembersErr");
  const listEl = document.getElementById("familyMembersList");
  const pendingEl = document.getElementById("familyPendingInvites");
  show(errEl, "");
  if (!listEl) return;
  syncActiveFamilyFlags();
  syncHouseholdSettingsUi();
  if (!canViewHouseholdSettings()) {
    listEl.innerHTML = "";
    if (pendingEl) pendingEl.innerHTML = "";
    return;
  }
  if (!state.activeFamilyId) {
    listEl.innerHTML = '<p class="meta">Select a family from the app first.</p>';
    if (pendingEl) pendingEl.innerHTML = "";
    return;
  }
  const canInvite = canManageHouseholdInvites();
  if (pendingEl) {
    pendingEl.innerHTML = "";
    if (canInvite && state.activeFamilyIsOwner) {
      try {
        const pend = await api(`/api/families/${state.activeFamilyId}/invites`, "GET");
        if (!pend || pend.length === 0) {
          pendingEl.innerHTML = '<p class="meta">No pending invites.</p>';
        } else {
          for (const p of pend) {
            const row = document.createElement("div");
            row.className = "family-member-row";
            row.style.display = "flex";
            row.style.justifyContent = "space-between";
            row.style.alignItems = "center";
            row.style.flexWrap = "wrap";
            row.style.gap = "8px";
            row.innerHTML = `<div><strong>${escapeHtml(String(p.email))}</strong> <span class="meta">${escapeHtml(
              String(p.access_mode)
            )} · expires ${escapeHtml(String(p.expires_at || "").slice(0, 10))}</span></div>`;
            const revoke = document.createElement("button");
            revoke.type = "button";
            revoke.textContent = "Revoke";
            revoke.addEventListener("click", async () => {
              try {
                show(errEl, "");
                await api(`/api/families/${state.activeFamilyId}/invites/${p.id}`, "DELETE");
                await loadFamilyMembersPanel();
              } catch (e) {
                show(errEl, e.message || String(e));
              }
            });
            row.appendChild(revoke);
            pendingEl.appendChild(row);
          }
        }
      } catch (e) {
        pendingEl.innerHTML = `<p class="meta">${escapeHtml(e.message || String(e))}</p>`;
      }
    } else {
      pendingEl.innerHTML = '<p class="meta">Only the family owner can manage invites.</p>';
    }
  }
  const rows = await api(`/api/families/${state.activeFamilyId}/members`, "GET");
  listEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const m of rows || []) {
    const row = document.createElement("div");
    row.className = "family-member-row";
    const ownerPart = m.is_family_owner ? ' <span class="meta">(owner)</span>' : "";
    row.innerHTML = `<div><strong>${escapeHtml(String(m.email))}</strong>${ownerPart}<div class="meta">${escapeHtml(
      String(m.name || "").trim()
    )}</div></div>`;
    const body = row.firstElementChild;
    if (state.activeFamilyIsOwner && !m.is_family_owner) {
      const tools = document.createElement("div");
      tools.className = "family-member-tools";
      tools.style.marginTop = "6px";
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", `Access for ${m.email}`);
      sel.dataset.memberUserId = String(m.user_id);
      for (const opt of [
        { v: "edit", t: "Can edit" },
        { v: "view", t: "View only" },
      ]) {
        const o = document.createElement("option");
        o.value = opt.v;
        o.textContent = opt.t;
        if (String(m.access_mode || "edit").toLowerCase() === opt.v) o.selected = true;
        sel.appendChild(o);
      }
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.textContent = "Update access";
      saveBtn.addEventListener("click", async () => {
        try {
          show(errEl, "");
          await api(`/api/families/${state.activeFamilyId}/members/${m.user_id}`, "PATCH", {
            access_mode: sel.value,
          });
          await loadFamilyMembersPanel();
        } catch (e) {
          show(errEl, e.message || String(e));
        }
      });
      const ownBtn = document.createElement("button");
      ownBtn.type = "button";
      ownBtn.textContent = "Make owner";
      ownBtn.style.marginLeft = "8px";
      ownBtn.addEventListener("click", async () => {
        if (!window.confirm(`Make ${m.email} the family owner? You will lose owner-only controls until they grant them back.`)) return;
        try {
          show(errEl, "");
          await api(`/api/families/${state.activeFamilyId}/members/${m.user_id}`, "PATCH", {
            is_family_owner: true,
          });
          await loadFamilies();
          await loadFamilyMembersPanel();
        } catch (e) {
          show(errEl, e.message || String(e));
        }
      });
      tools.appendChild(sel);
      tools.appendChild(saveBtn);
      tools.appendChild(ownBtn);
      if (body) body.appendChild(tools);
    }
    frag.appendChild(row);
  }
  listEl.appendChild(frag);
}

async function loadFamilies() {
  const families = await api("/api/families", "GET");
  state.families = families || [];

  const prevIdRaw =
    familySelect && familySelect.value
      ? familySelect.value
      : state.activeFamilyId != null
        ? String(state.activeFamilyId)
        : "";
  familySelect.innerHTML = "";
  for (const f of state.families) {
    const opt = document.createElement("option");
    opt.value = String(f.id);
    opt.textContent = f.name;
    familySelect.appendChild(opt);
  }

  if (state.families.length > 0) {
    const prevNum = Number(prevIdRaw);
    const prevOk =
      Number.isFinite(prevNum) &&
      prevNum > 0 &&
      state.families.some((f) => Number(f.id) === prevNum);
    if (prevOk) familySelect.value = String(prevNum);
    state.activeFamilyId = Number(familySelect.value);
  } else {
    state.activeFamilyId = null;
  }
  syncActiveFamilyFlags();
  if (settingsViewPanel && !settingsViewPanel.hidden && getActiveSettingsSectionKey() === "accounts") {
    void loadFamilyMembersPanel();
  }
  await migrateLegacyDeviceBalanceThresholdsToAccount();
  hydrateBalanceThresholdInputsFromStorage();
}

function categoryIdFromSelectValue(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Reads category id from a plain select or a mounted category combobox (flushes typed text to hidden value first). */
function categoryIdFromCategoryField(fieldId) {
  if (categoryComboboxRegistry.has(fieldId)) {
    normalizeCategoryComboboxInput(fieldId);
    const st = categoryComboboxRegistry.get(fieldId);
    if (st) return categoryIdFromSelectValue(st.hidden.value);
  }
  return categoryIdFromSelectValue(document.getElementById(fieldId)?.value);
}

const CATEGORY_COMBOBOX_FIELD_IDS = ["txAddCategoryId", "txEditCategoryId"];

/** @type {Map<string, { wrap: HTMLElement, input: HTMLInputElement, hidden: HTMLInputElement, list: HTMLUListElement, categories: { id: number | string; name: string }[], blurTimer: ReturnType<typeof setTimeout> | null }>} */
const categoryComboboxRegistry = new Map();

let categoryComboOutsideClickBound = false;

function categoryComboSearchInputId(fieldId) {
  return `${fieldId}_search`;
}

function hideCategoryComboboxList(st) {
  st.list.hidden = true;
  st.input.setAttribute("aria-expanded", "false");
  for (const li of st.list.querySelectorAll("li.category-combobox__option.is-active")) {
    li.classList.remove("is-active");
  }
}

function showCategoryComboboxList(st) {
  st.list.hidden = false;
  st.input.setAttribute("aria-expanded", "true");
}

function getCategoryComboboxActiveIndex(st) {
  const els = Array.from(st.list.querySelectorAll("li.category-combobox__option"));
  return els.findIndex((li) => li.classList.contains("is-active"));
}

function setCategoryComboboxActiveIndex(st, index) {
  const els = Array.from(st.list.querySelectorAll("li.category-combobox__option"));
  for (const li of els) li.classList.remove("is-active");
  if (index >= 0 && index < els.length) {
    els[index].classList.add("is-active");
    els[index].scrollIntoView({ block: "nearest" });
  }
}

function selectCategoryComboboxChoice(fieldId, catId, name) {
  const st = categoryComboboxRegistry.get(fieldId);
  if (!st) return;
  st.hidden.value = String(catId);
  st.input.value = name;
  hideCategoryComboboxList(st);
  if (fieldId === "txAddCategoryId") {
    applyTxAddCategoryRecurrenceDefaults(catId);
    refreshTxAddCategoryChipActiveState();
    updateTxAddFormValidity();
  } else if (fieldId === "txEditCategoryId") {
    applyTxEditCategoryRecurrenceDefaults(catId);
  }
}

function normalizeCategoryComboboxInput(fieldId) {
  const st = categoryComboboxRegistry.get(fieldId);
  if (!st) return;
  const hid = st.hidden.value.trim();
  if (hid) {
    const cat = (st.categories || []).find((c) => String(c.id) === String(hid));
    st.input.value = cat ? categoryDisplayLabel(cat) : "";
    return;
  }
  const q = st.input.value.trim().toLowerCase();
  if (!q) {
    st.input.value = "";
    return;
  }
  const exact = (st.categories || []).filter((c) => {
    const n = String(c.name).trim().toLowerCase();
    const d = categoryDisplayLabel(c).trim().toLowerCase();
    return n === q || d === q;
  });
  if (exact.length === 1) {
    st.hidden.value = String(exact[0].id);
    st.input.value = categoryDisplayLabel(exact[0]);
    if (fieldId === "txAddCategoryId") applyTxAddCategoryRecurrenceDefaults(exact[0].id);
    else if (fieldId === "txEditCategoryId") applyTxEditCategoryRecurrenceDefaults(exact[0].id);
    return;
  }
  const subs = (st.categories || []).filter((c) => {
    const n = String(c.name).toLowerCase();
    const g = String(c.group_name || "").toLowerCase();
    const d = categoryDisplayLabel(c).toLowerCase();
    return n.includes(q) || g.includes(q) || d.includes(q);
  });
  if (subs.length === 1) {
    st.hidden.value = String(subs[0].id);
    st.input.value = categoryDisplayLabel(subs[0]);
    if (fieldId === "txAddCategoryId") applyTxAddCategoryRecurrenceDefaults(subs[0].id);
    else if (fieldId === "txEditCategoryId") applyTxEditCategoryRecurrenceDefaults(subs[0].id);
    return;
  }
  st.input.value = "";
}

function filterCategoryCombobox(fieldId) {
  const st = categoryComboboxRegistry.get(fieldId);
  if (!st) return;
  const q = st.input.value.trim().toLowerCase();
  const cats = st.categories || [];
  const filtered = !q
    ? cats.slice()
    : cats.filter((c) => {
        const n = String(c.name).toLowerCase();
        const g = String(c.group_name || "").toLowerCase();
        const d = categoryDisplayLabel(c).toLowerCase();
        return n.includes(q) || g.includes(q) || d.includes(q);
      });

  st.list.innerHTML = "";
  // Grouped render: group header + indented category names.
  const order = (state.categoryTree?.groups || []).map((g) => String(g.name || "").trim()).filter(Boolean);
  const byGroup = new Map();
  for (const c of filtered) {
    const g = String(c.group_name || "").trim() || "Other";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(c);
  }
  const groupNames = [...new Set([...order, ...byGroup.keys()])].filter((g) => byGroup.has(g));
  for (const gName of groupNames) {
    const header = document.createElement("li");
    header.className = "category-combobox__group";
    header.setAttribute("role", "presentation");
    header.textContent = gName;
    st.list.appendChild(header);

    const arr = byGroup.get(gName) || [];
    arr.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
    for (const c of arr) {
      const li = document.createElement("li");
      li.className = "category-combobox__option category-combobox__option--child";
      li.setAttribute("role", "option");
      li.dataset.id = String(c.id);
      li.dataset.display = categoryDisplayLabel(c);
      li.textContent = String(c.name || "").trim() || "(unnamed)";
      st.list.appendChild(li);
    }
  }
  const rawQ = st.input.value.trim();
  const qExact = rawQ.toLowerCase();
  let hasExactNameMatch = false;
  if (rawQ) {
    hasExactNameMatch = cats.some((c) => {
      const n = String(c.name || "").trim().toLowerCase();
      const d = categoryDisplayLabel(c).trim().toLowerCase();
      return n === qExact || d === qExact;
    });
  }
  if (rawQ && !hasExactNameMatch) {
    const addLi = document.createElement("li");
    addLi.className = "category-combobox__option category-combobox__option--create";
    addLi.setAttribute("role", "option");
    addLi.dataset.createName = rawQ;
    const safe = escapeHtml(rawQ);
    addLi.innerHTML = `<span class="category-combobox__plus" aria-hidden="true">+</span><span class="category-combobox__create-text">Add “${safe}” as new category</span>`;
    st.list.appendChild(addLi);
  }
}

function applyCategoryComboboxPickFromLi(fieldId, li) {
  if (!li) return;
  if (li.classList.contains("category-combobox__option--create")) {
    const nm = li.dataset.createName || "";
    void createCategoryFromCombobox(fieldId, nm);
    return;
  }
  const id = li.dataset.id;
  const display = li.dataset.display || li.textContent || "";
  if (id) selectCategoryComboboxChoice(fieldId, id, display);
}

async function createCategoryFromCombobox(fieldId, rawName) {
  const name = String(rawName || "").trim();
  if (!name) return;
  const st = categoryComboboxRegistry.get(fieldId);
  if (st) hideCategoryComboboxList(st);
  try {
    if (!state.activeFamilyId) throw new Error("Choose a family first");
    const kind = categoryKindForComboboxField(fieldId);
    const gid = categoryGroupIdForNewCategory(kind);
    if (gid == null || !Number.isFinite(Number(gid))) throw new Error("No category group available yet.");
    const ok = await addCategoryToGroup(gid, name);
    if (!ok) return;
    const newCat = (state.categories || []).find((c) => normalizeNameForCompare(c?.name) === normalizeNameForCompare(name));
    if (newCat) selectCategoryComboboxChoice(fieldId, newCat.id, categoryDisplayLabel(newCat));
  } catch (err) {
    window.alert(err.message || "Failed to add category");
  }
}

function onCategoryComboboxKeydown(e, fieldId) {
  const st = categoryComboboxRegistry.get(fieldId);
  if (!st) return;
  if (e.key === "Escape") {
    e.preventDefault();
    hideCategoryComboboxList(st);
    normalizeCategoryComboboxInput(fieldId);
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (st.list.hidden) {
      showCategoryComboboxList(st);
      filterCategoryCombobox(fieldId);
    }
    const els = Array.from(st.list.querySelectorAll("li.category-combobox__option"));
    if (!els.length) return;
    let idx = getCategoryComboboxActiveIndex(st);
    if (idx < 0) {
      idx = e.key === "ArrowDown" ? -1 : els.length;
    }
    if (e.key === "ArrowDown") idx = Math.min(idx + 1, els.length - 1);
    else idx = Math.max(idx - 1, 0);
    setCategoryComboboxActiveIndex(st, idx);
    return;
  }
  if (e.key === "Enter") {
    if (!st.list.hidden) {
      const idx = getCategoryComboboxActiveIndex(st);
      const els = Array.from(st.list.querySelectorAll("li.category-combobox__option"));
      if (idx >= 0 && els[idx]) {
        e.preventDefault();
        applyCategoryComboboxPickFromLi(fieldId, els[idx]);
        return;
      }
    }
    const q = st.input.value.trim().toLowerCase();
    const cats = st.categories || [];
    const filtered = !q
      ? cats
      : cats.filter((c) => {
          const n = String(c.name).toLowerCase();
          const g = String(c.group_name || "").toLowerCase();
          const d = categoryDisplayLabel(c).toLowerCase();
          return n.includes(q) || g.includes(q) || d.includes(q);
        });
    if (filtered.length === 1) {
      e.preventDefault();
      selectCategoryComboboxChoice(fieldId, filtered[0].id, categoryDisplayLabel(filtered[0]));
    }
  }
}

function mountCategoryComboboxFromSelect(selectEl) {
  const fieldId = selectEl.id;
  if (!fieldId || categoryComboboxRegistry.has(fieldId)) return;

  ensureCategoryComboDocClick();

  const wrap = document.createElement("div");
  wrap.className = "category-combobox";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "category-combobox__input";
  input.id = categoryComboSearchInputId(fieldId);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", `${fieldId}_list`);
  input.autocomplete = "off";
  input.placeholder = "Select category";
  input.spellcheck = false;

  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.id = fieldId;

  const list = document.createElement("ul");
  list.className = "category-combobox__list";
  list.id = `${fieldId}_list`;
  list.setAttribute("role", "listbox");
  list.hidden = true;

  selectEl.replaceWith(wrap);
  wrap.appendChild(input);
  wrap.appendChild(hidden);
  wrap.appendChild(list);

  const label = document.querySelector(`label[for="${fieldId}"]`);
  if (label) label.setAttribute("for", input.id);

  const st = {
    wrap,
    input,
    hidden,
    list,
    categories: [],
    blurTimer: null,
  };
  categoryComboboxRegistry.set(fieldId, st);

  list.addEventListener("mousedown", (e) => {
    const li = e.target && /** @type {HTMLElement} */ (e.target).closest("li.category-combobox__option");
    if (!li || !list.contains(li)) return;
    e.preventDefault();
    if (st.blurTimer) {
      clearTimeout(st.blurTimer);
      st.blurTimer = null;
    }
    applyCategoryComboboxPickFromLi(fieldId, li);
  });

  input.addEventListener("input", () => filterCategoryCombobox(fieldId));
  input.addEventListener("focus", () => {
    showCategoryComboboxList(st);
    filterCategoryCombobox(fieldId);
  });
  input.addEventListener("blur", () => {
    if (st.blurTimer) clearTimeout(st.blurTimer);
    st.blurTimer = setTimeout(() => {
      st.blurTimer = null;
      normalizeCategoryComboboxInput(fieldId);
      hideCategoryComboboxList(st);
    }, 180);
  });
  input.addEventListener("keydown", (e) => onCategoryComboboxKeydown(e, fieldId));

  if (fieldId === "txAddCategoryId") {
    ensureTxAddCategoryChipsUi();
    renderTxAddCategoryChips();
  }
}

function syncCategoryComboboxCategories(fieldId, categories) {
  ensureCategoryComboDocClick();
  let st = categoryComboboxRegistry.get(fieldId);
  if (!st) {
    const el = document.getElementById(fieldId);
    if (!el || !(el instanceof HTMLSelectElement)) return;
    mountCategoryComboboxFromSelect(el);
    st = categoryComboboxRegistry.get(fieldId);
  }
  if (!st) return;
  st.categories = categories || [];
  const cur = st.hidden.value;
  if (cur) {
    const cat = st.categories.find((c) => String(c.id) === String(cur));
    st.input.value = cat ? categoryDisplayLabel(cat) : "";
  }
  if (!st.list.hidden) filterCategoryCombobox(fieldId);
  refreshTxCategoryColorPickers();
  if (fieldId === "txAddCategoryId") renderTxAddCategoryChips();
}

function syncAllCategoryComboboxes(categories) {
  for (const fid of CATEGORY_COMBOBOX_FIELD_IDS) {
    syncCategoryComboboxCategories(fid, categories);
  }
}

const txAddCategoryColorPicker = renderCategoryColorPicker({
  rowEl: txAddCategoryColorRow,
  swatchesEl: txAddCategoryColorSwatches,
  clearBtn: txAddCategoryColorClear,
  getCategoryId: () => categoryIdFromCategoryField("txAddCategoryId"),
  getBg: () => txAddSelectedBgColor,
  setBg: (v) => {
    txAddColorTouched = true;
    txAddSelectedBgColor = v && String(v).trim() ? String(v).trim() : null;
  },
});
const txEditCategoryColorPicker = renderCategoryColorPicker({
  rowEl: txEditCategoryColorRow,
  swatchesEl: txEditCategoryColorSwatches,
  clearBtn: txEditCategoryColorClear,
  unhideRow: true,
  getCategoryId: () => categoryIdFromCategoryField("txEditCategoryId"),
  getBg: () => txEditSelectedBgColor,
  setBg: (v) => {
    txEditColorTouched = true;
    txEditSelectedBgColor = v && String(v).trim() ? String(v).trim() : null;
  },
});

function txEditEffectiveColor() {
  const raw = txEditSelectedBgColor ? String(txEditSelectedBgColor).trim() : "";
  if (raw && raw.toLowerCase() === "none") return null;
  if (raw) return raw;
  const cid = categoryIdFromCategoryField("txEditCategoryId");
  const st = categoryStyleFromId(cid);
  const catBg = st && st.bg ? String(st.bg).trim() : "";
  if (catBg && catBg.toLowerCase() !== "none") return catBg;
  return null;
}

function refreshTxCategoryColorPickers() {
  try {
    if (txAddCategoryColorPicker) txAddCategoryColorPicker.refresh();
    if (txEditCategoryColorPicker) txEditCategoryColorPicker.refresh();
  } catch (_) {}
}

function setCategoryFieldValue(fieldId, categoryIdOrNull) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  if (categoryComboboxRegistry.has(fieldId)) {
    const st = categoryComboboxRegistry.get(fieldId);
    if (!st) return;
    if (categoryIdOrNull == null || categoryIdOrNull === "") {
      st.hidden.value = "";
      st.input.value = "";
    } else {
      const cat =
        (st.categories || []).find((c) => Number(c.id) === Number(categoryIdOrNull)) ||
        (state.categories || []).find((c) => Number(c.id) === Number(categoryIdOrNull));
      st.hidden.value = String(categoryIdOrNull);
      st.input.value = cat ? categoryDisplayLabel(cat) : "";
    }
    refreshTxCategoryColorPickers();
    if (fieldId === "txAddCategoryId") {
      if (categoryIdOrNull != null && categoryIdOrNull !== "") applyTxAddCategoryRecurrenceDefaults(categoryIdOrNull);
      refreshTxAddCategoryChipActiveState();
    }
    return;
  }
  if (el instanceof HTMLSelectElement) {
    el.value = categoryIdOrNull != null && categoryIdOrNull !== "" ? String(categoryIdOrNull) : "";
  }
  refreshTxCategoryColorPickers();
  if (fieldId === "txAddCategoryId") {
    if (categoryIdOrNull != null && categoryIdOrNull !== "") applyTxAddCategoryRecurrenceDefaults(categoryIdOrNull);
    refreshTxAddCategoryChipActiveState();
  }
}

function ensureCategoryComboDocClick() {
  if (categoryComboOutsideClickBound) return;
  categoryComboOutsideClickBound = true;
  document.addEventListener("click", (e) => {
    const t = /** @type {Node} */ (e.target);
    for (const [, st] of categoryComboboxRegistry) {
      if (st.wrap.contains(t)) continue;
      hideCategoryComboboxList(st);
    }
  });
}

const SYSTEM_UNCATEGORIZED_GROUP_NAME = "Uncategorized";

function normalizeCategoryGroupName(name) {
  return String(name || "").trim().toLowerCase();
}

function isSystemUncategorizedGroupName(name) {
  return normalizeCategoryGroupName(name) === normalizeCategoryGroupName(SYSTEM_UNCATEGORIZED_GROUP_NAME);
}

async function maybeEnsureSystemUncategorizedGroup(tree) {
  const groups = Array.isArray(tree?.groups) ? tree.groups.filter(Boolean) : [];
  if (!state.activeFamilyId || groups.length === 0 || groups.some((g) => isSystemUncategorizedGroupName(g?.name))) {
    return tree || { groups: [] };
  }
  try {
    await api(`/api/families/${state.activeFamilyId}/category-groups`, "POST", {
      name: SYSTEM_UNCATEGORIZED_GROUP_NAME,
    });
    return await api(`/api/families/${state.activeFamilyId}/categories/tree`, "GET");
  } catch (_) {
    return tree || { groups: [] };
  }
}

async function loadCategoryUsageSummary() {
  if (!state.activeFamilyId) {
    state.categoryUsageSummary = null;
    return;
  }
  try {
    state.categoryUsageSummary = await api(`/api/families/${state.activeFamilyId}/categories/usage-summary`, "GET");
  } catch (_) {
    state.categoryUsageSummary = null;
  }
}

function categoryAssignmentsForCategoryId(catId) {
  const s = state.categoryUsageSummary;
  if (!s || catId == null) return 0;
  const m = s.by_category_id || {};
  const v = m[String(catId)] ?? m[String(Number(catId))];
  return Number(v) || 0;
}

const CATS_GROUP_COLLAPSED_KEY = "familyCashFlow:catsGroupCollapsed";

function readCollapsedCategoryGroupIds() {
  try {
    const raw = localStorage.getItem(CATS_GROUP_COLLAPSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch (_) {
    return new Set();
  }
}

function writeCollapsedCategoryGroupIds(ids) {
  try {
    localStorage.setItem(CATS_GROUP_COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch (_) {}
}

function setCategoryGroupCollapsed(groupId, collapsed) {
  const ids = readCollapsedCategoryGroupIds();
  const id = String(groupId);
  if (collapsed) ids.add(id);
  else ids.delete(id);
  writeCollapsedCategoryGroupIds(ids);
}

function ensureCategoriesScanTips() {
  const pane = document.querySelector("[data-cats-pane]");
  if (!pane) return;
  let tips = pane.querySelector(".cats-pane__scan-tips");
  if (!tips) {
    tips = document.createElement("p");
    tips.className = "cats-pane__scan-tips";
    tips.setAttribute("role", "note");
  }
  const head = pane.querySelector(".categories-manager__head");
  if (head) head.insertAdjacentElement("afterend", tips);
  else if (!tips.parentElement) {
    const toolbar = pane.querySelector(".cats-pane__toolbar");
    if (toolbar) toolbar.insertAdjacentElement("beforebegin", tips);
    else pane.querySelector(".categories-manager__shell")?.prepend(tips);
  }
  tips.innerHTML =
    "<span>Drag to reorder</span>" +
    '<span class="cats-pane__scan-tips-sep" aria-hidden="true">•</span>' +
    "<span>Click to rename</span>";
}

function refreshCategoriesManagerChrome() {
  ensureCategoriesScanTips();
  const tree = state.categoryTree;
  const groups = (tree?.groups || []).filter(Boolean);
  const elG = document.getElementById("categoriesStatGroups");
  const elC = document.getElementById("categoriesStatCategories");
  const elH = document.getElementById("categoriesStatHighlight");
  if (elG) elG.textContent = String(groups.length);
  let nCats = 0;
  const gidTotals = new Map();
  for (const g of groups) {
    const arr = g.categories || [];
    nCats += arr.length;
    let sum = 0;
    for (const c of arr) sum += categoryAssignmentsForCategoryId(c.id);
    gidTotals.set(Number(g.id), { name: String(g.name || "").trim() || "Group", sum });
  }
  if (elC) elC.textContent = String(nCats);
  if (elH) {
    let totalAssigned = 0;
    const by = state.categoryUsageSummary?.by_category_id || {};
    for (const k of Object.keys(by)) totalAssigned += Number(by[k]) || 0;
    if (totalAssigned === 0) elH.textContent = "Default groups active";
    else {
      let best = null;
      for (const [, v] of gidTotals) {
        if (!best || v.sum > best.sum) best = v;
      }
      elH.textContent = best && best.sum > 0 ? `Busiest group: ${best.name}` : "No assignments yet";
    }
  }
  const s = state.categoryUsageSummary;
  const callout = document.getElementById("categoriesUncategorizedCallout");
  const countEl = document.getElementById("categoriesUncatCount");
  const uTx = s ? Number(s.uncategorized_transactions) || 0 : 0;
  if (callout) callout.hidden = !uTx;
  if (countEl) countEl.textContent = String(uTx);
}

let _categoryDeleteReassignModalEl = null;
let categoryDeleteReassignPending = null;
let _categorySimpleDeleteModalEl = null;
let categorySimpleDeletePending = null;
let _groupSimpleDeleteModalEl = null;
let groupSimpleDeletePending = null;
let _categoryMoveModalEl = null;
let categoryMovePending = null;

function syncCategoryDeleteReassignModalMode() {
  const wrap = _categoryDeleteReassignModalEl;
  if (!wrap) return;
  const moveBlock = wrap.querySelector("#categoryDeleteReassignMoveBlock");
  const note = wrap.querySelector("#categoryDeleteUncatNote");
  const mode = wrap.querySelector('input[name="catdelmode"]:checked')?.value || "move";
  if (moveBlock) moveBlock.hidden = mode !== "move";
  if (note) note.hidden = mode !== "uncategorize";
}

function ensureCategorySimpleDeleteModal() {
  if (_categorySimpleDeleteModalEl) return _categorySimpleDeleteModalEl;
  const wrap = document.createElement("div");
  wrap.id = "categorySimpleDeleteModal";
  wrap.className = "modal-overlay category-simple-delete-modal";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML =
    '<div class="modal category-simple-delete-modal__panel" role="dialog" aria-modal="true" aria-labelledby="categorySimpleDeleteTitle">' +
    '<h3 id="categorySimpleDeleteTitle"></h3>' +
    '<p id="categorySimpleDeleteBody" class="category-simple-delete-modal__body"></p>' +
    '<div class="modal-actions category-simple-delete-modal__actions">' +
    '<button type="button" class="secondary" id="categorySimpleDeleteCancel">Cancel</button>' +
    '<button type="button" class="btn-category-delete" id="categorySimpleDeleteConfirm">Delete category</button>' +
    "</div></div>";
  document.body.appendChild(wrap);
  wrap.querySelector("#categorySimpleDeleteCancel")?.addEventListener("click", () => {
    wrap.classList.remove("modal-overlay--open");
    wrap.setAttribute("aria-hidden", "true");
    categorySimpleDeletePending = null;
  });
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) {
      wrap.classList.remove("modal-overlay--open");
      wrap.setAttribute("aria-hidden", "true");
      categorySimpleDeletePending = null;
    }
  });
  wrap.querySelector("#categorySimpleDeleteConfirm")?.addEventListener("click", async () => {
    const pend = categorySimpleDeletePending;
    if (!pend || !state.activeFamilyId) return;
    try {
      show(catErr, "");
      await api(`/api/families/${state.activeFamilyId}/categories/${pend.id}`, "DELETE");
      wrap.classList.remove("modal-overlay--open");
      wrap.setAttribute("aria-hidden", "true");
      categorySimpleDeletePending = null;
      await loadCategories();
      await loadMonthAndCalendar();
      if (typeof closeCatEditModal === "function") {
        try {
          closeCatEditModal();
        } catch (_) {}
      }
    } catch (e) {
      show(catErr, e.message || "Failed to delete category");
    }
  });
  _categorySimpleDeleteModalEl = wrap;
  return wrap;
}

function openCategorySimpleDeleteModal({ id, name }) {
  const wrap = ensureCategorySimpleDeleteModal();
  categorySimpleDeletePending = { id: Number(id), name: String(name || "") };
  const t = wrap.querySelector("#categorySimpleDeleteTitle");
  const b = wrap.querySelector("#categorySimpleDeleteBody");
  if (t) t.textContent = `Delete category “${name}”?`;
  if (b) {
    b.textContent =
      "This will remove the category from future organization. No entries use it yet, so your ledger stays the same.";
  }
  wrap.classList.add("modal-overlay--open");
  wrap.setAttribute("aria-hidden", "false");
}

function groupDeleteBodyMessage(catsCount, fallbackName) {
  const n = Number(catsCount) || 0;
  if (n > 0) {
    const catWord = n === 1 ? "category" : "categories";
    return `Its ${n} ${catWord} will move to ${fallbackName || "another group"}.`;
  }
  return "This group is empty and will be removed.";
}

function countCategoriesInGroup(groupId) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid)) return 0;
  for (const g of state.categoryTree?.groups || []) {
    if (Number(g.id) === gid) return (g.categories || []).length;
  }
  return 0;
}

function fallbackGroupNameForDelete(excludeGroupId) {
  const exclude = Number(excludeGroupId);
  const groups = state.categoryTree?.groups || [];
  const fallback = groups.find((g) => Number(g.id) !== exclude);
  return fallback ? String(fallback.name || "").trim() || "another group" : "another group";
}

function ensureGroupSimpleDeleteModal() {
  if (_groupSimpleDeleteModalEl) return _groupSimpleDeleteModalEl;
  const wrap = document.createElement("div");
  wrap.id = "groupSimpleDeleteModal";
  wrap.className = "modal-overlay category-simple-delete-modal group-simple-delete-modal";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML =
    '<div class="modal category-simple-delete-modal__panel" role="dialog" aria-modal="true" aria-labelledby="groupSimpleDeleteTitle">' +
    '<h3 id="groupSimpleDeleteTitle"></h3>' +
    '<p id="groupSimpleDeleteBody" class="category-simple-delete-modal__body"></p>' +
    '<div class="modal-actions category-simple-delete-modal__actions">' +
    '<button type="button" class="secondary" id="groupSimpleDeleteCancel">Cancel</button>' +
    '<button type="button" class="btn-category-delete" id="groupSimpleDeleteConfirm">Delete group</button>' +
    "</div></div>";
  document.body.appendChild(wrap);
  wrap.querySelector("#groupSimpleDeleteCancel")?.addEventListener("click", () => {
    wrap.classList.remove("modal-overlay--open");
    wrap.setAttribute("aria-hidden", "true");
    groupSimpleDeletePending = null;
  });
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) {
      wrap.classList.remove("modal-overlay--open");
      wrap.setAttribute("aria-hidden", "true");
      groupSimpleDeletePending = null;
    }
  });
  wrap.querySelector("#groupSimpleDeleteConfirm")?.addEventListener("click", async () => {
    const pend = groupSimpleDeletePending;
    if (!pend || !state.activeFamilyId) return;
    try {
      show(catErr, "");
      if (typeof pend.beforeDelete === "function") await pend.beforeDelete();
      await api(`/api/families/${state.activeFamilyId}/category-groups/${Number(pend.id)}`, "DELETE");
      wrap.classList.remove("modal-overlay--open");
      wrap.setAttribute("aria-hidden", "true");
      groupSimpleDeletePending = null;
      await loadCategories();
      await loadMonthAndCalendar();
      if (pend.closeCatEditOnSuccess) {
        try {
          closeCatEditModal();
        } catch (_) {}
      }
    } catch (e) {
      show(catErr, e.message || "Failed to delete group");
    }
  });
  _groupSimpleDeleteModalEl = wrap;
  return wrap;
}

function openGroupSimpleDeleteModal({ id, name, catsCount, fallbackName, beforeDelete, closeCatEditOnSuccess = false }) {
  const wrap = ensureGroupSimpleDeleteModal();
  const gid = Number(id);
  const gname = String(name || "").trim() || "group";
  const count = Number.isFinite(Number(catsCount)) ? Number(catsCount) : countCategoriesInGroup(gid);
  const targetName = String(fallbackName || "").trim() || fallbackGroupNameForDelete(gid);
  groupSimpleDeletePending = {
    id: gid,
    name: gname,
    beforeDelete: beforeDelete || null,
    closeCatEditOnSuccess: !!closeCatEditOnSuccess,
  };
  const t = wrap.querySelector("#groupSimpleDeleteTitle");
  const b = wrap.querySelector("#groupSimpleDeleteBody");
  if (t) t.textContent = `Delete group “${gname}”?`;
  if (b) b.textContent = groupDeleteBodyMessage(count, targetName);
  wrap.classList.add("modal-overlay--open");
  wrap.setAttribute("aria-hidden", "false");
}

function ensureCategoryMoveModal() {
  if (_categoryMoveModalEl) return _categoryMoveModalEl;
  const wrap = document.createElement("div");
  wrap.id = "categoryMoveModal";
  wrap.className = "modal-overlay category-move-modal";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML =
    '<div class="modal category-move-modal__panel" role="dialog" aria-modal="true" aria-labelledby="categoryMoveTitle">' +
    '<h3 id="categoryMoveTitle">Move to group</h3>' +
    '<p id="categoryMoveHint" class="category-move-modal__hint"></p>' +
    '<label class="category-move-modal__label" for="categoryMoveGroupSelect">Group</label>' +
    '<select id="categoryMoveGroupSelect" class="category-move-modal__select"></select>' +
    '<div class="modal-actions category-move-modal__actions">' +
    '<button type="button" class="secondary" id="categoryMoveCancel">Cancel</button>' +
    '<button type="button" class="settings-house-primary-btn" id="categoryMoveConfirm">Move</button>' +
    "</div></div>";
  document.body.appendChild(wrap);
  wrap.querySelector("#categoryMoveCancel")?.addEventListener("click", () => {
    wrap.classList.remove("modal-overlay--open");
    wrap.setAttribute("aria-hidden", "true");
    categoryMovePending = null;
  });
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) {
      wrap.classList.remove("modal-overlay--open");
      wrap.setAttribute("aria-hidden", "true");
      categoryMovePending = null;
    }
  });
  wrap.querySelector("#categoryMoveConfirm")?.addEventListener("click", async () => {
    const pend = categoryMovePending;
    const sel = wrap.querySelector("#categoryMoveGroupSelect");
    if (!pend || !sel || !state.activeFamilyId) return;
    const gid = Number(sel.value);
    if (!Number.isFinite(gid)) return;
    try {
      show(catErr, "");
      await api(`/api/families/${state.activeFamilyId}/categories/${pend.id}`, "PUT", { group_id: gid });
      wrap.classList.remove("modal-overlay--open");
      wrap.setAttribute("aria-hidden", "true");
      categoryMovePending = null;
      await loadCategories();
      await loadMonthAndCalendar();
    } catch (e) {
      show(catErr, e.message || "Failed to move category");
    }
  });
  _categoryMoveModalEl = wrap;
  return wrap;
}

function openCategoryMoveModal({ categoryId, currentGroupId, name }) {
  const wrap = ensureCategoryMoveModal();
  const hint = wrap.querySelector("#categoryMoveHint");
  const sel = wrap.querySelector("#categoryMoveGroupSelect");
  let added = 0;
  if (hint) hint.textContent = `Move “${name}” into another group. Drag-and-drop still works if you prefer.`;
  if (sel) {
    sel.innerHTML = "";
    const groups = [...(state.categoryTree?.groups || [])].sort((a, b) =>
      String(a?.name || "").localeCompare(String(b?.name || ""))
    );
    for (const g of groups) {
      if (Number(g.id) === Number(currentGroupId)) continue;
      const o = document.createElement("option");
      o.value = String(g.id);
      o.textContent = String(g.name || "").trim() || `Group ${g.id}`;
      sel.appendChild(o);
      added += 1;
    }
    if (!added) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "No other groups yet";
      sel.appendChild(o);
      sel.disabled = true;
    } else {
      sel.disabled = false;
    }
  }
  categoryMovePending = { id: Number(categoryId) };
  const goBtn = wrap.querySelector("#categoryMoveConfirm");
  if (goBtn) goBtn.disabled = !added;
  wrap.classList.add("modal-overlay--open");
  wrap.setAttribute("aria-hidden", "false");
}

function ensureCategoryDeleteReassignModal() {
  if (_categoryDeleteReassignModalEl) return _categoryDeleteReassignModalEl;
  const wrap = document.createElement("div");
  wrap.id = "categoryDeleteReassignModal";
  wrap.className = "modal-overlay category-delete-modal";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML =
    '<div class="modal category-delete-modal__panel" role="dialog" aria-modal="true" aria-labelledby="categoryDeleteReassignTitle">' +
    '<h3 id="categoryDeleteReassignTitle">Delete category in use?</h3>' +
    '<p id="categoryDeleteReassignMsg" class="category-delete-modal__msg"></p>' +
    '<div class="category-delete-modal__choices" role="radiogroup" aria-labelledby="categoryDeleteReassignChoicesLabel">' +
    '<p id="categoryDeleteReassignChoicesLabel" class="category-delete-modal__legend">What should happen to existing uses?</p>' +
    '<label class="category-delete-modal__radio">' +
    '<input type="radio" name="catdelmode" value="move" checked />' +
    '<span class="category-delete-modal__radio-label">Move entries to another category</span></label>' +
    '<label class="category-delete-modal__radio">' +
    '<input type="radio" name="catdelmode" value="uncategorize" />' +
    '<span class="category-delete-modal__radio-label">Remove category from entries (uncategorize)</span></label>' +
    "</div>" +
    '<div id="categoryDeleteReassignMoveBlock">' +
    '<label class="category-delete-modal__label" for="categoryDeleteReassignSelect">Category</label>' +
    '<select id="categoryDeleteReassignSelect" class="category-delete-modal__select"></select>' +
    "</div>" +
    '<p id="categoryDeleteUncatNote" class="category-delete-modal__note" hidden>' +
    "Transactions and scheduled items will have no category until you assign one." +
    "</p>" +
    '<div class="modal-actions category-delete-modal__actions">' +
    '<button type="button" id="categoryDeleteReassignCancel" class="secondary">Cancel</button>' +
    '<button type="button" id="categoryDeleteReassignConfirm" class="btn-category-delete">Delete category</button>' +
    "</div></div>";
  document.body.appendChild(wrap);
  for (const r of wrap.querySelectorAll('input[name="catdelmode"]')) {
    r.addEventListener("change", () => syncCategoryDeleteReassignModalMode());
  }
  const cancel = wrap.querySelector("#categoryDeleteReassignCancel");
  if (cancel) {
    cancel.addEventListener("click", () => {
      wrap.classList.remove("modal-overlay--open");
      wrap.setAttribute("aria-hidden", "true");
      categoryDeleteReassignPending = null;
    });
  }
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) {
      wrap.classList.remove("modal-overlay--open");
      wrap.setAttribute("aria-hidden", "true");
      categoryDeleteReassignPending = null;
    }
  });
  const confirm = wrap.querySelector("#categoryDeleteReassignConfirm");
  if (confirm) {
    confirm.addEventListener("click", async () => {
      const pend = categoryDeleteReassignPending;
      const sel = wrap.querySelector("#categoryDeleteReassignSelect");
      const mode = wrap.querySelector('input[name="catdelmode"]:checked')?.value || "move";
      if (!pend || !state.activeFamilyId) return;
      try {
        show(catErr, "");
        if (mode === "uncategorize") {
          const path = `/api/families/${state.activeFamilyId}/categories/${pend.id}?uncategorize_refs=1`;
          await api(path, "DELETE");
        } else {
          if (!sel) return;
          const rid = Number(sel.value);
          if (!Number.isFinite(rid)) {
            show(catErr, "Choose a category to move entries into.");
            return;
          }
          const path = `/api/families/${state.activeFamilyId}/categories/${pend.id}?reassign_to=${encodeURIComponent(String(rid))}`;
          await api(path, "DELETE");
        }
        wrap.classList.remove("modal-overlay--open");
        wrap.setAttribute("aria-hidden", "true");
        categoryDeleteReassignPending = null;
        await loadCategories();
        await loadMonthAndCalendar();
        if (typeof closeCatEditModal === "function") {
          try {
            closeCatEditModal();
          } catch (_) {}
        }
      } catch (e) {
        show(catErr, e.message || "Failed to delete category");
      }
    });
  }
  _categoryDeleteReassignModalEl = wrap;
  syncCategoryDeleteReassignModalMode();
  return wrap;
}

function openCategoryDeleteReassignModal({ id, name, total }) {
  const wrap = ensureCategoryDeleteReassignModal();
  const msg = wrap.querySelector("#categoryDeleteReassignMsg");
  const sel = wrap.querySelector("#categoryDeleteReassignSelect");
  const moveRadio = wrap.querySelector('input[name="catdelmode"][value="move"]');
  if (moveRadio) moveRadio.checked = true;
  if (msg) {
    msg.textContent = `“${name}” is used by ${total} ${total === 1 ? "entry" : "entries"} (transactions, scheduled items, or overrides). Choose how to handle them before deleting the category.`;
  }
  if (sel) {
    sel.innerHTML = "";
    for (const c of state.categories || []) {
      if (Number(c.id) === Number(id)) continue;
      const o = document.createElement("option");
      o.value = String(c.id);
      o.textContent = categoryDisplayLabel(c);
      sel.appendChild(o);
    }
  }
  categoryDeleteReassignPending = { id: Number(id), name };
  syncCategoryDeleteReassignModalMode();
  wrap.classList.add("modal-overlay--open");
  wrap.setAttribute("aria-hidden", "false");
}

async function deleteCategoryWithOptionalReassign(categoryId, categoryName) {
  if (!state.activeFamilyId) throw new Error("Choose a family first");
  const cid = Number(categoryId);
  if (!Number.isFinite(cid)) throw new Error("Invalid category");
  await loadCategoryUsageSummary();
  const used = categoryAssignmentsForCategoryId(cid);
  if (used <= 0) {
    openCategorySimpleDeleteModal({ id: cid, name: categoryName });
    return;
  }
  openCategoryDeleteReassignModal({ id: cid, name: categoryName, total: used });
}

const CATS_MENU_FLOAT_Z = 14000;
let _catsMenuFloatingBound = false;

function syncCategoriesMenuOpenState(detailsEl) {
  if (!(detailsEl instanceof HTMLDetailsElement)) return;
  const row = detailsEl.closest(".cats-cat");
  if (row) row.classList.toggle("is-cat-menu-open", detailsEl.open);
  const head = detailsEl.closest(".cats-group__head");
  if (head) head.classList.toggle("is-group-menu-open", detailsEl.open);
}

function resetCategoriesMenuPanelPosition(panelEl) {
  if (!panelEl) return;
  panelEl.classList.remove("cats-menu-panel--floating");
  panelEl.style.removeProperty("position");
  panelEl.style.removeProperty("top");
  panelEl.style.removeProperty("left");
  panelEl.style.removeProperty("right");
  panelEl.style.removeProperty("z-index");
  panelEl.style.removeProperty("visibility");
}

function positionCategoriesFloatingMenu(detailsEl) {
  syncCategoriesMenuOpenState(detailsEl);
  const panel = detailsEl.querySelector(".cats-cat__menu-panel, .cats-group__menu-panel");
  const summary = detailsEl.querySelector("summary");
  if (!panel || !summary) return;
  if (!detailsEl.open) {
    resetCategoriesMenuPanelPosition(panel);
    return;
  }

  const rect = summary.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 10;
  const gap = 10;

  panel.classList.add("cats-menu-panel--floating");
  panel.style.position = "fixed";
  panel.style.zIndex = String(CATS_MENU_FLOAT_Z);
  panel.style.right = "auto";
  /* Off-screen measure so intrinsic width resolves before viewport clamping */
  panel.style.left = "-99999px";
  panel.style.top = "0";
  panel.style.visibility = "visible";

  const pr = panel.getBoundingClientRect();
  const pw = Math.max(pr.width, 1);
  const ph = Math.max(pr.height, 1);

  let left = rect.right - pw;
  if (left < pad) left = pad;
  if (left + pw > vw - pad) left = Math.max(pad, vw - pad - pw);

  let top = rect.bottom + gap;
  const belowSpace = vh - pad - top;
  const aboveSpace = rect.top - pad - gap;
  if (belowSpace < ph && aboveSpace > belowSpace) {
    top = rect.top - gap - ph;
  }
  if (top < pad) top = pad;
  if (top + ph > vh - pad) top = Math.max(pad, vh - pad - ph);

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

function refreshOpenCategoriesFloatingMenus() {
  document.querySelectorAll("details.cats-cat__menu[open], details.cats-group__menu[open]").forEach((d) =>
    positionCategoriesFloatingMenu(d)
  );
}

function closeAllCategoriesMenus() {
  document.querySelectorAll("details.cats-cat__menu[open], details.cats-group__menu[open]").forEach((det) => {
    try {
      det.open = false;
    } catch (_) {}
    syncCategoriesMenuOpenState(det);
    const panel = det.querySelector(".cats-cat__menu-panel, .cats-group__menu-panel");
    resetCategoriesMenuPanelPosition(panel);
  });
}

function bindCategoriesFloatingMenusGlobally() {
  if (_catsMenuFloatingBound) return;
  _catsMenuFloatingBound = true;

  document.addEventListener(
    "toggle",
    (e) => {
      const det = e.target;
      if (!(det instanceof HTMLDetailsElement)) return;
      if (!det.matches(".cats-cat__menu, .cats-group__menu")) return;
      if (det.open) {
        document.querySelectorAll("details.cats-cat__menu[open], details.cats-group__menu[open]").forEach((other) => {
          if (other !== det) {
            try {
              other.open = false;
            } catch (_) {}
          }
        });
      }
      positionCategoriesFloatingMenu(det);
      if (det.open) {
        window.requestAnimationFrame(() => refreshOpenCategoriesFloatingMenus());
      }
    },
    true
  );

  document.addEventListener(
    "pointerdown",
    (e) => {
      const openMenus = document.querySelectorAll("details.cats-cat__menu[open], details.cats-group__menu[open]");
      if (!openMenus.length) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (target.closest(".cats-cat__menu-panel, .cats-group__menu-panel")) return;
      if (target.closest(".cats-cat__menu-summary, .cats-group__menu-summary")) return;
      openMenus.forEach((det) => {
        if (det.contains(target)) return;
        try {
          det.open = false;
        } catch (_) {}
        syncCategoriesMenuOpenState(det);
        const panel = det.querySelector(".cats-cat__menu-panel, .cats-group__menu-panel");
        resetCategoriesMenuPanelPosition(panel);
      });
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!document.querySelector("details.cats-cat__menu[open], details.cats-group__menu[open]")) return;
    e.preventDefault();
    closeAllCategoriesMenus();
  });

  window.addEventListener("resize", refreshOpenCategoriesFloatingMenus);
  window.addEventListener("scroll", refreshOpenCategoriesFloatingMenus, true);
}

function renderCategoriesGrid(tree) {
  if (!categoriesTree) return;
  bindCategoriesFloatingMenusGlobally();
  categoriesTree.innerHTML = "";
  const groups = (tree?.groups || []).filter(Boolean);

  if (newCategoryGroupId && "innerHTML" in newCategoryGroupId) {
    newCategoryGroupId.innerHTML = "";
    for (const g of groups) {
      const o = document.createElement("option");
      o.value = String(g.id);
      o.textContent = g.name;
      newCategoryGroupId.appendChild(o);
    }
  }

  const pane = categoriesTree.closest("[data-cats-pane]") || document;
  const emptyEl = pane.querySelector("#categoriesEmpty");
  if (!groups.length) {
    if (emptyEl) emptyEl.hidden = false;
    categoriesTree.hidden = true;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;
  categoriesTree.hidden = false;

  const collapsedGroupIds = readCollapsedCategoryGroupIds();
  let maxCategoryUsage = 0;
  for (const g of groups) {
    for (const c of g.categories || []) {
      maxCategoryUsage = Math.max(maxCategoryUsage, categoryAssignmentsForCategoryId(c.id));
    }
  }
  const frequentUsageThreshold =
    maxCategoryUsage > 0 ? Math.max(3, Math.ceil(maxCategoryUsage * 0.55)) : Infinity;

  function clearDragUi() {
    categoriesTree
      .querySelectorAll(
        ".cats-cat.is-drag-over, .cats-group__head.is-drag-over, .cats-group__body.is-drag-over, .cats-group.is-drag-over"
      )
      .forEach((x) => x.classList.remove("is-drag-over"));
  }

  function selectEditableText(el) {
    try {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  function makeInlineEditable(el, { onCommit }) {
    el.setAttribute("role", "textbox");
    el.setAttribute("contenteditable", "true");
    el.spellcheck = false;
    el.addEventListener("focus", () => {
      el.dataset.originalValue = String(el.textContent || "").trim();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        el.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        el.textContent = el.dataset.originalValue || "";
        el.blur();
      }
    });
    el.addEventListener("blur", async () => {
      const newValue = String(el.textContent || "").trim();
      const oldValue = String(el.dataset.originalValue || "");
      if (!newValue) {
        el.textContent = oldValue;
        return;
      }
      if (newValue === oldValue) return;
      try {
        await onCommit(newValue, oldValue);
      } catch (e) {
        el.textContent = oldValue;
        show(catErr, e?.message || "Failed to rename");
      }
    });
  }

  function mountCategoryRow(c, grp) {
    const row = document.createElement("div");
    row.className = "cats-cat";
    row.dataset.categoryId = String(c.id);
    row.draggable = false;

    const nameEl = document.createElement("span");
    nameEl.className = "cats-cat__name";
    nameEl.textContent = c.name;
    nameEl.title = `Rename — ${categoryDisplayLabel(c)}`;
    makeInlineEditable(nameEl, {
      onCommit: async (newName) => {
        await api(`/api/families/${state.activeFamilyId}/categories/${Number(c.id)}`, "PUT", {
          name: newName,
        });
        await loadCategories();
        await loadMonthAndCalendar();
      },
    });

    const menu = document.createElement("details");
    menu.className = "cats-cat__menu";

    const menuSummary = document.createElement("summary");
    menuSummary.className = "cats-cat__menu-summary";
    menuSummary.setAttribute("aria-label", `Actions for ${c.name}`);
    menuSummary.innerHTML =
      '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3.5" r="1.35"/><circle cx="8" cy="8" r="1.35"/><circle cx="8" cy="12.5" r="1.35"/></svg>';

    const menuPanel = document.createElement("div");
    menuPanel.className = "cats-cat__menu-panel";

    function closeCatMenu() {
      try {
        menu.open = false;
      } catch (_) {}
    }

    const mkItem = (label, classExtra, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `cats-cat__menu-item${classExtra ? ` ${classExtra}` : ""}`;
      b.textContent = label;
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        closeCatMenu();
        onClick();
      });
      return b;
    };

    menuPanel.appendChild(
      mkItem("Rename", "", () => {
        selectEditableText(nameEl);
      })
    );
    menuPanel.appendChild(
      mkItem("Move", "", () => {
        openCategoryMoveModal({
          categoryId: c.id,
          currentGroupId: grp?.id,
          name: c.name,
        });
      })
    );
    const dangerSep = document.createElement("div");
    dangerSep.className = "cats-menu-divider";
    dangerSep.setAttribute("role", "separator");
    menuPanel.appendChild(dangerSep);
    menuPanel.appendChild(
      mkItem("Delete", "cats-cat__menu-item--danger", () => {
        void (async () => {
          try {
            show(catErr, "");
            await deleteCategoryWithOptionalReassign(Number(c.id), c.name);
          } catch (err) {
            show(catErr, err?.message || "Failed to delete category");
          }
        })();
      })
    );

    menu.appendChild(menuSummary);
    menu.appendChild(menuPanel);

    const handle = document.createElement("span");
    handle.className = "cats-cat__handle";
    handle.setAttribute("aria-hidden", "true");
    handle.tabIndex = 0;
    handle.title = "Drag to move";
    handle.draggable = true;

    const nUse = categoryAssignmentsForCategoryId(c.id);
    if (nUse === 0) row.classList.add("is-unused");
    else if (nUse >= frequentUsageThreshold) row.classList.add("is-frequent");

    const meta = document.createElement("span");
    meta.className = "cats-cat__meta";
    meta.textContent = nUse > 0 ? `${nUse} ${nUse === 1 ? "entry" : "entries"}` : "";

    const editHint = document.createElement("button");
    editHint.type = "button";
    editHint.className = "cats-cat__edit-hint";
    editHint.setAttribute("aria-label", `Rename ${c.name}`);
    editHint.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 2.5 13.5 5.5 5.5 13.5H2.5v-3L10.5 2.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    editHint.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      selectEditableText(nameEl);
    });

    row.appendChild(handle);
    row.appendChild(nameEl);
    row.appendChild(meta);
    row.appendChild(editHint);
    row.appendChild(menu);

    row.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      if (
        t.closest(".cats-cat__menu") ||
        t.closest(".cats-cat__handle") ||
        t.closest(".cats-cat__edit-hint") ||
        t.closest(".cats-cat__name")
      ) {
        return;
      }
      selectEditableText(nameEl);
    });

    handle.addEventListener("dragstart", (e) => {
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `cat:${row.dataset.categoryId}`);
      } catch (_) {}
      row.classList.add("is-dragging");
    });
    handle.addEventListener("dragend", () => {
      row.classList.remove("is-dragging");
      clearDragUi();
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      row.classList.add("is-drag-over");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("dragleave", () => row.classList.remove("is-drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("is-drag-over");
      const raw = (() => {
        try {
          return e.dataTransfer.getData("text/plain");
        } catch (_) {
          return "";
        }
      })();
      if (!raw.startsWith("cat:")) return;
      const movingId = Number(raw.slice("cat:".length));
      const beforeId = Number(row.dataset.categoryId);
      if (!movingId || !beforeId || movingId === beforeId) return;
      const movingRow = categoriesTree.querySelector(`.cats-cat[data-category-id="${movingId}"]`);
      if (!movingRow) return;
      row.parentElement.insertBefore(movingRow, row);
      scheduleCategoryTreePersist();
    });

    return row;
  }

  function mountGroupCard(g) {
    const isSystemGroup = isSystemUncategorizedGroupName(g.name);
    const card = document.createElement("section");
    card.className = "cats-group";
    card.dataset.groupId = String(g.id);
    if (isSystemGroup) card.dataset.systemGroup = "1";

    const head = document.createElement("header");
    head.className = "cats-group__head";
    head.draggable = false;

    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "cats-group__collapse";
    collapseBtn.setAttribute("aria-label", `Collapse ${g.name}`);
    collapseBtn.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="m5 3.5 6 4.5-6 4.5V3.5Z" fill="currentColor"/></svg>';

    const nameWrap = document.createElement("h4");
    nameWrap.className = "cats-group__name";

    const nameText = document.createElement("span");
    nameText.className = "cats-group__name-text";
    nameText.dataset.groupName = "1";
    nameText.textContent = g.name;
    nameText.title = isSystemGroup ? "System group" : "Click to rename";
    if (!isSystemGroup) {
      makeInlineEditable(nameText, {
        onCommit: async (newName) => {
          if (isSystemUncategorizedGroupName(newName)) {
            throw new Error('"Uncategorized" is reserved for the system fallback group.');
          }
          if (hasDuplicateCategoryGroupName(newName, g.id)) {
            throw new Error("A group with that name already exists.");
          }
          await persistCategoryTreeFromDom();
        },
      });
    }

    const count = document.createElement("span");
    count.className = "cats-group__count";
    const n = (g.categories || []).length;
    count.textContent = n === 0 ? "empty" : `${n} ${n === 1 ? "category" : "categories"}`;
    if (n === 0 && !isSystemGroup) card.classList.add("is-empty-group");

    nameWrap.appendChild(nameText);
    nameWrap.appendChild(count);

    const groupDragHandle = document.createElement("span");
    groupDragHandle.className = "cats-group__drag";
    groupDragHandle.setAttribute("aria-hidden", "true");
    groupDragHandle.title = "Drag to reorder group";
    groupDragHandle.draggable = true;

    const menu = document.createElement("details");
    menu.className = "cats-group__menu";

    const menuSummary = document.createElement("summary");
    menuSummary.className = "cats-group__menu-summary";
    menuSummary.setAttribute("aria-label", `Actions for ${g.name}`);
    menuSummary.textContent = "⋮";

    const menuPanel = document.createElement("div");
    menuPanel.className = "cats-group__menu-panel";

    function closeGroupMenu() {
      try {
        menu.open = false;
      } catch (_) {}
    }

    if (!isSystemGroup) {
      const mkBtn = (label, onClick, opts = {}) => {
        const danger = !!opts.danger;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cats-group__menu-item";
        if (danger) b.classList.add("cats-group__menu-item--danger");
        b.textContent = label;
        b.addEventListener("click", (ev) => {
          ev.preventDefault();
          closeGroupMenu();
          onClick();
        });
        return b;
      };
      menuPanel.appendChild(
        mkBtn("Rename group", () => {
          selectEditableText(nameText);
        })
      );
      menuPanel.appendChild(
        mkBtn("Move group up", () => {
          const prev = card.previousElementSibling;
          if (prev && prev.classList && prev.classList.contains("cats-group")) {
            card.parentElement.insertBefore(card, prev);
            scheduleCategoryTreePersist();
          }
        })
      );
      menuPanel.appendChild(
        mkBtn("Move group down", () => {
          const next = card.nextElementSibling;
          if (next && next.classList && next.classList.contains("cats-group")) {
            card.parentElement.insertBefore(next, card);
            scheduleCategoryTreePersist();
          }
        })
      );
      const groupDangerSep = document.createElement("div");
      groupDangerSep.className = "cats-menu-divider";
      groupDangerSep.setAttribute("role", "separator");
      menuPanel.appendChild(groupDangerSep);
      menuPanel.appendChild(
        mkBtn(
          "Delete group",
          () => {
            const catsCount = body.querySelectorAll(".cats-cat").length;
            const fallbackCard = categoriesTree.querySelector(
              `.cats-group[data-system-group="1"]:not([data-group-id="${String(g.id)}"])`
            );
            const fallbackName =
              fallbackCard?.querySelector("[data-group-name]")?.textContent?.trim() || fallbackGroupNameForDelete(g.id);
            openGroupSimpleDeleteModal({
              id: g.id,
              name: g.name,
              catsCount,
              fallbackName,
              beforeDelete: async () => {
                if (catsCount > 0 && fallbackCard) {
                  const fallbackBody = fallbackCard.querySelector(".cats-group__body");
                  if (fallbackBody) {
                    [...body.querySelectorAll(".cats-cat")].forEach((rowEl) => fallbackBody.appendChild(rowEl));
                    await persistCategoryTreeFromDom();
                  }
                }
              },
            });
          },
          { danger: true }
        )
      );
    } else {
      menu.hidden = true;
    }

    menu.appendChild(menuSummary);
    menu.appendChild(menuPanel);

    const body = document.createElement("div");
    body.className = "cats-group__body";

    head.appendChild(collapseBtn);
    head.appendChild(groupDragHandle);
    head.appendChild(nameWrap);
    head.appendChild(menu);

    if (collapsedGroupIds.has(String(g.id))) {
      card.classList.add("is-collapsed");
      collapseBtn.setAttribute("aria-label", `Expand ${g.name}`);
    }

    collapseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.toggle("is-collapsed");
      const collapsed = card.classList.contains("is-collapsed");
      setCategoryGroupCollapsed(g.id, collapsed);
      collapseBtn.setAttribute(
        "aria-label",
        `${collapsed ? "Expand" : "Collapse"} ${g.name}`
      );
    });

    groupDragHandle.addEventListener("dragstart", (e) => {
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `group:${card.dataset.groupId}`);
      } catch (_) {}
      card.classList.add("is-dragging");
    });
    groupDragHandle.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
      clearDragUi();
    });
    head.addEventListener("dragover", (e) => {
      e.preventDefault();
      head.classList.add("is-drag-over");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });
    head.addEventListener("dragleave", (e) => {
      if (e.relatedTarget && head.contains(/** @type {Node} */ (e.relatedTarget))) return;
      head.classList.remove("is-drag-over");
    });
    head.addEventListener("drop", (e) => {
      e.preventDefault();
      head.classList.remove("is-drag-over");
      const raw = (() => {
        try {
          return e.dataTransfer.getData("text/plain");
        } catch (_) {
          return "";
        }
      })();
      if (raw.startsWith("cat:")) {
        const movingId = Number(raw.slice("cat:".length));
        const movingRow = categoriesTree.querySelector(`.cats-cat[data-category-id="${movingId}"]`);
        if (movingRow) {
          const first = body.querySelector(".cats-cat");
          if (first) body.insertBefore(movingRow, first);
          else body.insertBefore(movingRow, body.firstChild);
          scheduleCategoryTreePersist();
        }
        return;
      }
      if (!raw.startsWith("group:")) return;
      const movingGid = String(raw.slice("group:".length));
      const targetGid = String(card.dataset.groupId);
      if (!movingGid || !targetGid || movingGid === targetGid) return;
      const movingEl = categoriesTree.querySelector(`.cats-group[data-group-id="${movingGid}"]`);
      if (!movingEl) return;
      categoriesTree.insertBefore(movingEl, card);
      scheduleCategoryTreePersist();
    });

    const cats = g.categories || [];
    if (cats.length === 0) {
      body.classList.add("is-empty");
      const emptyRow = document.createElement("p");
      emptyRow.className = "cats-group__empty-row";
      emptyRow.textContent = isSystemGroup
        ? "New or moved categories can land here."
        : "Start with a few simple categories. You can refine them anytime.";
      body.appendChild(emptyRow);
    }
    for (const c of cats) {
      body.appendChild(mountCategoryRow(c, g));
    }

    body.addEventListener("dragover", (e) => {
      e.preventDefault();
      body.classList.add("is-drag-over");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });
    body.addEventListener("dragleave", () => body.classList.remove("is-drag-over"));
    body.addEventListener("drop", (e) => {
      e.preventDefault();
      body.classList.remove("is-drag-over");
      const raw = (() => {
        try {
          return e.dataTransfer.getData("text/plain");
        } catch (_) {
          return "";
        }
      })();
      if (!raw.startsWith("cat:")) return;
      const movingId = Number(raw.slice("cat:".length));
      const movingRow = categoriesTree.querySelector(`.cats-cat[data-category-id="${movingId}"]`);
      if (!movingRow) return;
      body.appendChild(movingRow);
      scheduleCategoryTreePersist();
    });

    const addRow = document.createElement("div");
    addRow.className = "cats-group__add-row";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "cats-group__add-trigger";
    trigger.innerHTML = '<span class="cats-group__add-plus" aria-hidden="true">+</span><span>Add category</span>';

    const form = document.createElement("form");
    form.className = "cats-group__add-form";
    form.hidden = true;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "cats-group__add-input";
    input.placeholder = "New category";
    input.autocomplete = "off";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "cats-group__add-submit";
    submit.textContent = "Add";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "cats-group__add-cancel";
    cancel.textContent = "Cancel";

    form.appendChild(input);
    form.appendChild(submit);
    form.appendChild(cancel);

    addRow.appendChild(trigger);
    addRow.appendChild(form);

    function showForm(yes) {
      form.hidden = !yes;
      trigger.hidden = yes;
      if (yes) {
        try {
          input.value = "";
          input.focus();
        } catch (_) {}
      }
    }
    trigger.addEventListener("click", () => showForm(true));
    cancel.addEventListener("click", () => showForm(false));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nm = input.value.trim();
      if (!nm) return;
      try {
        show(catErr, "");
        const ok = await addCategoryToGroup(Number(g.id), nm);
        if (ok) {
          input.value = "";
          try {
            input.focus();
          } catch (_) {}
        }
      } catch (err) {
        show(catErr, err?.message || "Failed to add category");
      }
    });

    const panel = document.createElement("div");
    panel.className = "cats-group__panel";
    const panelInner = document.createElement("div");
    panelInner.className = "cats-group__panel-inner";
    panelInner.appendChild(body);
    panelInner.appendChild(addRow);
    panel.appendChild(panelInner);

    card.appendChild(head);
    card.appendChild(panel);
    return card;
  }

  for (const g of groups) {
    categoriesTree.appendChild(mountGroupCard(g));
  }
}

function categoryDisplayLabel(c) {
  if (!c) return "";
  const g = c.group_name && String(c.group_name).trim();
  const n = String(c.name || "").trim();
  return g ? `${g} › ${n}` : n;
}

function flattenCategoryTree(tree) {
  const out = [];
  for (const g of tree?.groups || []) {
    for (const c of g.categories || []) {
      out.push({
        ...c,
        group_id: Number(g.id),
        group_name: g.name,
      });
    }
  }
  return out;
}

let categoryTreeSaveTimer = null;
function scheduleCategoryTreePersist() {
  if (!state.activeFamilyId) return;
  if (categoryTreeSaveTimer) clearTimeout(categoryTreeSaveTimer);
  categoryTreeSaveTimer = setTimeout(() => {
    categoryTreeSaveTimer = null;
    void persistCategoryTreeFromDom();
  }, 250);
}

/** Run a pending debounced tree save before reloading from the server (avoids wiping in-DOM reorder). */
async function flushCategoryTreePersistIfPending() {
  if (!categoryTreeSaveTimer) return;
  clearTimeout(categoryTreeSaveTimer);
  categoryTreeSaveTimer = null;
  await persistCategoryTreeFromDom();
}

function applyCategoryTreeToState(tree) {
  state.categoryTree = tree || { groups: [] };
  state.categories = flattenCategoryTree(state.categoryTree);
  renderCategoriesGrid(state.categoryTree);
  syncAllCategoryComboboxes(state.categories);
  rebuildTmCategorySelect();
}

async function persistCategoryTreeFromDom() {
  if (!categoriesTree || !state.activeFamilyId) return;
  try {
    show(catErr, "");
    const groups = [];
    // Match both the new (.cats-group / .cats-cat) and legacy
    // (.cat-group / .cat-row) class names so any not-yet-migrated
    // surface keeps persisting cleanly.
    const groupSel = ":scope > .cats-group, :scope > .cat-group";
    for (const gEl of categoriesTree.querySelectorAll(groupSel)) {
      const gidRaw = String(gEl.dataset.groupId || "").trim();
      const parsed = Number(gidRaw);
      const gid = gidRaw !== "" && Number.isFinite(parsed) ? parsed : null;
      const nameInput = gEl.querySelector("[data-group-name]");
      const rawName =
        nameInput && "value" in nameInput && typeof nameInput.value === "string"
          ? String(nameInput.value || "")
          : String(nameInput?.textContent || "");
      const nm = rawName.trim();
      if (!nm) throw new Error("Each group needs a name");
      const rowSel = ".cats-group__body .cats-cat[data-category-id], .cat-group-body .cat-row[data-category-id]";
      const ids = [...gEl.querySelectorAll(rowSel)].map((r) => Number(r.dataset.categoryId));
      groups.push({ id: gid, name: nm, category_ids: ids });
    }
    const tree = await api(`/api/families/${state.activeFamilyId}/categories/tree`, "PUT", { groups });
    applyCategoryTreeToState(tree);
    await loadCategoryUsageSummary();
    refreshCategoriesManagerChrome();
    renderCategoriesGrid(state.categoryTree);
    await loadMonthAndCalendar();
  } catch (e) {
    show(catErr, e.message || "Failed to save category layout");
    // Don't immediately reload from server on failure; that makes the UI "snap back"
    // even though the user successfully reordered the DOM. Keep the current DOM order
    // and let the user retry after addressing the error (permissions/network/etc).
  }
}

async function loadCategories() {
  if (!state.activeFamilyId) return;
  await flushCategoryTreePersistIfPending();
  let tree = await api(`/api/families/${state.activeFamilyId}/categories/tree`, "GET");
  tree = await maybeEnsureSystemUncategorizedGroup(tree);
  applyCategoryTreeToState(tree);
  await loadCategoryUsageSummary();
  refreshCategoriesManagerChrome();
  renderCategoriesGrid(state.categoryTree);
  try {
    renderTxAddCategoryChips();
  } catch (_) {}
}

function categoryStyleFromId(categoryId) {
  if (!categoryId) return null;
  const c = (state.categories || []).find((x) => Number(x.id) === Number(categoryId));
  if (!c) return null;
  const fg = c.fg_color && String(c.fg_color).trim() ? String(c.fg_color).trim() : null;
  const bg = c.bg_color && String(c.bg_color).trim() ? String(c.bg_color).trim() : null;
  return { name: c.name, fg, bg };
}

function parseCssColorToRgb(input) {
  const t = String(input || "").trim();
  if (!t) return null;
  let m = /^#([0-9a-fA-F]{6})$/i.exec(t);
  if (m) {
    const h = m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  m = /^#([0-9a-fA-F]{3})$/i.exec(t);
  if (m) {
    const x = m[1];
    return { r: parseInt(x[0] + x[0], 16), g: parseInt(x[1] + x[1], 16), b: parseInt(x[2] + x[2], 16) };
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(t);
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  return null;
}

function relativeLuminanceFromRgb(rgb) {
  const lin = (c) => {
    const v = Math.max(0, Math.min(255, c)) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = lin(rgb.r);
  const g = lin(rgb.g);
  const b = lin(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatioBetweenRgb(fgRgb, bgRgb) {
  const L1 = relativeLuminanceFromRgb(fgRgb) + 0.05;
  const L2 = relativeLuminanceFromRgb(bgRgb) + 0.05;
  return Math.max(L1, L2) / Math.min(L1, L2);
}

/** Pick near-black or white, whichever reads better on this background (WCAG-style contrast). */
function accessibleTextOnBackground(bgCss) {
  const bgRgb = parseCssColorToRgb(bgCss);
  if (!bgRgb) return "#111827";
  // Heuristic: users strongly prefer white text on "dark-ish" colors even when contrast math
  // is close (e.g. deep reds). Use luminance as a primary signal, then fall back to contrast.
  const lum = relativeLuminanceFromRgb(bgRgb);
  const dark = { r: 17, g: 24, b: 39 };
  const light = { r: 255, g: 255, b: 255 };
  if (lum < 0.45) return "#ffffff";
  if (lum > 0.72) return "rgb(17, 24, 39)";
  const cDark = contrastRatioBetweenRgb(dark, bgRgb);
  const cLight = contrastRatioBetweenRgb(light, bgRgb);
  return cDark >= cLight ? "rgb(17, 24, 39)" : "#ffffff";
}

const CATEGORY_PILL_MIN_CONTRAST = 4.5;
/** Below this relative luminance, prefer auto light/dark text even if stored fg passes 4.5:1 (e.g. black on saturated red). */
const PILL_BG_LUM_FORCED_AUTO_FG = 0.55;

/**
 * Readable pill text on a colored background. Dark / saturated backgrounds get white or near-black
 * from accessibleTextOnBackground; mid/light backgrounds may keep a user-provided fg when contrast is OK.
 */
function resolvedPillForeground(bgCss, fgUserOpt) {
  const bg = bgCss != null ? String(bgCss).trim() : "";
  if (!bg) return "";
  const auto = accessibleTextOnBackground(bg);
  const bgRgb = parseCssColorToRgb(bg);
  if (!bgRgb) {
    const f = fgUserOpt != null ? String(fgUserOpt).trim() : "";
    return f || auto;
  }
  const lum = relativeLuminanceFromRgb(bgRgb);
  const fg = fgUserOpt != null ? String(fgUserOpt).trim() : "";
  const fgRgb = fg ? parseCssColorToRgb(fg) : null;
  const contrastOk = fgRgb && contrastRatioBetweenRgb(fgRgb, bgRgb) >= CATEGORY_PILL_MIN_CONTRAST;
  if (!contrastOk || lum < PILL_BG_LUM_FORCED_AUTO_FG) return auto;
  return fg;
}

/** fg/bg for category chips: keep custom colors but fix low-contrast pairs (e.g. white on yellow). */
function categoryPillStyleFromId(categoryId) {
  const st = categoryStyleFromId(categoryId);
  if (!st) return null;
  const { fg: fgUser, bg } = st;
  if (!bg) return st;
  return { ...st, fg: resolvedPillForeground(bg, fgUser) };
}

function pillStyleForTransaction(txOrItem) {
  const bg = txOrItem && txOrItem.bg_color ? String(txOrItem.bg_color).trim() : "";
  const fg = txOrItem && txOrItem.fg_color ? String(txOrItem.fg_color).trim() : "";
  // Sentinel meaning: explicitly no color, even if the category has one.
  if (bg && bg.toLowerCase() === "none") return null;
  if (bg) return { bg, fg: resolvedPillForeground(bg, fg) };
  if (txOrItem && txOrItem.category_id) return categoryPillStyleFromId(txOrItem.category_id);
  return null;
}

/** Category background on the label column only; amounts keep income/expense colors. */
function applyCalendarDayTxCategoryFill(labelWrap, row) {
  if (!labelWrap || !row || row._type === "start_balance") return;
  const pill = pillStyleForTransaction(row);
  if (!pill || !pill.bg) return;
  const fg = pill.fg || accessibleTextOnBackground(pill.bg);
  labelWrap.classList.add("cal-tx-label-wrap--category-fill");
  labelWrap.style.setProperty("--cal-tx-fill-bg", pill.bg);
  labelWrap.style.setProperty("--cal-tx-fill-fg", fg);
}

/** Label column width for one day: space beside the widest amount (must run in-layout). */
function measureCalendarDayLabelColumnWidth(txnsEl) {
  if (!txnsEl) return 0;
  const lines = [...txnsEl.querySelectorAll(":scope > .cal-day-tx-line")];
  if (!lines.length) return 0;
  const containerW = txnsEl.clientWidth;
  if (containerW <= 0) return 0;
  const gap = 4;
  const linePadL = 4;
  const linePadR = 1;
  let maxAmtW = 0;
  for (const line of lines) {
    const amt = line.querySelector(".cal-amt");
    if (amt) maxAmtW = Math.max(maxAmtW, amt.offsetWidth);
  }
  if (maxAmtW <= 0) return 0;
  return Math.max(0, Math.ceil(containerW - maxAmtW - gap - linePadL - linePadR));
}

/** Pin every row in the day to one label column width so category fills align. */
function applyCalendarDayLabelColumnWidth(txnsEl) {
  if (!txnsEl) return;
  txnsEl.classList.remove("cal-day-txns--uniform-label-col");
  txnsEl.style.removeProperty("--cal-day-label-col-w");
  if (!txnsEl.querySelector(".cal-tx-label-wrap--category-fill")) return;
  const colW = measureCalendarDayLabelColumnWidth(txnsEl);
  if (colW > 0) {
    txnsEl.classList.add("cal-day-txns--uniform-label-col");
    txnsEl.style.setProperty("--cal-day-label-col-w", `${colW}px`);
  }
}

function finalizeAllCalendarDayLabelColumnWidths() {
  for (const txnsEl of document.querySelectorAll(".cal-day-txns")) {
    applyCalendarDayLabelColumnWidth(txnsEl);
  }
}

/** Default label text color: green income / red expense (lists + pills). Calendar uses row flow modifiers + `.cal-amt.income|expense`. */
function kindFgClass(kind) {
  return String(kind) === "income" ? "tx-kind-fg--income" : "tx-kind-fg--expense";
}

/** Subtle forecast-calendar row modifiers (transfers, uncategorized actuals). */
function calendarDayTxLineToneParts(row) {
  const parts = [];
  if (!row || row._type === "start_balance") return parts;
  const cat = String(effectiveTransactionCategoryName(row) || "").toLowerCase();
  const desc = String(row.description || "").trim().toLowerCase();
  const isTransfer =
    cat.includes("transfer") ||
    cat.includes("xfer") ||
    desc.includes("transfer") ||
    desc.includes("xfer");
  if (isTransfer) parts.push("cal-day-tx-line--kind-transfer");
  const flagged =
    row._type === "actual" &&
    (!row.category_id || cat === "uncategorized" || desc === "uncategorized");
  if (flagged) parts.push("cal-day-tx-line--flag");
  return parts;
}

const CAL_TX_IMPACT_LG = 4500;
const CAL_TX_IMPACT_XL = 12000;

/**
 * Calendar row semantics: income vs expense direction (muted), high-impact amounts,
 * and neutral treatment for uncategorized actuals. Keeps cells untinted — row text only.
 */
function calendarDayTxSemanticParts(row) {
  const parts = [];
  if (!row || row._type === "start_balance") return parts;

  const absAmt = Math.abs(Number(row.amount ?? 0));
  if (absAmt >= CAL_TX_IMPACT_XL) parts.push("cal-day-tx-line--impact-xxl");
  else if (absAmt >= CAL_TX_IMPACT_LG) parts.push("cal-day-tx-line--impact-lg");

  const cat = String(effectiveTransactionCategoryName(row) || "").toLowerCase();
  const desc = String(row.description || "").trim().toLowerCase();
  const kind = String(row.kind || "").toLowerCase();
  if (kind === "income") parts.push("cal-day-tx-line--flow-in");
  else if (kind === "expense") parts.push("cal-day-tx-line--flow-out");
  else parts.push("cal-day-tx-line--flow-neutral");
  return parts;
}

/** Calendar cell density from visible ledger lines (transactions + start-balance rows). */
function applyCalendarCellDensity(cell, itemCount) {
  if (!cell) return;
  cell.classList.remove("cal-cell--density-sparse", "cal-cell--density-normal", "cal-cell--density-dense");
  const n = Number(itemCount) || 0;
  if (n <= 2) cell.classList.add("cal-cell--density-sparse");
  else if (n >= 4) cell.classList.add("cal-cell--density-dense");
  else cell.classList.add("cal-cell--density-normal");
}

/** True if this day has a paycheck-like income (actual or expected). */
function dayHasPaycheckLikeIncome(rows) {
  if (!rows || !rows.length) return false;
  const re = /(paycheck|pay roll|payroll|direct dep|salary|stipend|deposit)/i;
  for (const r of rows) {
    if (!r || r._type === "start_balance") continue;
    if (String(r.kind || "").toLowerCase() !== "income") continue;
    const label = `${effectiveTransactionCategoryName(r) || ""} ${r.description || ""}`;
    if (re.test(label)) return true;
  }
  return false;
}

function renderAccountsList(accounts) {
  if (!accountsList) return;
  accountsList.innerHTML = "";
  if (!accounts || accounts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No accounts yet.";
    accountsList.appendChild(empty);
    return;
  }

  for (const a of accounts) {
    const el = document.createElement("div");
    el.className = "item settings-account-row";

    const typeLabel = String(a.type || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const startDate = a.starting_balance_date || "";
    el.innerHTML = `
      <div class="settings-account-row__main">
        <div class="settings-account-row__top">
          <div class="settings-account-row__name">${escapeHtml(a.name)}</div>
          <button type="button" class="settings-account-edit-btn" data-account-id="${a.id}">Edit</button>
        </div>
        <div class="settings-account-row__detail">${escapeHtml(typeLabel)} · Starting balance $${fmtMoney(a.starting_balance)} · ${escapeHtml(
      fmtDateMDY(startDate),
    )}</div>
      </div>
    `;
    accountsList.appendChild(el);
  }

  for (const btn of accountsList.querySelectorAll(".settings-account-edit-btn")) {
    btn.addEventListener("click", () => {
      const accountId = Number(btn.dataset.accountId);
      const account = state.accounts.find((a) => Number(a.id) === accountId);
      if (!account) return;
      openAccountEditModalForAccount(account);
    });
  }
}

function renderAccountSelect(selectEl, accounts) {
  selectEl.innerHTML = "";
  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = "Choose account";
  selectEl.appendChild(emptyOpt);

  for (const a of accounts || []) {
    const opt = document.createElement("option");
    opt.value = String(a.id);
    opt.textContent = a.name;
    selectEl.appendChild(opt);
  }
}

function renderAccountDetailsPanel() {
  if (!accountDetailsAccountId) return;
  renderAccountSelect(accountDetailsAccountId, state.accounts || []);
  if (state.accounts && state.accounts.length > 0 && !accountDetailsAccountId.value) {
    accountDetailsAccountId.value = String(state.accounts[0].id);
  }
  const id = accountDetailsAccountId.value ? Number(accountDetailsAccountId.value) : NaN;
  const acct = Number.isFinite(id) ? (state.accounts || []).find((a) => Number(a.id) === id) : null;
  if (!acct) {
    if (accountDetailsType) accountDetailsType.textContent = "—";
    if (accountDetailsStarting) accountDetailsStarting.textContent = "—";
    return;
  }
  if (accountDetailsType) accountDetailsType.textContent = String(acct.type || "—").replaceAll("_", " ");
  if (accountDetailsStarting) {
    const startBal = acct.starting_balance != null ? `$${fmtMoney(acct.starting_balance)}` : "—";
    const startDt = acct.starting_balance_date ? fmtDateMDY(acct.starting_balance_date) : "—";
    accountDetailsStarting.textContent = `${startBal} on ${startDt}`;
  }
}

async function loadAccounts() {
  if (!state.activeFamilyId) return;
  const accounts = await api(`/api/families/${state.activeFamilyId}/accounts`, "GET");
  state.accounts = accounts || [];
  renderAccountsList(state.accounts);
  const expectedAccountIdEl = document.getElementById("expectedAccountId");
  if (expectedAccountIdEl) renderAccountSelect(expectedAccountIdEl, state.accounts);
  if (expectedEditAccountId) renderAccountSelect(expectedEditAccountId, state.accounts);
  if (txAddAccountId) renderAccountSelect(txAddAccountId, state.accounts);
  if (instanceAccountId) renderAccountSelect(instanceAccountId, state.accounts);
  renderAccountDetailsPanel();
  if (expectedAccountIdEl && state.accounts.length > 0 && !expectedAccountIdEl.value) {
    expectedAccountIdEl.value = String(state.accounts[0].id);
  }
  try {
    renderCalendar();
  } catch (_) {}
}

if (accountDetailsAccountId) {
  accountDetailsAccountId.addEventListener("change", () => {
    try {
      renderAccountDetailsPanel();
    } catch (_) {}
  });
}

if (openAccountModalBtn) {
  openAccountModalBtn.addEventListener("click", () => {
    clearAccountEdit();
    openAccountModal("add");
  });
}
if (accountModal) {
  accountModal.addEventListener("click", (e) => {
    if (e.target === accountModal) {
      clearAccountEdit();
      closeAccountModal();
    }
  });
}

function clearAccountEdit() {
  accountEditId.value = "";
  accountName.value = "";
  accountType.value = "checking";
  accountStartingBalance.value = "";
  accountStartingBalanceDate.value = "";
  accountName.disabled = false;
  accountType.disabled = false;
  show(accErr, "");
  if (addAccountBtn) addAccountBtn.style.display = "";
  if (saveAccountEditBtn) saveAccountEditBtn.style.display = "none";
  if (accountEditInfo) accountEditInfo.hidden = true;
  if (accountEditFootnote) accountEditFootnote.hidden = true;
}

function setExpectedModalMode() {
  const instPanel = document.getElementById("expectedEditInstancePanel");
  if (instPanel) instPanel.style.display = "block";
}

async function refreshExpectedCalendarAndMonth() {
  await refreshForecastAfterTransactionEdit(null);
}

function openExpectedEditModal(tx, opts = {}) {
  if (!txEditModal || !expectedEditId) return;
  const calendarItem = opts.calendarItem ?? null;

  if (txEditId) txEditId.value = "";
  expectedEditId.value = String(tx.id);
  selectedExpectedSeriesTx = tx;
  renderTxEditCategoryOptions();

  if (calendarItem) {
    selectExpectedInstance(calendarItem);
  } else {
    // Opened from a non-calendar surface (ex: Transaction View recurring filter list).
    // Seed the modal with the next scheduled occurrence so instance editing endpoints have a date.
    const basisIso = opts.nextOccurrenceIso ? normalizeIsoDate(opts.nextOccurrenceIso) : toISODate(new Date());
    const nextIso = opts.nextOccurrenceIso ? normalizeIsoDate(opts.nextOccurrenceIso) : nextExpectedOccurrenceIso(tx, basisIso);
    if (!nextIso) {
      selectedExpectedInstance = null;
      if (txEditDate) {
        txEditDate.value = "";
        txEditDate.disabled = true;
      }
      if (instanceExpectedTxId) instanceExpectedTxId.value = String(tx.id);
      if (txEditNotes) txEditNotes.value = tx.notes || "";
      {
        const k = tx && tx.kind ? String(tx.kind) : "expense";
        const radio = document.querySelector(`input[type="radio"][name="txEditKind"][value="${k}"]`);
        if (radio) radio.checked = true;
      }
      if (txEditAmount) txEditAmount.value = String(tx.amount ?? "");
      if (instanceAccountId) instanceAccountId.value = tx.account_id != null ? String(tx.account_id) : "";
      setCategoryFieldValue("txEditCategoryId", tx.category_id);
      {
        const bg = tx && tx.bg_color ? String(tx.bg_color).trim() : "";
        txEditSelectedBgColor = bg ? bg : null;
      }
    } else {
      const accountId = tx.account_id != null ? Number(tx.account_id) : NaN;
      const acct = Number.isFinite(accountId) ? state.accounts.find((a) => Number(a.id) === accountId) : null;
      const catId = tx.category_id != null ? Number(tx.category_id) : null;
      const cat = catId != null ? (state.categories || []).find((c) => Number(c.id) === catId) : null;
      const synthetic = {
        expected_transaction_id: Number(tx.id),
        date: nextIso,
        occurrence_date: nextIso,
        account_id: Number.isFinite(accountId) ? accountId : tx.account_id,
        account: acct?.name || "",
        kind: tx.kind,
        amount: tx.amount,
        description: tx.description || "",
        notes: tx.notes || "",
        reimbursable: !!tx.reimbursable,
        variable: !!tx.variable,
        category_id: catId,
        category: cat?.name || null,
        bg_color: tx && tx.bg_color ? String(tx.bg_color) : null,
        fg_color: tx && tx.fg_color ? String(tx.fg_color) : null,
      };
      // `selectExpectedInstance` is defined later in this file; schedule after parse completes.
      queueMicrotask(() => selectExpectedInstance(synthetic));
    }
  }

  if (instanceRecurrence) instanceRecurrence.value = String((selectedExpectedSeriesTx && selectedExpectedSeriesTx.recurrence) || tx.recurrence || "monthly");
  if (instanceSecondDayOfMonth) {
    const meta = selectedExpectedSeriesTx || tx;
    const rec = String((meta && meta.recurrence) || tx.recurrence || "monthly");
    const v =
      (meta && meta.second_day_of_month) != null ? meta.second_day_of_month : tx.second_day_of_month;
    const anchor =
      normalizeIsoDate(tx.date || tx.occurrence_date || "") ||
      normalizeIsoDate((meta && meta.start_date) || tx.start_date || "");
    if (rec === "semiannual") {
      setSecondOccurrenceInput(
        instanceSecondDayOfMonth,
        meta.second_occurrence_month,
        v,
        anchor
      );
    } else {
      setSecondDayOfMonthInput(instanceSecondDayOfMonth, v, anchor);
    }
  }
  if (instanceEndCount) {
    const v = (selectedExpectedSeriesTx && selectedExpectedSeriesTx.end_count) != null ? selectedExpectedSeriesTx.end_count : tx.end_count;
    instanceEndCount.value = v != null ? String(v) : "";
  }
  if (instanceEndsMode) {
    const cnt = instanceEndCount && instanceEndCount.value ? Number(instanceEndCount.value) : null;
    instanceEndsMode.value = cnt && cnt > 0 ? "after_count" : "never";
  }
  updateInstanceEndsDetailUi();
  updateInstanceTwiceMonthlyVisibility();

  // Seed the color picker from the effective instance/series style.
  txEditSelectedBgColor =
    (calendarItem && calendarItem.bg_color ? String(calendarItem.bg_color) : null) ||
    (tx && tx.bg_color ? String(tx.bg_color) : null) ||
    null;
  refreshTxCategoryColorPickers();

  if (seriesVariable) {
    const eff =
      calendarItem && typeof calendarItem.variable === "boolean"
        ? !!calendarItem.variable
        : !!tx.variable;
    seriesVariable.checked = eff;
  }

  setExpectedModalMode();
  show(txEditErr, "");
  closeTxAddModal();
  try { txEditModal.style.display = ""; } catch (_) {}
  txEditModal.classList.add("modal-overlay--open");
  txEditModal.setAttribute("aria-hidden", "false");
  applyTransactionEditMode("recurring");
  applyMinDateToTxEditDateInput();
}

function openExpectedDeleteModal(expectedId, occurrenceDate) {
  if (!expectedDeleteModal) return;
  expectedDeleteContext = { expectedId: expectedId ? String(expectedId) : null, occurrenceDate: occurrenceDate || null };
  show(expectedDeleteErr, "");

  const hasOcc = !!expectedDeleteContext.occurrenceDate;
  if (expectedDeleteThisBtn) expectedDeleteThisBtn.disabled = !hasOcc;
  if (expectedDeleteFutureBtn) expectedDeleteFutureBtn.disabled = !hasOcc;
  if (expectedDeleteThisBtn) expectedDeleteThisBtn.title = hasOcc ? "" : "Open from a specific calendar date to delete only one occurrence.";
  if (expectedDeleteFutureBtn) expectedDeleteFutureBtn.title = hasOcc ? "" : "Open from a specific calendar date to delete future occurrences.";

  expectedDeleteModal.classList.add("modal-overlay--open");
  expectedDeleteModal.setAttribute("aria-hidden", "false");
}

function closeExpectedDeleteModal() {
  if (!expectedDeleteModal) return;
  expectedDeleteModal.classList.remove("modal-overlay--open");
  expectedDeleteModal.setAttribute("aria-hidden", "true");
  expectedDeleteContext = { expectedId: null, occurrenceDate: null };
}

// Edit scope radio buttons removed (replaced with save options).

if (expectedDeleteCancelBtn) {
  expectedDeleteCancelBtn.addEventListener("click", () => closeExpectedDeleteModal());
}
if (expectedDeleteModal) {
  expectedDeleteModal.addEventListener("click", (e) => {
    if (e.target === expectedDeleteModal) closeExpectedDeleteModal();
  });
}

async function runExpectedDeleteAction(mode) {
  try {
    show(expectedDeleteErr, "");
    if (!state.activeFamilyId) throw new Error("Choose a family first");
    const expectedId = expectedDeleteContext.expectedId;
    if (!expectedId) throw new Error("No series selected");

    if (mode === "all") {
      if (!confirm("Delete ALL transactions in this series (all dates)? This cannot be undone.")) return;
      await api(`/api/families/${state.activeFamilyId}/expected-transactions/${expectedId}`, "DELETE");
    } else if (mode === "this") {
      const occ = expectedDeleteContext.occurrenceDate;
      if (!occ) throw new Error('Open from a specific calendar date to use "Delete only this transaction".');
      if (!confirm("Delete ONLY this occurrence? It will no longer appear on the calendar.")) return;
      await api(
        `/api/families/${state.activeFamilyId}/expected-transactions/${expectedId}/instances/${occ}`,
        "POST",
        { action: "cancel" }
      );
    } else if (mode === "future") {
      const occ = expectedDeleteContext.occurrenceDate;
      if (!occ) throw new Error('Open from a specific calendar date to use "Delete all future transactions".');
      if (!confirm("Delete this date and ALL future occurrences? Past dates stay on the schedule.")) return;
      await api(
        `/api/families/${state.activeFamilyId}/expected-transactions/${expectedId}/end-from-occurrence/${occ}`,
        "POST"
      );
    }

    closeExpectedDeleteModal();
    closeTxEditModal();
    await refreshExpectedCalendarAndMonth();
  } catch (e) {
    show(expectedDeleteErr, e.message || "Failed to delete");
  }
}

if (expectedDeleteAllBtn) {
  expectedDeleteAllBtn.addEventListener("click", () => runExpectedDeleteAction("all"));
}
if (expectedDeleteThisBtn) {
  expectedDeleteThisBtn.addEventListener("click", () => runExpectedDeleteAction("this"));
}
if (expectedDeleteFutureBtn) {
  expectedDeleteFutureBtn.addEventListener("click", () => runExpectedDeleteAction("future"));
}

if (reconcileSaveBtn) {
  reconcileSaveBtn.addEventListener("click", async () => {
    try {
      show(reconcileErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");
      const iso = normalizeIsoDate(reconcileActiveDate);
      if (!iso) throw new Error("Invalid date");
      const month = (calendarMonth?.value || monthInput?.value) || iso.slice(0, 7);
      const nowReconciled = !!reconcileChecked?.checked;
      await api(`/api/families/${state.activeFamilyId}/reconciled-days`, "POST", {
        date: iso,
        reconciled: nowReconciled,
      });
      await loadReconciledDays(month);
      closeReconcileModal();
      renderCalendar();
      if (typeof showBwToast === "function") {
        showBwToast(nowReconciled ? "✓ Forecast reconciled" : "Forecast reconciliation cleared");
      }
      if (nowReconciled) bwDispatchMilestone("first-reconcile");
    } catch (e) {
      show(reconcileErr, e.message || "Failed to save");
    }
  });
}

// Series panel save removed (replaced with "Update all series" in instance editor).

if (expectedEditDelete) {
  expectedEditDelete.addEventListener("click", () => {
    const id = expectedEditId?.value || null;
    const occ = selectedExpectedInstance ? normalizeIsoDate(selectedExpectedInstance.occurrence_date) : null;
    openExpectedDeleteModal(id, occ);
  });
}

function parseIsoDateLocal(iso) {
  const n = normalizeIsoDate(iso);
  if (!n) return null;
  const y = Number(n.slice(0, 4));
  const m = Number(n.slice(5, 7));
  const d = Number(n.slice(8, 10));
  if (!y || !m || !d) return null;
  // Midday avoids DST edge cases around midnight.
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function endOfMonthDay(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

/** Canonical recurrence labels (match Repeat dropdown in Add transaction). */
const RECURRENCE_OPTION_LABELS = {
  once: "Does not repeat",
  monthly: "Every month",
  twice_monthly: "Twice monthly",
  bimonthly: "Every 2 months",
  biweekly: "Every 2 weeks",
  weekly: "Every week",
  semiannual: "Twice Yearly",
  yearly: "Every year",
  quarterly: "Every 3 months",
};

function recurrenceLabel(value) {
  const v = String(value || "").toLowerCase();
  if (!v || v === "once") return RECURRENCE_OPTION_LABELS.once;
  return RECURRENCE_OPTION_LABELS[v] || v || "—";
}

function dateFromYMDClamped(year, monthIndex0, day) {
  const last = endOfMonthDay(year, monthIndex0);
  const d = Math.min(Math.max(1, Number(day) || 1), last);
  return new Date(year, monthIndex0, d, 12, 0, 0, 0);
}

function addMonthsClamped(d, months, dom) {
  const y = d.getFullYear();
  const m0 = d.getMonth() + Number(months);
  const year = y + Math.floor(m0 / 12);
  const monthIndex0 = ((m0 % 12) + 12) % 12;
  return dateFromYMDClamped(year, monthIndex0, dom);
}

function nextExpectedOccurrenceIso(tx, fromIso) {
  const start = parseIsoDateLocal(tx.start_date);
  if (!start) return null;
  const from = parseIsoDateLocal(fromIso) || start;
  const end = parseIsoDateLocal(tx.end_date || "");

  const startDom = start.getDate();
  const startMonth = start.getMonth(); // 0-11
  const startDow = start.getDay(); // 0-6
  const recurrence = String(tx.recurrence || "monthly");

  let cand = null;
  if (recurrence === "once") {
    cand = start >= from ? start : null;
  } else if (recurrence === "weekly") {
    if (from <= start) {
      cand = start;
    } else {
      const diffDays = Math.floor((from - start) / (24 * 3600 * 1000));
      const mod = ((diffDays % 7) + 7) % 7;
      const add = mod === 0 ? 0 : 7 - mod;
      cand = new Date(from);
      cand.setDate(from.getDate() + add);
      cand.setHours(12, 0, 0, 0);
      // Ensure weekday matches original schedule.
      if (cand.getDay() !== startDow) {
        const delta = (startDow - cand.getDay() + 7) % 7;
        cand.setDate(cand.getDate() + delta);
      }
    }
  } else if (recurrence === "biweekly") {
    if (from <= start) {
      cand = start;
    } else {
      const diffDays = Math.floor((from - start) / (24 * 3600 * 1000));
      const mod = ((diffDays % 14) + 14) % 14;
      const add = mod === 0 ? 0 : 14 - mod;
      cand = new Date(from);
      cand.setDate(from.getDate() + add);
      cand.setHours(12, 0, 0, 0);
    }
  } else if (recurrence === "twice_monthly") {
    const second = Number(tx.second_day_of_month);
    const days = [startDom, second].filter((n) => Number.isFinite(n) && n >= 1 && n <= 31).sort((a, b) => a - b);
    if (days.length === 0) return null;
    const y = from.getFullYear();
    const m0 = from.getMonth();
    const todayDom = from.getDate();
    const pick = days.find((d) => d >= todayDom);
    if (from <= start) {
      cand = start;
    } else if (pick != null) {
      cand = dateFromYMDClamped(y, m0, pick);
    } else {
      cand = dateFromYMDClamped(y, m0 + 1, days[0]);
    }
  } else if (recurrence === "bimonthly") {
    const days = [15, 31];
    const y = from.getFullYear();
    const m0 = from.getMonth();
    const todayDom = from.getDate();
    const pick = days.find((d) => d >= todayDom);
    if (from <= start) {
      cand = start;
    } else if (pick != null) {
      cand = dateFromYMDClamped(y, m0, pick);
    } else {
      cand = dateFromYMDClamped(y, m0 + 1, days[0]);
    }
  } else if (recurrence === "yearly") {
    const y = from.getFullYear();
    const thisYear = dateFromYMDClamped(y, startMonth, startDom);
    cand = thisYear >= from ? thisYear : dateFromYMDClamped(y + 1, startMonth, startDom);
  } else if (recurrence === "quarterly") {
    if (from <= start) {
      cand = start;
    } else {
      let cur = start;
      const monthsDiff = (from.getFullYear() - start.getFullYear()) * 12 + (from.getMonth() - start.getMonth());
      const steps = Math.max(0, Math.floor(monthsDiff / 3) * 3);
      cur = addMonthsClamped(start, steps, startDom);
      while (cur < from) cur = addMonthsClamped(cur, 3, startDom);
      cand = cur;
    }
  } else if (recurrence === "semiannual") {
    const secondMonth = Number(tx.second_occurrence_month);
    const secondDay = Number(tx.second_day_of_month);
    const anchors = [];
    if (Number.isFinite(startMonth) && Number.isFinite(startDom)) {
      anchors.push({ m: startMonth, d: startDom });
    }
    if (Number.isFinite(secondMonth) && Number.isFinite(secondDay)) {
      anchors.push({ m: secondMonth, d: secondDay });
    } else if (Number.isFinite(startMonth) && Number.isFinite(startDom)) {
      const legacy = addMonthsClamped(start, 6, startDom);
      anchors.push({ m: legacy.getMonth(), d: legacy.getDate() });
    }
    const uniq = anchors.filter(
      (a, i, arr) => arr.findIndex((b) => b.m === a.m && b.d === a.d) === i
    );
    if (!uniq.length) return null;
    if (from <= start) {
      cand = start;
    } else {
      const y = from.getFullYear();
      const today = { m: from.getMonth(), d: from.getDate() };
      let pick = null;
      for (const a of uniq) {
        if (a.m > today.m || (a.m === today.m && a.d >= today.d)) {
          pick = dateFromYMDClamped(y, a.m, a.d);
          break;
        }
      }
      if (!pick) pick = dateFromYMDClamped(y + 1, uniq[0].m, uniq[0].d);
      cand = pick;
    }
  } else {
    // monthly (default)
    if (from <= start) {
      cand = start;
    } else {
      const y = from.getFullYear();
      const m0 = from.getMonth();
      const thisMonth = dateFromYMDClamped(y, m0, startDom);
      cand = thisMonth >= from ? thisMonth : dateFromYMDClamped(y, m0 + 1, startDom);
    }
  }

  if (!cand) return null;
  if (cand < start) cand = start;
  if (end && cand > end) return null;
  return toISODate(cand);
}

/** Display amount / variable / kind / description for the next occurrence (API override-aware). */
function effectiveNextOccurrenceListFields(tx) {
  const rawAmt = tx && tx.next_occurrence_amount;
  const hasApiAmt = rawAmt != null && rawAmt !== "" && Number.isFinite(Number(rawAmt));
  const amount = hasApiAmt ? Number(rawAmt) : Number(tx && tx.amount) || 0;
  const variable =
    tx && typeof tx.next_occurrence_variable === "boolean" ? !!tx.next_occurrence_variable : !!(tx && tx.variable);
  const kind =
    tx && tx.next_occurrence_kind != null && String(tx.next_occurrence_kind).trim() !== ""
      ? String(tx.next_occurrence_kind)
      : String((tx && tx.kind) || "expense");
  const description =
    tx && tx.next_occurrence_description != null && String(tx.next_occurrence_description).trim() !== ""
      ? String(tx.next_occurrence_description).trim()
      : String((tx && tx.description) || "").trim() || "(no description)";
  return { amount, variable, kind, description };
}

/** Prefer API override-aware date; fall back to client schedule math for older backends. */
function nextOccurrenceIsoForRecurringList(tx, todayIso) {
  const raw = tx && tx.next_occurrence_date;
  if (raw != null && String(raw).trim() !== "") {
    const n = normalizeIsoDate(raw);
    if (n) return n;
    const s = String(raw);
    if (s.length >= 10) return `${s.slice(0, 4)}-${s.slice(5, 7)}-${s.slice(8, 10)}`;
  }
  return nextExpectedOccurrenceIso(tx, todayIso);
}

function renderUpcomingTransactionsFiltered() {
  if (!txListMain) return;
  const kindSel = upcomingKindFilter ? String(upcomingKindFilter.value || "all") : "all";
  const srcSel = upcomingSourceFilter ? String(upcomingSourceFilter.value || "all") : "all";
  const freqSel = upcomingRecurrenceFilter ? String(upcomingRecurrenceFilter.value || "all") : "all";
  const startIso = upcomingStartDate?.value || toISODate(new Date());
  const endIso = upcomingEndDate?.value || "";
  const q = tmSearch ? String(tmSearch.value || "").trim().toLowerCase() : "";
  const minAmt = tmMinAmt ? parseMoneyRangeField(tmMinAmt.value) : null;
  const maxAmt = tmMaxAmt ? parseMoneyRangeField(tmMaxAmt.value) : null;
  const statusSel = tmStatus ? String(tmStatus.value || "all") : "all";
  const catIdSel = tmCategory ? String(tmCategory.value || "all") : "all";

  const withinRange = (iso) => {
    if (!iso) return false;
    if (startIso && String(iso) < String(startIso)) return false;
    if (endIso && String(iso) > String(endIso)) return false;
    return true;
  };

  const matchesQuery = (txt) => {
    if (!q) return true;
    return String(txt || "").toLowerCase().includes(q);
  };
  const matchesAmount = (n) => {
    const v = Math.abs(toNum(n));
    if (!Number.isFinite(v)) return false;
    if (minAmt != null && v < minAmt) return false;
    if (maxAmt != null && v > maxAmt) return false;
    return true;
  };

  /** @type {{sortIso:string, type:"actual"|"expected", tx:any, nextIso?:string}[]} */
  const rows = [];

  if (srcSel === "all" || srcSel === "one_time") {
    for (const tx of state.upcomingActualItems || []) {
      const iso = normalizeIsoDate(tx?.date) || String(tx?.date || "");
      if (!withinRange(iso)) continue;
      if (kindSel !== "all" && String(tx?.kind || "expense") !== kindSel) continue;
      if (!matchesAmount(tx?.amount)) continue;
      const primary = actualTransactionPrimaryLabel(tx);
      const catName = effectiveTransactionCategoryName(tx);
      const notes = tx?.notes != null ? String(tx.notes) : "";
      const isUncat = tx?.category_id == null || tx?.category_id === "" || Number(tx?.category_id) === 0;
      const isPast = iso && String(iso) < toISODate(new Date());
      if (statusSel === "uncategorized" && !isUncat) continue;
      if (statusSel === "recurring") continue;
      if (statusSel === "upcoming" && isPast) continue;
      if (statusSel === "past" && !isPast) continue;
      if (catIdSel !== "all") {
        const cid = Number(tx?.category_id);
        if (!Number.isFinite(cid) || String(cid) !== catIdSel) continue;
      }
      if (q && ![primary, catName, notes].some(matchesQuery)) continue;
      rows.push({ sortIso: iso, type: "actual", tx });
    }
  }

  if (srcSel === "all" || srcSel === "recurring") {
    const todayIso = toISODate(new Date());
    const items = state.expectedTransactions || [];
    const byId = new Map();
    for (const tx of items) {
      const id = Number(tx && tx.id);
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, tx);
    }
    for (const tx of byId.values()) {
      const rec = String(tx?.recurrence || "monthly");
      if (srcSel === "recurring" && freqSel !== "all" && rec !== freqSel) continue;
      if (srcSel !== "recurring" && freqSel !== "all" && rec !== freqSel) {
        // Allow frequency filter even when "all" sources (applies to recurring rows only).
      }
      if (freqSel !== "all" && rec !== freqSel) continue;
      const eff = effectiveNextOccurrenceListFields(tx);
      if (kindSel !== "all" && String(eff.kind || "expense") !== kindSel) continue;
      const nextIso = nextOccurrenceIsoForRecurringList(tx, todayIso);
      if (!withinRange(nextIso)) continue;
      if (!matchesAmount(eff.amount)) continue;
      const cid = tx && tx.category_id;
      const isUncat = cid == null || cid === "" || Number(cid) === 0;
      if (statusSel === "uncategorized" && !isUncat) continue;
      if (statusSel === "past") continue;
      if (statusSel === "upcoming") {
        // ok (next occurrence)
      }
      if (statusSel === "recurring") {
        // ok
      }
      const catName = effectiveTransactionCategoryName(tx);
      if (catIdSel !== "all") {
        const cid = Number(tx?.category_id);
        if (!Number.isFinite(cid) || String(cid) !== catIdSel) continue;
      }
      if (q && ![eff.description, catName, tx?.notes].some(matchesQuery)) continue;
      rows.push({ sortIso: nextIso, type: "expected", tx, nextIso });
    }
  }

  rows.sort((a, b) => String(a.sortIso).localeCompare(String(b.sortIso)));

  txListMain.innerHTML = "";
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "tm-empty-state";
    empty.innerHTML = `<div class="tm-empty-state__title">No transactions match these filters</div><p class="tm-empty-state__lede">Try a wider date range, clearing quick filters, or loosening amount bounds—then tighten again once you see the rows you care about.</p>`;
    txListMain.appendChild(empty);
    renderUncategorizedTransactions();
    refreshTmSummaryStrip();
    return;
  }

  for (const r of rows) {
    if (r.type === "actual") {
      const tx = r.tx;
      const iso = normalizeIsoDate(tx?.date) || String(tx?.date || "");
      const primary = actualTransactionPrimaryLabel(tx);
      const catName = effectiveTransactionCategoryName(tx);
      const isUncat = tx?.category_id == null || tx?.category_id === "" || Number(tx?.category_id) === 0;

      const row = document.createElement("div");
      row.className = "tm-row";
      row.tabIndex = 0;
      row.setAttribute("title", "Open editor — changes flow into your forecast");
      row.addEventListener("click", (e) => {
        if (e.target.closest(".tm-row__edit")) return;
        openTxEditModal(tx);
      });
      row.addEventListener("keydown", (e) => {
        if (e.target.closest(".tm-row__edit")) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openTxEditModal(tx);
        }
      });

      const cDate = document.createElement("div");
      cDate.className = "tm-col tm-col--date";
      cDate.textContent = iso ? fmtDateMedDisplay(iso) : "—";

      const cDesc = document.createElement("div");
      cDesc.className = "tm-col tm-col--desc";
      const d1 = document.createElement("div");
      d1.className = `tm-desc${String(tx.kind) === "income" ? " tm-desc--income" : ""}`;
      d1.textContent = primary;
      const d2 = document.createElement("div");
      d2.className = "tm-meta";
      const metaBits = [];
      metaBits.push(catName && String(catName).trim() ? String(catName).trim() : "Uncategorized");
      const nt = tx?.notes && String(tx.notes).trim() ? String(tx.notes).trim() : "";
      if (nt) metaBits.push(nt);
      d2.textContent = metaBits.join(" · ");
      cDesc.appendChild(d1);
      cDesc.appendChild(d2);

      const cFreq = document.createElement("div");
      cFreq.className = "tm-col tm-col--freq";
      cFreq.textContent = "One-time";

      const cStatus = document.createElement("div");
      cStatus.className = "tm-col tm-col--status";
      cStatus.innerHTML = `<span class="tm-badge ${isUncat ? "tm-badge--uncategorized" : "tm-badge--confirmed"}">${isUncat ? "Uncategorized" : "Categorized"}</span>`;

      const cAmt = document.createElement("div");
      cAmt.className = `tm-col tm-col--amt ${tx.kind === "income" ? "income" : "expense"} ${tmAmtModifierClass(tx.kind, tx.amount)}`;
      cAmt.textContent = `${tx.kind === "income" ? "+" : "-"}$${fmtMoney(tx.amount)}`;

      const cAct = document.createElement("div");
      cAct.className = "tm-col tm-col--action";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "tm-row__edit";
      editBtn.setAttribute("aria-label", "Edit transaction");
      editBtn.setAttribute("title", "Edit — updates your forecast");
      editBtn.innerHTML = TM_ROW_EDIT_SVG;
      editBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        openTxEditModal(tx);
      });
      cAct.appendChild(editBtn);

      row.appendChild(cDate);
      row.appendChild(cDesc);
      row.appendChild(cAmt);
      row.appendChild(cFreq);
      row.appendChild(cStatus);
      row.appendChild(cAct);
      txListMain.appendChild(row);
      continue;
    }

    const tx = r.tx;
    const nextIso = r.nextIso;
    const eff = effectiveNextOccurrenceListFields(tx);

    const cid = tx && tx.category_id;
    const isUncat = cid == null || cid === "" || Number(cid) === 0;

    const row = document.createElement("div");
    row.className = "tm-row";
    if (eff.variable) row.classList.add("is-variable");
    if (tx?.id != null) row.dataset.tmExpectedId = String(tx.id);
    if (nextIso) row.dataset.tmNextIso = String(nextIso);
    row.tabIndex = 0;
    row.setAttribute("title", "Open series editor — updates your forecast");
    row.addEventListener("click", (e) => {
      if (e.target.closest(".tm-row__edit")) return;
      openExpectedEditModal(tx, { nextOccurrenceIso: nextIso });
    });
    row.addEventListener("keydown", (e) => {
      if (e.target.closest(".tm-row__edit")) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openExpectedEditModal(tx, { nextOccurrenceIso: nextIso });
      }
    });

    const cDate = document.createElement("div");
    cDate.className = "tm-col tm-col--date";
    cDate.textContent = nextIso ? fmtDateMedDisplay(nextIso) : "—";

    const cDesc = document.createElement("div");
    cDesc.className = "tm-col tm-col--desc";
    const d1 = document.createElement("div");
    d1.className = `tm-desc${String(eff.kind) === "income" ? " tm-desc--income" : ""}`;
    d1.textContent = String(eff.description || "(no description)").trim() || "(no description)";
    const d2 = document.createElement("div");
    d2.className = "tm-meta";
    const cn = effectiveTransactionCategoryName(tx) || "";
    const metaBits = [];
    metaBits.push(cn.trim() ? cn.trim() : "Uncategorized");
    d2.textContent = metaBits.join(" · ");
    cDesc.appendChild(d1);
    cDesc.appendChild(d2);

    const cFreq = document.createElement("div");
    cFreq.className = "tm-col tm-col--freq";
    cFreq.textContent = recurrenceLabel(tx.recurrence || "monthly");

    const cStatus = document.createElement("div");
    cStatus.className = "tm-col tm-col--status";
    let statusHtml = "";
    if (isUncat) {
      statusHtml = `<span class="tm-badge tm-badge--uncategorized">Uncategorized</span>`;
    } else if (eff.variable) {
      statusHtml = `<span class="tm-badge tm-badge--variable">Variable amount</span>`;
    } else {
      statusHtml = `<span class="tm-badge tm-badge--upcoming">Upcoming</span>`;
    }
    cStatus.innerHTML = statusHtml;

    const cAmt = document.createElement("div");
    cAmt.className = `tm-col tm-col--amt ${eff.kind === "income" ? "income" : "expense"} ${tmAmtModifierClass(eff.kind, eff.amount)}`;
    cAmt.textContent = `${eff.kind === "income" ? "+" : "-"}$${fmtMoney(eff.amount)}`;

    const cAct = document.createElement("div");
    cAct.className = "tm-col tm-col--action";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "tm-row__edit";
    editBtn.setAttribute("aria-label", "Edit recurring transaction");
    editBtn.setAttribute("title", "Edit series — updates your forecast");
    editBtn.innerHTML = TM_ROW_EDIT_SVG;
    editBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      openExpectedEditModal(tx, { nextOccurrenceIso: nextIso });
    });
    cAct.appendChild(editBtn);

    row.appendChild(cDate);
    row.appendChild(cDesc);
    row.appendChild(cAmt);
    row.appendChild(cFreq);
    row.appendChild(cStatus);
    row.appendChild(cAct);
    txListMain.appendChild(row);
  }

  tmApplyQueuedReviewFocus();
  renderUncategorizedTransactions();
  refreshTmSummaryStrip();
}

function renderUncategorizedTransactions() {
  if (!uncatTxList) return;

  const items = (state.upcomingActualItems || []).filter((t) => {
    const cid = t && t.category_id;
    return cid == null || cid === "" || Number(cid) === 0;
  });

  uncatTxList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No uncategorized transactions. New imported or manually added transactions that need cleanup will appear here.";
    uncatTxList.appendChild(empty);
    if (uncatTxSaveBtn) {
      uncatTxSaveBtn.disabled = true;
      uncatTxSaveBtn.hidden = true;
    }
    if (uncatTxErr) show(uncatTxErr, "");
    return;
  }

  // Clear pending selections that no longer exist.
  const ids = new Set(items.map((t) => Number(t.id)).filter((n) => Number.isFinite(n)));
  for (const k of [...uncatPendingCategoryByTxId.keys()]) {
    if (!ids.has(k)) uncatPendingCategoryByTxId.delete(k);
  }

  if (uncatTxSaveBtn) {
    uncatTxSaveBtn.hidden = false;
    uncatTxSaveBtn.disabled = uncatPendingCategoryByTxId.size === 0;
  }

  const cats = state.categories || [];
  const groups = state.categoryTree?.groups || [];
  const byGroupId = new Map();
  for (const c of cats) {
    const gid = c && c.group_id != null ? Number(c.group_id) : 0;
    if (!byGroupId.has(gid)) byGroupId.set(gid, []);
    byGroupId.get(gid).push(c);
  }

  for (const tx of items) {
    const id = Number(tx && tx.id);
    const row = document.createElement("div");
    row.className = "item uncat-item";

    const left = document.createElement("div");
    left.className = "left";
    const desc = document.createElement("div");
    desc.className = `desc ${kindFgClass(tx.kind)}`;
    desc.textContent = actualTransactionPrimaryLabel(tx);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = fmtDateMDY(tx.date || "");
    left.appendChild(desc);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.className = "uncat-right";

    const sel = document.createElement("select");
    sel.className = "uncat-cat-select";
    sel.setAttribute("aria-label", "Assign category");

    {
      const opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = "Select category";
      sel.appendChild(opt0);
    }

    // Render as grouped options.
    for (const g of groups) {
      const gid = Number(g && g.id);
      const arr = (byGroupId.get(gid) || []).slice();
      if (!arr.length) continue;
      arr.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
      const og = document.createElement("optgroup");
      og.label = String(g.name || "").trim() || "Group";
      for (const c of arr) {
        const opt = document.createElement("option");
        opt.value = String(c.id);
        // The native select will visually nest these under the group.
        opt.textContent = String(c.name || "").trim() || "(unnamed)";
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
    // Fallback: categories without a known group.
    const ungrouped = (byGroupId.get(0) || []).slice();
    if (ungrouped.length) {
      ungrouped.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
      const og = document.createElement("optgroup");
      og.label = "Other";
      for (const c of ungrouped) {
        const opt = document.createElement("option");
        opt.value = String(c.id);
        opt.textContent = String(c.name || "").trim() || "(unnamed)";
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }

    const pending = Number.isFinite(id) ? uncatPendingCategoryByTxId.get(id) : null;
    if (pending != null && pending !== "") sel.value = String(pending);
    sel.addEventListener("change", () => {
      const v = sel.value ? Number(sel.value) : null;
      if (Number.isFinite(id)) {
        if (v != null && Number.isFinite(v) && v > 0) uncatPendingCategoryByTxId.set(id, v);
        else uncatPendingCategoryByTxId.delete(id);
      }
      if (uncatTxSaveBtn) uncatTxSaveBtn.disabled = uncatPendingCategoryByTxId.size === 0;
    });

    const amt = document.createElement("div");
    amt.className = `amt ${tx.kind === "income" ? "income" : "expense"}`;
    amt.textContent = `${tx.kind === "income" ? "+" : "-"}$${fmtMoney(tx.amount)}`;

    right.appendChild(sel);
    right.appendChild(amt);

    row.appendChild(left);
    row.appendChild(right);
    uncatTxList.appendChild(row);
  }
}

function renderRecurringFilteredList() {
  if (!recurringFilteredList) return;
  const items = state.expectedTransactions || [];
  recurringFilteredList.innerHTML = "";
  if (!items || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No recurring transactions yet.";
    recurringFilteredList.appendChild(empty);
    return;
  }

  const sel = recurringFrequencyFilter ? String(recurringFrequencyFilter.value || "all") : "all";
  const kindSel = recurringKindFilter ? String(recurringKindFilter.value || "all") : "all";
  const todayIso = toISODate(new Date());
  // Ensure one row per series id, even if items contain duplicates.
  const byId = new Map();
  for (const tx of items) {
    const id = Number(tx && tx.id);
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, tx);
  }

  const filtered = [...byId.values()]
    .filter(
      (tx) =>
        (sel === "all" || String(tx.recurrence || "monthly") === sel) &&
        (kindSel === "all" || String(tx.kind || "expense") === kindSel),
    )
    .map((tx) => ({ tx, nextIso: nextOccurrenceIsoForRecurringList(tx, todayIso) }))
    .filter((row) => !!row.nextIso);

  filtered.sort((a, b) => {
    const d = String(a.nextIso).localeCompare(String(b.nextIso));
    if (d !== 0) return d;
    return String(a.tx.description || "").localeCompare(String(b.tx.description || ""));
  });

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No matching recurring transactions.";
    recurringFilteredList.appendChild(empty);
    return;
  }

  for (const { tx, nextIso } of filtered) {
    const eff = effectiveNextOccurrenceListFields(tx);
    const el = document.createElement("div");
    el.className = "item expected-item--dense";
    if (eff.variable) el.classList.add("expected-item--variable");
    el.style.cursor = "pointer";

    const amtClass = eff.kind === "income" ? "income" : "expense";
    const kindSign = eff.kind === "income" ? "+" : "-";
    const startDom =
      tx.start_date != null && String(tx.start_date).length >= 10
        ? Number(String(tx.start_date).slice(8, 10))
        : null;
    let twiceMeta = "";
    if (tx.recurrence === "twice_monthly" && tx.second_day_of_month != null && startDom != null && !Number.isNaN(startDom)) {
      twiceMeta = `days ${startDom} & ${tx.second_day_of_month}`;
    } else if (
      tx.recurrence === "semiannual" &&
      tx.second_day_of_month != null &&
      tx.second_occurrence_month != null &&
      tx.start_date
    ) {
      const s = normalizeIsoDate(tx.start_date) || "";
      if (s.length >= 10) {
        twiceMeta = `${s.slice(5, 7)}/${s.slice(8, 10)} & ${String(tx.second_occurrence_month).padStart(2, "0")}/${tx.second_day_of_month}`;
      }
    }

    const left = document.createElement("div");
    left.className = "left";
    const descEl = document.createElement("div");
    descEl.className = `desc ${kindFgClass(eff.kind)}`;
    descEl.textContent = eff.description;

    const metaEl = document.createElement("div");
    metaEl.className = "meta";
    const bits = [`Next: ${fmtDateMDY(nextIso)}`, twiceMeta, tx.recurrence ? `recurs: ${recurrenceLabel(tx.recurrence)}` : ""].filter(Boolean);
    metaEl.appendChild(document.createTextNode(bits.join(" ")));

    left.appendChild(descEl);
    left.appendChild(metaEl);

    const amtBtn = document.createElement("button");
    amtBtn.type = "button";
    amtBtn.className = `amt ${amtClass} expected-amt-link`;
    amtBtn.textContent = `${kindSign}$${fmtMoney(eff.amount)}`;
    amtBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openExpectedEditModal(tx, { nextOccurrenceIso: nextIso });
    });

    el.appendChild(left);
    el.appendChild(amtBtn);
    bindFastTxnTipHover(left, `Recurring schedule #${tx.id} · next ${nextIso}`);
    bindFastTxnTipHover(amtBtn, "Edit recurring transaction");
    el.addEventListener("click", () => openExpectedEditModal(tx, { nextOccurrenceIso: nextIso }));
    recurringFilteredList.appendChild(el);
  }
}

async function loadExpectedTransactions() {
  if (!state.activeFamilyId) return;
  const items = await api(`/api/families/${state.activeFamilyId}/expected-transactions`, "GET");
  state.expectedTransactions = items || [];
  renderUpcomingTransactionsFiltered();
  invalidateLowBalanceAlertCache();
  void refreshLowBalanceAlert();
}

function renderProjectionSummary(summary) {
  if (!projectionSummary) return;
  projectionSummary.innerHTML = "";
  if (!summary?.daily || summary.daily.length === 0) return;

  const first = summary.daily[0];
  const last = summary.daily[summary.daily.length - 1];

  const startBal = Number(first.total_balance ?? 0);
  const endBal = Number(last.total_balance ?? 0);
  const net = endBal - startBal;

  const startEl = document.createElement("div");
  startEl.className = "total";
  startEl.innerHTML = `<div class="k">Start balance</div><div class="v">$${fmtMoney(startBal)}</div>`;

  const endEl = document.createElement("div");
  endEl.className = "total";
  endEl.innerHTML = `<div class="k">End balance</div><div class="v">$${fmtMoney(endBal)}</div>`;

  const netEl = document.createElement("div");
  netEl.className = "total";
  netEl.innerHTML = `<div class="k">Net cashflow</div><div class="v ${net >= 0 ? "ok" : "danger"}">$${fmtMoney(net)}</div>`;

  projectionSummary.appendChild(startEl);
  projectionSummary.appendChild(endEl);
  projectionSummary.appendChild(netEl);
}

function renderProjectionDaily(dailyItems) {
  projectionDailyList.innerHTML = "";
  if (!dailyItems || dailyItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No projection data.";
    projectionDailyList.appendChild(empty);
    return;
  }

  for (const d of dailyItems) {
    const el = document.createElement("div");
    el.className = "item";

    const netNum = Number(d.net_cashflow ?? 0);
    const amtClass = netNum >= 0 ? "income" : "expense";
    const kindSign = netNum >= 0 ? "+" : "-";

    let balancesMeta = "";
    if (d.account_balance && state.accounts && state.accounts.length > 0) {
      const pairs = [];
      for (const a of state.accounts) {
        const key = String(a.id);
        const bal = d.account_balance[key] ?? 0;
        pairs.push(`${a.name}: $${fmtMoney(bal)}`);
        if (pairs.length >= 3) break;
      }
      balancesMeta = `Balances: ${pairs.join(", ")}`;
    }

    el.innerHTML = `
      <div class="left">
        <div class="desc">${fmtDateMDY(d.date)}</div>
        <div class="meta">Total balance: $${fmtMoney(d.total_balance)}${balancesMeta ? ` · ${escapeHtml(balancesMeta)}` : ""}</div>
      </div>
      <div class="amt ${amtClass}">${kindSign}$${fmtMoney(Math.abs(netNum))}</div>
    `;

    projectionDailyList.appendChild(el);
  }
}

function renderTotals(totals) {
  if (!totalsEl) return;
  totalsEl.innerHTML = "";
  const income = totals?.income ?? 0;
  const expense = totals?.expense ?? 0;
  const net = totals?.net ?? 0;
  const netTone = net >= 0 ? "ok" : "danger";

  if (totalsEl.classList.contains("totals--compact")) {
    totalsEl.innerHTML = `
      <div class="totals-compact">
        <div class="totals-compact__row totals-compact__row--income">
          <span class="totals-compact__k">Income</span>
          <span class="totals-compact__v ok">$${fmtMoneySidebarSummary(income)}</span>
        </div>
        <div class="totals-compact__row totals-compact__row--expense">
          <span class="totals-compact__k">Expenses</span>
          <span class="totals-compact__v danger">$${fmtMoneySidebarSummary(expense)}</span>
        </div>
        <div class="totals-compact__row totals-compact__row--net">
          <span class="totals-compact__k">Net</span>
          <span class="totals-compact__v ${net >= 0 ? "ok" : "danger"}">$${fmtMoneySidebarSummary(net)}</span>
        </div>
      </div>`;
    return;
  }

  const incomeEl = document.createElement("div");
  incomeEl.className = "total total--income";
  incomeEl.innerHTML = `<div class="k">Income</div><div class="v ok">$${fmtMoneySidebarSummary(income)}</div>`;

  const expenseEl = document.createElement("div");
  expenseEl.className = "total total--expense";
  expenseEl.innerHTML = `<div class="k">Expenses</div><div class="v danger">$${fmtMoneySidebarSummary(expense)}</div>`;

  const netEl = document.createElement("div");
  netEl.className = "total total--net";
  netEl.innerHTML = `<div class="k">Net</div><div class="v ${netTone}">$${fmtMoneySidebarSummary(net)}</div>`;

  totalsEl.appendChild(incomeEl);
  totalsEl.appendChild(expenseEl);
  totalsEl.appendChild(netEl);
}

function computeMonthSummaryTotalsFromState() {
  const mode = calendarMode?.value || "both";
  const includeActual = mode === "both" || mode === "actual";
  const includeExpected = mode === "both" || mode === "expected";

  let income = 0;
  let expense = 0;

  if (includeActual) {
    for (const tx of state.monthActualItems || []) {
      const amt = toNum(tx.amount);
      if (!Number.isFinite(amt)) continue;
      if (String(tx.kind) === "income") income += amt;
      else expense += amt;
    }
  }

  if (includeExpected) {
    for (const tx of state.monthExpectedItems || []) {
      const amt = toNum(tx.amount);
      if (!Number.isFinite(amt)) continue;
      if (String(tx.kind) === "income") income += amt;
      else expense += amt;
    }
  }

  return { income, expense, net: income - expense };
}

function renderMonthSummaryTotalsFromState() {
  renderTotals(computeMonthSummaryTotalsFromState());
  refreshSidebarForecastHints();
  refreshCalendarCashInsights();
}

function renderTransactionsInto(listEl, items, emptyMessage) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!items || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = emptyMessage || "No transactions for this month.";
    listEl.appendChild(empty);
    return;
  }

  for (const tx of items) {
    const el = document.createElement("div");
    el.className = "item";
    el.style.cursor = "pointer";

    const amtClass = tx.kind === "income" ? "income" : "expense";

    const left = document.createElement("div");
    left.className = "left";
    const link = document.createElement("a");
    link.href = "#";
    link.className = `desc tx-desc-link ${kindFgClass(tx.kind)}`;
    const primary = actualTransactionPrimaryLabel(tx);
    link.textContent = primary;
    const catName = effectiveTransactionCategoryName(tx);
    const n = tx.notes && String(tx.notes).trim();
    if (n) bindFastTxnTipHover(el, n);
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTxEditModal(tx);
    });

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.appendChild(document.createTextNode(fmtDateMDY(tx.date || "")));
    const showCatPill = !!catName && primary !== catName;
    if (showCatPill && tx.category_id) {
      const st = pillStyleForTransaction(tx);
      const pill = document.createElement("span");
      pill.className = `cat-pill ${kindFgClass(tx.kind)}`;
      pill.textContent = catName;
      if (st?.fg) pill.style.color = st.fg;
      if (st?.bg) {
        pill.style.background = st.bg;
      }
      meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(pill);
    } else if (showCatPill && tx.category) {
      meta.appendChild(document.createTextNode(` · ${catName}`));
    }

    left.appendChild(link);
    left.appendChild(meta);

    const amt = document.createElement("div");
    amt.className = `amt ${amtClass}`;
    amt.textContent = `${tx.kind === "income" ? "+" : "-"}$${fmtMoney(tx.amount)}`;

    el.appendChild(left);
    el.appendChild(amt);
    el.addEventListener("click", () => openTxEditModal(tx));
    listEl.appendChild(el);
  }
}

function renderTransactions(items) {
  renderTransactionsInto(txList, items, "No transactions for this month.");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadTransactions() {
  try {
    show(txErr, "");
    if (!state.activeFamilyId) return;
    // Keep the month query aligned with what the calendar is displaying, but also guard
    // against the calendar month picker and sidebar month input drifting out of sync.
    const calMonth = (calendarMonth?.value || "").trim();
    const sideMonth = (monthInput?.value || "").trim();
    const months = [calMonth || sideMonth].filter(Boolean);
    if (calMonth && sideMonth && calMonth !== sideMonth) months.push(sideMonth);
    const uniqueMonths = [...new Set(months)];

    const results = await Promise.all(
      uniqueMonths.map((m) => api(`/api/families/${state.activeFamilyId}/transactions?month=${encodeURIComponent(m)}`, "GET"))
    );
    const byId = new Map();
    for (const r of results) {
      for (const it of r?.items || []) {
        const id = Number(it && it.id);
        if (!Number.isFinite(id)) continue;
        byId.set(id, it);
      }
    }
    const items = [...byId.values()];
    state.monthActualItems = items;
    renderTransactions(items);
  } catch (e) {
    show(txErr, e.message || "Failed to load transactions");
  }
}

/** Actual transactions on or after today (for Transaction View list), chronological. */
async function loadUpcomingTransactionsPanel() {
  try {
    if (!state.activeFamilyId) {
      state.upcomingActualItems = [];
      renderUpcomingTransactionsFiltered();
      return;
    }
    const todayIso = upcomingStartDate?.value || toISODate(new Date());
    const endIso = upcomingEndDate?.value || (() => {
      const endCap = new Date();
      endCap.setDate(endCap.getDate() + 548);
      return toISODate(endCap);
    })();
    const qs = `?start_date=${encodeURIComponent(todayIso)}&end_date=${encodeURIComponent(endIso)}`;
    const data = await api(`/api/families/${state.activeFamilyId}/transactions${qs}`, "GET");
    const items = data?.items || [];
    state.upcomingActualItems = items;
    renderUpcomingTransactionsFiltered();
  } catch (e) {
    show(txErr, e.message || "Failed to load upcoming transactions");
  }
}

async function loadExpectedCalendar() {
  try {
    show(calendarErr, "");
    state.monthExpectedItems = [];
    if (!state.activeFamilyId) return;

    const month = calendarMonth?.value || monthInput?.value;
    if (!month) return;

    const data = await api(`/api/families/${state.activeFamilyId}/expected-calendar?month=${encodeURIComponent(month)}`, "GET");
    state.monthExpectedItems = data?.items || [];
  } catch (e) {
    show(calendarErr, e.message || "Failed to load expected calendar");
  }
  renderVariableTodosForMonth();
}

function shiftMonthStr(ym, deltaMonths) {
  const p = String(ym || "").split("-");
  const y = Number(p[0]);
  const m = Number(p[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return "";
  const d = new Date(y, m - 1 + deltaMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function loadCalendarExtras() {
  state.calendarExtraActualItems = [];
  state.calendarExtraExpectedItems = [];
  if (!state.activeFamilyId) return;
  const month = calendarMonth?.value || monthInput?.value;
  if (!month) return;
  const prev = shiftMonthStr(month, -1);
  const next = shiftMonthStr(month, 1);
  if (!prev || !next) return;
  try {
    const [prevTx, nextTx] = await Promise.all([
      api(`/api/families/${state.activeFamilyId}/transactions?month=${encodeURIComponent(prev)}`, "GET"),
      api(`/api/families/${state.activeFamilyId}/transactions?month=${encodeURIComponent(next)}`, "GET"),
    ]);
    state.calendarExtraActualItems = [...(prevTx?.items || []), ...(nextTx?.items || [])];
  } catch (_) {
    // Non-fatal; calendar will still render the base month.
    state.calendarExtraActualItems = [];
  }
  try {
    const [prevExp, nextExp] = await Promise.all([
      api(`/api/families/${state.activeFamilyId}/expected-calendar?month=${encodeURIComponent(prev)}`, "GET"),
      api(`/api/families/${state.activeFamilyId}/expected-calendar?month=${encodeURIComponent(next)}`, "GET"),
    ]);
    state.calendarExtraExpectedItems = [...(prevExp?.items || []), ...(nextExp?.items || [])];
  } catch (_) {
    state.calendarExtraExpectedItems = [];
  }
}

/** Normalize API/legacy dates to YYYY-MM-DD for Map keys. */
function normalizeIsoDate(raw) {
  if (raw == null || raw === "") return "";
  const s = String(raw);
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/** Map day-of-month (1–31) to a calendar date using the anchor month/year. */
function dayOfMonthToIsoDate(day, anchorIso) {
  const dom = Number(day);
  if (!Number.isFinite(dom) || dom < 1 || dom > 31) return "";
  const anchor = normalizeIsoDate(anchorIso) || normalizeIsoDate(new Date().toISOString().slice(0, 10));
  if (!anchor) return "";
  const y = Number(anchor.slice(0, 4));
  const m0 = Number(anchor.slice(5, 7)) - 1;
  const last = new Date(y, m0 + 1, 0).getDate();
  const clamped = Math.min(dom, last);
  return `${anchor.slice(0, 7)}-${String(clamped).padStart(2, "0")}`;
}

function isoDateToDayOfMonth(iso) {
  const n = normalizeIsoDate(iso);
  if (!n || n.length < 10) return NaN;
  return Number(n.slice(8, 10));
}

function readSecondDayOfMonthFromInput(el) {
  if (!el) return NaN;
  const raw = String(el.value || "").trim();
  if (!raw) return NaN;
  if (/^\d{1,2}$/.test(raw)) {
    const legacy = Number(raw);
    return legacy >= 1 && legacy <= 31 ? legacy : NaN;
  }
  return isoDateToDayOfMonth(raw);
}

function readSecondOccurrenceFromInput(el) {
  const iso = normalizeIsoDate(el?.value || "");
  if (!iso || iso.length < 10) return null;
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  return { month, day };
}

function setSecondDayOfMonthInput(el, day, anchorIso) {
  if (!el) return;
  const n = Number(day);
  if (!Number.isFinite(n) || n < 1 || n > 31) {
    el.value = "";
    return;
  }
  el.value = dayOfMonthToIsoDate(n, anchorIso);
}

function setSecondOccurrenceInput(el, month, day, anchorIso) {
  if (!el) return;
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(d) || d < 1 || d > 31) {
    el.value = "";
    return;
  }
  const anchor = normalizeIsoDate(anchorIso) || "";
  const y =
    anchor.length >= 4 && /^\d{4}$/.test(anchor.slice(0, 4)) ? anchor.slice(0, 4) : String(new Date().getFullYear());
  el.value = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function inferSecondMonthlyIsoFromStart(startIso) {
  const start = normalizeIsoDate(startIso);
  if (!start) return "";
  const dom = Number(start.slice(8, 10));
  if (!Number.isFinite(dom)) return "";
  const other = dom <= 15 ? 31 : 15;
  return dayOfMonthToIsoDate(other, start);
}

function inferSecondYearlyIsoFromStart(startIso) {
  const start = parseIsoDateLocal(normalizeIsoDate(startIso) || startIso);
  if (!start) return "";
  const shifted = addMonthsClamped(start, 6, start.getDate());
  return toISODate(shifted);
}

function recurrenceUsesSecondOccurrenceDate(recurrence) {
  const r = String(recurrence || "").trim().toLowerCase();
  return r === "twice_monthly" || r === "semiannual";
}

function secondOccurrenceFieldMode(recurrence) {
  return String(recurrence || "").trim().toLowerCase() === "semiannual" ? "yearly" : "monthly";
}

function updateSecondOccurrenceFieldCopy(container, recurrence) {
  if (!container) return;
  const yearly = secondOccurrenceFieldMode(recurrence) === "yearly";
  const label = container.querySelector("label[for], .form-row-h__label label, .account-setup-tx-schedule-grid__label");
  const hint = container.querySelector(".tx-add-twice-monthly-hint, .expected-second-day-row__hint");
  if (label) label.textContent = yearly ? "Second yearly date" : "Second monthly date";
  if (hint) {
    hint.textContent = yearly
      ? "Pick a different date than the start date (often about six months apart)."
      : "Pick a date on a different day of the month than the start date.";
  }
}

function validateSecondOccurrenceForSave(recurrence, startIso, secondEl) {
  const start = normalizeIsoDate(startIso) || "";
  if (!start) return "Start date is required";
  if (secondOccurrenceFieldMode(recurrence) === "monthly") {
    const n = readSecondDayOfMonthFromInput(secondEl);
    if (!Number.isFinite(n) || n < 1 || n > 31) return "Second monthly date is required for twice monthly";
    const startDay = Number(start.slice(8, 10));
    if (n === startDay) return "Second monthly date must be on a different day of the month than the start date";
    return null;
  }
  const occ = readSecondOccurrenceFromInput(secondEl);
  if (!occ) return "Second yearly date is required for twice yearly";
  const sm = Number(start.slice(5, 7));
  const sd = Number(start.slice(8, 10));
  if (occ.month === sm && occ.day === sd) return "Second yearly date must differ from the start date";
  return null;
}

function secondOccurrencePayloadFromForm(recurrence, secondEl) {
  if (secondOccurrenceFieldMode(recurrence) === "monthly") {
    return { second_day_of_month: readSecondDayOfMonthFromInput(secondEl), second_occurrence_month: null };
  }
  const occ = readSecondOccurrenceFromInput(secondEl);
  return occ
    ? { second_day_of_month: occ.day, second_occurrence_month: occ.month }
    : { second_day_of_month: null, second_occurrence_month: null };
}

/** Earliest account starting-balance date (YYYY-MM-DD); null if no accounts. */
function getFamilyEarliestStartingBalanceIso() {
  const accounts = state.accounts || [];
  if (!accounts.length) return null;
  let minIso = null;
  for (const a of accounts) {
    const iso = normalizeIsoDate(a.starting_balance_date);
    if (!iso) continue;
    if (!minIso || iso < minIso) minIso = iso;
  }
  return minIso;
}

function isDateBeforeEarliestStartingBalance(iso) {
  if (!iso) return false;
  const n = normalizeIsoDate(iso) || iso;
  const earliest = getFamilyEarliestStartingBalanceIso();
  return !!earliest && n < earliest;
}

function alertIfDateBeforeStartingBalance(iso) {
  if (!isDateBeforeEarliestStartingBalance(iso)) return false;
  window.alert("That date is before your starting balance.");
  return true;
}

function applyMinDateToTxAddDateInput() {
  if (!txAddDate) return;
  const minD = getFamilyEarliestStartingBalanceIso();
  if (minD) txAddDate.min = minD;
  else txAddDate.removeAttribute("min");
}

function applyMinDateToTxEditDateInput() {
  if (!txEditDate) return;
  const minD = getFamilyEarliestStartingBalanceIso();
  if (minD) txEditDate.min = minD;
  else txEditDate.removeAttribute("min");
}

async function loadReconciledDays(month) {
  if (!state.activeFamilyId) return;
  if (!month) return;
  const cur = String(month).trim();
  const prev = shiftMonthStr(cur, -1);
  const next = shiftMonthStr(cur, 1);
  const months = [cur, prev, next].filter(Boolean);
  const merged = new Set();
  try {
    const results = await Promise.all(
      months.map((m) => api(`/api/families/${state.activeFamilyId}/reconciled-days?month=${encodeURIComponent(m)}`, "GET"))
    );
    for (const data of results) {
      const ds = data?.dates || [];
      for (const d of ds) {
        const iso = normalizeIsoDate(d);
        if (iso) merged.add(iso);
      }
    }
    state.reconciledDates = merged;
  } catch (_) {
    state.reconciledDates = new Set();
  }
  refreshCalendarCashInsights();
}

function monthStartEndIso(ym) {
  const [yS, mS] = String(ym || "").split("-");
  const y = Number(yS);
  const m = Number(mS);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = toISODate(new Date(y, m, 0)); // day 0 of next month = last day of month
  return { start, end };
}

function renderSidebarPendingTransactionsForMonth() {
  if (!sidebarPendingTxList) return;
  const month = calendarMonth?.value || monthInput?.value;
  const range = monthStartEndIso(month);
  sidebarPendingTxList.innerHTML = "";
  if (sidebarPendingTxCard) sidebarPendingTxCard.classList.remove("sidebar-pending--empty");
  const checked = loadPendingAttentionChecked();
  const setTitle = (n) => {
    if (!sidebarPendingTitle) return;
    sidebarPendingTitle.textContent = `Needs review (${Number(n) || 0})`;
  };
  if (!range) {
    setTitle(0);
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "Choose a month to see pending transactions.";
    sidebarPendingTxList.appendChild(empty);
    if (sidebarPendingTxCard) sidebarPendingTxCard.classList.add("sidebar-pending--empty");
    return;
  }

  const todayIso = toISODate(new Date());
  const startIso = todayIso > range.start ? todayIso : range.start;
  const endIso = range.end;

  /** @type {{sortIso:string, type:"actual"|"expected", tx:any}[]} */
  const rows = [];
  for (const it of state.monthExpectedItems || []) {
    // Sidebar "pending" is specifically for Variable (estimate) items only.
    if (!it?.variable) continue;
    const iso = normalizeIsoDate(it?.date) || String(it?.date || "");
    if (!iso || iso < startIso || iso > endIso) continue;
    rows.push({ sortIso: iso, type: "expected", tx: it });
  }

  // Sort by urgency (soonest first), then by magnitude (larger impact first).
  rows.sort((a, b) => {
    const dc = String(a.sortIso).localeCompare(String(b.sortIso));
    if (dc !== 0) return dc;
    const aa = Math.abs(toNum(a?.tx?.amount));
    const bb = Math.abs(toNum(b?.tx?.amount));
    if (bb !== aa) return bb - aa;
    const an = effectiveTransactionCategoryName(a?.tx || {}) || "";
    const bn = effectiveTransactionCategoryName(b?.tx || {}) || "";
    return an.localeCompare(bn);
  });

  if (!rows.length) {
    setTitle(0);
    if (sidebarPendingTxCard) sidebarPendingTxCard.classList.add("sidebar-pending--empty");
    const emptyWrap = document.createElement("div");
    emptyWrap.className = "sidebar-pending-empty";
    const lead = document.createElement("p");
    lead.className = "sidebar-pending-empty-msg sidebar-pending-empty-msg--lead";
    lead.textContent = "You're all caught up";
    const sub = document.createElement("p");
    sub.className = "sidebar-pending-empty-msg sidebar-pending-empty-msg--sub";
    sub.textContent = "Everything looks categorized · No pending transaction reviews";
    emptyWrap.append(lead, sub);
    sidebarPendingTxList.appendChild(emptyWrap);
    return;
  }

  setTitle(rows.length);
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const it = r.tx;
    const open = () => {
      if (document.body?.dataset?.bwView === "transactions") {
        tmFocusExpectedReviewItem(it);
        return;
      }
      const meta = getExpectedSeriesMeta(it?.expected_transaction_id);
      if (meta) openExpectedEditModal(meta, { calendarItem: it });
    };

    const kind = String(it?.kind || "expense");

    const el = document.createElement("button");
    el.type = "button";
    el.className = "pending-attn-item";
    let daysUntil = 999;
    try {
      const t0 = new Date(`${todayIso}T12:00:00`).getTime();
      const t1 = new Date(`${r.sortIso}T12:00:00`).getTime();
      if (Number.isFinite(t0) && Number.isFinite(t1)) daysUntil = Math.round((t1 - t0) / 86400000);
    } catch (_) {}
    if (daysUntil >= 0 && daysUntil <= 3) el.classList.add("is-critical");
    else if (daysUntil >= 0 && daysUntil <= 10) el.classList.add("is-soon");
    el.addEventListener("click", () => open());
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        open();
      }
    });

    const catLabel = effectiveTransactionCategoryName(it) || "Uncategorized";
    const primaryLabel = forecastTransactionPrimaryLabel(it);
    const descFull = String(it?.description || "").trim();
    const notesFull = String(it?.notes || "").trim();
    const hintParts = [
      descFull && descFull !== primaryLabel ? descFull : "",
      notesFull,
    ].filter(Boolean);

    const name = document.createElement("div");
    name.className = "pending-attn-name";
    name.textContent = primaryLabel;
    name.title = hintParts.length ? `${primaryLabel} — ${hintParts.join(" · ")}` : primaryLabel;

    const amt = Math.abs(toNum(it?.amount));
    const sign = String(kind) === "income" ? "+" : "–";
    const dateStr = it?.date ? fmtMonthDay(it.date) : "—";
    if (amt >= 7500) el.classList.add("is-major");
    else if (amt >= 1200) el.classList.add("is-notable");

    const meta = document.createElement("div");
    meta.className = "pending-attn-meta";
    meta.textContent = `${sign}$${fmtMoney0(amt)} • ${dateStr}`;
    meta.title = `${catLabel} · ${sign}$${fmtMoney0(amt)} · ${dateStr}`;

    const textCol = document.createElement("div");
    textCol.className = "pending-attn-text";
    textCol.appendChild(name);
    textCol.appendChild(meta);

    const indicator = document.createElement("span");
    indicator.className = "pending-attn-indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.innerHTML =
      '<svg class="pending-attn-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

    el.setAttribute(
      "aria-label",
      `${primaryLabel}, ${sign}$${fmtMoney0(amt)}, ${it?.date ? fmtMonthDay(it.date) : "date unknown"}`
    );
    el.title = name.title;
    el.appendChild(textCol);
    el.appendChild(indicator);
    sidebarPendingTxList.appendChild(el);
  }
}

async function loadCalendarMonthDaily() {
  state.monthDailyBalances = new Map();
  if (!state.activeFamilyId) return;
  const month = calendarMonth?.value || monthInput?.value;
  if (!month) return;
  const mode = calendarMode?.value || "both";
  try {
    const data = await api(
      `/api/families/${state.activeFamilyId}/calendar-month-daily?month=${encodeURIComponent(month)}&mode=${encodeURIComponent(mode)}`,
      "GET",
    );
    const days = data?.days;
    if (Array.isArray(days) && days.length > 0) {
      for (const row of days) {
        const iso = normalizeIsoDate(row.date);
        if (!iso || row.end == null) continue;
        const start = Number(row.start);
        const txNet = Number(row.tx_net);
        const end = Number(row.end);
        state.monthDailyBalances.set(iso, {
          start: Number.isFinite(start) ? start : 0,
          txNet: Number.isFinite(txNet) ? txNet : 0,
          end: Number.isFinite(end) ? end : 0,
        });
      }
      // Fill visible "wrap" days using the same authoritative API (prev/next month),
      // so balances for gray cells match when you scroll between months.
      const prev = shiftMonthStr(month, -1);
      const next = shiftMonthStr(month, 1);
      const extras = await Promise.allSettled([
        api(`/api/families/${state.activeFamilyId}/calendar-month-daily?month=${encodeURIComponent(prev)}&mode=${encodeURIComponent(mode)}`, "GET"),
        api(`/api/families/${state.activeFamilyId}/calendar-month-daily?month=${encodeURIComponent(next)}&mode=${encodeURIComponent(mode)}`, "GET"),
      ]);
      for (const res of extras) {
        if (res.status !== "fulfilled") continue;
        const more = res.value?.days;
        if (!Array.isArray(more) || more.length === 0) continue;
        for (const row of more) {
          const iso = normalizeIsoDate(row.date);
          if (!iso || state.monthDailyBalances.has(iso) || row.end == null) continue;
          const start = Number(row.start);
          const txNet = Number(row.tx_net);
          const end = Number(row.end);
          state.monthDailyBalances.set(iso, {
            start: Number.isFinite(start) ? start : 0,
            txNet: Number.isFinite(txNet) ? txNet : 0,
            end: Number.isFinite(end) ? end : 0,
          });
        }
      }

      // As a last-resort fallback (offline / partial API), compute any still-missing days client-side.
      const wrap = computeCalendarVisibleDailyBalancesClient();
      for (const [iso, row] of wrap.entries()) {
        if (!state.monthDailyBalances.has(iso)) state.monthDailyBalances.set(iso, row);
      }
      return;
    }
  } catch (_) {
    /* offline or old API — fall back */
  }
  computeMonthDailyBalancesLegacy();
}

let calendarLoadingGuardTimer = null;

function setCalendarLoadingUi(on) {
  const panel = document.getElementById("calendarPanel");
  if (panel) {
    panel.classList.toggle("calendar-panel--loading", !!on);
    panel.setAttribute("aria-busy", on ? "true" : "false");
  }
  for (const el of [calendarPrevMonth, calendarNextMonth, calendarGoToday, calendarMonthNum, calendarYear, calendarMode]) {
    if (el) el.disabled = !!on;
  }
  if (calendarLoadingGuardTimer) {
    clearTimeout(calendarLoadingGuardTimer);
    calendarLoadingGuardTimer = null;
  }
  if (on) {
    calendarLoadingGuardTimer = setTimeout(() => {
      calendarLoadingGuardTimer = null;
      setCalendarLoadingUi(false);
    }, 60000);
  }
}

async function loadMonthAndCalendar() {
  try {
    state.monthActualItems = [];
    state.monthExpectedItems = [];
    state.calendarExtraActualItems = [];
    state.calendarExtraExpectedItems = [];
    state.monthDailyBalances = new Map();
    state.reconciledDates = new Set();
    renderCalendar();

    if (!state.activeFamilyId) {
      renderSidebarPendingTransactionsForMonth();
      renderMonthSummaryTotalsFromState();
      return;
    }

    setCalendarLoadingUi(true);
    await loadTransactions();
    await loadUpcomingTransactionsPanel();
    await loadExpectedCalendar();
    renderSidebarPendingTransactionsForMonth();
    renderMonthSummaryTotalsFromState();
    await loadCalendarExtras();
    await loadReconciledDays(getCalendarViewYm());
    await loadCalendarMonthDaily();
    renderCalendar();
    await refreshLowBalanceAlert();
  } catch (e) {
    show(calendarErr, e.message || "Failed to load calendar");
  } finally {
    setCalendarLoadingUi(false);
  }
}

/** Client-only fallback when calendar-month-daily API is unavailable (approximate). */
function computeMonthDailyBalancesLegacy() {
  state.monthDailyBalances = computeCalendarVisibleDailyBalancesClient();
}

function computeCalendarVisibleDailyBalancesClient() {
  const out = new Map();
  const month = getCalendarViewYm();
  if (!month) return out;
  const [yearPart, monthPart] = String(month).split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const monthStartIso = dateISOFromParts(year, monthIndex, 1);

  // Determine the visible calendar grid range (includes wrap days).
  const first = new Date(year, monthIndex, 1);
  const offset = first.getDay(); // Sunday=0
  let weekRows = Math.ceil((offset + daysInMonth) / 7); // 4–6
  let totalCells = weekRows * 7;
  if (totalCells === 42) {
    let lastRowHasInMonth = false;
    for (let i = 35; i < 42; i++) {
      const dayNum = i - offset + 1;
      if (dayNum >= 1 && dayNum <= daysInMonth) {
        lastRowHasInMonth = true;
        break;
      }
    }
    if (!lastRowHasInMonth) {
      weekRows = 5;
      totalCells = 35;
    }
  }
  const rangeStart = new Date(year, monthIndex, 1 - offset);
  const rangeEnd = new Date(year, monthIndex, 1 - offset + (totalCells - 1));

  const mode = calendarMode?.value || "both";
  const includeActual = mode === "both" || mode === "actual";
  const includeExpected = mode === "both" || mode === "expected";

  const dailyTxnTotals = new Map();
  const startAdds = new Map();
  for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
    const iso = toISODate(d);
    dailyTxnTotals.set(iso, 0);
    startAdds.set(iso, 0);
  }

  if (includeActual) {
    for (const tx of [...(state.monthActualItems || []), ...(state.calendarExtraActualItems || [])]) {
      const amt = Number(tx.amount || 0);
      const signed = tx.kind === "income" ? amt : -amt;
      const dk = normalizeIsoDate(tx.date) || tx.date;
      dailyTxnTotals.set(dk, (dailyTxnTotals.get(dk) || 0) + signed);
    }
  }
  if (includeExpected) {
    for (const tx of [...(state.monthExpectedItems || []), ...(state.calendarExtraExpectedItems || [])]) {
      const amt = Number(tx.amount || 0);
      const signed = tx.kind === "income" ? amt : -amt;
      const dk = normalizeIsoDate(tx.date) || tx.date;
      dailyTxnTotals.set(dk, (dailyTxnTotals.get(dk) || 0) + signed);
    }
  }

  let carry = 0;
  const rangeStartIso = toISODate(rangeStart);
  for (const account of state.accounts || []) {
    const startBal = Number(account.starting_balance || 0);
    const startDate = normalizeIsoDate(account.starting_balance_date) || account.starting_balance_date || monthStartIso;
    if (startDate < rangeStartIso) {
      carry += startBal;
    } else if (startAdds.has(startDate)) {
      startAdds.set(startDate, (startAdds.get(startDate) || 0) + startBal);
    }
  }

  for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
    const iso = toISODate(d);
    const dayStart = carry + (startAdds.get(iso) || 0);
    const txNet = dailyTxnTotals.get(iso) || 0;
    const dayEnd = dayStart + txNet;
    out.set(iso, { start: dayStart, txNet, end: dayEnd });
    carry = dayEnd;
  }

  return out;
}

function truncate(s, maxLen) {
  const str = String(s ?? "");
  if (str.length <= maxLen) return str;
  return str.slice(0, Math.max(0, maxLen - 1)) + "…";
}

const RISK_PRESSURE_TIP_SHOW_MS = 115;
let riskPressureTipEl = null;
let riskPressureTipShowTimer = null;
let riskPressureTipHideTimer = null;
let riskPressureTipScrollBound = false;

function hideRiskPressureTipNow() {
  if (riskPressureTipShowTimer) {
    clearTimeout(riskPressureTipShowTimer);
    riskPressureTipShowTimer = null;
  }
  if (riskPressureTipHideTimer) {
    clearTimeout(riskPressureTipHideTimer);
    riskPressureTipHideTimer = null;
  }
  if (riskPressureTipEl) {
    riskPressureTipEl.classList.remove("reports-risk-tip--visible");
    riskPressureTipEl.hidden = true;
    riskPressureTipEl.innerHTML = "";
  }
}

function ensureRiskPressureTipEl() {
  if (riskPressureTipEl && riskPressureTipEl.isConnected) return riskPressureTipEl;
  riskPressureTipEl = document.createElement("div");
  riskPressureTipEl.className = "reports-risk-tip";
  riskPressureTipEl.setAttribute("role", "tooltip");
  riskPressureTipEl.hidden = true;
  document.body.appendChild(riskPressureTipEl);
  if (!riskPressureTipScrollBound) {
    riskPressureTipScrollBound = true;
    window.addEventListener("scroll", hideRiskPressureTipNow, true);
    window.addEventListener("resize", hideRiskPressureTipNow);
  }
  return riskPressureTipEl;
}

function positionRiskPressureTip(anchorEl) {
  const tip = ensureRiskPressureTipEl();
  const rect = anchorEl.getBoundingClientRect();
  const gap = 8;
  const margin = 8;
  requestAnimationFrame(() => {
    let x = rect.left + rect.width / 2 - tip.offsetWidth / 2;
    let y = rect.bottom + gap;
    const maxX = window.innerWidth - tip.offsetWidth - margin;
    const maxY = window.innerHeight - tip.offsetHeight - margin;
    x = Math.max(margin, Math.min(x, maxX));
    if (y > maxY) y = Math.max(margin, rect.top - tip.offsetHeight - gap);
    y = Math.max(margin, Math.min(y, maxY));
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
  });
}

/** Rich hover detail for projected-balance tiles (risk / cash pressure calendar). */
function bindRiskPressureCellHover(cell, anchorEl, html) {
  const h = String(html ?? "").trim();
  if (!cell || !anchorEl || !h) return;

  const onEnter = () => {
    hideRiskPressureTipNow();
    if (riskPressureTipHideTimer) {
      clearTimeout(riskPressureTipHideTimer);
      riskPressureTipHideTimer = null;
    }
    riskPressureTipShowTimer = window.setTimeout(() => {
      riskPressureTipShowTimer = null;
      const tip = ensureRiskPressureTipEl();
      tip.innerHTML = h;
      tip.hidden = false;
      tip.classList.remove("reports-risk-tip--visible");
      positionRiskPressureTip(anchorEl);
      requestAnimationFrame(() => {
        positionRiskPressureTip(anchorEl);
        tip.classList.add("reports-risk-tip--visible");
      });
    }, RISK_PRESSURE_TIP_SHOW_MS);
  };
  const onLeave = () => {
    if (riskPressureTipShowTimer) {
      clearTimeout(riskPressureTipShowTimer);
      riskPressureTipShowTimer = null;
    }
    riskPressureTipHideTimer = window.setTimeout(() => {
      riskPressureTipHideTimer = null;
      hideRiskPressureTipNow();
    }, 55);
  };
  cell.addEventListener("mouseenter", onEnter);
  cell.addEventListener("mouseleave", onLeave);
  cell.addEventListener("blur", hideRiskPressureTipNow);
}

/** Faster than native `title` tooltips (browser delay is ~500ms+). */
const FAST_TXN_TIP_SHOW_MS = 100;
let fastTxnTipEl = null;
let fastTxnTipShowTimer = null;
let fastTxnTipHideTimer = null;
let fastTxnTipScrollBound = false;

function hideFastTxnTipNow() {
  if (fastTxnTipShowTimer) {
    clearTimeout(fastTxnTipShowTimer);
    fastTxnTipShowTimer = null;
  }
  if (fastTxnTipHideTimer) {
    clearTimeout(fastTxnTipHideTimer);
    fastTxnTipHideTimer = null;
  }
  if (fastTxnTipEl) {
    fastTxnTipEl.classList.remove("fast-txn-tip--visible");
    fastTxnTipEl.hidden = true;
    fastTxnTipEl.textContent = "";
  }
}

function ensureFastTxnTipEl() {
  if (fastTxnTipEl && fastTxnTipEl.isConnected) return fastTxnTipEl;
  fastTxnTipEl = document.createElement("div");
  fastTxnTipEl.className = "fast-txn-tip";
  fastTxnTipEl.setAttribute("role", "tooltip");
  fastTxnTipEl.hidden = true;
  document.body.appendChild(fastTxnTipEl);
  if (!fastTxnTipScrollBound) {
    fastTxnTipScrollBound = true;
    window.addEventListener("scroll", hideFastTxnTipNow, true);
    window.addEventListener("resize", hideFastTxnTipNow);
  }
  return fastTxnTipEl;
}

function positionFastTxnTip(anchorEl) {
  const tip = ensureFastTxnTipEl();
  const rect = anchorEl.getBoundingClientRect();
  const gap = 6;
  const margin = 8;
  let x = rect.left + rect.width / 2 - tip.offsetWidth / 2;
  let y = rect.bottom + gap;
  const maxX = window.innerWidth - tip.offsetWidth - margin;
  const maxY = window.innerHeight - tip.offsetHeight - margin;
  x = Math.max(margin, Math.min(x, maxX));
  if (y > maxY) y = Math.max(margin, rect.top - tip.offsetHeight - gap);
  y = Math.max(margin, Math.min(y, maxY));
  tip.style.left = `${Math.round(x)}px`;
  tip.style.top = `${Math.round(y)}px`;
}

/**
 * Show `text` in a floating tip after a short delay when hovering `anchorEl`.
 * Avoids native `title` delay; do not set `title` for the same text on this node.
 */
function bindFastTxnTipHover(anchorEl, text) {
  const t = String(text ?? "").trim();
  if (!anchorEl || !t) return;
  const onEnter = () => {
    if (fastTxnTipHideTimer) {
      clearTimeout(fastTxnTipHideTimer);
      fastTxnTipHideTimer = null;
    }
    if (fastTxnTipShowTimer) clearTimeout(fastTxnTipShowTimer);
    fastTxnTipShowTimer = window.setTimeout(() => {
      fastTxnTipShowTimer = null;
      const tip = ensureFastTxnTipEl();
      tip.textContent = t;
      tip.hidden = false;
      tip.classList.remove("fast-txn-tip--visible");
      positionFastTxnTip(anchorEl);
      requestAnimationFrame(() => {
        positionFastTxnTip(anchorEl);
        tip.classList.add("fast-txn-tip--visible");
      });
    }, FAST_TXN_TIP_SHOW_MS);
  };
  const onLeave = () => {
    if (fastTxnTipShowTimer) {
      clearTimeout(fastTxnTipShowTimer);
      fastTxnTipShowTimer = null;
    }
    fastTxnTipHideTimer = window.setTimeout(() => {
      fastTxnTipHideTimer = null;
      hideFastTxnTipNow();
    }, 50);
  };
  anchorEl.addEventListener("mouseenter", onEnter);
  anchorEl.addEventListener("mouseleave", onLeave);
}

function leafCategoryName(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  // Some category labels come through as "Group • Category".
  const parts = s.split("•").map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : s;
}

/** Category label for display when API `category` string may be missing but `category_id` is set. */
function effectiveTransactionCategoryName(tx) {
  if (!tx || typeof tx !== "object") return "";
  const raw = tx.category != null ? String(tx.category).trim() : "";
  if (raw && raw.toLowerCase() !== "none") return leafCategoryName(raw);
  const cid = tx.category_id != null ? Number(tx.category_id) : NaN;
  if (!Number.isFinite(cid)) return "";
  const c = (state.categories || []).find((x) => Number(x.id) === cid);
  const name = c?.name != null ? String(c.name).trim() : "";
  if (!name || name.toLowerCase() === "none") return "";
  return leafCategoryName(name);
}

/** Primary line for lists: description, else category, else notes snippet, else placeholder. */
function actualTransactionPrimaryLabel(tx) {
  const desc = String(tx?.description ?? "").trim();
  if (desc) return desc;
  const cat = effectiveTransactionCategoryName(tx || {});
  if (cat) return cat;
  const n = tx?.notes != null ? String(tx.notes).trim() : "";
  if (n) return truncate(n, 72);
  return "(no description)";
}

/** Forecast / expected row label (calendar + Needs review): category when set, else description. */
function forecastTransactionPrimaryLabel(tx) {
  const cat = effectiveTransactionCategoryName(tx || {});
  if (cat) return cat;
  const desc = String(tx?.description ?? "").trim();
  if (desc) return desc;
  return "Uncategorized";
}

function renderVariableTodosForMonth() {
  if (!variableTodoList) return;
  const items = state.monthExpectedItems || [];
  variableTodoList.innerHTML = "";
  const variableItems = items.filter((it) => !!it && !!it.variable);
  if (variableItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No variable items this month.";
    variableTodoList.appendChild(empty);
    return;
  }

  variableItems.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  for (const it of variableItems) {
    const el = document.createElement("div");
    el.className = "item expected-item--dense expected-item--variable";
    el.style.cursor = "pointer";

    const left = document.createElement("div");
    left.className = "left";

    const descEl = document.createElement("div");
    descEl.className = `desc ${kindFgClass(it.kind)}`;
    descEl.textContent = truncate(it.description || "(expected)", 32);

    const metaEl = document.createElement("div");
    metaEl.className = "meta";
    metaEl.textContent = it.date ? fmtDateMDY(it.date) : "—";

    left.appendChild(descEl);
    left.appendChild(metaEl);

    const amtBtn = document.createElement("button");
    amtBtn.type = "button";
    amtBtn.className = `amt ${it.kind === "income" ? "income" : "expense"} expected-amt-link`;
    amtBtn.textContent = `$${fmtMoney(it.amount)}`;

    el.appendChild(left);
    el.appendChild(amtBtn);
    bindFastTxnTipHover(el, "Review / edit this recurring occurrence");

    el.addEventListener("click", () => {
      const meta = getExpectedSeriesMeta(it.expected_transaction_id);
      if (meta) openExpectedEditModal(meta, { calendarItem: it });
    });

    variableTodoList.appendChild(el);
  }
}

function getExpectedSeriesMeta(expectedId) {
  return (state.expectedTransactions || []).find((t) => Number(t.id) === Number(expectedId));
}

/** Description for recurring save payloads (label field removed from modal). */
function expectedSaveDescription() {
  const inst = selectedExpectedInstance;
  if (inst && inst.description != null && String(inst.description).trim() !== "") {
    return String(inst.description).trim().slice(0, 500);
  }
  const meta =
    selectedExpectedSeriesTx ||
    (inst && getExpectedSeriesMeta(inst.expected_transaction_id)) ||
    getExpectedSeriesMeta(Number(expectedEditId?.value || 0));
  return String(meta?.description || "").trim().slice(0, 500);
}

function dateISOFromParts(year, monthIndex0Based, day) {
  const y = year;
  const m = String(monthIndex0Based + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function selectExpectedInstance(item) {
  const occ = item.occurrence_date ? normalizeIsoDate(item.occurrence_date) : normalizeIsoDate(item.date);
  selectedExpectedInstance = {
    expected_transaction_id: item.expected_transaction_id,
    occurrence_date: occ || item.date,
    description: item.description != null ? String(item.description) : "",
  };

  if (txEditDate) {
    txEditDate.readOnly = false;
    txEditDate.disabled = false;
    selectedExpectedMovedToDate = normalizeIsoDate(item.date) || item.date;
    txEditDate.value = selectedExpectedMovedToDate;
    applyMinDateToTxEditDateInput();
  }
  if (instanceExpectedTxId) instanceExpectedTxId.value = String(item.expected_transaction_id);
  {
    const k = item && item.kind ? String(item.kind) : "expense";
    const radio = document.querySelector(`input[type="radio"][name="txEditKind"][value="${k}"]`);
    if (radio) radio.checked = true;
  }
  if (txEditAmount) txEditAmount.value = Number(item.amount);
  if (txEditNotes) txEditNotes.value = item.notes && String(item.notes).trim() ? String(item.notes).trim() : "";
  if (instanceAccountId) instanceAccountId.value = String(item.account_id);
  setCategoryFieldValue("txEditCategoryId", item.category_id);
  {
    const bg = item && item.bg_color ? String(item.bg_color).trim() : "";
    if (bg) txEditSelectedBgColor = bg;
  }
  refreshTxCategoryColorPickers();

  {
    const meta = selectedExpectedSeriesTx || getExpectedSeriesMeta(item.expected_transaction_id);
    if (meta) {
      if (instanceRecurrence) instanceRecurrence.value = String(meta.recurrence || "monthly");
      if (instanceSecondDayOfMonth) {
        const rec = String(meta.recurrence || "monthly");
        if (rec === "semiannual") {
          setSecondOccurrenceInput(
            instanceSecondDayOfMonth,
            meta.second_occurrence_month,
            meta.second_day_of_month,
            meta.start_date || instanceExpectedTxId?.value || ""
          );
        } else {
          setSecondDayOfMonthInput(
            instanceSecondDayOfMonth,
            meta.second_day_of_month,
            meta.start_date || instanceExpectedTxId?.value || ""
          );
        }
      }
      updateInstanceTwiceMonthlyVisibility();
    }
  }

  show(txEditErr, "");
}

function renderCalendar() {
  if (!calendarGrid) return;
  calendarGrid.innerHTML = "";
  const calendarDow = document.getElementById("calendarDow");
  if (calendarDow) calendarDow.innerHTML = "";
  const isMobileCalendarLayout =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 768px)").matches
      : false;
  if (calendarDow) calendarDow.hidden = isMobileCalendarLayout;

  const month = getCalendarViewYm();
  const parts = String(month).split("-");
  const year = Number(parts[0]);
  const monthIndex = Number(parts[1]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return;

  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const offset = first.getDay(); // Sunday=0

  const mode = calendarMode?.value || "both";
  // Never hide actual transactions; users can still toggle expected overlays.
  const showActual = true;
  const showExpected = mode === "both" || mode === "expected";
  // "Transactions" vs "Balance Only" toggle (detailed vs simplified).
  const showDetails = state.calendarDetailMode === "detailed";
  const earliestStartIso = getFamilyEarliestStartingBalanceIso();

  const actualTxsByDate = new Map();
  for (const tx of [...(state.monthActualItems || []), ...(state.calendarExtraActualItems || [])]) {
    const dk = normalizeIsoDate(tx.date) || tx.date;
    if (!actualTxsByDate.has(dk)) actualTxsByDate.set(dk, []);
    actualTxsByDate.get(dk).push(tx);
  }

  const expectedByDate = new Map(); // iso -> [items]
  for (const item of [...(state.monthExpectedItems || []), ...(state.calendarExtraExpectedItems || [])]) {
    const key = normalizeIsoDate(item.date) || item.date;
    if (!expectedByDate.has(key)) expectedByDate.set(key, []);
    expectedByDate.get(key).push(item);
  }

  // Starting balances affect the running balance, but aren't "transactions".
  // Surface them explicitly so users don't see unexplained balance jumps.
  const startBalancesByDate = new Map(); // iso -> [items]
  for (const account of state.accounts || []) {
    const startBal = Number(account.starting_balance || 0);
    if (!Number.isFinite(startBal) || startBal === 0) continue;
    const startDate =
      normalizeIsoDate(account.starting_balance_date) ||
      account.starting_balance_date ||
      null;
    if (!startDate) continue;
    const row = {
      _type: "start_balance",
      account_id: account.id,
      account_name: account.name || "",
      kind: "income",
      amount: Math.abs(startBal),
      description: "Starting Balance",
      notes: "",
      category_id: null,
      bg_color: null,
      fg_color: null,
      id: `start-balance-${String(account.id || "")}-${startDate}`,
    };
    if (!startBalancesByDate.has(startDate)) startBalancesByDate.set(startDate, []);
    startBalancesByDate.get(startDate).push(row);
  }

  function txSortKeyKindFirst(tx) {
    // income (positive) first, then expense (negative)
    return String(tx.kind) === "income" ? 0 : 1;
  }

  function txSortAmountDesc(a, b) {
    const ak = txSortKeyKindFirst(a);
    const bk = txSortKeyKindFirst(b);
    if (ak !== bk) return ak - bk;
    const aa = Number(a.amount ?? 0);
    const ba = Number(b.amount ?? 0);
    if (ba !== aa) return ba - aa;
    // Prefer actual over expected when otherwise equal.
    const at = a && a._type === "expected" ? 1 : 0;
    const bt = b && b._type === "expected" ? 1 : 0;
    if (at !== bt) return at - bt;
    // stable-ish fallback for consistent ordering
    const ad = String((a.category || a.description) || "");
    const bd = String((b.category || b.description) || "");
    const dc = ad.localeCompare(bd);
    if (dc !== 0) return dc;
    const aid = Number(a.id ?? 0);
    const bid = Number(b.id ?? 0);
    return aid - bid;
  }

  function txSortCalendarDayImpact(a, b) {
    const aSb = a && a._type === "start_balance" ? 0 : 1;
    const bSb = b && b._type === "start_balance" ? 0 : 1;
    if (aSb !== bSb) return aSb - bSb;
    const aa = Math.abs(Number(a.amount ?? 0));
    const ba = Math.abs(Number(b.amount ?? 0));
    if (ba !== aa) return ba - aa;
    return txSortAmountDesc(a, b);
  }

  /** Larger score = show first when the day is collapsed (income + large expenses beat transfers). */
  function calendarTxnPriority(row) {
    if (row && row._type === "start_balance") return 1e12;
    const amt = Math.abs(Number(row.amount ?? 0));
    const isInc = String(row.kind) === "income";
    const isExpected = row && row._type === "expected";
    let cat = "";
    try {
      cat = String(effectiveTransactionCategoryName(row) || "").toLowerCase();
    } catch (_) {
      cat = "";
    }
    const desc = String(row.description || "").toLowerCase();
    const isXfer =
      cat.includes("transfer") ||
      cat.includes("xfer") ||
      desc.includes("transfer") ||
      desc.includes("xfer") ||
      /\bxfr\b/.test(desc);
    let p = amt;
    if (isInc) p += 250000;
    else p += 80000;
    if (!isInc && amt >= 1500) p += 40000;
    if (isExpected) p *= 0.82;
    if (isXfer) p *= 0.28;
    return p;
  }

  // Sort transactions within each day.
  for (const arr of actualTxsByDate.values()) {
    arr.sort(txSortAmountDesc);
  }
  for (const arr of expectedByDate.values()) {
    arr.sort(txSortAmountDesc);
  }
  for (const arr of startBalancesByDate.values()) {
    arr.sort(txSortAmountDesc);
  }

  // Forecast storytelling cues (lightweight, single label per day).
  let monthLowPointIso = null;
  let monthLowPointBal = null;
  try {
    const monthStartIso = `${String(year)}-${String(monthIndex + 1).padStart(2, "0")}-01`;
    const monthEndIso = `${String(year)}-${String(monthIndex + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
    for (const [iso, bal] of state.monthDailyBalances.entries()) {
      if (!iso || iso < monthStartIso || iso > monthEndIso) continue;
      const endNum = Number(bal?.end ?? NaN);
      if (!Number.isFinite(endNum)) continue;
      if (monthLowPointBal == null || endNum < monthLowPointBal) {
        monthLowPointBal = endNum;
        monthLowPointIso = iso;
      }
    }
  } catch (_) {}

  let monthRecoveryIso = null;
  try {
    if (monthLowPointIso && monthLowPointBal != null) {
      const target = Number(monthLowPointBal) + Math.max(100, Math.abs(Number(monthLowPointBal)) * 0.25);
      for (let day = 1; day <= daysInMonth; day++) {
        const iso = toISODate(new Date(year, monthIndex, day));
        if (iso <= monthLowPointIso) continue;
        const bal = state.monthDailyBalances.get(iso);
        const endNum = Number(bal?.end ?? NaN);
        if (Number.isFinite(endNum) && endNum >= target) {
          monthRecoveryIso = iso;
          break;
        }
      }
    }
  } catch (_) {}

  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const wrapper = document.createElement("div");
  wrapper.className = isMobileCalendarLayout ? "calendar calendar--mobile" : "calendar";

  if (calendarDow && !isMobileCalendarLayout) {
    for (const label of dow) {
      const el = document.createElement("div");
      el.className = "cal-dow";
      el.textContent = label;
      calendarDow.appendChild(el);
    }
  }

  // Render only the weeks needed for this month.
  // If the 6th row would be entirely out-of-month, drop it (cap at 5 rows).
  let weekRows = Math.ceil((offset + daysInMonth) / 7); // 4–6
  let totalCells = weekRows * 7;
  if (totalCells === 42) {
    let lastRowHasInMonth = false;
    for (let i = 35; i < 42; i++) {
      const dayNum = i - offset + 1;
      if (dayNum >= 1 && dayNum <= daysInMonth) {
        lastRowHasInMonth = true;
        break;
      }
    }
    if (!lastRowHasInMonth) {
      weekRows = 5;
      totalCells = 35;
    }
  }
  const MIN_CELL_H = isMobileCalendarLayout ? 0 : 162;
  const MAX_VISIBLE_TXNS = 3;
  const minBalFloor = readUserConfiguredMinBalanceThreshold();
  /** @type {HTMLElement[]} */
  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement("div");
    cell.className = "cal-cell";

    const dayNum = i - offset + 1;
    const isOutOfMonth = dayNum < 1 || dayNum > daysInMonth;
    const dObj = new Date(year, monthIndex, dayNum);
    const iso = toISODate(dObj);
    const isBeforeStart = !!(earliestStartIso && iso < earliestStartIso);
    cell.dataset.iso = iso;
    if (isBeforeStart) {
      cell.classList.add("cal-cell--before-start");
      cell.setAttribute("title", "Before your starting balance date");
    }
    const todayIso = toISODate(new Date());
    const isToday = iso === todayIso;
    const isPast = iso < todayIso;
    const isReconciled = state.reconciledDates && state.reconciledDates.has(iso);
    cell.innerHTML = `
      <div class="cal-daynum">${isReconciled ? `
        <span class="cal-reconciled-mark" title="Reconciled" aria-label="Reconciled">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.65"></circle>
            <path d="M8 12.5l2.6 2.6L16.5 9.2" fill="none" stroke="currentColor" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </span>` : ""}<span class="cal-daynum-num${isToday ? " is-today" : ""}">${dObj.getDate()}</span></div>
      <div class="cal-cell-fill"></div>
      <div class="cal-cell-stack">
        <div class="cal-forecast-note" hidden></div>
        <div class="cal-day-start-balance" hidden></div>
        <div class="cal-day-txns"></div>
        <div class="cal-ledger-metrics"></div>
      </div>
    `;
    if (isOutOfMonth) cell.classList.add("cal-cell--out");
    if (isReconciled && !isOutOfMonth) cell.classList.add("cal-cell--reconciled");
    // In-month "past" gray only when we have no starting-balance date; otherwise only
    // cal-cell--before-start tints days before the anchor (days on/after stay white).
    if (!isOutOfMonth && isPast && !earliestStartIso) cell.classList.add("cal-cell--past");
    const txnsEl = cell.querySelector(".cal-day-txns");
    const startBalEl = cell.querySelector(".cal-day-start-balance");
    const metricsEl = cell.querySelector(".cal-ledger-metrics");
    const noteEl = cell.querySelector(".cal-forecast-note");

    const dayNumEl = cell.querySelector(".cal-daynum");
    if (dayNumEl) {
      dayNumEl.dataset.mobileLabel = dObj.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      if (!isBeforeStart && !isOutOfMonth) {
        const reconcileBtn = document.createElement("button");
        reconcileBtn.type = "button";
        reconcileBtn.className = "cal-day-reconcile-btn";
        reconcileBtn.title = "Reconcile this day";
        reconcileBtn.setAttribute("aria-label", `Reconcile forecast for ${fmtDateMDY(iso)}`);
        reconcileBtn.innerHTML =
          '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.25"></circle><path d="M8.5 12.2l2.2 2.2 4.8-5.1"></path></svg>';
        reconcileBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          openReconcileModal(iso);
        });
        dayNumEl.insertBefore(reconcileBtn, dayNumEl.firstChild);
      }
    }

    const actualTxs = !isBeforeStart && showActual ? actualTxsByDate.get(iso) || [] : [];
    const expectedItems = !isBeforeStart && showExpected ? expectedByDate.get(iso) || [] : [];
    const stabilizingDay =
      isReconciled &&
      dayHasPaycheckLikeIncome([
        ...actualTxs.map((tx) => ({ ...tx, _type: "actual" })),
        ...expectedItems.map((tx) => ({ ...tx, _type: "expected" })),
      ]);

    // Combine and sort expected + actual for consistent ordering per-day.
    const combined = [];
    if (showDetails) {
      for (const item of expectedItems) combined.push({ ...item, _type: "expected" });
      for (const tx of actualTxs) combined.push({ ...tx, _type: "actual" });
      combined.sort((a, b) => {
        const pa = calendarTxnPriority(a);
        const pb = calendarTxnPriority(b);
        if (pb !== pa) return pb - pa;
        return txSortCalendarDayImpact(a, b);
      });
    }

    let visibleItemCount = 0;
    if (showDetails) {
      const startBalRows = !isBeforeStart ? startBalancesByDate.get(iso) || [] : [];
      visibleItemCount = combined.length + startBalRows.length;
      const labelMaxLen = visibleItemCount <= 1 ? 68 : visibleItemCount >= 4 ? 50 : 58;
      if (startBalEl) {
        startBalEl.hidden = startBalRows.length === 0;
        for (const sbRow of startBalRows) appendCalendarDayStartBalanceLine(sbRow, startBalEl, iso);
      }

      const isExpanded = !!(state.calendarExpandedDays && state.calendarExpandedDays.has(iso));
      const visibleRows = isExpanded ? combined : combined.slice(0, MAX_VISIBLE_TXNS);
      const hiddenCount = Math.max(0, combined.length - visibleRows.length);

      // Render a compact, forecast-first list. Expand only on demand.
      const dayLineEntries = [];
      for (let vri = 0; vri < visibleRows.length; vri++) {
        const row = visibleRows[vri];
        const isExpected = row._type === "expected";
        const line = document.createElement("div");
        line.className = isExpected
          ? "cal-day-tx-line cal-day-tx-line--expected"
          : "cal-day-tx-line cal-tx-part";
        if (isExpanded) {
          if (vri === 0) line.classList.add("cal-day-tx-line--primary");
          else if (vri === 1) line.classList.add("cal-day-tx-line--secondary");
          else if (vri >= 2) line.classList.add("cal-day-tx-line--deemph");
        } else {
          if (vri === 0) line.classList.add("cal-day-tx-line--primary");
          else if (vri === 1) line.classList.add("cal-day-tx-line--secondary");
        }
        for (const p of calendarDayTxLineToneParts(row)) line.classList.add(p);
        for (const p of calendarDayTxSemanticParts(row)) line.classList.add(p);
        if (isExpected && row.variable) line.classList.add("cal-expected-variable");
        if (!isExpected) {
          const txId = Number(row.id);
          if (Number.isFinite(txId) && txId > 0) line.dataset.txId = String(txId);
        }
        if (isExpected) {
          const eid = Number(row.expected_transaction_id);
          if (Number.isFinite(eid) && eid > 0) line.dataset.expectedId = String(eid);
          line.dataset.occurrenceDate =
            normalizeIsoDate(row.occurrence_date || row.date) || normalizeIsoDate(iso) || iso;
        }
        // Match list UIs: prefer category (from API string or category_id → state.categories).
        // Forecast rows used to always show description (e.g. "ComEd") even when category was "Gas".
        const descRaw = isExpected ? row.description || "(expected)" : (row.description || "Uncategorized").trim();
        const labelRaw = isExpected ? forecastTransactionPrimaryLabel(row) : effectiveTransactionCategoryName(row) || descRaw;
        // Keep labels short so they don't wrap into the amount column.
        const label = truncate(labelRaw, labelMaxLen);

        const labelSpan = document.createElement("span");
        labelSpan.className = "cal-tx-label";
        labelSpan.textContent = `${label} `;

        const labelWrap = document.createElement("span");
        labelWrap.className = "cal-tx-label-wrap";
        labelWrap.appendChild(labelSpan);

        const amtSpan = document.createElement("span");
        amtSpan.className = "cal-amt";
        {
          const k = String(row.kind || "").toLowerCase();
          if (k === "income") amtSpan.classList.add("income");
          else if (k === "expense") amtSpan.classList.add("expense");
        }
        amtSpan.textContent = `$${fmtMoney(row.amount)}`;

        line.appendChild(labelWrap);
        line.appendChild(amtSpan);
        line.title = String(labelRaw || "").trim();

        {
          const noteStr = row.notes && String(row.notes).trim() ? String(row.notes).trim() : "";
          if (noteStr) bindFastTxnTipHover(line, noteStr);
        }

        if (isExpected) {
          line.addEventListener("click", (e) => {
            e.stopPropagation();
            void openCalendarExpectedFromLine(line);
          });
        } else {
          const txId = Number(row.id);
          if (Number.isFinite(txId) && txId > 0) {
            line.addEventListener("click", (e) => {
              e.stopPropagation();
              const tx = findActualTransactionById(txId);
              if (tx) openTxEditModal(tx);
              else void openCalendarActualTransactionById(txId);
            });
          }
        }

        dayLineEntries.push({ line, labelWrap, row });
      }
      for (const { line } of dayLineEntries) txnsEl.appendChild(line);
      for (const { labelWrap, row } of dayLineEntries) {
        applyCalendarDayTxCategoryFill(labelWrap, row);
      }

      if (combined.length > MAX_VISIBLE_TXNS && txnsEl) {
        const moreBtn = document.createElement("button");
        moreBtn.type = "button";
        moreBtn.className = `cal-day-more${isExpanded ? " is-expanded" : ""}`;
        moreBtn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
        moreBtn.title = isExpanded
          ? "Show fewer transactions"
          : `Show ${hiddenCount} more transaction${hiddenCount === 1 ? "" : "s"}`;
        moreBtn.textContent = isExpanded ? "Show less" : `+${hiddenCount} more`;
        moreBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!state.calendarExpandedDays) state.calendarExpandedDays = new Set();
          if (state.calendarExpandedDays.has(iso)) state.calendarExpandedDays.delete(iso);
          else state.calendarExpandedDays.add(iso);
          renderCalendar();
        });
        txnsEl.appendChild(moreBtn);
      }

      if (combined.length > MAX_VISIBLE_TXNS && !isExpanded) {
        cell.classList.add("cal-cell--has-collapsed-rows");
      }
    }

    if (isBeforeStart || !showDetails || combined.length === 0) {
      cell.classList.add("cal-cell--no-tx");
    }

    if (isToday && !isOutOfMonth && !isBeforeStart) cell.classList.add("cal-cell--today");
    if (!isBeforeStart && !isOutOfMonth && dayHasPaycheckLikeIncome(combined)) {
      cell.classList.add("cal-cell--payday");
    }
    if (visibleItemCount > 0) cell.classList.add("cal-cell--has-activity");
    applyCalendarCellDensity(cell, visibleItemCount);

    if (iso === monthRecoveryIso && !isOutOfMonth && !cell.classList.contains("cal-cell--before-start")) {
      cell.classList.add("cal-cell--recovery-milestone");
    }

    const dayBal = state.monthDailyBalances.get(iso);

    if (!isBeforeStart && dayBal && metricsEl) {
      const endNum = Number(dayBal.end ?? 0);
      const txNetNum = Number(dayBal.tx_net);
      const balParts = ["cal-stat", "cal-balance"];
      const hasFloor = minBalFloor != null && Number.isFinite(minBalFloor) && minBalFloor > 0;
      const prevEndNum = Number(state.monthDailyBalances.get(isoAddDays(iso, -1))?.end);
      const repeatedNegativeRun =
        !isOutOfMonth &&
        !isPast &&
        Number.isFinite(endNum) &&
        endNum < 0 &&
        Number.isFinite(prevEndNum) &&
        Math.abs(prevEndNum - endNum) < 0.005 &&
        Number.isFinite(txNetNum) &&
        Math.abs(txNetNum) < 0.005;
      if (Number.isFinite(endNum)) {
        if (isPast && !isOutOfMonth) {
          balParts.push("cal-balance--quiet", "cal-balance--past-day");
        } else if (endNum < 0) {
          balParts.push("is-negative", "cal-balance--risk");
          if (repeatedNegativeRun) balParts.push("cal-balance--repeated");
        } else if (isOutOfMonth) {
          balParts.push("is-muted");
        } else {
          if (hasFloor && endNum < minBalFloor) {
            balParts.push("cal-balance--below-floor");
          } else if (hasFloor && endNum < minBalFloor * 1.25) {
            balParts.push("cal-balance--watch-zone");
          } else if (monthLowPointIso === iso) {
            balParts.push("cal-balance--month-low-mark");
          } else {
            balParts.push("cal-balance--quiet");
          }
        }
      }
      const pastBalTone = isPast && !isOutOfMonth;
      const belowFloor =
        !pastBalTone && hasFloor && Number.isFinite(endNum) && endNum >= 0 && endNum < minBalFloor;
      const negativeBal = !pastBalTone && Number.isFinite(endNum) && endNum < 0;
      const watchOnly =
        !pastBalTone &&
        hasFloor &&
        Number.isFinite(endNum) &&
        endNum >= minBalFloor &&
        endNum < minBalFloor * 1.25;
      if (
        !pastBalTone &&
        iso === monthRecoveryIso &&
        !isOutOfMonth &&
        Number.isFinite(endNum) &&
        endNum >= 0 &&
        !negativeBal &&
        !(hasFloor && endNum < minBalFloor * 1.25)
      ) {
        balParts.push("cal-balance--recovery-milestone");
      } else if (
        !pastBalTone &&
        stabilizingDay &&
        !isOutOfMonth &&
        Number.isFinite(endNum) &&
        endNum >= 0 &&
        !negativeBal &&
        !belowFloor
      ) {
        balParts.push("cal-balance--stabilizing");
      } else if (
        !pastBalTone &&
        !isOutOfMonth &&
        !negativeBal &&
        !belowFloor &&
        !watchOnly &&
        Number.isFinite(txNetNum) &&
        txNetNum >= 3200
      ) {
        balParts.push("cal-balance--strong-inflow");
      }

      let stripCue = "";
      if (negativeBal) stripCue = "cal-balance-strip--cue-risk";
      else if (belowFloor) stripCue = "cal-balance-strip--cue-warn";
      else if (watchOnly) stripCue = "cal-balance-strip--cue-watch";

      const balanceClass = balParts.join(" ");
      const riskIcon =
        negativeBal && !repeatedNegativeRun
          ? `<span class="cal-balance-risk-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 2.25L14 13.75H2L8 2.25z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" fill="none"/><path d="M8 6.25v3M8 11.1v.01" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/></svg></span>`
          : "";
      const warnIcon =
        belowFloor && !negativeBal
          ? `<span class="cal-balance-warn-icon" aria-hidden="true" title="Below your minimum balance"><svg viewBox="0 0 16 16" width="9" height="9" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 2.25L14 13.75H2L8 2.25z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/><path d="M8 6.25v3M8 11.1v.01" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></span>`
          : "";
      metricsEl.innerHTML = `<div class="cal-balance-strip${stripCue ? ` ${stripCue}` : ""}"><div class="cal-balance-strip__row"><span class="cal-balance-strip__amt">${riskIcon}${warnIcon}<span class="${balanceClass}" title="Projected end-of-day balance">$${fmtMoneyParens(
        endNum
      )}</span></span></div></div>`;
    }

    if (
      minBalFloor != null &&
      Number.isFinite(minBalFloor) &&
      minBalFloor > 0 &&
      dayBal &&
      !isPast &&
      !isOutOfMonth &&
      !cell.classList.contains("cal-cell--before-start")
    ) {
      const endNum = Number(dayBal.end ?? 0);
      if (Number.isFinite(endNum)) {
        if (endNum < 0) cell.classList.add("cal-cell--bal-risk");
        else if (endNum < minBalFloor) cell.classList.add("cal-cell--bal-warn");
        else if (endNum < minBalFloor * 1.25) cell.classList.add("cal-cell--bal-watch");
      }
    }
    // Hide forecast "storytelling" annotations (ex: "Low point", "Balance recovers") — keep the calendar clean.
    if (noteEl) {
      noteEl.textContent = "";
      noteEl.hidden = true;
      noteEl.classList.remove("is-danger", "is-ok");
    }

    bindCalendarCellAddTxClick(cell, iso);
    wrapper.appendChild(cell);
    cells.push(cell);
  }

  calendarGrid.appendChild(wrapper);
  bindCalendarPanelClickRouting();

  // Expand each week row to fit all transactions, keeping all 7 days the same height.
  try {
    if (isMobileCalendarLayout) {
      for (const c of cells) {
        if (!c) continue;
        c.style.height = "auto";
      }
    } else if (showDetails) {
      for (let w = 0; w < weekRows; w++) {
        const start = w * 7;
        const end = Math.min(start + 7, cells.length);
        let maxH = MIN_CELL_H;
        for (let j = start; j < end; j++) {
          const c = cells[j];
          if (!c) continue;
          maxH = Math.max(maxH, c.scrollHeight);
        }
        for (let j = start; j < end; j++) {
          const c = cells[j];
          if (!c) continue;
          c.style.height = `${maxH}px`;
        }
      }
    } else {
      for (const c of cells) {
        if (!c) continue;
        c.style.height = `${MIN_CELL_H}px`;
      }
    }
  } catch (_) {}

  const calendarPanel = document.getElementById("calendarPanel");
  if (calendarPanel) {
    calendarPanel.style.setProperty("--cal-week-rows", String(weekRows));
    // Keep day boxes tall enough for balance strip + top forecast rows.
    const h = `${MIN_CELL_H}px`;
    calendarPanel.style.setProperty("--cal-day-min-h", h);
  }

  finalizeAllCalendarDayLabelColumnWidths();
}

function readStoredMinBalanceThresholdForReports() {
  const userFloor = readUserConfiguredMinBalanceThreshold();
  if (userFloor != null) return userFloor;
  const suggested = computeSuggestedMinBalanceThreshold();
  return suggested.ok ? suggested.value : null;
}

function weekKeyMondayFromIso(iso) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return toISODate(d);
}

/** Drop demo / edge weeks with no categorized cashflow so sparse columns disappear. */
function filterIncomeExpenseWeeksWithoutActivity(agg) {
  if (!agg || !Array.isArray(agg.weeks)) return agg;
  const inc = agg.income || [];
  const exp = agg.expense || [];
  const nw = [];
  const ni = [];
  const ne = [];
  for (let i = 0; i < agg.weeks.length; i++) {
    const a = Number(inc[i] || 0);
    const b = Number(exp[i] || 0);
    if (a === 0 && b === 0) continue;
    nw.push(agg.weeks[i]);
    ni.push(a);
    ne.push(b);
  }
  return { ...agg, weeks: nw, income: ni, expense: ne };
}

let incomeExpenseChartPluginsRegistered = false;
function ensureIncomeExpenseChartPlugins() {
  if (typeof Chart === "undefined" || incomeExpenseChartPluginsRegistered) return;
  incomeExpenseChartPluginsRegistered = true;
  Chart.register({
    id: "incomeExpenseWeekHighlight",
    beforeDatasetsDraw(chart) {
      const hi = chart.options?.plugins?.incomeExpenseHighlight;
      const ix =
        hi && Number.isFinite(Number(hi.highlightIndex)) ? Number(hi.highlightIndex) : -1;
      if (ix < 0) return;
      const dsInc = chart.data.datasets.findIndex((d) => d && d.label === "Income");
      const dsExp = chart.data.datasets.findIndex((d) => d && d.label === "Expense");
      let el =
        dsInc >= 0 ? chart.getDatasetMeta(dsInc)?.data?.[ix] : null;
      if (!el || el.skip) {
        el = dsExp >= 0 ? chart.getDatasetMeta(dsExp)?.data?.[ix] : null;
      }
      if (!el || el.hidden || el.skip) return;
      const { x, width } = el.getProps(["x", "width"], true);
      if (x == null || !width) return;
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const pad = 5;
      const left = Math.max(chartArea.left, x - width / 2 - pad);
      const right = Math.min(chartArea.right, x + width / 2 + pad);
      ctx.save();
      const g = ctx.createLinearGradient(left, chartArea.top, left, chartArea.bottom);
      g.addColorStop(0, "rgba(254, 202, 202, 0.14)");
      g.addColorStop(0.42, "rgba(252, 165, 165, 0.2)");
      g.addColorStop(1, "rgba(254, 226, 226, 0.12)");
      ctx.fillStyle = g;
      ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
      ctx.restore();
    },
    afterDatasetsDraw(chart) {
      const div = chart.options?.plugins?.incomeExpenseDivider;
      if (!div?.stacked) return;
      const iIdx = chart.data.datasets.findIndex((d) => d && d.label === "Income");
      if (iIdx < 0) return;
      const meta = chart.getDatasetMeta(iIdx);
      const { ctx } = chart;
      if (!meta?.data?.length) return;
      ctx.save();
      for (const bar of meta.data) {
        if (!bar || bar.hidden || bar.skip) continue;
        const { x, y, width } = bar.getProps(["x", "y", "width"], true);
        if (x == null || y == null || !width) continue;
        ctx.beginPath();
        ctx.strokeStyle = "rgba(15, 23, 42, 0.34)";
        ctx.lineWidth = 1.65;
        ctx.moveTo(x - width / 2, y);
        ctx.lineTo(x + width / 2, y);
        ctx.stroke();
      }
      ctx.restore();
    },
  });
}

/** YYYY-MM strings for each calendar month touched by an inclusive ISO date range. */
function monthsOverlappingIsoRange(startIso, endIso) {
  const out = [];
  if (!startIso || !endIso || endIso < startIso) return out;
  const sp = String(startIso).split("-").map(Number);
  const ep = String(endIso).split("-").map(Number);
  let y = sp[0];
  let m = sp[1];
  const endY = ep[0];
  const endM = ep[1];
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(endY) || !Number.isFinite(endM)) return out;
  for (let guard = 0; guard < 500; guard++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (y === endY && m === endM) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Posted + forecast rows for the income vs expense report (respects calendar Show mode). */
async function fetchIncomeExpenseReportItems(startIso, endIso) {
  const mode = calendarMode?.value || "both";
  const includeActual = mode === "both" || mode === "actual";
  const includeExpected = mode === "both" || mode === "expected";
  /** @type {Array<{date:string,kind:string,amount:number}>} */
  const items = [];

  if (includeActual) {
    const r = await api(
      `/api/families/${state.activeFamilyId}/transactions?start_date=${encodeURIComponent(startIso)}&end_date=${encodeURIComponent(endIso)}`,
      "GET"
    );
    for (const it of r?.items || []) {
      const iso = normalizeIsoDate(it?.date) || (it?.date ? String(it.date).slice(0, 10) : "");
      if (!iso || iso < startIso || iso > endIso) continue;
      items.push({
        date: iso,
        kind: String(it.kind || ""),
        amount: Number(it.amount || 0),
      });
    }
  }

  if (includeExpected) {
    const months = monthsOverlappingIsoRange(startIso, endIso);
    const results = await Promise.all(
      months.map((month) =>
        api(`/api/families/${state.activeFamilyId}/expected-calendar?month=${encodeURIComponent(month)}`, "GET")
      )
    );
    for (const data of results) {
      for (const it of data?.items || []) {
        const iso = normalizeIsoDate(it?.date) || "";
        if (!iso || iso < startIso || iso > endIso) continue;
        items.push({
          date: iso,
          kind: String(it.kind || ""),
          amount: Number(it.amount || 0),
        });
      }
    }
  }

  return items;
}

function aggregateIncomeExpenseByWeek(items) {
  /** @type {Map<string,{income:number,expense:number}>} */
  const byWeek = new Map();
  for (const it of items || []) {
    const iso = it && it.date ? String(it.date) : "";
    if (!iso || iso.length < 10) continue;
    const wk = weekKeyMondayFromIso(iso);
    if (!wk) continue;
    const kind = String(it.kind || "").toLowerCase();
    const amt = Number(it.amount || 0);
    if (!Number.isFinite(amt)) continue;
    const row = byWeek.get(wk) || { income: 0, expense: 0 };
    if (kind === "income") row.income += amt;
    else if (kind === "expense") row.expense += amt;
    byWeek.set(wk, row);
  }
  const weeks = [...byWeek.keys()].sort();
  return {
    weeks,
    income: weeks.map((w) => byWeek.get(w)?.income || 0),
    expense: weeks.map((w) => byWeek.get(w)?.expense || 0),
  };
}

/* === Transaction Breakdown report === */
const TXN_BREAKDOWN_COLORS = [
  "rgba(91, 128, 110, 0.88)",
  "rgba(107, 142, 159, 0.88)",
  "rgba(120, 132, 148, 0.86)",
  "rgba(134, 151, 128, 0.86)",
  "rgba(96, 125, 139, 0.86)",
  "rgba(149, 164, 152, 0.86)",
  "rgba(118, 138, 155, 0.84)",
  "rgba(140, 154, 142, 0.84)",
  "rgba(108, 122, 137, 0.82)",
  "rgba(156, 168, 158, 0.82)",
];
let txnBreakdownChartInstance = null;
/** @type {Array<{id:string|number,name:string,amount:number,pct:number}>|null} */
let lastTxnBreakdownRowsForChart = null;
/** @type {Array<object>} */
let lastTxnBreakdownTxCache = [];
let txnBreakdownControlsBound = false;
const txnBreakdownUi = {
  level: "groups",
  groupId: null,
  groupName: "",
  categoryId: null,
  categoryName: "",
  flow: "expense",
  sortKey: "amount",
  sortDir: "desc",
};

/** Cash leaving checking to pay bills/debt — not an internal account transfer (even under a "Transfers" group). */
function isTxnBreakdownCashMovement(tx) {
  const cat = normalizeNameForCompare(tx?.category || "");
  const grp = normalizeNameForCompare(tx?.groupName || "");
  const desc = normalizeNameForCompare(tx?.description || "");
  const blob = `${cat} ${grp} ${desc}`;
  if (blob.includes("credit card")) return true;
  if (blob.includes("student loan") || blob.includes("car loan") || blob.includes("auto loan")) return true;
  if (blob.includes("mortgage") || blob.includes("rent")) return true;
  if (cat.endsWith(" payment") && !cat.includes("transfer")) return true;
  if (grp === "debt" || grp.includes("loans")) return true;
  return false;
}

function isTxnBreakdownTransfer(tx) {
  if (isTxnBreakdownCashMovement(tx)) return false;
  const cat = String(tx?.category || "").toLowerCase();
  const desc = String(tx?.description || "").toLowerCase();
  // Classify by category/description only — group names like "Transfers" also hold card/loan payments.
  return (
    cat.includes("transfer") ||
    cat.includes("xfer") ||
    desc.includes("transfer") ||
    desc.includes("xfer")
  );
}

function txnBreakdownMatchesFlow(tx, flow) {
  const kind = String(tx?.kind || "").toLowerCase();
  const xfer = isTxnBreakdownTransfer(tx);
  if (flow === "transfer") return xfer;
  if (flow === "expense") return kind === "expense" && !xfer;
  if (flow === "income") return kind === "income" && !xfer;
  return !xfer;
}

function txnBreakdownFlowAmount(tx, flow) {
  const amt = Math.abs(Number(tx?.amount || 0));
  if (flow === "net") {
    const kind = String(tx?.kind || "").toLowerCase();
    return kind === "income" ? amt : -amt;
  }
  return amt;
}

function buildTxnBreakdownCategoryMap() {
  /** @type {Map<number,{groupId:number|null,groupName:string,categoryName:string}>} */
  const map = new Map();
  for (const g of state.categoryTree?.groups || []) {
    for (const c of g.categories || []) {
      map.set(Number(c.id), {
        groupId: g.id != null ? Number(g.id) : null,
        groupName: String(g.name || "Other"),
        categoryName: String(c.name || "Category"),
      });
    }
  }
  return map;
}

function enrichTxnBreakdownRow(tx, catMap) {
  const meta = tx.category_id != null ? catMap.get(Number(tx.category_id)) : null;
  return {
    id: tx.id,
    date: normalizeIsoDate(tx.date) || String(tx.date || "").slice(0, 10),
    description: String(tx.description || ""),
    notes: tx.notes ? String(tx.notes) : "",
    kind: String(tx.kind || ""),
    amount: Number(tx.amount || 0),
    category: tx.category ? String(tx.category) : meta?.categoryName || "Uncategorized",
    category_id: tx.category_id != null ? Number(tx.category_id) : null,
    groupId: meta?.groupId ?? null,
    groupName: meta?.groupName || "Uncategorized",
  };
}

function enrichExpectedTxnBreakdownRow(it, catMap) {
  const iso = normalizeIsoDate(it?.date) || "";
  const meta = it.category_id != null ? catMap.get(Number(it.category_id)) : null;
  return {
    id: `exp-${it.expected_transaction_id}-${iso}`,
    date: iso,
    description: String(it.description || ""),
    notes: it.notes ? String(it.notes) : "",
    kind: String(it.kind || ""),
    amount: Number(it.amount || 0),
    category: it.category ? String(it.category) : meta?.categoryName || "Uncategorized",
    category_id: it.category_id != null ? Number(it.category_id) : null,
    groupId: meta?.groupId ?? null,
    groupName: meta?.groupName || "Uncategorized",
  };
}

function isoMinDate(a, b) {
  if (!a) return b || "";
  if (!b) return a;
  return a <= b ? a : b;
}

function isoMaxDate(a, b) {
  if (!a) return b || "";
  if (!b) return a;
  return a >= b ? a : b;
}

function txnBreakdownDedupeKey(row) {
  const amt = Math.round(Math.abs(Number(row.amount || 0)) * 100);
  return `${row.date}|${row.category_id ?? "n"}|${row.kind}|${amt}`;
}

function isTxnBreakdownExpectedRow(row) {
  return String(row.id || "").startsWith("exp-");
}

/** Drop scheduled rows when the same date/category/amount was already posted as an actual txn. */
function dedupeTxnBreakdownActualAndExpected(rows) {
  const actualKeys = new Set();
  for (const r of rows) {
    if (!isTxnBreakdownExpectedRow(r)) actualKeys.add(txnBreakdownDedupeKey(r));
  }
  return rows.filter((r) => {
    if (!isTxnBreakdownExpectedRow(r)) return true;
    return !actualKeys.has(txnBreakdownDedupeKey(r));
  });
}

async function fetchTxnBreakdownTransactions(startIso, endIso) {
  const mode = calendarMode?.value || "both";
  const includeActual = mode === "both" || mode === "actual";
  const includeExpected = mode === "both" || mode === "expected";
  const catMap = buildTxnBreakdownCategoryMap();
  /** @type {Array<object>} */
  const out = [];

  if (includeActual && startIso && endIso && startIso <= endIso) {
    const r = await api(
      `/api/families/${state.activeFamilyId}/transactions?start_date=${encodeURIComponent(startIso)}&end_date=${encodeURIComponent(endIso)}`,
      "GET"
    );
    for (const it of r?.items || []) {
      const iso = normalizeIsoDate(it?.date) || String(it?.date || "").slice(0, 10);
      if (!iso || iso < startIso || iso > endIso) continue;
      out.push(enrichTxnBreakdownRow(it, catMap));
    }
  }

  if (includeExpected && startIso && endIso && startIso <= endIso) {
    const months = monthsOverlappingIsoRange(startIso, endIso);
    const results = await Promise.all(
      months.map((month) =>
        api(`/api/families/${state.activeFamilyId}/expected-calendar?month=${encodeURIComponent(month)}`, "GET")
      )
    );
    for (const data of results) {
      for (const it of data?.items || []) {
        const iso = normalizeIsoDate(it?.date) || "";
        if (!iso || iso < startIso || iso > endIso) continue;
        out.push(enrichExpectedTxnBreakdownRow(it, catMap));
      }
    }
  }

  if (includeActual && includeExpected) return dedupeTxnBreakdownActualAndExpected(out);
  return out;
}

function filterTxnBreakdownTxs(txs, flow) {
  return (txs || []).filter((tx) => txnBreakdownMatchesFlow(tx, flow));
}

function aggregateTxnBreakdownGroups(txs, flow) {
  /** @type {Map<string,{id:string|number,name:string,amount:number}>} */
  const byGroup = new Map();
  for (const tx of txs) {
    const key = tx.groupId != null ? String(tx.groupId) : `name:${tx.groupName}`;
    const signed = txnBreakdownFlowAmount(tx, flow);
    const row = byGroup.get(key) || { id: tx.groupId ?? key, name: tx.groupName, amount: 0 };
    row.amount += signed;
    byGroup.set(key, row);
  }
  return finalizeTxnBreakdownRows([...byGroup.values()], flow);
}

function aggregateTxnBreakdownCategories(txs, groupId, groupName, flow) {
  /** @type {Map<string,{id:string|number,name:string,amount:number}>} */
  const byCat = new Map();
  for (const tx of txs) {
    const inGroup =
      groupId != null ? Number(tx.groupId) === Number(groupId) : String(tx.groupName) === String(groupName);
    if (!inGroup) continue;
    const key = tx.category_id != null ? String(tx.category_id) : `name:${tx.category}`;
    const signed = txnBreakdownFlowAmount(tx, flow);
    const row = byCat.get(key) || { id: tx.category_id ?? key, name: tx.category, amount: 0 };
    row.amount += signed;
    byCat.set(key, row);
  }
  return finalizeTxnBreakdownRows([...byCat.values()], flow);
}

function finalizeTxnBreakdownRows(rows, flow) {
  const useAbs = flow === "net";
  const total = rows.reduce((s, r) => s + (useAbs ? Math.abs(r.amount) : Math.max(0, r.amount)), 0);
  return rows
    .map((r) => {
      const displayAmt = flow === "net" ? r.amount : Math.abs(r.amount);
      const pctBase = useAbs ? Math.abs(r.amount) : Math.max(0, r.amount);
      const pct = total > 0 ? (pctBase / total) * 100 : 0;
      return { ...r, amount: displayAmt, pct };
    })
    .filter((r) => (useAbs ? Math.abs(r.amount) > 0.0001 : r.amount > 0.0001));
}

function sortTxnBreakdownRows(rows) {
  const key = txnBreakdownUi.sortKey;
  const dir = txnBreakdownUi.sortDir === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    if (key === "name") return dir * String(a.name).localeCompare(String(b.name));
    if (key === "pct") return dir * (a.pct - b.pct);
    return dir * (a.amount - b.amount);
  });
}

function destroyTxnBreakdownChart() {
  if (txnBreakdownChartInstance) {
    try { txnBreakdownChartInstance.destroy(); } catch (_) {}
    txnBreakdownChartInstance = null;
  }
}

function txnBreakdownActiveChartRows(rows) {
  return (rows || []).filter((r) => Math.abs(Number(r.amount || 0)) > 0.0001);
}

function ensureTxnBreakdownSummaryEl() {
  const frame = document.querySelector("#txnBreakdownBody .reports-tb-chart__frame");
  if (!frame) return null;
  let el = document.getElementById("txnBreakdownChartSummary");
  if (!el) {
    el = document.createElement("div");
    el.id = "txnBreakdownChartSummary";
    el.className = "reports-tb-chart__summary";
    el.hidden = true;
    el.innerHTML = `<div class="reports-tb-chart__summary-ring" aria-hidden="true"><span class="reports-tb-chart__summary-swatch"></span></div>
      <p class="reports-tb-chart__summary-amount"></p>
      <p class="reports-tb-chart__summary-label"></p>
      <p class="reports-tb-chart__summary-share"></p>`;
    frame.insertBefore(el, frame.firstChild);
  }
  return el;
}

function hideTxnBreakdownChartSummary() {
  const summary = document.getElementById("txnBreakdownChartSummary");
  if (summary) summary.hidden = true;
}

function renderTxnBreakdownChartSummary(row, color) {
  const summary = ensureTxnBreakdownSummaryEl();
  const canvas = document.getElementById("txnBreakdownChartCanvas");
  const emptyEl = document.getElementById("txnBreakdownChartEmpty");
  if (!summary || !canvas) return;
  destroyTxnBreakdownChart();
  canvas.style.display = "none";
  if (emptyEl) emptyEl.style.display = "none";
  summary.hidden = false;
  const swatch = summary.querySelector(".reports-tb-chart__summary-swatch");
  const amt = summary.querySelector(".reports-tb-chart__summary-amount");
  const lbl = summary.querySelector(".reports-tb-chart__summary-label");
  const share = summary.querySelector(".reports-tb-chart__summary-share");
  if (swatch) swatch.style.background = color;
  if (amt) amt.textContent = `$${fmtMoney(Math.abs(row.amount))}`;
  if (lbl) lbl.textContent = row.name;
  if (share) {
    share.textContent = `${row.pct.toFixed(1)}% of ${txnBreakdownFlowLabel(txnBreakdownUi.flow)} in view`;
  }
}

function applyTxnBreakdownLayout(chartRows) {
  const body = document.getElementById("txnBreakdownBody");
  if (!body) return;
  const active = txnBreakdownActiveChartRows(chartRows);
  const n = active.length;
  const level = txnBreakdownUi.level;
  body.classList.remove(
    "reports-tb-body--chart-full",
    "reports-tb-body--chart-medium",
    "reports-tb-body--chart-compact",
    "reports-tb-body--chart-summary",
    "reports-tb-body--drill",
    "reports-tb-body--tx-level"
  );
  if (level === "transactions") {
    body.classList.add("reports-tb-body--tx-level", "reports-tb-body--drill");
    return;
  }
  if (level !== "groups") body.classList.add("reports-tb-body--drill");
  if (n <= 0) return;
  if (n === 1) body.classList.add("reports-tb-body--chart-summary");
  else if (level !== "groups" || n <= 3) body.classList.add("reports-tb-body--chart-compact");
  else if (n <= 5) body.classList.add("reports-tb-body--chart-medium");
  else body.classList.add("reports-tb-body--chart-full");
}

function drawTxnBreakdownChart(rows) {
  const canvas = document.getElementById("txnBreakdownChartCanvas");
  const emptyEl = document.getElementById("txnBreakdownChartEmpty");
  if (!canvas || typeof Chart === "undefined") return;
  ensureProjectionChartDefaults();
  lastTxnBreakdownRowsForChart = rows || [];
  const active = txnBreakdownActiveChartRows(rows);
  applyTxnBreakdownLayout(rows);
  destroyTxnBreakdownChart();
  hideTxnBreakdownChartSummary();
  if (!active.length) {
    canvas.style.display = "none";
    if (emptyEl) {
      emptyEl.style.display = "block";
      emptyEl.textContent = "No activity in this range for the selected view.";
    }
    return;
  }
  if (active.length === 1) {
    renderTxnBreakdownChartSummary(active[0], TXN_BREAKDOWN_COLORS[0]);
    return;
  }
  canvas.style.display = "block";
  if (emptyEl) emptyEl.style.display = "none";
  const labels = active.map((r) => r.name);
  const data = active.map((r) => Math.abs(r.amount));
  const colors = active.map((_, i) => TXN_BREAKDOWN_COLORS[i % TXN_BREAKDOWN_COLORS.length]);
  const cutout = active.length <= 2 ? "72%" : active.length <= 4 ? "62%" : "52%";
  txnBreakdownChartInstance = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 2 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 280 },
      cutout,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const row = active[ctx.dataIndex];
              return `${row.name}: $${fmtMoney(Math.abs(row.amount))} (${row.pct.toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });
}

function txnBreakdownFlowLabel(flow) {
  if (flow === "income") return "income";
  if (flow === "transfer") return "transfers";
  if (flow === "net") return "net flow";
  return "spending";
}

function txnBreakdownNavBackButton(label, onClick) {
  const back = document.createElement("button");
  back.type = "button";
  back.className = "reports-tb-nav__back";
  const icon = document.createElement("span");
  icon.className = "reports-tb-nav__back-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "←";
  back.append(icon, document.createTextNode(` ${label}`));
  back.addEventListener("click", onClick);
  return back;
}

function renderTxnBreakdownDrillNav() {
  const nav = document.getElementById("txnBreakdownNav");
  const titleEl = document.getElementById("txnBreakdownContentTitle");
  const drillbar = document.getElementById("txnBreakdownDrillbar");
  if (!nav || !titleEl) return;

  const { level, groupName, categoryName } = txnBreakdownUi;
  nav.replaceChildren();

  if (level === "groups") {
    if (drillbar) drillbar.classList.remove("reports-tb-drillbar--drill");
    const levelLabel = document.createElement("span");
    levelLabel.className = "reports-tb-nav__level";
    levelLabel.textContent = "All Groups";
    nav.appendChild(levelLabel);
    titleEl.textContent = "Transaction Breakdown";
    return;
  }

  if (drillbar) drillbar.classList.add("reports-tb-drillbar--drill");

  if (level === "categories") {
    nav.appendChild(txnBreakdownNavBackButton("Back to All Groups", () => txnBreakdownNavigate("groups")));
    const trail = document.createElement("div");
    trail.className = "reports-tb-nav__trail";
    const current = document.createElement("span");
    current.className = "reports-tb-nav__current";
    current.textContent = groupName;
    trail.appendChild(current);
    nav.appendChild(trail);
    titleEl.textContent = `Transaction Breakdown — ${groupName}`;
    return;
  }

  nav.appendChild(txnBreakdownNavBackButton("Back to Categories", () => txnBreakdownNavigate("categories")));
  const trail = document.createElement("div");
  trail.className = "reports-tb-nav__trail";
  const group = document.createElement("span");
  group.className = "reports-tb-nav__ancestor";
  group.textContent = groupName;
  const sep = document.createElement("span");
  sep.className = "reports-tb-nav__sep";
  sep.textContent = "›";
  sep.setAttribute("aria-hidden", "true");
  const current = document.createElement("span");
  current.className = "reports-tb-nav__current";
  current.textContent = categoryName;
  trail.append(group, sep, current);
  nav.appendChild(trail);
  titleEl.textContent = `Transaction Breakdown — ${groupName} › ${categoryName}`;
}

function renderTxnBreakdownTable(rows) {
  const tbody = document.getElementById("txnBreakdownTableBody");
  const tfoot = document.getElementById("txnBreakdownTableFoot");
  if (!tbody || !tfoot) return;
  tbody.replaceChildren();
  tfoot.replaceChildren();
  const sorted = sortTxnBreakdownRows(rows);
  for (const row of sorted) {
    const tr = document.createElement("tr");
    tr.className = "reports-tb-row--drill";
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    if (
      (txnBreakdownUi.level === "transactions" || txnBreakdownUi.level === "categories") &&
      txnBreakdownUi.categoryId != null &&
      String(row.id) === String(txnBreakdownUi.categoryId)
    ) {
      tr.classList.add("is-selected");
    }
    const amtClass = txnBreakdownUi.flow === "net" && row.amount < 0 ? "tx-kind-fg--expense" : "";
    tr.innerHTML = `
      <td>${escapeHtml(row.name)}</td>
      <td class="num ${amtClass}">${txnBreakdownUi.flow === "net" && row.amount < 0 ? "-" : ""}$${fmtMoney(Math.abs(row.amount))}</td>
      <td class="num">${row.pct.toFixed(1)}%</td>
    `;
    const activate = () => {
      if (txnBreakdownUi.level === "groups") {
        txnBreakdownUi.groupId = row.id;
        txnBreakdownUi.groupName = row.name;
        txnBreakdownNavigate("categories");
      } else {
        txnBreakdownUi.categoryId = row.id;
        txnBreakdownUi.categoryName = row.name;
        if (txnBreakdownUi.level === "categories") txnBreakdownNavigate("transactions");
        else renderTxnBreakdownFromCache();
      }
    };
    tr.addEventListener("click", activate);
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
    tbody.appendChild(tr);
  }
  const total = sorted.reduce((s, r) => s + r.amount, 0);
  const totalAbs = sorted.reduce((s, r) => s + Math.abs(r.amount), 0);
  const pctSum = sorted.reduce((s, r) => s + r.pct, 0);
  const tr = document.createElement("tr");
  const totalDisplay =
    txnBreakdownUi.flow === "net"
      ? `${total < 0 ? "-" : ""}$${fmtMoney(Math.abs(total))}`
      : `$${fmtMoney(totalAbs)}`;
  tr.innerHTML = `
    <td>Total</td>
    <td class="num">${totalDisplay}</td>
    <td class="num">${Math.min(100, pctSum).toFixed(1)}%</td>
  `;
  tfoot.appendChild(tr);

  document.querySelectorAll("#txnBreakdownTable thead th[data-tb-sort]").forEach((th) => {
    th.classList.toggle("is-sorted", th.getAttribute("data-tb-sort") === txnBreakdownUi.sortKey);
  });
}

function renderTxnBreakdownTxList(txs) {
  const panel = document.getElementById("txnBreakdownTxPanel");
  const title = document.getElementById("txnBreakdownTxTitle");
  const body = document.getElementById("txnBreakdownTxBody");
  if (!panel || !body) return;
  if (txnBreakdownUi.level !== "transactions") {
    panel.hidden = true;
    body.replaceChildren();
    return;
  }
  const { categoryId, categoryName, groupName, flow } = txnBreakdownUi;
  const filtered = txs.filter((tx) => {
    if (categoryId != null && String(tx.category_id) !== String(categoryId)) return false;
    if (categoryId == null && String(tx.category) !== String(categoryName)) return false;
    return txnBreakdownMatchesFlow(tx, flow);
  });
  filtered.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  panel.hidden = false;
  if (title) title.textContent = `${groupName} › ${categoryName} · ${filtered.length} transaction${filtered.length === 1 ? "" : "s"}`;
  body.replaceChildren();
  if (!filtered.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="4" class="reports-table__empty">No transactions in this range.</td>';
    body.appendChild(tr);
    return;
  }
  for (const tx of filtered) {
    const tr = document.createElement("tr");
    const kindCls = String(tx.kind) === "income" ? "tx-kind-fg--income" : "tx-kind-fg--expense";
    const sign = flow === "net" && String(tx.kind) !== "income" ? "-" : "";
    tr.innerHTML = `
      <td>${escapeHtml(formatChartRangeLongLabel(tx.date))}</td>
      <td>${escapeHtml(tx.description)}</td>
      <td class="num ${kindCls}">${sign}$${fmtMoney(Math.abs(tx.amount))}</td>
      <td class="reports-tb-tx-notes" title="${escapeHtml(tx.notes || "")}">${escapeHtml(tx.notes || "—")}</td>
    `;
    body.appendChild(tr);
  }
}

function txnBreakdownNavigate(level) {
  const body = document.getElementById("txnBreakdownBody");
  if (body) body.classList.add("is-transitioning");
  txnBreakdownUi.level = level;
  if (level === "groups") {
    txnBreakdownUi.groupId = null;
    txnBreakdownUi.groupName = "";
    txnBreakdownUi.categoryId = null;
    txnBreakdownUi.categoryName = "";
  } else if (level === "categories") {
    txnBreakdownUi.categoryId = null;
    txnBreakdownUi.categoryName = "";
  }
  renderTxnBreakdownFromCache();
  window.setTimeout(() => {
    if (body) body.classList.remove("is-transitioning");
  }, 180);
}

function renderTxnBreakdownFromCache() {
  const flow = txnBreakdownUi.flow;
  const txs = filterTxnBreakdownTxs(lastTxnBreakdownTxCache, flow);
  let rows = [];
  if (txnBreakdownUi.level === "groups") {
    rows = aggregateTxnBreakdownGroups(txs, flow);
  } else {
    rows = aggregateTxnBreakdownCategories(txs, txnBreakdownUi.groupId, txnBreakdownUi.groupName, flow);
  }
  renderTxnBreakdownDrillNav();
  renderTxnBreakdownTable(rows);
  const chartRows = txnBreakdownActiveChartRows(rows);
  if (txnBreakdownUi.level === "transactions") {
    applyTxnBreakdownLayout(chartRows);
    destroyTxnBreakdownChart();
    hideTxnBreakdownChartSummary();
    const canvas = document.getElementById("txnBreakdownChartCanvas");
    const emptyEl = document.getElementById("txnBreakdownChartEmpty");
    if (canvas) canvas.style.display = "none";
    if (emptyEl) emptyEl.style.display = "none";
    lastTxnBreakdownRowsForChart = [];
  } else {
    drawTxnBreakdownChart(chartRows);
  }
  renderTxnBreakdownTxList(lastTxnBreakdownTxCache);
  const caption = document.getElementById("txnBreakdownChartCaption");
  if (caption) {
    const { start, endIso } = readReportsDateRange();
    const rangeTxt = start && endIso ? `${formatChartRangeLongLabel(start)} – ${formatChartRangeLongLabel(endIso)}` : "selected range";
    if (txnBreakdownUi.level === "groups") {
      caption.textContent = `${txnBreakdownFlowLabel(flow)} by group · ${rangeTxt}`;
    } else if (txnBreakdownUi.level === "categories") {
      caption.textContent = `${txnBreakdownUi.groupName} categories · ${rangeTxt}`;
    } else {
      caption.textContent = `${txnBreakdownUi.groupName} · ${txnBreakdownUi.categoryName} · ${rangeTxt}`;
    }
  }
}

function wireTxnBreakdownControls() {
  if (txnBreakdownControlsBound) return;
  txnBreakdownControlsBound = true;
  document.querySelectorAll(".reports-tb-flow__btn[data-tb-flow]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const flow = String(btn.getAttribute("data-tb-flow") || "expense");
      txnBreakdownUi.flow = flow;
      document.querySelectorAll(".reports-tb-flow__btn[data-tb-flow]").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
      });
      renderTxnBreakdownFromCache();
    });
  });
  document.querySelectorAll("#txnBreakdownTable thead th[data-tb-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = String(th.getAttribute("data-tb-sort") || "amount");
      if (txnBreakdownUi.sortKey === key) {
        txnBreakdownUi.sortDir = txnBreakdownUi.sortDir === "asc" ? "desc" : "asc";
      } else {
        txnBreakdownUi.sortKey = key;
        txnBreakdownUi.sortDir = key === "name" ? "asc" : "desc";
      }
      renderTxnBreakdownFromCache();
    });
  });
}

async function refreshTxnBreakdownReport() {
  const errEl = document.getElementById("txnBreakdownErr");
  show(errEl, "");
  if (!state.activeFamilyId) return;
  wireTxnBreakdownControls();
  if (!state.categoryTree?.groups?.length) {
    try { await loadCategories(); } catch (_) {}
  }
  const { start, endIso } = readReportsDateRange();
  if (!start || !endIso) return;
  try {
    lastTxnBreakdownTxCache = await fetchTxnBreakdownTransactions(start, endIso);
    renderTxnBreakdownFromCache();
  } catch (e) {
    show(errEl, e?.message || "Failed to load transaction breakdown");
    destroyTxnBreakdownChart();
    lastTxnBreakdownRowsForChart = null;
    const tbody = document.getElementById("txnBreakdownTableBody");
    const tfoot = document.getElementById("txnBreakdownTableFoot");
    if (tbody) tbody.replaceChildren();
    if (tfoot) tfoot.replaceChildren();
  }
}

function destroyReportsSafeTransferChart() {
  if (reportsSafeTransferChartInstance) {
    try {
      reportsSafeTransferChartInstance.destroy();
    } catch (_) {}
    reportsSafeTransferChartInstance = null;
  }
}

function computeSafeToTransferSeries(daily, floor) {
  const items = daily || [];
  return items.map((d) => {
    const projectedBalance = Number(d?.total_balance ?? NaN);
    if (!Number.isFinite(projectedBalance)) return 0;
    return Math.max(0, projectedBalance - floor);
  });
}

function mapObligationGroup(description, category) {
  const s = `${String(description || "")} ${String(category || "")}`.toLowerCase();
  if (/mortgage|rent|hoa|housing|landlord/.test(s)) return "Housing";
  if (/electric|gas|water|utility|utilities|internet|sewer|trash/.test(s)) return "Utilities";
  if (/loan|card|credit|debt|student|auto loan/.test(s)) return "Debt";
  if (/subscription|netflix|spotify|software|saas|apple|google/.test(s)) return "Subscriptions";
  if (/insurance|premium/.test(s)) return "Insurance";
  if (/daycare|school|sport|activity|kids|child/.test(s)) return "Kids / activities";
  return "Other obligations";
}

/** Conversational recurrence copy for the obligations report. */
function obligationRecurrenceLabel(raw) {
  return recurrenceLabel(raw);
}

function fmtObligationNextDate(iso) {
  const isoN = normalizeIsoDate(iso) || "";
  if (!isoN) return "—";
  const y = isoN.slice(0, 4);
  const cy = String(new Date().getFullYear());
  if (y === cy) return fmtMonthDay(isoN);
  return fmtDateMedDisplay(isoN);
}

/** Whole calendar days from `fromIso` to `toIso` (exclusive of partial days; both YYYY-MM-DD). */
function calendarDaysBetweenIso(fromIso, toIso) {
  const a = parseIsoDateLocal(normalizeIsoDate(fromIso) || "");
  const b = parseIsoDateLocal(normalizeIsoDate(toIso) || "");
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function formatDaysUntilImpact(todayIso, impactIso) {
  const d = calendarDaysBetweenIso(todayIso, impactIso);
  if (d == null || !Number.isFinite(d)) return "—";
  if (d <= 0) return "Today";
  if (d === 1) return "Tomorrow";
  return `In ${d} days`;
}

function categoryNameForPressure(cid) {
  const id = Number(cid);
  if (!Number.isFinite(id) || id <= 0) return "";
  const c = (state.categories || []).find((x) => Number(x.id) === id);
  return c ? String(c.name || "").trim() : "";
}

/** Richer label for generic short descriptions (e.g. card names + category). */
function pressureRowDescription(tx) {
  return String(tx.description || "Scheduled expense").trim() || "Scheduled expense";
}

function pressureCategoryLabel(tx) {
  const cn = categoryNameForPressure(tx?.category_id);
  if (cn) return cn;
  const fallback = mapObligationGroup(tx?.description, tx?.category);
  return fallback === "Other obligations" ? "" : fallback;
}

/**
 * Relative timing for pressure table: show countdown only when within 30 days;
 * far-dated rows leave timing subtle (date is in the first column).
 */
function formatPressureRelativeTiming(todayIso, impactIso) {
  const d = calendarDaysBetweenIso(todayIso, impactIso);
  if (d == null || !Number.isFinite(d)) return "—";
  if (d <= 0) return "Today";
  if (d > 30) return "";
  if (d === 1) return "Tomorrow";
  return `In ${d} days`;
}

function pressureSeverityMeta(after, floor) {
  if (after == null || !Number.isFinite(after)) {
    return {
      key: "unknown",
      label: "Outside forecast range",
      balClass: "reports-pressure-bal--unknown",
      levelClass: "reports-pressure-level--unknown",
      accentClass: "reports-pressure-row--accent-unknown",
    };
  }
  const target = floor != null ? floor : 0;
  if (after < target) {
    return {
      key: "below",
      label: floor != null ? "Below minimum balance" : "Below zero",
      balClass: "reports-pressure-bal--below",
      levelClass: "reports-pressure-level--below",
      accentClass: "reports-pressure-row--accent-below",
    };
  }
  if (floor != null && after < floor * 1.12) {
    return {
      key: "tight",
      label: "Tight",
      balClass: "reports-pressure-bal--tight",
      levelClass: "reports-pressure-level--tight",
      accentClass: "reports-pressure-row--accent-tight",
    };
  }
  if ((floor != null && after < floor * 1.4) || (floor == null && after < 1500)) {
    return {
      key: "watch",
      label: "Watch",
      balClass: "reports-pressure-bal--watch",
      levelClass: "reports-pressure-level--watch",
      accentClass: "reports-pressure-row--accent-watch",
    };
  }
  return {
    key: "comfortable",
    label: "Comfortable",
    balClass: "reports-pressure-bal--comfortable",
    levelClass: "reports-pressure-level--comfortable",
    accentClass: "reports-pressure-row--accent-comfortable",
  };
}

function balanceAfterPressureClass(after, floor) {
  return pressureSeverityMeta(after, floor).balClass;
}

function computePressureRecoveryLabel(daily, impactIso, afterBal) {
  const thr = readStoredMinBalanceThresholdForReports();
  const target = thr != null ? thr : 0;
  const norm = (s) => normalizeIsoDate(s) || "";
  const imp = norm(impactIso);
  const rows = (daily || [])
    .slice()
    .sort((a, b) => norm(a.date).localeCompare(norm(b.date)));
  const idx = rows.findIndex((r) => norm(r.date) === imp);
  if (afterBal == null || !Number.isFinite(afterBal)) {
    return { label: "Recovery not shown", cls: "reports-pressure-rec--muted", state: "outside" };
  }
  if (idx < 0) {
    return { label: "Recovery not shown", cls: "reports-pressure-rec--muted", state: "outside" };
  }
  if (afterBal >= target) {
    return {
      label: thr != null ? "Above minimum" : "In the black",
      cls: "reports-pressure-rec--ok",
      state: "covered",
    };
  }
  for (let j = idx + 1; j < rows.length; j++) {
    const b = Number(rows[j].total_balance ?? 0);
    if (b >= target) {
      return {
        label: `Recovers ${fmtMonthDay(norm(rows[j].date))}`,
        cls: "reports-pressure-rec--date",
        state: "date",
      };
    }
  }
  return {
    label: thr != null ? "Below minimum" : "Below zero",
    cls: "reports-pressure-rec--stale",
    state: "stale",
  };
}

/** Short label for the Status column (scan-friendly). */
function pressureStatusColumnText(rec, thr) {
  if (!rec || !rec.label) return "—";
  if (rec.state === "covered") return thr != null ? "OK" : "In range";
  if (rec.state === "date") {
    const m = /^Recovers\s+(.+)$/.exec(String(rec.label || ""));
    return m ? `Recovers ${m[1]}` : String(rec.label);
  }
  if (rec.state === "stale") return thr != null ? "Below min" : "Below zero";
  if (rec.state === "outside") return "Outside range";
  return String(rec.label);
}

function pressureWhyItMatters(hit, floor, lowestHit) {
  const recovery = hit?.recovery || null;
  const after = Number(hit?.after ?? NaN);
  const target = floor != null ? floor : 0;
  const isLowest =
    !!lowestHit &&
    String(lowestHit.iso || "") === String(hit?.iso || "") &&
    Number(lowestHit.after ?? NaN) === after;

  if (!Number.isFinite(after)) {
    return "Outside the current forecast range, so recovery is not yet projected.";
  }
  if (isLowest) {
    if (recovery?.state === "date") {
      return `Creates the lowest balance point before recovery on ${recovery.label}.`;
    }
    if (recovery?.state === "stale") {
      return floor != null
        ? "Creates the lowest balance point and stays below your minimum balance in this range."
        : "Creates the lowest balance point and stays below zero in this range.";
    }
    return "Creates the lowest projected balance point in this range.";
  }
  if (after < target) {
    if (recovery?.state === "date") {
      return floor != null
        ? `Pushes projected cash below your minimum balance until ${recovery.label}.`
        : `Pushes projected cash below zero until ${recovery.label}.`;
    }
    return floor != null
      ? "Pushes projected cash below your minimum balance with no recovery shown in this range."
      : "Pushes projected cash below zero with no recovery shown in this range.";
  }
  if (recovery?.state === "date" && floor != null && after < floor * 1.15) {
    return `Tightens cash flow, but recovers by ${recovery.label}.`;
  }
  return "Larger payment, but projected cash remains covered.";
}

function addDaysIso(baseIso, days) {
  const d = parseIsoDateLocal(baseIso);
  if (!d || !Number.isFinite(days)) return "";
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

const REPORTS_OBL_LARGE_THRESHOLD = 2500;
let reportsObligationControlsWired = false;

function wireReportsObligationControlsOnce() {
  if (reportsObligationControlsWired) return;
  const sortEl = document.getElementById("reportsObligationSort");
  const grpEl = document.getElementById("reportsObligationFilterGroup");
  const largeEl = document.getElementById("reportsObligationLargeOnly");
  if (!sortEl || !grpEl || !largeEl) return;
  const rerender = () => renderReportsObligations();
  sortEl.addEventListener("change", rerender);
  grpEl.addEventListener("change", rerender);
  largeEl.addEventListener("change", rerender);
  reportsObligationControlsWired = true;
}

function estimatedMonthlyFromRecurrence(amount, recurrence) {
  const r = String(recurrence || "monthly").toLowerCase();
  const a = Number(amount || 0);
  if (!Number.isFinite(a)) return 0;
  if (r === "weekly") return a * 4.345;
  if (r === "biweekly") return a * 2.1725;
  if (r === "twice_monthly") return a * 2;
  if (r === "quarterly") return a / 3;
  if (r === "bimonthly") return a / 2;
  if (r === "semiannual") return a / 6;
  if (r === "yearly" || r === "annual") return a / 12;
  return a;
}

function getProjectedBalancesByDate(source, options = {}) {
  const startIso = normalizeIsoDate(options.startIso) || "";
  const endIso = normalizeIsoDate(options.endIso) || "";
  let rows = [];
  if (Array.isArray(source)) {
    rows = source.map((row) => {
      const iso = normalizeIsoDate(row?.date) || "";
      return {
        date: iso,
        balance: Number(row?.balance ?? row?.total_balance ?? NaN),
        netCashflow: Number(row?.netCashflow ?? row?.net_cashflow ?? NaN),
        raw: row || null,
      };
    });
  } else if (source instanceof Map) {
    rows = [...source.entries()].map(([iso, row]) => ({
      date: normalizeIsoDate(iso) || "",
      balance: Number(row?.end ?? row?.balance ?? NaN),
      netCashflow: Number(row?.txNet ?? row?.net_cashflow ?? NaN),
      raw: row || null,
    }));
  }
  return rows
    .filter((row) => row.date && Number.isFinite(row.balance))
    .filter((row) => (!startIso || row.date >= startIso) && (!endIso || row.date <= endIso))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getLowestBalanceInRange(source, startIso, endIso) {
  const rows = Array.isArray(source) && source.length && source[0]?.date && Object.prototype.hasOwnProperty.call(source[0], "balance")
    ? source
    : getProjectedBalancesByDate(source, { startIso, endIso });
  if (!rows.length) return null;
  let low = rows[0];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].balance < low.balance) low = rows[i];
  }
  return { date: low.date, amount: low.balance, row: low };
}

function getNextBelowFloorDate(source, floor, fromIso = "") {
  if (!Number.isFinite(Number(floor))) return null;
  const rows = Array.isArray(source) && source.length && source[0]?.date && Object.prototype.hasOwnProperty.call(source[0], "balance")
    ? source
    : getProjectedBalancesByDate(source);
  const refIso = normalizeIsoDate(fromIso) || "";
  for (const row of rows) {
    if (refIso && row.date < refIso) continue;
    if (row.balance < floor) return { date: row.date, amount: row.balance, row };
  }
  return null;
}

function getDaysSinceReconciled(endIso = toISODate(new Date())) {
  const refIso = normalizeIsoDate(endIso) || toISODate(new Date());
  const latest = tmLatestReconciledIsoBefore(refIso);
  if (!latest) return null;
  const days = calendarDaysBetweenIso(latest, refIso);
  if (days == null || !Number.isFinite(days)) return null;
  return { days, lastReconciledDate: latest };
}

function getRecurringExpenseMonthlyBaseline() {
  let total = 0;
  for (const tx of state.expectedTransactions || []) {
    if (!tx || String(tx.kind || "") !== "expense") continue;
    const recurrence = String(tx.recurrence || "").toLowerCase();
    if (!recurrence || recurrence === "once") continue;
    total += estimatedMonthlyFromRecurrence(Math.abs(Number(tx.amount || 0)), recurrence);
  }
  return total;
}

function collectForecastOccurrencesInRange(startIso, endIso, kinds = []) {
  const want = new Set((Array.isArray(kinds) ? kinds : []).map((v) => String(v || "").toLowerCase()).filter(Boolean));
  const includeKind = (kind) => !want.size || want.has(String(kind || "").toLowerCase());
  const out = [];

  for (const tx of state.expectedTransactions || []) {
    if (!tx) continue;
    const kind = String(tx.kind || "").toLowerCase() || "expense";
    if (!includeKind(kind)) continue;
    let cursor = startIso;
    let safety = 0;
    while (cursor && safety < 500) {
      safety++;
      let next = "";
      try {
        next = normalizeIsoDate(nextExpectedOccurrenceIso(tx, cursor)) || "";
      } catch (_) {
        next = "";
      }
      if (!next || next > endIso) break;
      out.push({
        id: String(tx.id ?? tx.expected_transaction_id ?? tx.series_id ?? `${kind}:${next}:${tx.description || "recurring"}`),
        date: next,
        amount: Math.abs(Number(tx.amount || 0)),
        kind,
        description: String(tx.description || "Recurring").trim() || "Recurring",
        source: "expected",
        recurrence: String(tx.recurrence || ""),
      });
      cursor = addDaysIso(next, 1);
      if (!cursor || cursor > endIso) break;
    }
  }

  for (const tx of state.upcomingActualItems || []) {
    const iso = normalizeIsoDate(tx?.date) || "";
    if (!iso || iso < startIso || iso > endIso) continue;
    const kind = String(tx?.kind || "").toLowerCase() || "expense";
    if (!includeKind(kind)) continue;
    out.push({
      id: String(tx?.id ?? tx?.transaction_id ?? `${kind}:${iso}:${tx?.description || "transaction"}`),
      date: iso,
      amount: Math.abs(Number(tx?.amount || 0)),
      kind,
      description: String(tx?.description || "Transaction").trim() || "Transaction",
      source: "actual",
      recurrence: "once",
    });
  }

  return out
    .filter((row) => row.date && Number.isFinite(row.amount) && row.amount > 0)
    .sort((a, b) => (a.date === b.date ? b.amount - a.amount : a.date.localeCompare(b.date)));
}

function detectLargeExpenseClusters(startIso, endIso, options = {}) {
  const defaultThreshold = Number(options.defaultThreshold);
  const recurringBaseline = getRecurringExpenseMonthlyBaseline();
  const dynamicThreshold = recurringBaseline > 0 ? recurringBaseline * 0.2 : 0;
  const threshold = Math.max(Number.isFinite(defaultThreshold) && defaultThreshold > 0 ? defaultThreshold : 500, dynamicThreshold);
  const expenses = collectForecastOccurrencesInRange(startIso, endIso, ["expense"]).filter((row) => row.amount >= threshold);
  if (expenses.length < 2) return null;

  let best = null;
  for (let i = 0; i < expenses.length; i++) {
    const first = expenses[i];
    const windowEnd = isoAddDays(first.date, 6);
    const grouped = expenses.filter((row) => row.date >= first.date && row.date <= windowEnd);
    if (grouped.length < 2) continue;
    const total = grouped.reduce((sum, row) => sum + row.amount, 0);
    if (!best || grouped.length > best.count || (grouped.length === best.count && total > best.totalAmount)) {
      best = {
        startDate: grouped[0].date,
        endDate: grouped[grouped.length - 1].date,
        count: grouped.length,
        totalAmount: total,
        threshold,
        events: grouped,
        relatedTransactionIds: grouped.map((row) => row.id),
      };
    }
  }
  return best;
}

function compareSafeToTransferTodayVsFuture(daily, floor, options = {}) {
  if (!Number.isFinite(Number(floor))) return null;
  const rows = getProjectedBalancesByDate(daily, { startIso: options.startIso, endIso: options.endIso });
  if (rows.length < 2) return null;
  const referenceIso = normalizeIsoDate(options.fromIso) || toISODate(new Date());
  const series = computeSafeToTransferSeries(rows.map((row) => ({ total_balance: row.balance })), floor);
  const currentIndex = rows.findIndex((row) => row.date >= referenceIso);
  if (currentIndex < 0) return null;
  const currentAmount = Number(series[currentIndex] || 0);
  const incomes = collectForecastOccurrencesInRange(rows[currentIndex].date, rows[rows.length - 1].date, ["income"]);
  const nextIncome = incomes.find((row) => row.date > rows[currentIndex].date);
  if (!nextIncome) return null;
  const futureIndex = rows.findIndex((row) => row.date >= nextIncome.date);
  if (futureIndex < 0) return null;
  const futureAmount = Number(series[futureIndex] || 0);
  const gain = futureAmount - currentAmount;
  const meaningfulGain = gain >= 100 || (currentAmount > 0 && gain >= currentAmount * 0.1);
  if (!meaningfulGain) return null;

  const largeThreshold = Math.max(500, getRecurringExpenseMonthlyBaseline() * 0.2 || 0);
  const nextMajorExpense = collectForecastOccurrencesInRange(rows[currentIndex].date, rows[rows.length - 1].date, ["expense"])
    .find((row) => row.date >= nextIncome.date && row.amount >= largeThreshold);

  return {
    date: rows[futureIndex].date,
    currentAmount,
    futureAmount,
    gain,
    incomeEvent: nextIncome,
    nextMajorExpense,
  };
}

function getBestTransferDay(daily, floor, options = {}) {
  if (!Number.isFinite(Number(floor))) return null;
  const rows = getProjectedBalancesByDate(daily, { startIso: options.startIso, endIso: options.endIso });
  if (!rows.length) return null;
  const referenceIso = normalizeIsoDate(options.fromIso) || toISODate(new Date());
  const series = computeSafeToTransferSeries(rows.map((row) => ({ total_balance: row.balance })), floor);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].date < referenceIso) continue;
    if (series[i] <= 0) continue;
    let staysAboveFloor = true;
    for (let j = i; j < rows.length; j++) {
      if (rows[j].balance < floor) {
        staysAboveFloor = false;
        break;
      }
    }
    if (staysAboveFloor) return { date: rows[i].date, amount: series[i] };
  }
  return null;
}

function getPressureEasingDate(daily, floor, options = {}) {
  const threshold = Number.isFinite(Number(floor)) ? Number(floor) : 0;
  const rows = getProjectedBalancesByDate(daily, { startIso: options.startIso, endIso: options.endIso });
  if (!rows.length) return null;
  const referenceIso = normalizeIsoDate(options.fromIso) || toISODate(new Date());
  let seenPressure = false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.date < referenceIso) continue;
    if (row.balance < threshold) {
      seenPressure = true;
      continue;
    }
    if (!seenPressure) continue;
    let stable = true;
    for (let j = i; j < Math.min(rows.length, i + 7); j++) {
      if (rows[j].balance < threshold) {
        stable = false;
        break;
      }
    }
    if (stable) return { date: row.date, amount: row.balance };
  }
  return null;
}

function cashInsightLabel(type) {
  if (type === "reconcile") return "Reconcile forecast";
  if (type === "large_cluster" || type === "pressure_easing") return "Cash pressure";
  if (type === "transfer_timing" || type === "best_transfer_day") return "Safe to move";
  return "Projected balance";
}

function cashInsightPriority(type) {
  if (type === "low_balance") return 1;
  if (type === "tightest_day") return 2;
  if (type === "reconcile") return 3;
  if (type === "large_cluster") return 4;
  if (type === "transfer_timing") return 5;
  if (type === "best_transfer_day") return 6;
  if (type === "pressure_easing") return 7;
  return 9;
}

function buildCashInsightsForSurface({ daily, startIso = "", endIso = "", surface = "reports" } = {}) {
  const rows = getProjectedBalancesByDate(daily, { startIso, endIso });
  if (!rows.length) return [];
  const rangeStart = startIso || rows[0].date;
  const rangeEnd = endIso || rows[rows.length - 1].date;
  const todayIso = toISODate(new Date());
  const referenceIso = rangeEnd < todayIso ? rangeEnd : (rangeStart > todayIso ? rangeStart : todayIso);
  const floor = readStoredMinBalanceThresholdForReports();
  const insights = [];
  let positiveLowInsight = null;

  const low = getLowestBalanceInRange(rows, rangeStart, rangeEnd);
  const nextLow = floor != null ? getNextBelowFloorDate(rows, floor, referenceIso) : null;
  if (nextLow) {
    const shortfall = floor != null ? floor - nextLow.amount : 0;
    insights.push({
      id: `low-balance-${nextLow.date}`,
      type: "low_balance",
      severity: nextLow.amount < 0 || shortfall > Math.max(150, Number(floor || 0) * 0.15) ? "urgent" : "watch",
      title: "Cash pressure ahead",
      message:
        floor != null
          ? `Cash gets tight on ${fmtMonthDay(nextLow.date)}, when your projected balance dips below your $${fmtMoney(floor)} minimum balance at ${fmtMoney0SignedDollar(nextLow.amount)}.`
          : `Cash gets tight on ${fmtMonthDay(nextLow.date)}, when your projected balance reaches ${fmtMoney0SignedDollar(nextLow.amount)}.`,
      date: nextLow.date,
      amount: nextLow.amount,
    });
  } else if (floor != null) {
    positiveLowInsight = {
      id: `low-balance-clear-${rangeStart}-${rangeEnd}`,
      type: "low_balance",
      severity: "positive",
      title: "Cash pressure is clear",
      message: "No cash pressure days are currently projected in this range.",
    };
  }

  if (low) {
    const sameAsNextLow = !!(nextLow && nextLow.date === low.date);
    if (!sameAsNextLow || low.amount >= Number(floor ?? -Infinity)) {
      insights.push({
        id: `tightest-day-${low.date}`,
        type: "tightest_day",
        severity:
          low.amount < 0
            ? "urgent"
            : floor != null && low.amount < floor
              ? "watch"
              : "info",
        title: "Tightest day in range",
        message:
          floor != null && low.amount >= floor
            ? `Your tightest day is ${fmtMonthDay(low.date)}, and the projected balance still stays above your $${fmtMoney(floor)} minimum balance.`
            : `Your tightest day is ${fmtMonthDay(low.date)}, with a projected balance of ${fmtMoney0SignedDollar(low.amount)}.`,
        date: low.date,
        amount: low.amount,
      });
    }
  }

  const reconcile = getDaysSinceReconciled(todayIso);
  if (reconcile && reconcile.days > 3) {
    insights.push({
      id: `reconcile-${reconcile.lastReconciledDate}`,
      type: "reconcile",
      severity: reconcile.days > 7 ? "watch" : "info",
      title: reconcile.days > 7 ? "Reconcile forecast soon" : "Forecast could use a quick check-in",
      message: `Your forecast has not been reconciled in ${reconcile.days} days. Update your actual balance to keep projected balances trustworthy.`,
      date: reconcile.lastReconciledDate,
    });
  }

  const cluster = detectLargeExpenseClusters(rangeStart, rangeEnd);
  if (cluster) {
    insights.push({
      id: `large-cluster-${cluster.startDate}-${cluster.endDate}`,
      type: "large_cluster",
      severity: cluster.count >= 3 ? "watch" : "info",
      title: "Bills cluster together",
      message: `${cluster.count} large expenses hit between ${fmtMonthDay(cluster.startDate)} and ${fmtMonthDay(cluster.endDate)}. Grouped expenses can make cash feel tighter even when the month looks okay overall.`,
      date: cluster.startDate,
      amount: cluster.totalAmount,
      relatedTransactionIds: cluster.relatedTransactionIds,
    });
  }

  const transfer = floor != null
    ? compareSafeToTransferTodayVsFuture(rows, floor, { startIso: rangeStart, endIso: rangeEnd, fromIso: referenceIso })
    : null;
  if (transfer) {
    const helper = transfer.nextMajorExpense
      ? `${transfer.incomeEvent.description} clears before ${transfer.nextMajorExpense.description}.`
      : `${transfer.incomeEvent.description} clears before the next heavier stretch in this range.`;
    insights.push({
      id: `transfer-timing-${transfer.date}`,
      type: "transfer_timing",
      severity: "info",
      title: "Safe to move improves after payday",
      message: `Waiting until ${fmtMonthDay(transfer.date)} increases what is safe to move by about $${fmtMoney0(transfer.gain)}. ${helper}`,
      date: transfer.date,
      amount: transfer.gain,
    });
  }

  if (!insights.length && positiveLowInsight) insights.push(positiveLowInsight);
  if (!insights.length && surface === "forecast" && low) {
    insights.push({
      id: `cash-steady-${low.date}`,
      type: "tightest_day",
      severity: "positive",
      title: "Forecast looks steady",
      message: `Your lowest projected balance in this range is ${fmtMoney0SignedDollar(low.amount)} on ${fmtMonthDay(low.date)}.`,
      date: low.date,
      amount: low.amount,
    });
  }

  return insights.sort((a, b) => {
    const pa = cashInsightPriority(a?.type);
    const pb = cashInsightPriority(b?.type);
    if (pa !== pb) return pa - pb;
    const sa = ["urgent", "watch", "info", "positive"].indexOf(String(a?.severity || ""));
    const sb = ["urgent", "watch", "info", "positive"].indexOf(String(b?.severity || ""));
    return sa - sb;
  });
}

function renderCashInsights(host, insights, options = {}) {
  if (!host) return;
  const list = Array.isArray(insights) ? insights.filter(Boolean) : [];
  if (!list.length) {
    host.innerHTML = "";
    host.hidden = true;
    return;
  }
  const limit = Math.max(1, Number(options.limit || 3));
  const visible = list.slice(0, limit);
  const extra = list.slice(limit);
  const renderCard = (insight) => {
    const label = cashInsightLabel(insight.type);
    const actionHtml = insight.actionLabel && insight.actionHref
      ? `<a class="cash-insights__action" href="${escapeHtml(insight.actionHref)}">${escapeHtml(insight.actionLabel)}</a>`
      : "";
    return `<article class="cash-insights__card cash-insights__card--${escapeHtml(insight.severity || "info")}">
      <div class="cash-insights__eyebrow">${escapeHtml(label)}</div>
      <h3 class="cash-insights__title">${escapeHtml(insight.title || "")}</h3>
      <p class="cash-insights__message">${escapeHtml(insight.message || "")}</p>
      ${actionHtml}
    </article>`;
  };
  const introHtml = options.description
    ? `<p class="cash-insights__intro">${escapeHtml(options.description)}</p>`
    : "";
  const moreHtml = extra.length
    ? `<details class="cash-insights__more"><summary>View more insights</summary><div class="cash-insights__stack cash-insights__stack--extra">${extra.map(renderCard).join("")}</div></details>`
    : "";
  const bodyHtml = `${introHtml}<div class="cash-insights__stack">${visible.map(renderCard).join("")}</div>${moreHtml}`;

  if (options.variant === "sidebar") {
    host.innerHTML = `
      <div class="sidebar-section-head">
        <h2>${escapeHtml(options.title || "Cash insights")}</h2>
      </div>
      <div class="sidebar-section-body">
        <div class="cash-insights cash-insights--sidebar">${bodyHtml}</div>
      </div>
    `;
  } else {
    host.innerHTML = `<div class="cash-insights cash-insights--inline">${bodyHtml}</div>`;
  }
  host.hidden = false;
}

function refreshCalendarCashInsights() {
  if (!sidebarCashInsights) return;
  // Launch: hide Cash Insights in the sidebar to reduce noise; inline report insights remain.
  sidebarCashInsights.innerHTML = "";
  sidebarCashInsights.hidden = true;
}

function renderReportsBalanceTakeaway(items, dateLabels, values) {
  const el = document.getElementById("reportsBalanceTakeaway");
  if (!el) return;
  const lastItem = Array.isArray(items) && items.length ? items[items.length - 1] : null;
  const insights = lastCashInsightsForReports?.length
    ? lastCashInsightsForReports
    : buildCashInsightsForSurface({
      daily: items || [],
      startIso: chartStart?.value || String(items?.[0]?.date || ""),
      endIso:
        chartStart?.value && chartDaysRange?.value
          ? chartRangeEndIso(chartStart.value, Number(chartDaysRange.value || 0) || Math.max(1, items?.length || 1))
          : String(lastItem?.date || ""),
      surface: "reports",
    });
  renderCashInsights(el, insights, {
    variant: "inline",
    limit: 3,
  });
}

function renderReportsBalanceLegend(daily, dateLabels, values) {
  const el = document.getElementById("reportsBalanceLegend");
  if (!el) return;
  const items = daily || [];
  if (!items.length) {
    el.innerHTML = "";
    return;
  }
  let lowIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[lowIdx]) lowIdx = i;
  }
  const lowIso = String(dateLabels[lowIdx] || "");
  const negSpans = [];
  let spanStart = -1;
  for (let i = 0; i < values.length; i++) {
    const neg = values[i] < 0;
    if (neg && spanStart < 0) spanStart = i;
    if (!neg && spanStart >= 0) {
      negSpans.push({ a: spanStart, b: i - 1 });
      spanStart = -1;
    }
  }
  if (spanStart >= 0) negSpans.push({ a: spanStart, b: values.length - 1 });

  let worstOutflow = null;
  for (let i = 0; i < items.length; i++) {
    const net = Number(items[i].net_cashflow ?? 0);
    if (!Number.isFinite(net) || net >= 0) continue;
    if (!worstOutflow || net < worstOutflow.net) worstOutflow = { iso: String(items[i].date), net };
  }

  const thr = readStoredMinBalanceThresholdForReports();
  const hasNeg = negSpans.length > 0;
  let firstNeg = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < 0) {
      firstNeg = i;
      break;
    }
  }
  let recoveryPos = -1;
  if (firstNeg >= 0) {
    for (let j = firstNeg + 1; j < values.length; j++) {
      if (values[j] >= 0) {
        recoveryPos = j;
        break;
      }
    }
  }
  let lastNegIdx = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < 0) lastNegIdx = i;
  }

  const lowValue = Number(values[lowIdx]) < 0
    ? `−$${fmtMoney(Math.abs(Number(values[lowIdx]) || 0))}`
    : `$${fmtMoney(Number(values[lowIdx]) || 0)}`;

  let statusLabel = "Status";
  let statusValue = "Above zero";
  let statusSub = "Stays above zero in this window";
  let statusClass = " reports-kpi--calm";
  if (hasNeg && firstNeg >= 0) {
    statusLabel = "Negative starting";
    statusValue = fmtMonthDay(String(dateLabels[firstNeg] || ""));
    statusSub = recoveryPos >= 0
      ? `Recovers by ${fmtMonthDay(String(dateLabels[recoveryPos] || ""))}`
      : `Below zero through ${fmtMonthDay(String(dateLabels[lastNegIdx] || ""))}`;
    statusClass = " reports-kpi--risk";
  } else if (thr != null && Number.isFinite(thr) && thr > 0 && Number(values[lowIdx]) < thr) {
    statusLabel = "Minimum balance";
    statusValue = "Near minimum balance";
    statusSub = `${fmtMonthDay(lowIso)} at ${lowValue}`;
    statusClass = " reports-kpi--warn";
  }

  const lowClass = hasNeg
    ? " reports-kpi--risk"
    : thr != null && Number.isFinite(thr) && thr > 0 && Number(values[lowIdx]) < thr
      ? " reports-kpi--warn"
      : "";

  const outflowValue = worstOutflow
    ? `−$${fmtMoney(Math.abs(Number(worstOutflow.net) || 0))}`
    : "—";
  const outflowSub = worstOutflow
    ? fmtMonthDay(String(worstOutflow.iso || ""))
    : "No major negative day in this range";

  const floorValue = thr != null && Number.isFinite(thr) && thr > 0
    ? `$${fmtMoney(thr)}`
    : "Not set";
  const floorSub = thr != null && Number.isFinite(thr) && thr > 0
    ? "Saved minimum balance"
    : "Set in Settings";

  const kpi = (label, value, sub, extraClass = "") => `
    <div class="reports-kpi${extraClass}">
      <div class="reports-kpi__label">${escapeHtml(label)}</div>
      <div class="reports-kpi__value">${escapeHtml(value)}</div>
      <div class="reports-kpi__sub">${escapeHtml(sub)}</div>
    </div>
  `;

  el.innerHTML = `
    <div class="reports-kpi-strip">
      ${kpi("Lowest Balance", lowValue, fmtMonthDay(lowIso), lowClass)}
      ${kpi(statusLabel, statusValue, statusSub, statusClass)}
      ${kpi("Largest Outflow", outflowValue, outflowSub, " reports-kpi--neutral")}
      ${kpi("Minimum balance", floorValue, floorSub, " reports-kpi--floor")}
    </div>
  `;
}

function renderReportsSafeTransferNarrative(result) {
  const insightEl = document.getElementById("reportsSafeTransferInsight");
  const contextEl = document.getElementById("reportsSafeTransferContext");
  if (insightEl) {
    const leadRaw = result ? String(result.summaryLead || result.summary || "").trim() : "";
    const noteRaw = result ? String(result.summaryNote || "").trim() : "";
    const recRaw = result ? String(result.recoveryLine || "").trim() : "";
    const parts = [];
    if (leadRaw) {
      parts.push(`<p class="reports-safe-transfer-insight__lead">${escapeHtml(leadRaw)}</p>`);
    }
    if (noteRaw) {
      parts.push(`<p class="reports-safe-transfer-insight__note">${escapeHtml(noteRaw)}</p>`);
    }
    if (recRaw) {
      parts.push(`<p class="reports-safe-transfer-insight__recovery">${escapeHtml(recRaw)}</p>`);
    }
    insightEl.hidden = !parts.length;
    insightEl.innerHTML = parts.join("");
  }
  if (contextEl) {
    if (!result?.cards?.length) {
      contextEl.hidden = true;
      contextEl.innerHTML = "";
    } else {
      contextEl.hidden = false;
      contextEl.innerHTML = result.cards
        .map(
          (card) => `
            <article class="reports-safe-transfer-context__card">
              <div class="reports-safe-transfer-context__label">${escapeHtml(card.label)}</div>
              <p class="reports-safe-transfer-context__text">${escapeHtml(card.text)}</p>
            </article>
          `
        )
        .join("");
    }
  }
}

function pickReportsSafeTransferDriver(entries, kind) {
  const matches = (entries || [])
    .filter((entry) => String(entry?.kind || "") === kind)
    .sort((a, b) => Number(b?.amount || 0) - Number(a?.amount || 0));
  return matches[0] || null;
}

function buildReportsSafeTransferNarrative(items, series, floor) {
  const rows = Array.isArray(items) ? items : [];
  const labels = rows.map((row) => String(row?.date || ""));
  if (!rows.length || !series.length || !labels[0] || !labels[labels.length - 1]) return null;

  const occByIso = buildRiskOccurrencesIndex(labels[0], labels[labels.length - 1]);
  const peakIdx = series.reduce((best, value, idx, arr) => (value > arr[best] ? idx : best), 0);
  const lowIdx = series.reduce((best, value, idx, arr) => (value < arr[best] ? idx : best), 0);
  const firstZeroIdx = series.findIndex((value) => Number(value || 0) <= 0.5);
  const recoveryIdx =
    firstZeroIdx >= 0 ? series.findIndex((value, idx) => idx > firstZeroIdx && Number(value || 0) > 0.5) : -1;

  const peakIso = labels[peakIdx];
  const lowIso = labels[lowIdx];
  const peakValue = Number(series[peakIdx] || 0);
  const lowValue = Number(series[lowIdx] || 0);
  const lowEvents = occByIso.get(lowIso) || [];
  const lowExpense = pickReportsSafeTransferDriver(lowEvents, "expense");

  if (firstZeroIdx >= 0) {
    const zeroIso = labels[firstZeroIdx];
    const zeroEvents = occByIso.get(zeroIso) || [];
    const zeroExpense = pickReportsSafeTransferDriver(zeroEvents, "expense");
    const recoveryIso = recoveryIdx >= 0 ? labels[recoveryIdx] : "";
    const recoveryEvents = recoveryIdx >= 0 ? occByIso.get(recoveryIso) || [] : [];
    const recoveryIncome = pickReportsSafeTransferDriver(recoveryEvents, "income");

    const payer = zeroExpense ? String(zeroExpense.description || "").trim() : "";
    const summaryLead = payer
      ? `Safe to Move reaches $0 on ${fmtMonthDay(zeroIso)} after ${payer} clears.`
      : `Safe to Move reaches $0 on ${fmtMonthDay(zeroIso)}.`;
    const summaryNote =
      "$0 means your projected balance has reached your minimum balance — not that your account is empty.";
    let recoveryLine = "";
    if (recoveryIdx >= 0 && recoveryIso) {
      if (recoveryIncome && String(recoveryIncome.description || "").trim()) {
        const rn = String(recoveryIncome.description || "").trim();
        recoveryLine = `Safe to Move returns after ${rn} on ${fmtMonthDay(recoveryIso)}.`;
      } else {
        recoveryLine = `Safe to Move goes back above $0 around ${fmtMonthDay(recoveryIso)}.`;
      }
    }

    const cards = [
      {
        label: "What happened",
        text: `Your safe to move reaches $0 on ${fmtMonthDay(zeroIso)}.`,
      },
      {
        label: "Why",
        text: payer
          ? `The ${payer} payment uses the remaining cushion above your minimum balance.`
          : "Scheduled outflows use the cushion above your minimum balance.",
      },
      {
        label: "What to watch",
        text: "Avoid transferring additional money out before new income arrives.",
      },
    ];
    const annotations = [
      {
        idx: firstZeroIdx,
        value: Number(series[firstZeroIdx] || 0),
        label: zeroExpense ? truncate(zeroExpense.description, 18) : "Hits $0",
        kind: "outflow",
      },
    ];
    if (recoveryIdx >= 0) {
      annotations.push({
        idx: recoveryIdx,
        value: Number(series[recoveryIdx] || 0),
        label: recoveryIncome ? truncate(recoveryIncome.description, 18) : "Rebuilds",
        kind: "inflow",
      });
    }
    return {
      summaryLead,
      summaryNote,
      recoveryLine,
      cards,
      annotations,
    };
  }

  const summaryLead =
    peakIdx !== lowIdx
      ? `Highest safe to move sits near ${fmtMonthDay(peakIso)} (${fmtMoneyCompactTile(peakValue)}), narrowing to ${fmtMoneyCompactTile(
          lowValue
        )} by ${fmtMonthDay(lowIso)}.`
      : `Safe to Move stays near ${fmtMoneyCompactTile(peakValue)} across this window.`;

  const cards = [
    {
      label: "What happened",
      text:
        peakIdx !== lowIdx
          ? `The most you can move peaks around ${fmtMonthDay(peakIso)} (${fmtMoneyCompactTile(peakValue)}).`
          : `Safe to Move stays available across this forecast.`,
    },
    {
      label: "Why",
      text: lowExpense
        ? `${lowExpense.description} (${fmtMoneyCompactTile(-Math.abs(Number(lowExpense.amount || 0)))}) is the main reason it tightens on ${fmtMonthDay(lowIso)}.`
        : "Upcoming bills lower how much can leave checking while keeping your minimum balance.",
    },
    {
      label: "What to watch",
      text:
        lowValue <= Math.max(250, peakValue * 0.2)
          ? `Bigger transfers are safer earlier in this window—before safe to move narrows ${peakIdx !== lowIdx ? `around ${fmtMonthDay(lowIso)}` : ""}.`
          : `Your minimum balance stays protected; timing stays flexible unless you add new bills.`,
    },
  ];
  const annotations = [];
  if (peakValue > 0) {
    annotations.push({
      idx: peakIdx,
      value: peakValue,
      label: "Peak",
      kind: "inflow",
    });
  }
  if (lowIdx !== peakIdx) {
    annotations.push({
      idx: lowIdx,
      value: lowValue,
      label: lowExpense ? truncate(lowExpense.description, 18) : "Lowest point",
      kind: "outflow",
    });
  }
  return { summaryLead, cards, annotations };
}

function drawReportsSafeTransferChart(daily) {
  const canvas = document.getElementById("reportsSafeTransferCanvas");
  const emptyEl = document.getElementById("reportsSafeTransferEmpty");
  const statsEl = document.getElementById("reportsSafeTransferStats");
  if (!canvas || typeof Chart === "undefined") return;
  destroyReportsSafeTransferChart();
  const floor = readStoredMinBalanceThresholdForReports();
  const items = daily || [];
  if (items.length < 2) {
    if (emptyEl) {
      emptyEl.style.display = "flex";
      emptyEl.textContent = items.length ? "Not enough projection days." : "No projection data.";
    }
    if (statsEl) statsEl.innerHTML = "";
    renderReportsSafeTransferNarrative(null);
    return;
  }
  if (floor == null) {
    if (emptyEl) {
      emptyEl.style.display = "flex";
      emptyEl.textContent = "Set a minimum balance in Settings to see Safe to Move.";
    }
    if (statsEl) {
      statsEl.innerHTML =
        '<p class="meta reports-safe-transfer-meta">Safe to Move uses your saved minimum balance across the forecast range.</p>';
    }
    renderReportsSafeTransferNarrative(null);
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";
  const labels = items.map((d) => d.date);
  const series = computeSafeToTransferSeries(items, floor);
  const narrative = buildReportsSafeTransferNarrative(items, series, floor);
  const allZero = series.every((v) => !Number.isFinite(v) || v <= 0);
  if (allZero) {
    if (emptyEl) {
      emptyEl.style.display = "flex";
      emptyEl.textContent = "No Safe to Move above your minimum balance in this range.";
    }
    if (statsEl) {
      statsEl.innerHTML =
        '<p class="meta reports-safe-transfer-meta">Projected checking stays at or below your saved minimum balance for these dates.</p>';
    }
    renderReportsSafeTransferNarrative({
      summaryLead:
        "Safe to Move stays at $0 for this entire range—checking is projected at your minimum balance before any transfers.",
      summaryNote:
        "$0 means no cushion above your minimum balance yet, not necessarily an empty bank account.",
      cards: [
        {
          label: "What happened",
          text: "Safe to Move does not climb above $0 anywhere in this window.",
        },
        {
          label: "Why",
          text: "Bills scheduled in this forecast use the cushion that would normally be above your minimum balance.",
        },
        {
          label: "What to watch",
          text: "Wait for the next paycheck or add a buffer before moving more money out of checking.",
        },
      ],
    });
    return;
  }
  const hi = Math.max(...series);
  const lo = Math.min(...series);
  const avg = series.reduce((a, b) => a + b, 0) / series.length;
  const loTight = Number.isFinite(lo) && lo <= 0.55;
  const hiStrong = Number.isFinite(hi) && hi >= 500;
  if (statsEl) {
    statsEl.innerHTML = `<div class="reports-safe-stats">
      <div class="reports-safe-stats__tile${hiStrong ? " reports-safe-stats__tile--high" : ""}">
        <span class="reports-safe-stats__label">Highest safe to move</span>
        <span class="reports-safe-stats__amount">${fmtMoneyCompactTile(hi)}</span>
      </div>
      <div class="reports-safe-stats__tile${loTight ? " reports-safe-stats__tile--atfloor" : ""}">
        <span class="reports-safe-stats__label">Lowest safe to move</span>
        <span class="reports-safe-stats__amount">${fmtMoneyCompactTile(lo)}</span>
      </div>
      <div class="reports-safe-stats__tile">
        <span class="reports-safe-stats__label">Typical safe to move</span>
        <span class="reports-safe-stats__amount">${fmtMoneyCompactTile(avg)}</span>
      </div>
    </div>`;
  }
  renderReportsSafeTransferNarrative(narrative);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dipZeroIdx = series.findIndex((v) => Number(v || 0) <= 0.5);
  const pointRadii = series.map((_, i) => (i === dipZeroIdx && dipZeroIdx >= 0 ? 6 : 0));
  const pointBorderWidths = series.map((_, i) => (i === dipZeroIdx && dipZeroIdx >= 0 ? 2.25 : 0));
  const pointBackgroundColors = series.map((_, i) =>
    i === dipZeroIdx && dipZeroIdx >= 0 ? "rgba(254, 249, 247, 0.98)" : "rgba(255, 255, 255, 0)",
  );
  const pointBorderColors = series.map((_, i) =>
    i === dipZeroIdx && dipZeroIdx >= 0 ? "rgba(185, 28, 28, 0.95)" : "transparent",
  );
  const yTop = Math.max(...series.map((v) => Number(v) || 0));
  const suggestedMax = Math.max(800, yTop * 1.12);
  reportsSafeTransferChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Safe to Move",
          data: series,
          borderColor: "rgba(11, 61, 46, 0.92)",
          borderWidth: 2.85,
          fill: true,
          backgroundColor: ({ chart }) => {
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return "rgba(22, 101, 71, 0.12)";
            const top = chartArea.top;
            const bot = chartArea.bottom;
            const gr = c.createLinearGradient(0, top, 0, bot);
            gr.addColorStop(0, "rgba(22, 101, 71, 0.18)");
            gr.addColorStop(0.65, "rgba(22, 101, 71, 0.06)");
            gr.addColorStop(1, "rgba(22, 101, 71, 0)");
            return gr;
          },
          tension: 0.1,
          pointRadius: pointRadii,
          pointHoverRadius: series.map((_, i) => (pointRadii[i] ? 8 : 5)),
          pointHitRadius: series.map((_, i) => (pointRadii[i] ? 14 : 8)),
          pointBorderWidth: pointBorderWidths,
          pointBackgroundColor: pointBackgroundColors,
          pointBorderColor: pointBorderColors,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        balanceAnnotations: {
          annotations: Array.isArray(narrative?.annotations) ? narrative.annotations.slice(0, 2) : [],
          todayIdx: -1,
          floor: 0,
          floorDrawLine: true,
          floorLabel: "Minimum balance reached",
          todayBal: null,
        },
        tooltip: {
          callbacks: {
            title: (t) => formatProjectionTooltipDate(labels[t[0]?.dataIndex ?? 0]),
            label: (c) => ` Safe to Move ${fmtMoneyCompactTile(c.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
            font: { size: 10, weight: "600" },
            color: "rgba(71, 85, 105, 0.74)",
          },
        },
        y: {
          suggestedMin: 0,
          suggestedMax,
          grid: { color: "rgba(100, 116, 139, 0.1)", drawBorder: false },
          ticks: {
            font: { size: 10, weight: "600" },
            color: "rgba(71, 85, 105, 0.72)",
            callback: (v) => "$" + formatChartMoneyShort(v),
          },
        },
      },
    },
  });
}

function navigateToCalendarForRiskDay(iso) {
  const ym = String(iso || "").slice(0, 7);
  try {
    if (/^\d{4}-\d{2}$/.test(ym)) sessionStorage.setItem("bw_pending_cal_month", ym);
  } catch (_) {}
  try {
    window.location.assign(new URL("../calendar/", window.location.href).href);
  } catch (_) {
    window.location.href = "/calendar/";
  }
}

/**
 * Build an index of {iso -> [{description, amount, kind, category}]} occurrences
 * for the projection window. Combines recurring expected transactions and
 * one-time upcoming actuals so we can explain *why* a day is tight.
 */
function buildRiskOccurrencesIndex(startIso, endIso) {
  const idx = new Map();
  const push = (iso, entry) => {
    if (!iso || !entry) return;
    if (!idx.has(iso)) idx.set(iso, []);
    idx.get(iso).push(entry);
  };

  for (const tx of state.expectedTransactions || []) {
    let cursor = startIso;
    let safety = 0;
    while (cursor && safety < 400) {
      safety++;
      let next;
      try {
        next = nextExpectedOccurrenceIso(tx, cursor);
      } catch (_) {
        next = null;
      }
      if (!next) break;
      if (String(next) > String(endIso)) break;
      push(next, {
        description: String(tx.description || "Recurring").trim() || "Recurring",
        amount: Math.abs(Number(tx.amount || 0)),
        kind: String(tx.kind || "expense"),
        source: "expected",
      });
      cursor = addDaysIso(next, 1);
      if (!cursor || String(cursor) > String(endIso)) break;
    }
  }

  for (const tx of state.upcomingActualItems || []) {
    const iso = normalizeIsoDate(tx?.date) || String(tx?.date || "");
    if (!iso || iso < startIso || iso > endIso) continue;
    push(iso, {
      description: String(tx?.description || "Transaction").trim() || "Transaction",
      amount: Math.abs(Number(tx?.amount || 0)),
      kind: String(tx?.kind || "expense"),
      source: "actual",
    });
  }

  return idx;
}

/**
 * Pick the appropriate severity class for a day's projected balance.
 * Negatives use depth-based tiers so the eye can quickly tell a $500 dip
 * from a $15k deficit, instead of "wall of red".
 */
function riskSeverityClass(bal, thr, worstNeg) {
  if (bal < 0) {
    const depth = Math.abs(bal);
    const worst = Math.max(Math.abs(worstNeg || 0), 1);
    const ratio = depth / worst;
    // Shallow negatives stay visually quiet; deeper deficits step up separately.
    const shallowCut = Math.max(550, worst * 0.08);
    if (depth <= shallowCut) return "reports-risk-cell--neg-1";
    if (ratio >= 0.68 || depth >= worst * 0.82) return "reports-risk-cell--neg-3";
    if (ratio >= 0.33 || depth >= worst * 0.2) return "reports-risk-cell--neg-2";
    return "reports-risk-cell--neg-1";
  }
  if (thr != null && bal < thr) {
    const shortfall = thr - bal;
    // Keep modest cushion gaps in the lightest tier; reserve "deep" for material shortfalls.
    const deep = Math.max(380, thr * 0.28);
    if (shortfall >= deep) return "reports-risk-cell--below-deep";
    return "reports-risk-cell--below-soft";
  }
  if (thr != null && bal < thr * 1.12) return "reports-risk-cell--caution";
  return "reports-risk-cell--safe";
}

/** Human-readable cushion state for tooltip / scan (matches legend tiers). */
function riskPressureThresholdLabel(bal, thr, severityClass) {
  if (bal < 0) return "Negative balance";
  if (severityClass === "reports-risk-cell--below-soft" || severityClass === "reports-risk-cell--below-deep") {
    return "Below minimum balance";
  }
  if (severityClass === "reports-risk-cell--caution") return "Near minimum balance";
  return "Comfortable";
}

/** Short title for accessibility on calendar cells (plain text only). */
function riskPressureAriaLabel(iso, bal, thr, severityClass, firstStressIso, recoveryIso) {
  let s = `${fmtDateMedDisplay(iso)}, projected ${fmtMoney0SignedDollar(bal)}.`;
  const st = riskPressureThresholdLabel(bal, thr, severityClass);
  s += ` ${st}`;
  const gap = thr != null ? bal - thr : null;
  if (thr != null && gap != null) {
    if (gap < 0) s += ` (${fmtMoney0(Math.abs(gap))} below ${fmtMoney0(thr)} minimum).`;
    else s += ` (${fmtMoney0(gap)} above ${fmtMoney0(thr)} minimum).`;
  }
  if (firstStressIso && iso === firstStressIso) {
    s += " First day projected below cushion.";
  }
  if (recoveryIso && iso === recoveryIso) {
    s += " Cushion restores this day.";
  }
  s += " Show details.";
  return s;
}

function buildRiskPressureHoverTipHtml(payload, firstStressIso) {
  if (!payload) return "";
  const iso = String(payload.iso || "");
  const bal = Number(payload.balance ?? 0);
  const thr = payload.thr;
  const sev = String(payload.severityClass || "");
  const status = riskPressureThresholdLabel(bal, thr, sev);
  const outs = (payload.events || [])
    .filter((e) => e.kind === "expense")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);
  const ins = (payload.events || [])
    .filter((e) => e.kind === "income")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 2);
  const parts = [];
  parts.push(`<div class="reports-risk-tip__date">${escapeHtml(fmtDateMedDisplay(iso))}</div>`);
  parts.push(`<div class="reports-risk-tip__bal">${escapeHtml(fmtMoney0SignedDollar(bal))}</div>`);
  parts.push(`<div class="reports-risk-tip__status">${escapeHtml(status)}</div>`);
  if (thr != null) {
    const gap = bal - thr;
    if (gap < 0) {
      parts.push(
        `<div class="reports-risk-tip__muted">${escapeHtml(
          `$${fmtMoney0(Math.abs(gap))} below your $${fmtMoney0(thr)} minimum balance.`,
        )}</div>`,
      );
    } else if (gap >= 0) {
      parts.push(
        `<div class="reports-risk-tip__muted">${escapeHtml(
          `$${fmtMoney0(gap)} above your $${fmtMoney0(thr)} minimum balance.`,
        )}</div>`,
      );
    }
  } else if (bal < 0) {
    parts.push(`<div class="reports-risk-tip__muted">Projected checking balance goes negative.</div>`);
  }
  if (firstStressIso === iso && firstStressIso) {
    parts.push(`<div class="reports-risk-tip__flag">Risk begins · timing matters from here.</div>`);
  }
  if (outs.length) {
    parts.push('<div class="reports-risk-tip__sub">Driving outflows</div><ul class="reports-risk-tip__list">');
    for (const e of outs) {
      parts.push(
        `<li><span>${escapeHtml(truncate(e.description || "Expense", 40))}</span><span class="reports-risk-tip__amt reports-risk-tip__amt--out">−$${fmtMoney0(e.amount)}</span></li>`,
      );
    }
    parts.push("</ul>");
  }
  if (ins.length) {
    parts.push('<div class="reports-risk-tip__sub">Inflows today</div><ul class="reports-risk-tip__list reports-risk-tip__list--in">');
    for (const e of ins.slice(0, 2)) {
      parts.push(
        `<li><span>${escapeHtml(truncate(e.description || "Income", 36))}</span><span class="reports-risk-tip__amt reports-risk-tip__amt--in">+$${fmtMoney0(e.amount)}</span></li>`,
      );
    }
    parts.push("</ul>");
  }
  if (payload.recovery && (bal < 0 || (thr != null && bal < thr))) {
    const r = payload.recovery;
    parts.push(
      `<div class="reports-risk-tip__recovery">Next inflow · <strong>+$${fmtMoney0(r.amount)}</strong> ${escapeHtml(
        truncate(r.description || "", 42),
      )} on ${escapeHtml(fmtMonthDay(r.iso))}</div>`,
    );
  }
  parts.push(`<div class="reports-risk-tip__foot">Click to pin details in the side panel.</div>`);
  return `<div class="reports-risk-tip__inner">${parts.join("")}</div>`;
}

function riskDetailSeverityClass(severityClass) {
  if (!severityClass) return "";
  if (severityClass.startsWith("reports-risk-cell--neg")) return "reports-risk-detail--neg";
  if (
    severityClass === "reports-risk-cell--below-soft" ||
    severityClass === "reports-risk-cell--below-deep"
  ) {
    return "reports-risk-detail--low";
  }
  return "";
}

function riskActionGuidance(payload, primaryExpense) {
  const when = fmtMonthDay(String(payload?.iso || ""));
  if (primaryExpense?.description) {
    return `Move, reduce, or offset ${primaryExpense.description} before ${when}.`;
  }
  if (payload?.balance < 0) {
    return `Add or move cash before ${when} to keep this day out of the red.`;
  }
  if (payload?.thr != null && payload?.balance < payload.thr) {
    return `Shift a little cash before ${when} to stay above your minimum balance.`;
  }
  return "Keep upcoming large payments and inflows in sync so this day stays comfortable.";
}

function defaultRiskCalendarViewYm() {
  return getCalendarViewYm() || toISODate(new Date()).slice(0, 7);
}

function fmtMonthYearLabel(ym) {
  const d = new Date(`${String(ym || "").slice(0, 7)}-01T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(ym || "");
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** Monday-first calendar grid dates shown for a month (includes leading/trailing pad days). */
function riskCalendarGridIsosForMonth(ym) {
  const parts = String(ym || "").split("-").map(Number);
  const year = parts[0];
  const monthIndex = (parts[1] || 1) - 1;
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) return [];
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const first = new Date(year, monthIndex, 1);
  const lead = (first.getDay() + 6) % 7;
  const totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const rangeStart = new Date(year, monthIndex, 1 - lead);
  const isos = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(rangeStart);
    d.setDate(rangeStart.getDate() + i);
    isos.push(toISODate(d));
  }
  return isos;
}

function syncRiskCalendarMonthLabel() {
  const label = document.getElementById("reportsRiskCalMonthLabel");
  if (!label) return;
  const ym = riskCalendarViewYm || defaultRiskCalendarViewYm();
  label.textContent = fmtMonthYearLabel(ym);
}

function setRiskCalendarNavBusy(busy) {
  for (const id of ["reportsRiskCalPrev", "reportsRiskCalNext", "reportsRiskCalToday"]) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !!busy;
  }
  const wrap = document.querySelector("#reportRiskHeatmap .reports-risk-cal-wrap");
  if (wrap) wrap.classList.toggle("reports-risk-cal-wrap--loading", !!busy);
}

function riskHeatmapDayBalance(row) {
  if (!row || row.total_balance == null) return null;
  const bal = Number(row.total_balance);
  return Number.isFinite(bal) ? bal : null;
}

async function loadRiskCalendarDailyForMonth(ym) {
  const gridIsos = riskCalendarGridIsosForMonth(ym);
  if (!gridIsos.length) return [];
  if (!state.activeFamilyId) return gridIsos.map((iso) => ({ date: iso, total_balance: null }));

  const mode = calendarMode?.value || "both";
  const prev = shiftMonthStr(ym, -1);
  const next = shiftMonthStr(ym, 1);
  const balanceByIso = new Map();

  try {
    const payloads = await Promise.all(
      [ym, prev, next].map((month) =>
        api(
          `/api/families/${state.activeFamilyId}/calendar-month-daily?month=${encodeURIComponent(month)}&mode=${encodeURIComponent(mode)}`,
          "GET",
        ),
      ),
    );
    for (const data of payloads) {
      for (const row of data?.days || []) {
        const iso = normalizeIsoDate(row.date);
        if (!iso) continue;
        if (row.end == null) {
          balanceByIso.set(iso, null);
          continue;
        }
        const end = Number(row.end);
        balanceByIso.set(iso, Number.isFinite(end) ? end : null);
      }
    }
  } catch (_) {
    /* fall through to projection */
  }

  if (!balanceByIso.size) {
    const earliest = getFamilyEarliestStartingBalanceIso();
    const startIso = earliest && gridIsos[0] < earliest ? earliest : gridIsos[0];
    const summary = await api(
      `/api/families/${state.activeFamilyId}/projection?start=${encodeURIComponent(startIso)}&days=${gridIsos.length}&include_accounts=false`,
      "GET",
    );
    for (const row of summary?.daily || []) {
      const iso = normalizeIsoDate(row.date);
      if (!iso || isDateBeforeEarliestStartingBalance(iso)) continue;
      balanceByIso.set(iso, Number(row.total_balance ?? 0));
    }
  }

  return gridIsos.map((iso) => ({
    date: iso,
    total_balance: isDateBeforeEarliestStartingBalance(iso)
      ? null
      : balanceByIso.has(iso)
        ? balanceByIso.get(iso)
        : null,
  }));
}

async function refreshRiskCalendarMonth() {
  if (!document.getElementById("reportsRiskHeatmapGrid")) return;
  wireReportsRiskCalendarNavOnce();
  if (!riskCalendarViewYm) riskCalendarViewYm = defaultRiskCalendarViewYm();
  syncRiskCalendarMonthLabel();
  if (!state.activeFamilyId) {
    lastRiskCalendarDaily = [];
    renderReportsRiskHeatmap([]);
    return;
  }
  setRiskCalendarNavBusy(true);
  try {
    lastRiskCalendarDaily = await loadRiskCalendarDailyForMonth(riskCalendarViewYm);
    renderReportsRiskHeatmap(lastRiskCalendarDaily, riskCalendarViewYm);
  } catch (e) {
    lastRiskCalendarDaily = [];
    const insightEl = document.getElementById("reportsRiskHeatmapInsight");
    if (insightEl) {
      insightEl.textContent = e.message || "Could not load risk calendar for this month.";
      insightEl.hidden = false;
    }
    renderReportsRiskHeatmap([], riskCalendarViewYm);
  } finally {
    setRiskCalendarNavBusy(false);
  }
}

function shiftRiskCalendarMonth(delta) {
  if (!riskCalendarViewYm) riskCalendarViewYm = defaultRiskCalendarViewYm();
  const next = shiftMonthStr(riskCalendarViewYm, delta);
  if (!next) return;
  riskCalendarViewYm = next;
  void refreshRiskCalendarMonth();
}

function wireReportsRiskCalendarNavOnce() {
  if (reportsRiskCalendarNavWired) return;
  const prev = document.getElementById("reportsRiskCalPrev");
  const next = document.getElementById("reportsRiskCalNext");
  const today = document.getElementById("reportsRiskCalToday");
  if (!prev && !next && !today) return;
  reportsRiskCalendarNavWired = true;
  prev?.addEventListener("click", () => shiftRiskCalendarMonth(-1));
  next?.addEventListener("click", () => shiftRiskCalendarMonth(1));
  today?.addEventListener("click", () => {
    riskCalendarViewYm = toISODate(new Date()).slice(0, 7);
    void refreshRiskCalendarMonth();
  });
  calendarMode?.addEventListener("change", () => {
    if (document.getElementById("reportsRiskHeatmapGrid")) void refreshRiskCalendarMonth();
  });
}

function renderRiskHeatmapDetail(payload) {
  const host = document.getElementById("reportsRiskHeatmapDetail");
  if (!host) return;
  host.classList.remove("reports-risk-detail--neg", "reports-risk-detail--low");
  if (!payload) {
    host.innerHTML = `<div class="reports-risk-detail__hint">Hover or select a day to see projected balance, what drove it, and what could help.</div>`;
    return;
  }
  const sevDetailCls = riskDetailSeverityClass(payload.severityClass);
  if (sevDetailCls) host.classList.add(sevDetailCls);

  const dateLabel = fmtDateMedDisplay(payload.iso);
  const balLabel = fmtMoney0SignedDollar(payload.balance);

  let gapHtml = "";
  let statusLine = "";
  const threshLabel = riskPressureThresholdLabel(Number(payload.balance), payload.thr, String(payload.severityClass || ""));
  if (threshLabel === "Near minimum balance") {
    statusLine = `<div class="reports-risk-detail__status">${escapeHtml(threshLabel)}</div>`;
  }
  if (payload.thr != null) {
    const gap = payload.balance - payload.thr;
    if (gap < 0) {
      gapHtml = `<div class="reports-risk-detail__gap">Below your $${fmtMoney0(payload.thr)} minimum balance by $${fmtMoney0(Math.abs(gap))}.</div>`;
    } else {
      gapHtml = `<div class="reports-risk-detail__gap">Above your $${fmtMoney0(payload.thr)} minimum balance by $${fmtMoney0(gap)}.</div>`;
    }
  } else if (payload.balance < 0) {
    gapHtml = `<div class="reports-risk-detail__gap">Projected checking balance crosses below zero.</div>`;
  } else if (threshLabel !== "Comfortable") {
    gapHtml = `<div class="reports-risk-detail__gap">Set a minimum balance in Settings to flag cushion versus negative.</div>`;
  }

  const outs = (payload.events || [])
    .filter((e) => e.kind === "expense")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);
  const ins = (payload.events || [])
    .filter((e) => e.kind === "income")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 2);
  const primaryExpense = outs[0] || null;

  let driverHtml = "";
  if (primaryExpense) {
    driverHtml = `
      <div class="reports-risk-detail__sec reports-risk-detail__sec--divider">
        <div class="reports-risk-detail__sec-title">Main driver</div>
        <div class="reports-risk-detail__driver">
          <div class="reports-risk-detail__driver-text">
            <div class="reports-risk-detail__desc">${escapeHtml(primaryExpense.description)}</div>
          </div>
          <span class="reports-risk-detail__amtblk reports-risk-detail__amtblk--exp">−$${fmtMoney0(primaryExpense.amount)}</span>
        </div>
      </div>
    `;
  } else if (ins.length) {
    const leadIn = ins[0];
    driverHtml = `
      <div class="reports-risk-detail__sec reports-risk-detail__sec--divider">
        <div class="reports-risk-detail__sec-title">Main driver</div>
        <div class="reports-risk-detail__driver">
          <div class="reports-risk-detail__driver-text">
            <div class="reports-risk-detail__desc">${escapeHtml(leadIn.description)}</div>
          </div>
          <span class="reports-risk-detail__amtblk reports-risk-detail__amtblk--inc">+$${fmtMoney0(leadIn.amount)}</span>
        </div>
      </div>
    `;
  } else {
    driverHtml = `<div class="reports-risk-detail__sec reports-risk-detail__sec--divider"><div class="reports-risk-detail__sec-title">Main driver</div><div class="reports-risk-detail__muted">No scheduled flows on this day.</div></div>`;
  }

  const helpText = riskActionGuidance(payload, primaryExpense);
  const helpHtml = `
    <div class="reports-risk-detail__sec reports-risk-detail__sec--divider">
      <div class="reports-risk-detail__sec-title">What could help</div>
      <div class="reports-risk-detail__help">${escapeHtml(helpText)}</div>
    </div>
  `;

  let recHtml = "";
  if (payload.recovery) {
    const r = payload.recovery;
    recHtml = `<div class="reports-risk-detail__rec reports-risk-detail__rec--divider">
      <div class="reports-risk-detail__sec-title">Next inflow</div>
      <div class="reports-risk-detail__inflow">
        <div class="reports-risk-detail__inflow-amt">+$${fmtMoney0(r.amount)}</div>
        <div class="reports-risk-detail__inflow-meta">${escapeHtml(r.description)} on ${escapeHtml(fmtMonthDay(r.iso))}</div>
      </div>
    </div>`;
  } else if (payload.balance < 0 || (payload.thr != null && payload.balance < payload.thr)) {
    recHtml = `<div class="reports-risk-detail__rec reports-risk-detail__rec--muted reports-risk-detail__rec--divider"><div class="reports-risk-detail__sec-title">Next inflow</div><div class="reports-risk-detail__muted">No projected inflow before the end of this window.</div></div>`;
  }

  host.innerHTML = `
    <div class="reports-risk-detail__head reports-risk-detail__head--stack">
      <div class="reports-risk-detail__date">${escapeHtml(dateLabel)}</div>
      <div class="reports-risk-detail__balblock">
        <div class="reports-risk-detail__bal-label">Projected balance</div>
        <div class="reports-risk-detail__balance">${escapeHtml(balLabel)}</div>
      </div>
    </div>
    ${gapHtml}
    ${statusLine}
    ${driverHtml}
    ${helpHtml}
    ${recHtml}
  `;
}

function renderRiskHeatmapActionPanel(items, occByIso, thr, todayIso, worstIso) {
  const host = document.getElementById("reportsRiskHeatmapAction");
  if (!host) return;
  host.hidden = true;
  host.innerHTML = "";
  if (!items?.length) return;

  const anyTrouble = items.some((row) => {
    const bal = Number(row.total_balance ?? 0);
    return bal < 0 || (thr != null && bal < thr);
  });
  if (!anyTrouble) return;

  const suggestions = [];

  // Largest outflow in the window
  let largestOut = null;
  for (const row of items) {
    const iso = String(row.date || "");
    const ev = occByIso.get(iso) || [];
    for (const e of ev) {
      if (e.kind !== "expense") continue;
      if (!largestOut || e.amount > largestOut.amount) {
        largestOut = { ...e, iso };
      }
    }
  }
  if (largestOut) {
    suggestions.push(
      `The biggest hit in this window is <strong>${escapeHtml(largestOut.description)}</strong> on ${escapeHtml(fmtMonthDay(largestOut.iso))} (<strong>−$${fmtMoney0(largestOut.amount)}</strong>). Shifting it by a few days could relieve pressure.`
    );
  }

  // First day below the minimum balance — find an income that lands within ~7 days before it.
  const troubleIdx = items.findIndex((row) => {
    const bal = Number(row.total_balance ?? 0);
    return bal < 0 || (thr != null && bal < thr);
  });
  if (troubleIdx >= 0) {
    const troubleIso = String(items[troubleIdx].date || "");
    // Look for the largest inflow within the 14 days before trouble.
    let bestInflow = null;
    for (let k = Math.max(0, troubleIdx - 14); k < troubleIdx; k++) {
      const iso = String(items[k].date || "");
      const ev = occByIso.get(iso) || [];
      for (const e of ev) {
        if (e.kind !== "income") continue;
        if (!bestInflow || e.amount > bestInflow.amount) {
          bestInflow = { ...e, iso };
        }
      }
    }
    if (bestInflow) {
      suggestions.push(
        `A paycheck of <strong>+$${fmtMoney0(bestInflow.amount)}</strong> arrives on ${escapeHtml(fmtMonthDay(bestInflow.iso))} — consider moving a buffer before ${escapeHtml(fmtMonthDay(troubleIso))}.`
      );
    } else {
      suggestions.push(
        `No paycheck is projected before ${escapeHtml(fmtMonthDay(troubleIso))} — a transfer from savings ahead of that date would keep you above your minimum balance.`
      );
    }
  }

  // Largest recovery — a big inflow after the worst day.
  if (worstIso) {
    let bestRecovery = null;
    for (const row of items) {
      const iso = String(row.date || "");
      if (iso <= worstIso) continue;
      const ev = occByIso.get(iso) || [];
      for (const e of ev) {
        if (e.kind !== "income") continue;
        if (!bestRecovery || e.amount > bestRecovery.amount) {
          bestRecovery = { ...e, iso };
        }
      }
    }
    if (bestRecovery) {
      suggestions.push(
        `Largest recovery: <strong>+$${fmtMoney0(bestRecovery.amount)}</strong> on ${escapeHtml(fmtMonthDay(bestRecovery.iso))} — ${escapeHtml(bestRecovery.description)}.`
      );
    }
  }

  if (!suggestions.length) return;
  host.innerHTML = `
    <div class="reports-risk-action__title">What could help?</div>
    <ul class="reports-risk-action__items">
      ${suggestions.slice(0, 3).map((s) => `<li>${s}</li>`).join("")}
    </ul>
  `;
  host.hidden = false;
}

function renderReportsRiskHeatmap(daily, viewYm = riskCalendarViewYm || defaultRiskCalendarViewYm()) {
  const host = document.getElementById("reportsRiskHeatmapGrid");
  const insightEl = document.getElementById("reportsRiskHeatmapInsight");
  if (!host) return;
  host.innerHTML = "";
  hideRiskPressureTipNow();
  const items = Array.isArray(daily) ? daily : [];
  const thr = readStoredMinBalanceThresholdForReports();
  const monthLabel = fmtMonthYearLabel(viewYm);

  const setInsight = (text, hidden) => {
    if (!insightEl) return;
    insightEl.textContent = text || "";
    insightEl.hidden = !!hidden || !text;
  };

  if (!items.length) {
    setInsight("", true);
    renderRiskHeatmapDetail(null);
    const actionHost = document.getElementById("reportsRiskHeatmapAction");
    if (actionHost) { actionHost.innerHTML = ""; actionHost.hidden = true; }
    return;
  }

  const dayTight = (bal) => bal != null && (thr != null ? bal < thr : bal < 0);
  const hasAnyBalance = items.some((row) => riskHeatmapDayBalance(row) != null);

  if (!hasAnyBalance) {
    setInsight(`No forecast data before your starting balance date in ${monthLabel}.`, false);
  }

  let run = 0;
  let runStart = -1;
  let bestLen = 0;
  let bestStartIso = "";
  for (let i = 0; i < items.length; i++) {
    const bal = riskHeatmapDayBalance(items[i]);
    if (bal == null) {
      if (run > bestLen) {
        bestLen = run;
        bestStartIso = String(items[runStart].date || "");
      }
      run = 0;
      continue;
    }
    if (dayTight(bal)) {
      if (run === 0) runStart = i;
      run++;
    } else {
      if (run > bestLen) {
        bestLen = run;
        bestStartIso = String(items[runStart].date || "");
      }
      run = 0;
    }
  }
  if (run > bestLen) {
    bestLen = run;
    bestStartIso = String(items[runStart]?.date || "");
  }

  const firstStressIdx = items.findIndex((row) => {
    const bal = riskHeatmapDayBalance(row);
    return bal != null && dayTight(bal);
  });
  const firstStressIso = firstStressIdx >= 0 ? String(items[firstStressIdx]?.date || "") : "";
  const eveBeforeStressIso =
    firstStressIdx > 0 ? String(items[firstStressIdx - 1]?.date || "") : "";

  let recoveryIso = "";
  let seenStress = false;
  for (const row of items) {
    const bal = riskHeatmapDayBalance(row);
    const iso = String(row.date || "");
    if (bal == null) continue;
    if (dayTight(bal)) {
      seenStress = true;
    } else if (seenStress && !recoveryIso) {
      recoveryIso = iso;
    }
  }

  const recoverySuffix = recoveryIso && firstStressIso ? ` Safe again ${fmtMonthDay(recoveryIso)}.` : "";

  if (bestLen >= 2 && bestStartIso) {
    setInsight(
      (thr != null
        ? `Projected below your $${fmtMoney(thr)} minimum balance for ${bestLen} straight days beginning ${fmtMonthDay(bestStartIso)}.`
        : `Projected negative balance for ${bestLen} straight days beginning ${fmtMonthDay(bestStartIso)}.`) + recoverySuffix,
      false,
    );
  } else if (bestLen === 1 && bestStartIso) {
    setInsight(
      (thr != null
        ? `Projected below your $${fmtMoney(thr)} minimum balance on ${fmtMonthDay(bestStartIso)}.`
        : `Projected negative balance on ${fmtMonthDay(bestStartIso)}.`) + recoverySuffix,
      false,
    );
  } else if (!hasAnyBalance) {
    /* insight already set above */
  } else if (thr != null) {
    setInsight(`Stays above your $${fmtMoney(thr)} minimum balance in ${monthLabel}.`, false);
  } else {
    const anyNeg = items.some((row) => {
      const bal = riskHeatmapDayBalance(row);
      return bal != null && bal < 0;
    });
    setInsight(
      anyNeg
        ? "Set a minimum balance in Settings to flag cushion risk and below-target streaks."
        : `No projected negative days in ${monthLabel}. Set a minimum balance in Settings to tune cushion bands.`,
      false
    );
  }

  // Compute the worst (most negative) balance and its date — anchors severity tiers
  // and powers the default "preview" shown in the detail panel.
  let worstNeg = 0;
  let worstIso = "";
  for (const row of items) {
    const bal = riskHeatmapDayBalance(row);
    if (bal == null) continue;
    if (bal < worstNeg) {
      worstNeg = bal;
      worstIso = String(row.date || "");
    }
  }

  // Per-day occurrence index — expand recurring + one-time across the window.
  const startIso = String(items[0].date || "");
  const endIso = String(items[items.length - 1].date || "");
  const occByIso = buildRiskOccurrencesIndex(startIso, endIso);

  // Pre-compute lookup of next significant inflow after each iso (for "recovery").
  const incomeIsoSorted = [];
  for (const [iso, evs] of occByIso.entries()) {
    const incomes = evs.filter((e) => e.kind === "income");
    if (!incomes.length) continue;
    incomes.sort((a, b) => b.amount - a.amount);
    incomeIsoSorted.push({ iso, event: incomes[0] });
  }
  incomeIsoSorted.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
  const nextInflowFromIso = (iso) => {
    for (const row of incomeIsoSorted) {
      if (row.iso >= iso) return { iso: row.iso, ...row.event };
    }
    return null;
  };

  const todayIso = toISODate(new Date());
  const cellByIso = new Map();
  const detailPayloadByIso = new Map();
  let selectedIso = "";
  const viewYmKey = String(viewYm || "").slice(0, 7);
  const expectedGrid = riskCalendarGridIsosForMonth(viewYmKey);
  const isPrebuiltGrid =
    expectedGrid.length > 0 &&
    items.length === expectedGrid.length &&
    String(items[0]?.date || "") === expectedGrid[0] &&
    String(items[items.length - 1]?.date || "") === expectedGrid[expectedGrid.length - 1];
  let lead = 0;

  if (!isPrebuiltGrid) {
    const firstDt = new Date(`${startIso}T12:00:00`);
    lead = Number.isNaN(firstDt.getTime()) ? 0 : (firstDt.getDay() + 6) % 7;
    for (let p = 0; p < lead; p++) {
    const ph = document.createElement("div");
    ph.className = "reports-risk-pad";
    ph.setAttribute("aria-hidden", "true");
    host.appendChild(ph);
    }
  }

  let prevMonth = -1;
  for (const row of items) {
    const iso = String(row.date || "");
    const bal = riskHeatmapDayBalance(row);
    const isNoData = bal == null;

    const dt = new Date(`${iso}T12:00:00`);
    const dom = Number.isNaN(dt.getTime()) ? 0 : dt.getDate();
    const m0 = Number.isNaN(dt.getTime()) ? -1 : dt.getMonth();

    const cell = document.createElement("button");
    cell.type = "button";
    if (isNoData) {
      cell.className = "reports-risk-cell reports-risk-cell--no-data";
      if (isPrebuiltGrid && viewYmKey && iso.slice(0, 7) !== viewYmKey) {
        cell.classList.add("reports-risk-cell--outside");
      }
      if (m0 !== prevMonth) {
        cell.classList.add("reports-risk-cell--month-start");
        cell.dataset.month = Number.isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("en-US", { month: "short" });
        prevMonth = m0;
      }
      cell.disabled = true;
      cell.setAttribute("tabindex", "-1");
      cell.setAttribute("aria-label", `${fmtDateMedDisplay(iso)}. Before starting balance.`);
      const dEl = document.createElement("span");
      dEl.className = "reports-risk-cell__d";
      dEl.textContent = String(dom || "");
      cell.appendChild(dEl);
      host.appendChild(cell);
      continue;
    }

    const sevCls = riskSeverityClass(bal, thr, worstNeg);
    cell.className = `reports-risk-cell ${sevCls}`;
    if (isPrebuiltGrid && viewYmKey && iso.slice(0, 7) !== viewYmKey) {
      cell.classList.add("reports-risk-cell--outside");
    }
    if (m0 !== prevMonth) {
      cell.classList.add("reports-risk-cell--month-start");
      cell.dataset.month = Number.isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("en-US", { month: "short" });
      prevMonth = m0;
    }
    if (iso === todayIso) cell.classList.add("reports-risk-cell--today");
    if (firstStressIso && iso === firstStressIso) cell.classList.add("reports-risk-cell--risk-start");
    if (recoveryIso && iso === recoveryIso) cell.classList.add("reports-risk-cell--recovery-day");
    if (eveBeforeStressIso && iso === eveBeforeStressIso) cell.classList.add("reports-risk-cell--eve-risk");

    const recovery = nextInflowFromIso(addDaysIso(iso, 1) || iso);
    const events = occByIso.get(iso) || [];
    const payload = {
      iso,
      balance: bal,
      thr,
      severityClass: sevCls,
      events,
      recovery,
    };
    detailPayloadByIso.set(iso, payload);

    cell.removeAttribute("title");

    if (firstStressIso && iso === firstStressIso) {
      const mark = document.createElement("span");
      mark.className = "reports-risk-cell__risk-mark";
      mark.setAttribute("aria-hidden", "true");
      cell.appendChild(mark);
    }

    if (recoveryIso && iso === recoveryIso) {
      const pill = document.createElement("span");
      pill.className = "reports-risk-cell__recovery-pill";
      pill.textContent = "Safe again";
      cell.appendChild(pill);
    }

    const bEl = document.createElement("span");
    bEl.className = "reports-risk-cell__b";
    bEl.textContent = fmtMoneyCompactTile(bal);
    const dEl = document.createElement("span");
    dEl.className = "reports-risk-cell__d";
    dEl.textContent = String(dom || "");
    cell.appendChild(bEl);
    cell.appendChild(dEl);

    cell.setAttribute(
      "aria-label",
      riskPressureAriaLabel(iso, bal, thr, sevCls, firstStressIso, recoveryIso),
    );

    bindRiskPressureCellHover(cell, cell, buildRiskPressureHoverTipHtml(payload, firstStressIso));

    const activate = (persist = false) => {
      for (const el of cellByIso.values()) el.classList.remove("reports-risk-cell--active");
      cell.classList.add("reports-risk-cell--active");
      renderRiskHeatmapDetail(payload);
      if (persist) selectedIso = iso;
    };
    cell.addEventListener("mouseenter", () => activate(false));
    cell.addEventListener("focus", () => activate(false));
    cell.addEventListener("click", (ev) => {
      ev.preventDefault();
      activate(true);
    });

    cellByIso.set(iso, cell);
    host.appendChild(cell);
  }

  if (!isPrebuiltGrid) {
    const used = lead + items.length;
    const trail = (7 - (used % 7)) % 7;
    for (let p = 0; p < trail; p++) {
      const ph = document.createElement("div");
      ph.className = "reports-risk-pad";
      ph.setAttribute("aria-hidden", "true");
      host.appendChild(ph);
    }
  }

  // Show a sensible default in the detail panel — pick the worst day if there's
  // any stress, otherwise show "today". This gives an immediate example of what
  // hovering reveals, instead of an empty panel on first load.
  let defaultIso = "";
  if (worstIso && (worstNeg < 0 || (thr != null && worstNeg < thr))) {
    defaultIso = worstIso;
  } else if (cellByIso.has(todayIso)) {
    defaultIso = todayIso;
  } else {
    const firstWithBalance = items.find((row) => riskHeatmapDayBalance(row) != null);
    if (firstWithBalance) defaultIso = String(firstWithBalance.date || "");
  }
  if (defaultIso && detailPayloadByIso.has(defaultIso)) {
    selectedIso = defaultIso;
    renderRiskHeatmapDetail(detailPayloadByIso.get(defaultIso));
    const c = cellByIso.get(defaultIso);
    if (c) c.classList.add("reports-risk-cell--active");
  } else {
    renderRiskHeatmapDetail(null);
  }

  // Reset to default when the cursor leaves the grid entirely.
  host.onmouseleave = () => {
    hideRiskPressureTipNow();
    const activeCell = host.querySelector(".reports-risk-cell--active");
    if (activeCell) activeCell.classList.remove("reports-risk-cell--active");
    if (selectedIso && detailPayloadByIso.has(selectedIso)) {
      const c = cellByIso.get(selectedIso);
      if (c) c.classList.add("reports-risk-cell--active");
      renderRiskHeatmapDetail(detailPayloadByIso.get(selectedIso));
    } else {
      renderRiskHeatmapDetail(null);
    }
  };

  const actionHost = document.getElementById("reportsRiskHeatmapAction");
  if (actionHost) {
    actionHost.innerHTML = "";
    actionHost.hidden = true;
  }
}

const OBLIGATION_GROUP_ICONS = {
  Housing: "🏠",
  Utilities: "💡",
  Debt: "💳",
  Subscriptions: "🔁",
  Insurance: "🛡",
  "Kids / activities": "🎒",
  "Other obligations": "📦",
};

const OBLIGATION_GROUP_TONES = {
  Housing: "#1d4ed8",
  Utilities: "#0d9488",
  Debt: "#be123c",
  Subscriptions: "#6d28d9",
  Insurance: "#0369a1",
  "Kids / activities": "#be185d",
  "Other obligations": "#475569",
};

/**
 * Expand all recurring expense occurrences in [startIso, endIso] inclusive.
 * Returns Map<iso, [{description, amount}]> for the timing-cluster analysis.
 */
function buildObligationOccurrencesIndex(startIso, endIso) {
  const idx = new Map();
  for (const tx of state.expectedTransactions || []) {
    if (String(tx.kind || "") !== "expense") continue;
    const amt = Number(tx.amount || 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    let cursor = startIso;
    let safety = 0;
    while (cursor && safety < 400) {
      safety++;
      let next;
      try {
        next = nextExpectedOccurrenceIso(tx, cursor);
      } catch (_) {
        next = null;
      }
      if (!next) break;
      if (String(next) > String(endIso)) break;
      if (!idx.has(next)) idx.set(next, []);
      idx.get(next).push({
        description: String(tx.description || "Recurring").trim() || "Recurring",
        amount: amt,
      });
      cursor = addDaysIso(next, 1);
      if (!cursor || String(cursor) > String(endIso)) break;
    }
  }
  return idx;
}

/** Monday-aligned ISO for the week containing `iso`. */
function isoWeekStart(iso) {
  const d = parseIsoDateLocal(iso);
  if (!d) return iso;
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return toISODate(d);
}

function fmtWeekRange(startIso) {
  const start = parseIsoDateLocal(startIso);
  if (!start) return startIso;
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const s = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const e = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  // If same month, collapse: "May 14–20"
  if (start.getMonth() === end.getMonth()) {
    return `${s.split(" ")[0]} ${start.getDate()}–${end.getDate()}`;
  }
  return `${s} – ${e}`;
}

function setReportsObligationStat(el, primary, secondary) {
  if (!el) return;
  if (!primary) {
    el.textContent = "—";
    return;
  }
  const primaryHtml = escapeHtml(String(primary));
  if (!secondary) {
    el.innerHTML = `<span class="reports-ob-card__big">${primaryHtml}</span>`;
    return;
  }
  el.innerHTML = `<span class="reports-ob-card__big">${primaryHtml}</span><span class="reports-ob-card__sub">${escapeHtml(
    String(secondary)
  )}</span>`;
}

function obligationForecastBalanceOnIso(iso) {
  const key = normalizeIsoDate(String(iso || "")) || "";
  if (!key) return null;
  const daily = lastProjectionDailyForReports || [];
  for (let i = 0; i < daily.length; i++) {
    const d = daily[i];
    if (String(d?.date || "") === key) {
      const b = Number(d?.total_balance ?? NaN);
      return Number.isFinite(b) ? b : null;
    }
  }
  return null;
}

function renderObligationTakeaway(allRows) {
  const el = document.getElementById("reportsObligationTakeaway");
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
  el.classList.remove("reports-ob-takeaway--strong");
  if (!allRows.length) return;

  const total = allRows.reduce((sum, row) => sum + row.est, 0);
  if (!(total > 0)) return;

  const byGroup = new Map();
  for (const row of allRows) byGroup.set(row.grp, (byGroup.get(row.grp) || 0) + row.est);
  const grpShare = (g) => ((byGroup.get(g) || 0) / total) * 100;
  const sharePair = (a, b) => (((byGroup.get(a) || 0) + (byGroup.get(b) || 0)) / total) * 100;

  const todayIso = toISODate(new Date());

  /** First intelligence-style sentence wins (clearer than stacking generic stats). */
  let text = "";

  const buckets = new Map();
  for (const r of allRows) {
    const wk = isoWeekStart(r.nextIso || "");
    if (!wk || r.nextIso < todayIso) continue;
    if (!buckets.has(wk)) buckets.set(wk, []);
    buckets.get(wk).push(r);
  }

  outer: for (const [, list] of [...buckets.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    const majors = list.filter((r) => r.amt >= REPORTS_OBL_LARGE_THRESHOLD || r.est >= REPORTS_OBL_LARGE_THRESHOLD * 0.45);
    if (majors.length >= 2) {
      majors.sort((a, b) => b.amt - a.amt || b.est - a.est);
      text = `${majors[0].desc} and ${majors[1].desc} are both due in the same week (${fmtWeekRange(isoWeekStart(majors[0].nextIso))}).`;
      break outer;
    }
    if (
      majors.length &&
      list.length >= 2 &&
      majors[0].amt >= REPORTS_OBL_LARGE_THRESHOLD &&
      list.filter((r) => r.amt >= Math.max(1500, majors[0].amt * 0.35)).length >= 2
    ) {
      list.sort((a, b) => b.amt - a.amt);
      text = `Two sizeable recurring bills — ${list[0].desc} and ${list[1].desc} — land together in ${fmtWeekRange(
        isoWeekStart(list[0].nextIso),
      )}.`;
      break outer;
    }
  }

  if (!text && grpShare("Debt") >= 36) {
    text = "Debt obligations dominate this forecast.";
    el.classList.add("reports-ob-takeaway--strong");
  }

  if (!text && sharePair("Housing", "Debt") >= 85) {
    text = `Housing and debt account for ${Math.round(sharePair("Housing", "Debt"))}% of recurring obligations.`;
  }

  if (!text && grpShare("Housing") >= 48) {
    text = `${Math.round(grpShare("Housing"))}% of monthly commitments ties back to housing.`;
  }

  const sortedGrp = [...byGroup.entries()].sort((a, b) => b[1] - a[1]);
  const largestEntry = sortedGrp[0] || null;
  const topRows = allRows
    .slice()
    .sort((a, b) => b.est - a.est || b.amt - a.amt)
    .slice(0, 2);

  if (!text && largestEntry?.[0]) {
    const pct = Math.round((largestEntry[1] / total) * 100);
    if (pct >= 58) {
      text = `${largestEntry[0]} accounts for ${pct}% of recurring monthly obligations.`;
    }
  }
  if (!text && topRows.length >= 2) {
    const topTwoPct = Math.round(((topRows[0].est + topRows[1].est) / total) * 100);
    if (topTwoPct >= 48) {
      text = `${topRows[0].desc} and ${topRows[1].desc} together shape ${topTwoPct}% of monthly commitments.`;
    }
  }
  if (!text && largestEntry?.[0]) {
    const pct = Math.round((largestEntry[1] / total) * 100);
    text = `${largestEntry[0]} is your largest recurring category (${pct}% of commitments).`;
  }
  if (!text) return;

  el.textContent = text;
  el.hidden = false;
}

function renderObligationMixBars(allRows) {
  const host = document.getElementById("reportsObligationMixBars");
  const caption = document.getElementById("reportsObligationMixCaption");
  if (!host) return;
  host.innerHTML = "";
  if (!allRows.length) {
    if (caption) caption.textContent = "";
    return;
  }
  // Sum estimated monthly by group.
  const byGroup = new Map();
  let total = 0;
  for (const r of allRows) {
    byGroup.set(r.grp, (byGroup.get(r.grp) || 0) + r.est);
    total += r.est;
  }
  const entries = [...byGroup.entries()].sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 5);
  const max = top[0]?.[1] || 1;
  if (caption) {
    if (top.length) {
      const [biggestName, biggestVal] = top[0];
      const pct = total > 0 ? Math.round((biggestVal / total) * 100) : 0;
      caption.textContent = `${biggestName} accounts for ${pct}% of your $${fmtMoney(total)} monthly recurring.`;
    } else {
      caption.textContent = "";
    }
  }
  for (const [g, val] of top) {
    const li = document.createElement("li");
    li.className = "reports-ob-bar";
    li.style.setProperty("--reports-ob-tone", OBLIGATION_GROUP_TONES[g] || "var(--accent)");
    const pct = total > 0 ? (val / total) * 100 : 0;
    const width = max > 0 ? Math.max(6, (val / max) * 100) : 0;
    const icon = OBLIGATION_GROUP_ICONS[g] || "•";
    li.innerHTML = `
      <span class="reports-ob-bar__label"><span class="reports-ob-bar__icon" aria-hidden="true">${icon}</span>${escapeHtml(g)}</span>
      <span class="reports-ob-bar__track"><span class="reports-ob-bar__fill" style="width: ${width.toFixed(1)}%"></span></span>
      <span class="reports-ob-bar__value"><span class="reports-ob-bar__money">$${fmtMoney(val)}</span><span class="reports-ob-bar__pct">${pct.toFixed(
        0
      )}%</span></span>
    `;
    host.appendChild(li);
    bindFastTxnTipHover(
      li,
      `$${fmtMoney(val)}/mo normalized · ${pct.toFixed(0)}% of $${fmtMoney(
        total,
      )} recurring · Obligation category: ${g}`,
    );
  }
}

function renderObligationHeavyWeeks(allRows) {
  const host = document.getElementById("reportsObligationTimingList");
  const caption = document.getElementById("reportsObligationTimingCaption");
  if (!host) return;
  host.innerHTML = "";
  if (!allRows.length) {
    if (caption) caption.textContent = "";
    return;
  }

  const todayIso = toISODate(new Date());
  const endIso = addDaysIso(todayIso, 56); // ~8 weeks
  const idx = buildObligationOccurrencesIndex(todayIso, endIso);

  // Bucket occurrences by Monday-aligned week start.
  const weeks = new Map();
  for (const [iso, evs] of idx.entries()) {
    const wk = isoWeekStart(iso);
    if (!weeks.has(wk)) weeks.set(wk, { sum: 0, count: 0, big: [], hits: [] });
    const bucket = weeks.get(wk);
    for (const e of evs) {
      bucket.sum += e.amount;
      bucket.count++;
      bucket.hits.push({ iso, ...e });
      if (e.amount >= 1000) bucket.big.push({ iso, ...e });
    }
  }
  if (!weeks.size) {
    if (caption) caption.textContent = "No recurring commitments in the next 8 weeks.";
    return;
  }
  const weekEntries = [...weeks.entries()].map(([wk, b]) => ({ wk, ...b }));
  // Average across all 8 weeks (use 8 as denominator so empty weeks pull the mean down).
  const meanForRef = weekEntries.reduce((a, w) => a + w.sum, 0) / 8;

  const sorted = weekEntries.slice().sort((a, b) => b.sum - a.sum);
  // Show up to 3 "heavy" weeks: those significantly above the mean OR having
  // 3+ obligations OR a single big hit.
  const heavy = sorted.filter((w) => {
    return (
      (meanForRef > 0 && w.sum >= meanForRef * 1.4) ||
      w.count >= 3 ||
      w.big.length >= 1
    );
  });
  // If nothing flagged, still show the top week so users have temporal grounding.
  const items = heavy.length ? heavy.slice(0, 3) : sorted.slice(0, 1);

  if (caption) {
    if (heavy.length) {
      caption.textContent = "Weeks where recurring bills cluster more than usual.";
    } else {
      caption.textContent = "No unusual recurring pressure in the next 8 weeks.";
    }
  }

  for (const w of items) {
    const li = document.createElement("li");
    li.className = "reports-ob-timing-item";
    const sortedHits = w.hits.slice().sort((a, b) => b.amount - a.amount);
    const headlineCount = `${w.count} obligation${w.count === 1 ? "" : "s"}`;
    const top3 = sortedHits
      .slice(0, 3)
      .map(
        (h) =>
          `<li class="reports-ob-timing-line"><span class="reports-ob-timing-line__name">${escapeHtml(h.description)}</span><span class="reports-ob-timing-line__leader" aria-hidden="true"></span><span class="reports-ob-timing-line__amt">−$${fmtMoney(h.amount)}</span></li>`,
      )
      .join("");
    li.innerHTML = `
      <div class="reports-ob-timing-stack">
        <div class="reports-ob-timing-weekline">${escapeHtml(fmtWeekRange(w.wk))}</div>
        <div class="reports-ob-timing-hero">
          <span class="reports-ob-timing-hero__amt">$${fmtMoney(w.sum)} due</span>
          <span class="reports-ob-timing-hero__meta">${escapeHtml(headlineCount)}</span>
        </div>
        <ul class="reports-ob-timing-sub">${top3}</ul>
      </div>
    `;
    host.appendChild(li);
    const topNames = sortedHits
      .slice(0, 3)
      .map((h) => `${h.description} −$${fmtMoney(h.amount)}`)
      .join(" · ");
    bindFastTxnTipHover(
      li,
      `${fmtWeekRange(w.wk)}: $${fmtMoney(w.sum)} recurring due across ${w.count} payment${w.count === 1 ? "" : "s"}. ${topNames}`,
    );
  }
}

function renderReportsObligations() {
  const body = document.getElementById("reportsObligationBody");
  const foot = document.getElementById("reportsObligationFoot");
  const summaryWrap = document.getElementById("reportsObligationSummary");
  const insightsRow = document.getElementById("reportsObligationInsightRow");
  if (!body) return;
  wireReportsObligationControlsOnce();

  const sortEl = document.getElementById("reportsObligationSort");
  const grpEl = document.getElementById("reportsObligationFilterGroup");
  const largeEl = document.getElementById("reportsObligationLargeOnly");
  const sort = sortEl?.value || "next";
  const groupFilter = String(grpEl?.value || "").trim();
  const largeOnly = !!largeEl?.checked;

  const statTotal = document.getElementById("reportsObligationStatTotal");
  const statLargest = document.getElementById("reportsObligationStatLargest");
  const statWeek = document.getElementById("reportsObligationStatWeek");

  const todayIso = toISODate(new Date());
  const weekEndIso = addDaysIso(todayIso, 7);

  const allRows = [];
  for (const tx of state.expectedTransactions || []) {
    if (String(tx.kind || "") !== "expense") continue;
    const nextIso = nextOccurrenceIsoForRecurringList(tx, todayIso);
    if (!nextIso) continue;
    const grp = mapObligationGroup(tx.description, tx.category);
    const recRaw = String(tx.recurrence || "monthly");
    const est = estimatedMonthlyFromRecurrence(tx.amount, recRaw);
    const amt = Number(tx.amount || 0);
    const isLarge = amt >= REPORTS_OBL_LARGE_THRESHOLD || est >= REPORTS_OBL_LARGE_THRESHOLD;
    allRows.push({
      grp,
      desc: String(tx.description || "Recurring"),
      amt,
      recLabel: obligationRecurrenceLabel(recRaw),
      nextIso,
      est,
      isLarge,
    });
  }

  if (summaryWrap) {
    for (const c of summaryWrap.querySelectorAll(".reports-ob-card")) {
      c.classList.remove("reports-ob-card--attention");
    }
    if (!allRows.length) {
      summaryWrap.hidden = true;
      setReportsObligationStat(statTotal, null);
      setReportsObligationStat(statLargest, null);
      setReportsObligationStat(statWeek, null);
    } else {
      summaryWrap.hidden = false;
      const totalEst = allRows.reduce((a, r) => a + r.est, 0);
      let largest = allRows[0];
      for (const r of allRows) {
        if (r.amt > largest.amt) largest = r;
      }
      const due7 = allRows.filter((r) => r.nextIso >= todayIso && r.nextIso <= weekEndIso);
      const due7Sum = due7.reduce((a, r) => a + r.amt, 0);
      setReportsObligationStat(statTotal, `$${fmtMoney(totalEst)}`);
      setReportsObligationStat(statLargest, `$${fmtMoney(largest.amt)}`, largest.desc);
      const weekSub = due7.length
        ? `${due7.length} upcoming payment${due7.length === 1 ? "" : "s"}`
        : "No payments this week";
      setReportsObligationStat(statWeek, `$${fmtMoney(due7Sum)}`, weekSub);
      const weekCard = statWeek && statWeek.closest(".reports-ob-card");
      if (
        weekCard &&
        (due7.length >= 2 || due7Sum >= Math.min(REPORTS_OBL_LARGE_THRESHOLD, Math.max(totalEst * 0.12, 4000)))
      ) {
        weekCard.classList.add("reports-ob-card--attention");
      }
    }
  }

  renderObligationTakeaway(allRows);

  if (insightsRow) {
    if (!allRows.length) {
      insightsRow.hidden = true;
    } else {
      insightsRow.hidden = false;
      renderObligationMixBars(allRows);
      renderObligationHeavyWeeks(allRows);
    }
  }

  if (grpEl) {
    if (!allRows.length) {
      grpEl.innerHTML = `<option value="">All groups</option>`;
    } else {
      const prevGrp = grpEl.value || "";
      const grps = [...new Set(allRows.map((r) => r.grp))].sort((a, b) => a.localeCompare(b));
      grpEl.innerHTML =
        `<option value="">All groups</option>` +
        grps.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
      if (prevGrp && grps.includes(prevGrp)) grpEl.value = prevGrp;
    }
  }

  body.innerHTML = "";
  if (foot) foot.innerHTML = "";

  if (!allRows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" class="reports-table__empty">No recurring expenses on file.</td>`;
    body.appendChild(tr);
    return;
  }

  let rows = allRows.slice();
  if (groupFilter) rows = rows.filter((r) => r.grp === groupFilter);
  if (largeOnly) rows = rows.filter((r) => r.isLarge);

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" class="reports-table__empty">No rows match your filters.</td>`;
    body.appendChild(tr);
    return;
  }

  const uniqGroups = [...new Set(rows.map((r) => r.grp))];
  const rowsInGroup = (g) => rows.filter((r) => r.grp === g);
  const sumEst = (g) => rowsInGroup(g).reduce((a, r) => a + r.est, 0);
  const minNext = (g) => {
    const xs = rowsInGroup(g).map((r) => r.nextIso).sort();
    return xs[0] || "";
  };
  const maxAmt = (g) => Math.max(...rowsInGroup(g).map((r) => r.amt));

  uniqGroups.sort((a, b) => {
    if (sort === "monthly_desc") return sumEst(b) - sumEst(a) || a.localeCompare(b);
    if (sort === "monthly_asc") return sumEst(a) - sumEst(b) || a.localeCompare(b);
    if (sort === "amount_desc") return maxAmt(b) - maxAmt(a) || a.localeCompare(b);
    return String(minNext(a)).localeCompare(String(minNext(b))) || a.localeCompare(b);
  });

  const groupOrder = uniqGroups;
  const byGroup = new Map();
  for (const g of groupOrder) {
    let list = rowsInGroup(g);
    list = list.slice().sort((a, b) => {
      if (sort === "monthly_desc") return b.est - a.est || String(a.nextIso).localeCompare(String(b.nextIso));
      if (sort === "monthly_asc") return a.est - b.est || String(a.nextIso).localeCompare(String(b.nextIso));
      if (sort === "amount_desc") return b.amt - a.amt || String(a.nextIso).localeCompare(String(b.nextIso));
      return String(a.nextIso).localeCompare(String(b.nextIso)) || String(a.desc).localeCompare(String(b.desc));
    });
    byGroup.set(g, list);
  }

  let grandEst = 0;
  for (const g of groupOrder) {
    const list = byGroup.get(g) || [];
    const subEst = list.reduce((a, r) => a + r.est, 0);
    grandEst += subEst;

    const headTr = document.createElement("tr");
    headTr.className = "reports-obligation-group-head";
    const th = document.createElement("th");
    th.scope = "colgroup";
    th.colSpan = 5;
    const icon = OBLIGATION_GROUP_ICONS[g] || "•";
    th.innerHTML = `<span class="reports-obligation-group-head__icon" aria-hidden="true">${icon}</span><span class="reports-obligation-group-head__label">${escapeHtml(g)}</span><span class="reports-obligation-group-head__sub">${list.length} item${list.length === 1 ? "" : "s"} · $${fmtMoney(subEst)} / mo</span>`;
    headTr.appendChild(th);
    body.appendChild(headTr);

    for (const r of list) {
      const tr = document.createElement("tr");
      tr.className = "reports-obligation-row";
      if (r.isLarge) tr.classList.add("reports-obligation-row--large");
      const pill = r.isLarge
        ? `<span class="reports-obligation-pill" title="Large recurring payment relative to the rest of your obligations and forecast—worth watching on tight weeks">High impact</span>`
        : "";
      tr.innerHTML = `<td class="reports-obligation-desc"><span class="reports-obligation-desc__name">${escapeHtml(r.desc)}</span>${pill ? ` ${pill}` : ""}</td><td class="num reports-obligation-amt">$${fmtMoney(
        r.amt
      )}</td><td class="reports-obligation-next">${escapeHtml(
        fmtObligationNextDate(r.nextIso)
      )}</td><td class="reports-obligation-freq">${escapeHtml(r.recLabel)}</td><td class="num reports-ob-est">$${fmtMoney(r.est)}</td>`;
      const forecastBal = obligationForecastBalanceOnIso(r.nextIso);
      const tipParts = [
        `${r.recLabel} · ~$${fmtMoney(r.est)}/mo normalized`,
        `Next payment ${fmtObligationNextDate(r.nextIso)} for $${fmtMoney(r.amt)}`,
      ];
      if (forecastBal != null && Number.isFinite(forecastBal)) {
        tipParts.push(`Forecast balance end of that day (trendline): ${fmtMoney0SignedDollar(forecastBal)}`);
      } else {
        tipParts.push("Open Reports with a loaded forecast to see projected balance on that date.");
      }
      bindFastTxnTipHover(tr, tipParts.join(" · "));
      body.appendChild(tr);
    }

    const subTr = document.createElement("tr");
    subTr.className = "reports-obligation-subtotal";
    subTr.innerHTML = `<td colspan="4" class="reports-obligation-subtotal__k">${escapeHtml(g)} · subtotal</td><td class="num reports-ob-est">$${fmtMoney(
      subEst
    )}</td>`;
    body.appendChild(subTr);
  }

  if (foot && rows.length) {
    const tr = document.createElement("tr");
    tr.className = "reports-obligation-grand";
    tr.innerHTML = `<td colspan="4" class="reports-obligation-grand__label">Total recurring (this view)</td><td class="num reports-ob-est">$${fmtMoney(grandEst)}</td>`;
    foot.appendChild(tr);
  }
}

/**
 * Build a short narrative + recovery hint above the pressure table.
 * Returns true if any narrative is meaningful enough to show.
 */
function renderPressureNarrative(hits, daily, floor) {
  const wrap = document.getElementById("reportsPressureNarrative");
  const ledeEl = document.getElementById("reportsPressureNarrativeLede");
  const recEl = document.getElementById("reportsPressureNarrativeRec");
  if (!wrap || !ledeEl || !recEl) return;
  wrap.hidden = true;
  wrap.classList.remove(
    "reports-pressure-narrative--danger",
    "reports-pressure-narrative--caution",
    "reports-pressure-narrative--clear"
  );
  ledeEl.textContent = "";
  recEl.textContent = "";

  if (!hits.length) return;

  const byDate = hits.slice().sort((a, b) => String(a.iso).localeCompare(String(b.iso)));
  const flagged = byDate.filter((h) => {
    const sev = pressureSeverityMeta(h.after, floor);
    return sev.key === "watch" || sev.key === "tight" || sev.key === "below";
  });
  const focus = flagged.length ? flagged : byDate.slice(0, Math.min(3, byDate.length));
  const lowest = byDate.reduce((acc, h) => {
    if (h.after == null || !Number.isFinite(h.after)) return acc;
    if (!acc || h.after < acc.after) return h;
    return acc;
  }, null);
  const largest = hits.reduce((acc, h) => (!acc || h.amt > acc.amt ? h : acc), null);

  if (!flagged.length) {
    wrap.classList.add("reports-pressure-narrative--clear");
    ledeEl.textContent = "Larger upcoming payments stay covered across this range.";
    recEl.textContent = largest
      ? `Largest impact: ${largest.desc} — $${fmtMoney(largest.amt)} on ${fmtMonthDay(largest.iso)}.`
      : "";
    wrap.hidden = false;
    return;
  }

  wrap.classList.add("reports-pressure-narrative--caution");

  const startIso = focus[0]?.iso || "";
  const endIso = focus[focus.length - 1]?.iso || startIso;
  const dateSpan =
    startIso && endIso
      ? startIso === endIso
        ? fmtMonthDay(startIso)
        : `${fmtMonthDay(startIso)} and ${fmtMonthDay(endIso)}`
      : "";
  ledeEl.textContent =
    focus.length === 1
      ? `Upcoming cash pressure centers on one larger payment on ${dateSpan}.`
      : `Upcoming cash pressure centers around ${focus.length} larger payments between ${dateSpan}.`;

  if (lowest && Number.isFinite(lowest.after)) {
    recEl.textContent = `Lowest projected balance: ${fmtMoney0SignedDollar(lowest.after)} on ${fmtMonthDay(lowest.iso)}.`;
  } else {
    recEl.textContent = "";
  }
  wrap.hidden = false;
}

function renderReportsCashPressure(daily) {
  const body = document.getElementById("reportsPressureBody");
  const hint = document.getElementById("reportsPressureHint");
  const summaryEl = document.getElementById("reportsPressureSummary");
  const statLargest = document.getElementById("reportsPressureStatLargest");
  const statLowBal = document.getElementById("reportsPressureStatLowBal");
  if (!body) return;
  body.innerHTML = "";
  const balByDate = new Map((daily || []).map((d) => [String(d.date), Number(d.total_balance ?? 0)]));
  const todayIso = toISODate(new Date());
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 90);
  const horizonIso = toISODate(horizon);
  const floor = readStoredMinBalanceThresholdForReports();
  const hits = [];
  for (const tx of state.expectedTransactions || []) {
    if (String(tx.kind || "") !== "expense") continue;
    const amt = Number(tx.amount || 0);
    if (!Number.isFinite(amt) || amt < 400) continue;
    const nextIso = nextOccurrenceIsoForRecurringList(tx, todayIso);
    if (!nextIso || nextIso > horizonIso) continue;
    const rawAfter = balByDate.get(nextIso);
    const after = rawAfter != null && Number.isFinite(rawAfter) ? rawAfter : null;
    hits.push({
      iso: nextIso,
      desc: pressureRowDescription(tx),
      categoryLabel: pressureCategoryLabel(tx),
      amt,
      after,
      recovery: computePressureRecoveryLabel(daily, nextIso, after),
    });
  }
  hits.sort((a, b) => String(a.iso).localeCompare(String(b.iso)));

  const lowestHit = hits.reduce((acc, h) => {
    if (h.after == null || !Number.isFinite(h.after)) return acc;
    if (!acc || h.after < acc.after) return h;
    return acc;
  }, null);

  if (hint) {
    if (!hits.length) {
      hint.textContent = "No scheduled outflows of $400+ in the next 90 days.";
      hint.hidden = false;
    } else {
      hint.textContent = "";
      hint.hidden = true;
    }
  }

  renderPressureNarrative(hits, daily, floor);

  if (summaryEl) {
    for (const c of summaryEl.querySelectorAll(".reports-ob-card")) {
      c.classList.remove("reports-ob-card--pressure-alert", "reports-ob-card--pressure-warn", "reports-ob-card--pressure-neutral");
    }
    if (!hits.length) {
      summaryEl.hidden = true;
      setReportsObligationStat(statLargest, null);
      setReportsObligationStat(statLowBal, null);
    } else {
      summaryEl.hidden = false;
      let maxHit = hits[0];
      for (const h of hits) {
        if (h.amt > maxHit.amt) maxHit = h;
      }
      setReportsObligationStat(
        statLargest,
        `$${fmtMoney(maxHit.amt)}`,
        `${maxHit.desc} · ${fmtMonthDay(maxHit.iso)}`,
      );
      setReportsObligationStat(
        statLowBal,
        lowestHit && Number.isFinite(lowestHit.after) ? fmtMoney0SignedDollar(lowestHit.after) : "—",
        lowestHit ? `${fmtMonthDay(lowestHit.iso)}` : "No projected low in range",
      );
      statLargest?.closest(".reports-ob-card")?.classList.add("reports-ob-card--pressure-neutral");
      if (lowestHit && Number.isFinite(lowestHit.after) && floor != null && lowestHit.after < floor) {
        statLowBal.closest(".reports-ob-card")?.classList.add("reports-ob-card--pressure-alert");
      }
    }
  }

  for (const h of hits) {
    const mainTr = document.createElement("tr");
    mainTr.className = "reports-pressure-row reports-pressure-row--main";
    const sev = pressureSeverityMeta(h.after, floor);
    mainTr.classList.add(sev.accentClass);
    const isPrimary =
      !!lowestHit &&
      String(lowestHit.iso || "") === String(h.iso || "") &&
      Number(lowestHit.after ?? NaN) === Number(h.after ?? NaN);
    if (isPrimary) mainTr.classList.add("reports-pressure-row--focus");

    const why = pressureWhyItMatters(h, floor, lowestHit);

    let balCell = "";
    if (h.after != null && Number.isFinite(h.after)) {
      const tone =
        sev.key === "below"
          ? "reports-pressure-bal__num--neg"
          : sev.key === "tight" || sev.key === "watch"
            ? "reports-pressure-bal__num--amber"
            : "reports-pressure-bal__num--ok";
      const weight = isPrimary ? " reports-pressure-bal__num--lead" : "";
      balCell = `<td class="num reports-pressure-bal-cell"><span class="reports-pressure-bal__num ${tone}${weight}">${fmtMoney0SignedDollar(
        h.after,
      )}</span></td>`;
    } else {
      balCell = `<td class="num reports-pressure-bal-cell"><span class="reports-pressure-bal__num reports-pressure-bal__num--muted">—</span></td>`;
    }

    const rec = h.recovery || { label: "—", cls: "reports-pressure-status--muted", state: "" };
    const recTitle =
      rec.state === "outside"
        ? ' title="Extend the forecast horizon to see recovery timing"'
        : rec.state === "stale"
          ? ' title="Stays below target through the end of the visible forecast"'
          : "";
    const statusText = pressureStatusColumnText(rec, floor);
    const statusClass =
      rec.state === "covered"
        ? "reports-pressure-status--ok"
        : rec.state === "date"
          ? "reports-pressure-status--date"
          : rec.state === "stale"
            ? "reports-pressure-status--stale"
            : "reports-pressure-status--muted";

    const catInline = h.categoryLabel
      ? `<span class="reports-pressure-pay__cat">${escapeHtml(h.categoryLabel)}</span>`
      : "";

    mainTr.innerHTML = `<td class="reports-pressure-date">${escapeHtml(fmtObligationNextDate(h.iso))}</td><td class="reports-pressure-pay"><span class="reports-pressure-pay__name">${escapeHtml(
      h.desc,
    )}</span>${catInline}</td><td class="num reports-pressure-amt"><span class="reports-pressure-amt__v">$${fmtMoney(h.amt)}</span></td>${balCell}<td class="reports-pressure-status ${statusClass}"${recTitle}>${escapeHtml(
      statusText,
    )}</td>`;

    const detailTr = document.createElement("tr");
    detailTr.className = "reports-pressure-detail";
    detailTr.hidden = true;
    detailTr.innerHTML = `<td colspan="5" class="reports-pressure-detail__cell"><div class="reports-pressure-detail__body">${escapeHtml(
      why,
    )}</div></td>`;

    const floorTip = floor != null ? `Minimum balance: $${fmtMoney(floor)}` : "No minimum balance — pressure uses $0.";
    const tipBits = [
      floorTip,
      `Payment −$${fmtMoney(h.amt)} on ${fmtMonthDay(h.iso)}`,
      h.after != null && Number.isFinite(h.after) ? `Projected after: ${fmtMoney0SignedDollar(h.after)}` : "",
      statusText && statusText !== "—" ? `Status: ${statusText}` : "",
      why ? `Details: ${why}` : "",
    ].filter(Boolean);
    const tip = tipBits.join(" · ");
    bindFastTxnTipHover(mainTr.querySelector(".reports-pressure-pay"), tip);
    bindFastTxnTipHover(mainTr.querySelector(".reports-pressure-bal-cell"), tip);

    mainTr.addEventListener("click", (e) => {
      if (e.target.closest("a, button, input, select, textarea, label")) return;
      detailTr.hidden = !detailTr.hidden;
      const open = !detailTr.hidden;
      mainTr.classList.toggle("is-open", open);
      mainTr.setAttribute("aria-expanded", open ? "true" : "false");
    });
    mainTr.setAttribute("tabindex", "0");
    mainTr.setAttribute("role", "button");
    mainTr.setAttribute("aria-expanded", "false");
    mainTr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        mainTr.click();
      }
    });

    body.appendChild(mainTr);
    body.appendChild(detailTr);
  }
  if (!hits.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" class="reports-table__empty">No upcoming pressure rows.</td>`;
    body.appendChild(tr);
  }
}

function renderReportsOperationalPanels() {
  const daily = lastProjectionDailyForReports || [];
  drawReportsSafeTransferChart(daily);
  void refreshRiskCalendarMonth();
  renderReportsObligations();
  renderReportsCashPressure(daily);
  requestAnimationFrame(() => {
    try {
      reportsSafeTransferChartInstance?.resize();
    } catch (_) {}
  });
}

function drawProjectionChart(daily) {
  const emptyEl = document.getElementById("projectionChartEmpty");
  if (!projectionChartCanvas) return;

  if (projectionChartInstance) {
    try {
      projectionChartInstance.destroy();
    } catch (_) {}
    projectionChartInstance = null;
  }

  const items = daily || [];
  if (items.length < 2) {
    if (emptyEl) {
      emptyEl.style.display = "flex";
      emptyEl.textContent =
        items.length === 0 ? "No data for this range." : "Not enough data points to draw the chart.";
    }
    const leg = document.getElementById("reportsBalanceLegend");
    if (leg) leg.innerHTML = "";
    const take = document.getElementById("reportsBalanceTakeaway");
    if (take) {
      take.textContent = "";
      take.hidden = true;
    }
    return;
  }

  if (typeof Chart === "undefined") {
    if (emptyEl) {
      emptyEl.style.display = "flex";
      emptyEl.textContent = "Chart library failed to load. Check your network connection.";
    }
    const take = document.getElementById("reportsBalanceTakeaway");
    if (take) {
      take.textContent = "";
      take.hidden = true;
    }
    return;
  }

  if (emptyEl) emptyEl.style.display = "none";

  ensureProjectionChartDefaults();

  const dateLabels = items.map((d) => d.date);
  const values = items.map((d) => Number(d.total_balance ?? 0));
  const thr = readStoredMinBalanceThresholdForReports();
  const onReports = !!(reportsViewPanel && !reportsViewPanel.hidden);

  let lowIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[lowIdx]) lowIdx = i;
  }

  let recoveryIdx = -1;
  const startBal0 = Number(values[0] ?? 0);
  for (let j = lowIdx + 1; j < values.length; j++) {
    if (values[j] >= startBal0) {
      recoveryIdx = j;
      break;
    }
  }

  const outflowMarkers = new Set();
  const inflowMarkers = new Set();
  if (onReports && items.length === values.length) {
    const ranked = items
      .map((row, i) => ({ i, n: Number(row?.net_cashflow ?? NaN) }))
      .filter((x) => Number.isFinite(x.n) && x.n < 0)
      .sort((a, b) => a.n - b.n)
      .slice(0, 2);
    for (const x of ranked) outflowMarkers.add(x.i);

    const rankedIn = items
      .map((row, i) => ({ i, n: Number(row?.net_cashflow ?? NaN) }))
      .filter((x) => Number.isFinite(x.n) && x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 1);
    for (const x of rankedIn) inflowMarkers.add(x.i);
  }

  const pointRadius = values.map((_, i) => {
    if (i === lowIdx) return 5;
    if (onReports && recoveryIdx !== -1 && i === recoveryIdx && recoveryIdx !== lowIdx) return 4;
    return 0;
  });
  const pointBackgroundColor = values.map((_, i) => {
    if (i === lowIdx) return "rgba(167, 55, 68, 0.95)";
    if (onReports && recoveryIdx !== -1 && i === recoveryIdx && recoveryIdx !== lowIdx) return "rgba(4, 120, 87, 0.92)";
    return "rgba(55, 130, 115, 0)";
  });

  renderReportsBalanceLegend(items, dateLabels, values);
  renderReportsBalanceTakeaway(items, dateLabels, values);

  // Slightly stronger fills on the reports view so positive vs. negative
  // regions read as zones instead of empty whitespace.
  const negFillBelow =
    onReports ? "rgba(220, 38, 38, 0.115)" : "rgba(167, 55, 68, 0.12)";
  const negFillBelowEnd = onReports ? "rgba(127, 29, 29, 0.18)" : "rgba(167, 55, 68, 0.12)";
  const posFillAbove = onReports ? "rgba(11, 61, 46, 0.032)" : "rgba(11, 61, 46, 0.12)";
  const posFillTop = onReports ? "rgba(255, 255, 255, 0)" : "rgba(11, 61, 46, 0.12)";

  const yDomain = values.filter((n) => Number.isFinite(Number(n))).map((n) => Number(n));
  yDomain.push(0);
  if (thr != null && Number.isFinite(Number(thr))) yDomain.push(Number(thr));
  const minDomain = Math.min(...yDomain);
  const maxDomain = Math.max(...yDomain);
  const span = Math.max(800, maxDomain - minDomain);
  const suggestedMin = minDomain - span * (onReports ? 0.065 : 0.12);
  const suggestedMax = maxDomain + span * (onReports ? 0.124 : 0.18);

  // Build annotation list (top outflows and inflows) for the custom plugin.
  const annotations = [];
  if (onReports) {
    for (const i of outflowMarkers) {
      const net = Number(items[i]?.net_cashflow ?? 0);
      if (!Number.isFinite(net) || net >= 0) continue;
      annotations.push({
        idx: i,
        value: Number(values[i] ?? 0),
        kind: "outflow",
        label: `−$${formatChartMoneyShort(Math.abs(net))}`,
        caption: "Heaviest outflow day",
      });
    }
    for (const i of inflowMarkers) {
      const net = Number(items[i]?.net_cashflow ?? 0);
      if (!Number.isFinite(net) || net <= 0) continue;
      annotations.push({
        idx: i,
        value: Number(values[i] ?? 0),
        kind: "inflow",
        label: `+$${formatChartMoneyShort(net)}`,
        caption: "Strongest inflow day",
      });
    }
  }

  // Find "today" within the chart range, if present, for the vertical guide.
  let todayIdx = -1;
  if (onReports) {
    try {
      const todayIso = toISODate(new Date());
      todayIdx = dateLabels.findIndex((d) => String(d) === todayIso);
    } catch (_) {}
  }
  let todayBalForAnn = null;
  if (onReports && todayIdx >= 0) {
    const tb = Number(values[todayIdx]);
    if (Number.isFinite(tb)) todayBalForAnn = tb;
  }

  const datasets = [
    {
      label: "Balance",
      data: values,
      borderColor: "rgba(11, 61, 46, 0.88)",
      backgroundColor: (context) => {
        const chart = context.chart;
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales?.y) return "rgba(11, 61, 46, 0.08)";
        const y0 = scales.y.getPixelForValue(0);
        const top = chartArea.top;
        const bottom = chartArea.bottom;
        const g = ctx.createLinearGradient(0, top, 0, bottom);
        const span = bottom - top || 1;
        let t = (y0 - top) / span;
        if (!Number.isFinite(t)) t = 0.5;
        t = Math.max(0, Math.min(1, t));
        if (onReports) {
          g.addColorStop(0, posFillTop);
          g.addColorStop(Math.max(0, t - 0.12), posFillAbove);
          g.addColorStop(t, posFillAbove);
          g.addColorStop(t, negFillBelow);
          g.addColorStop(t + (1 - t) * 0.45, "rgba(185, 28, 28, 0.13)");
          g.addColorStop(1, negFillBelowEnd);
        } else {
          g.addColorStop(0, posFillAbove);
          g.addColorStop(t, posFillAbove);
          g.addColorStop(t, negFillBelow);
          g.addColorStop(1, negFillBelowEnd);
        }
        return g;
      },
      borderWidth: onReports ? 3 : 2,
      fill: true,
      cubicInterpolationMode: "default",
      tension: onReports ? 0.12 : 0.08,
      pointRadius,
      pointHoverRadius: 4,
      pointBackgroundColor,
      segment: {
        borderColor: (ctx) => {
          const y0 = ctx.p0.parsed.y;
          const y1 = ctx.p1.parsed.y;
          const mid = (Number(y0) + Number(y1)) / 2;
          return mid >= 0 ? "rgba(11, 61, 46, 0.94)" : "rgba(185, 28, 28, 0.9)";
        },
      },
    },
  ];
  if (thr != null) {
    datasets.push({
      label: "Minimum",
      data: dateLabels.map(() => thr),
      borderColor: onReports ? "rgba(51, 65, 85, 0.62)" : "rgba(75, 85, 99, 0.55)",
      borderWidth: onReports ? 1.85 : 1.5,
      borderDash: onReports ? [8, 5] : [5, 5],
      pointRadius: 0,
      fill: false,
      tension: 0,
    });
  }
  // Heavy outflow / inflow visual markers are now drawn by the
  // `balanceAnnotations` plugin so they can carry an inline label.
  // The main "Balance" dataset still drives tooltips via interaction mode "index".

  const ctx = projectionChartCanvas.getContext("2d");
  if (!ctx) return;

  projectionChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: dateLabels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: onReports
        ? {
            padding: { top: 32, right: 3, bottom: 8, left: 1 },
          }
        : undefined,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        balanceAnnotations: onReports
          ? {
              annotations,
              todayIdx,
              floor: thr != null ? Number(thr) : null,
              todayBal: todayBalForAnn,
            }
          : { annotations: [], todayIdx: -1, floor: null, todayBal: null },
        tooltip: {
          callbacks: {
            title: (ctxItems) => {
              const i = ctxItems[0]?.dataIndex ?? 0;
              return formatProjectionTooltipDate(dateLabels[i]);
            },
            footer: (ctxItems) => {
              if (!ctxItems || !ctxItems.length) return "";
              const i = ctxItems[0]?.dataIndex ?? 0;
              const net = Number(items[i]?.net_cashflow ?? 0);
              if (!net) return "";
              const sign = net >= 0 ? "+" : "−";
              return `Day net ${sign}$${fmtMoney(Math.abs(net))}`;
            },
            label: (ctx) => {
              if (ctx.dataset.label === "Minimum") return ` Minimum balance $${fmtMoney(ctx.parsed.y)}`;
              return ` Balance $${fmtMoney(ctx.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "category",
          grid: {
            display: onReports,
            color: "rgba(100, 116, 139, 0.22)",
            lineWidth: onReports ? 1 : 1,
            drawTicks: false,
          },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 8,
            maxRotation: 0,
            color: onReports ? "rgba(30, 41, 59, 0.8)" : undefined,
            font: onReports ? { size: 11, weight: "600" } : undefined,
            callback: function (tickValue) {
              const lbl = typeof tickValue === "number" ? dateLabels[tickValue] : tickValue;
              if (lbl == null || lbl === "") return "";
              return formatProjectionAxisDate(String(lbl));
            },
          },
        },
        y: {
          suggestedMin: onReports ? suggestedMin : undefined,
          suggestedMax: onReports ? suggestedMax : undefined,
          grid: {
            color: onReports ? "rgba(71, 85, 105, 0.2)" : "rgba(0,0,0,0.045)",
            drawBorder: false,
          },
          ticks: {
            maxTicksLimit: 6,
            color: onReports ? "rgba(30, 41, 59, 0.78)" : undefined,
            font: onReports ? { size: 11, weight: "600" } : undefined,
            callback: (value) =>
              "$" +
              Number(value).toLocaleString(undefined, {
                maximumFractionDigits: 0,
                minimumFractionDigits: 0,
              }),
          },
        },
      },
    },
  });
}
/** Shown in forecast-ready modal; keep in sync with marketing/plans pages. */
function getTrialContinueMonthlyPriceDisplay() {
  return "5.99";
}

function setForecastReadyTrialPricing() {
  const el = document.getElementById("bwForecastReadyPricingLine");
  if (!el) return;
  el.textContent = "Cancel anytime.";
}

function ensureForecastReadyModal() {
  const existing = document.getElementById("bwForecastReadyModal");
  if (existing) {
    if (String(existing.dataset.bwForecastReadyVersion || "") === BW_FORECAST_READY_MODAL_VERSION) return existing;
    existing.remove();
  }
  const wrap = document.createElement("div");
  wrap.id = "bwForecastReadyModal";
  wrap.className = "modal-overlay";
  wrap.dataset.bwForecastReadyVersion = BW_FORECAST_READY_MODAL_VERSION;
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = `
    <div class="modal modal--choice modal--forecast-ready" role="dialog" aria-modal="true" aria-labelledby="bwForecastReadyTitle" aria-describedby="bwForecastReadyDesc">
      <h3 id="bwForecastReadyTitle">Your forecast is ready</h3>
      <div id="bwForecastReadyDesc" class="bw-forecast-ready__body">
        <p class="bw-forecast-ready__tagline">Take a quick walkthrough to learn the basics.</p>
      </div>
      <div class="modal-actions bw-forecast-ready__actions">
        <button type="button" class="bw-forecast-ready__cta" id="bwForecastReadyStartTourBtn">Take the Tour</button>
        <button type="button" class="bw-forecast-ready__skip" id="bwForecastReadySkipBtn">Go to Forecast</button>
        <p class="bw-forecast-ready__reassure">Takes about 60 seconds. Reopen the tour anytime from Help.</p>
      </div>
      <p class="bw-forecast-ready__finePrint" aria-label="Trial and pricing">
        14-day free trial <span aria-hidden="true">•</span> <span id="bwForecastReadyPricingLine">Cancel anytime.</span>
      </p>
    </div>
  `;
  document.body.appendChild(wrap);
  setForecastReadyTrialPricing();

  const close = () => {
    try {
      wrap.classList.remove("modal-overlay--open");
      wrap.setAttribute("aria-hidden", "true");
    } catch (_) {}
  };
  const startTourFromModal = () => {
    close();
    // Let the modal's fade-out finish so the spotlight calculations measure
    // a stable layout — otherwise the first tooltip can land off-center.
    window.setTimeout(() => {
      try {
        if (window.BW && window.BW.tour && typeof window.BW.tour.start === "function") {
          window.BW.tour.start();
        }
      } catch (_) {}
    }, 180);
  };
  const skipTourFromModal = () => {
    close();
    try {
      if (window.BW && window.BW.tour && typeof window.BW.tour.markSkipped === "function") {
        window.BW.tour.markSkipped();
      }
    } catch (_) {}
  };
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  wrap.querySelector("#bwForecastReadyStartTourBtn")?.addEventListener("click", startTourFromModal);
  wrap.querySelector("#bwForecastReadySkipBtn")?.addEventListener("click", skipTourFromModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && wrap.classList.contains("modal-overlay--open")) close();
  });

  return wrap;
}

function maybeShowForecastReadyPopup() {
  // Only on Calendar view.
  if (!calendarViewPanel || calendarViewPanel.hidden) return;
  try {
    const v = sessionStorage.getItem(BW_FORECAST_READY_POPUP_KEY);
    if (v !== "1") return;
    sessionStorage.removeItem(BW_FORECAST_READY_POPUP_KEY);
  } catch (_) {
    return;
  }

  const modal = ensureForecastReadyModal();
  setForecastReadyTrialPricing();
  try {
    modal.classList.add("modal-overlay--open");
    modal.setAttribute("aria-hidden", "false");
    modal.querySelector("#bwForecastReadyStartTourBtn")?.focus?.();
  } catch (_) {}
}

// Show it once after initial calendar render (when the app has mounted).
try {
  if (window.__BW_FORCE_VIEW === "calendar") {
    // Give the calendar a tick to render before showing.
    window.setTimeout(maybeShowForecastReadyPopup, 60);
  }
} catch (_) {}

function setDefaultMonth() {
  initCalendarYearOptions();
  let ym = "";
  try {
    const pending = sessionStorage.getItem("bw_pending_cal_month");
    if (pending && /^\d{4}-\d{2}$/.test(pending)) {
      ym = pending;
      sessionStorage.removeItem("bw_pending_cal_month");
    }
  } catch (_) {}
  if (!ym) {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    ym = `${d.getFullYear()}-${m}`;
  }
  if (monthInput) monthInput.value = ym;
  applyCalendarMonthToPickers(ym);
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function setDefaultProjectionStart() {
  if (projectionStart) projectionStart.value = toISODate(new Date());
}

function setDefaultChartStart() {
  const days = Number(chartDaysRange?.value);
  applyReportsHorizonPresetDays(Number.isFinite(days) && days >= 1 ? days : 30);
}

function setDefaultAccountStartDate() {
  if (accountStartingBalanceDate) accountStartingBalanceDate.value = toISODate(new Date());
}

/**
 * Recovers an interrupted onboarding wizard.
 *
 * The signup flow stores a draft (account + first transactions) in sessionStorage and
 * normally creates them server-side before redirecting to /calendar. If those POSTs
 * timed out, failed, or the user closed the tab before the redirect, the calendar
 * page would load with a brand-new family that has zero accounts and no transactions.
 *
 * This function detects that situation and finishes the creation server-side using
 * the same draft the wizard captured. On success it clears the draft and refreshes
 * accounts so the calendar renders with the user's data.
 *
 * Returns true if recovery ran AND succeeded enough to require refreshing accounts.
 */
function accountSetupDraftTxFingerprint(t) {
  if (!t || typeof t !== "object") return "";
  return [
    String(t.kind || "").trim().toLowerCase(),
    Number(t.amount),
    String(t.date || "").trim(),
    String(t.category || "").trim().toLowerCase(),
  ].join("|");
}

function mergeAccountSetupDraftTransactions(a, b) {
  const out = [];
  const seen = new Set();
  for (const t of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    const fp = accountSetupDraftTxFingerprint(t);
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    out.push(t);
  }
  return out;
}

function mergeAccountSetupDraftObjects(sessionObj, localObj) {
  if (!sessionObj || typeof sessionObj !== "object") return localObj;
  if (!localObj || typeof localObj !== "object") return sessionObj;
  const sessionTx = Array.isArray(sessionObj.transactions) ? sessionObj.transactions : [];
  const localTx = Array.isArray(localObj.transactions) ? localObj.transactions : [];
  const sessionAccount =
    sessionObj.account && sessionObj.account.name && sessionObj.account.starting_balance_date != null
      ? sessionObj.account
      : null;
  const localAccount =
    localObj.account && localObj.account.name && localObj.account.starting_balance_date != null
      ? localObj.account
      : null;
  return {
    ...sessionObj,
    ...localObj,
    account: sessionAccount || localAccount || localObj.account || sessionObj.account || null,
    transactions: mergeAccountSetupDraftTransactions(sessionTx, localTx),
  };
}

const BW_ONBOARDING_RECOVERY_PENDING_KEY = "bw_onboarding_recovery_pending";

function readAccountSetupDraftJsonRaw() {
  try {
    localStorage.removeItem("bw_account_setup_draft");
  } catch (_) {}
  try {
    return sessionStorage.getItem("bw_account_setup_draft") || "";
  } catch (_) {
    return "";
  }
}

function clearAccountSetupDraftJsonStorage() {
  try {
    sessionStorage.removeItem("bw_account_setup_draft");
  } catch (_) {}
  try {
    localStorage.removeItem("bw_account_setup_draft");
  } catch (_) {}
  try {
    sessionStorage.removeItem(BW_ONBOARDING_RECOVERY_PENDING_KEY);
  } catch (_) {}
}

function onboardingRecoveryIsAllowedForDraft(draft) {
  let recoveryPending = false;
  try {
    recoveryPending = sessionStorage.getItem(BW_ONBOARDING_RECOVERY_PENDING_KEY) === "1";
  } catch (_) {}
  const meEmail = state.user?.email ? String(state.user.email).trim().toLowerCase() : "";
  const draftEmail = draft?.signupEmail ? String(draft.signupEmail).trim().toLowerCase() : "";
  if (draftEmail && meEmail && draftEmail !== meEmail) return false;
  return recoveryPending;
}

function resolveRecoveryAccountIdFromDraft(draft) {
  const accounts = Array.isArray(state.accounts) ? state.accounts : [];
  if (!accounts.length) return null;
  const draftName = draft?.account?.name ? String(draft.account.name).trim() : "";
  if (draftName) {
    const match = accounts.find((a) => String(a?.name || "").trim() === draftName);
    if (match && match.id != null) return Number(match.id);
  }
  return Number(accounts[0].id);
}

async function tryRecoverAccountSetupDraft() {
  const draftRaw = readAccountSetupDraftJsonRaw();
  if (!draftRaw) return false;

  let draft = null;
  try {
    draft = JSON.parse(draftRaw);
  } catch (_) {
    draft = null;
  }
  if (!draft || typeof draft !== "object") {
    clearAccountSetupDraftJsonStorage();
    return false;
  }

  if (!onboardingRecoveryIsAllowedForDraft(draft)) {
    clearAccountSetupDraftJsonStorage();
    return false;
  }

  if (!state.activeFamilyId) return false;

  const txs = Array.isArray(draft.transactions) ? draft.transactions : [];
  const pendingTxCount = txs.filter((t) => Number(t?.amount) > 0).length;
  const hasAccounts = Array.isArray(state.accounts) && state.accounts.length > 0;
  const draftNeedsAccount =
    draft.account &&
    draft.account.name &&
    Number.isFinite(Number(draft.account.starting_balance));

  if (hasAccounts && pendingTxCount === 0) {
    clearAccountSetupDraftJsonStorage();
    return false;
  }

  let createdAccountId = resolveRecoveryAccountIdFromDraft(draft);
  let anyAccountWork = false;
  if (hasAccounts && draftNeedsAccount && createdAccountId) {
    const acct = (state.accounts || []).find((a) => Number(a.id) === Number(createdAccountId));
    const curBal = Number(acct?.starting_balance ?? 0);
    const wantBal = Number(draft.account.starting_balance);
    if (acct && Number.isFinite(wantBal) && wantBal !== 0 && (!Number.isFinite(curBal) || curBal === 0)) {
      anyAccountWork = true;
      try {
        await api(`/api/families/${state.activeFamilyId}/accounts/${encodeURIComponent(String(createdAccountId))}`, "PUT", {
          name: draft.account.name || acct.name,
          type: draft.account.type || acct.type || "checking",
          starting_balance: wantBal,
          starting_balance_date: draft.account.starting_balance_date || acct.starting_balance_date,
        });
      } catch (e) {
        try {
          if (window.console && console.warn) {
            console.warn("[onboarding] account balance recovery failed", e && e.message);
          }
        } catch (_) {}
      }
    }
  }
  if (!hasAccounts && draftNeedsAccount) {
    anyAccountWork = true;
    try {
      const created = await api(`/api/families/${state.activeFamilyId}/accounts`, "POST", {
        name: draft.account.name,
        type: draft.account.type || "checking",
        starting_balance: Number(draft.account.starting_balance),
        starting_balance_date: draft.account.starting_balance_date,
      });
      if (created && created.id) createdAccountId = Number(created.id);
    } catch (e) {
      try {
        if (window.console && console.warn) {
          console.warn("[onboarding] account recovery failed", e && e.message);
        }
      } catch (_) {}
      return false;
    }
  }

  const recoveryAcct = createdAccountId
    ? (state.accounts || []).find((a) => Number(a.id) === Number(createdAccountId))
    : null;
  const recoveryAcctStart =
    String(draft?.account?.starting_balance_date || recoveryAcct?.starting_balance_date || "").trim() || null;

  function recoveryEffectiveTxDate(txDate) {
    const d = String(txDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !recoveryAcctStart || !/^\d{4}-\d{2}-\d{2}$/.test(recoveryAcctStart)) return d;
    return d < recoveryAcctStart ? recoveryAcctStart : d;
  }

  let txTotal = 0;
  let txCreated = 0;
  for (const t of txs) {
    const amt = Number(t.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    txTotal += 1;
    const description = (t.category || "").trim() || "Transaction";
    const txDate = recoveryEffectiveTxDate(t.date);
    try {
      if (t.recurring) {
        if (!createdAccountId) continue;
        await api(`/api/families/${state.activeFamilyId}/expected-transactions`, "POST", {
          account_id: createdAccountId,
          start_date: txDate,
          end_date: t.end_date || null,
          end_count: t.end_date ? null : t.end_count ?? null,
          recurrence: t.recurrence || "monthly",
          second_day_of_month:
            t.recurrence === "twice_monthly" || t.recurrence === "semiannual" ? t.second_day_of_month ?? null : null,
          second_occurrence_month: t.recurrence === "semiannual" ? t.second_occurrence_month ?? null : null,
          description,
          notes: t.notes ? t.notes : null,
          kind: t.kind,
          amount: amt,
          variable: !!t.variable,
          category_id: null,
          bg_color: t.bg_color ? t.bg_color : null,
          fg_color: null,
        });
        txCreated += 1;
      } else {
        await api(`/api/families/${state.activeFamilyId}/transactions`, "POST", {
          date: txDate,
          description,
          notes: t.notes ? t.notes : null,
          kind: t.kind,
          amount: amt,
          category_id: null,
          fg_color: null,
          bg_color: t.bg_color ? t.bg_color : null,
          reimbursable: false,
        });
        txCreated += 1;
      }
    } catch (e) {
      try {
        if (window.console && console.warn) {
          console.warn("[onboarding] transaction recovery failed", e && e.message, { txDate, kind: t.kind });
        }
      } catch (_) {}
      // Continue the loop — one transaction failure shouldn't block the rest.
    }
  }

  const accountReady = hasAccounts || (anyAccountWork && createdAccountId);
  const txsReady = pendingTxCount === 0 || txCreated >= pendingTxCount;
  if (accountReady && txsReady && (anyAccountWork || txCreated > 0 || (hasAccounts && pendingTxCount > 0))) {
    clearAccountSetupDraftJsonStorage();
    return anyAccountWork || txCreated > 0;
  }
  if (accountReady && pendingTxCount === 0 && !anyAccountWork) {
    clearAccountSetupDraftJsonStorage();
    return false;
  }
  return anyAccountWork || txCreated > 0;
}

async function main() {
  const apiBase = apiBaseUrl();
  if (location.hostname.endsWith("github.io") && !apiBase) {
    show(
      familiesErr,
      "GitHub Pages build is missing API_BASE. In the repo: Settings → Secrets → Actions → set API_BASE to your Render URL (e.g. https://your-app.onrender.com, no trailing slash), then re-run the workflow “Deploy frontend to GitHub Pages”."
    );
    if (userPill) userPill.textContent = "API not configured";
    return;
  }
  setDefaultProjectionStart();
  setDefaultChartStart();
  syncChartRangeDisplay();
  setDefaultAccountStartDate();
  await loadMe();
  bwDispatchMilestone("first-login");
  await loadFamilies();
  syncHouseholdSettingsUi();
  if (window.__BW_FORCE_VIEW === "settings") {
    try {
      activateSettingsSection("accounts");
    } catch (_) {}
  }
  if (state.activeFamilyId) {
    await loadCategories();
    await loadAccounts();
    // If the signup wizard's account/transaction POSTs didn't complete (cold start,
    // dropped connection, slow tab), finish that work now using the draft still in
    // sessionStorage. This is what keeps a new user from landing on an empty calendar.
    try {
      const recovered = await tryRecoverAccountSetupDraft();
      if (recovered) {
        await loadAccounts();
        await loadExpectedTransactions();
      }
    } catch (e) {
      try {
        if (window.console && console.warn) {
          console.warn("[onboarding] recovery wrapper threw", e && e.message);
        }
      } catch (_) {}
    }
    await loadExpectedTransactions();
  }
  setDefaultMonth();
  await loadMonthAndCalendar();
  // Defensive re-render: if any upstream step threw and cleared the grid without
  // refilling it, this guarantees the day cells are visible (even on an empty family).
  try {
    renderCalendar();
  } catch (_) {}
  if (state.activeFamilyId) {
    try {
      await refreshProjectionChart();
    } catch (e) {
      show(chartErr, e.message || "Failed to load balance chart");
    }
  }
  const bt = balanceThresholdFieldEls();
  if (bt.min || bt.max) {
    hydrateBalanceThresholdInputsFromStorage();
    if (bt.min) {
      bt.min.addEventListener("input", onBalanceThresholdFieldEdited);
      bt.min.addEventListener("change", onBalanceThresholdFieldEdited);
    }
    if (bt.max) {
      bt.max.addEventListener("input", onBalanceThresholdFieldEdited);
      bt.max.addEventListener("change", onBalanceThresholdFieldEdited);
    }
    if (bt.saveBtn && bt.saveBtn.dataset.balanceThresholdBound !== "1") {
      bt.saveBtn.dataset.balanceThresholdBound = "1";
      bt.saveBtn.addEventListener("mousedown", (e) => {
        // Keep focus in the input until click so Save reads the edited value, not a stale blur snapshot.
        e.preventDefault();
        if (balanceThresholdPersistTimer) {
          clearTimeout(balanceThresholdPersistTimer);
          balanceThresholdPersistTimer = null;
        }
      });
      bt.saveBtn.addEventListener("click", async () => {
        try {
          await saveBalanceThresholds();
        } catch (e) {
          const els = balanceThresholdFieldEls();
          show(els.err, e.message || "Could not save thresholds.");
          try {
            els.err?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
          } catch (_) {}
        }
      });
    }
    await refreshLowBalanceAlert();
  }

  wireForecastPreferencesUi();
}

// Wire the new Forecast Preferences controls (default landing, balance display
// mode, low-balance alerts toggle). Each preference is browser-local and reads
// from localStorage on load so the UI mirrors the persisted choice.
function wireForecastPreferencesUi() {
  const landing = document.getElementById("prefDefaultLanding");
  if (landing && !landing.dataset.bwPrefBound) {
    landing.dataset.bwPrefBound = "1";
    const stored = readPrefDefaultLanding();
    if (stored) {
      try {
        landing.value = stored;
      } catch (_) {}
    }
    landing.addEventListener("change", () => {
      try {
        const v = String(landing.value || "").trim().toLowerCase();
        if (v === "calendar" || v === "transactions" || v === "reports") {
          localStorage.setItem(PREF_DEFAULT_LANDING_KEY, v);
        } else {
          localStorage.removeItem(PREF_DEFAULT_LANDING_KEY);
        }
      } catch (_) {}
    });
  }

  const lowBal = document.getElementById("prefAlertLowBalance");
  if (lowBal && !lowBal.dataset.bwPrefBound) {
    lowBal.dataset.bwPrefBound = "1";
    lowBal.checked = readPrefAlertLowBalanceEnabled();
    lowBal.addEventListener("change", () => {
      try {
        localStorage.setItem(PREF_ALERT_LOW_BALANCE_KEY, lowBal.checked ? "1" : "0");
      } catch (_) {}
      // Re-evaluate sidebar banners; refreshLowBalanceAlert respects the
      // toggle state via readPrefAlertLowBalanceEnabled().
      void refreshLowBalanceAlert();
    });
  }

  const modeRadios = document.querySelectorAll('input[name="prefBalanceDisplayMode"]');
  if (modeRadios.length) {
    const current = readPrefBalanceDisplayMode();
    modeRadios.forEach((r) => {
      try {
        r.checked = String(r.value) === current;
      } catch (_) {}
      if (r.dataset.bwPrefBound === "1") return;
      r.dataset.bwPrefBound = "1";
      r.addEventListener("change", () => {
        if (!r.checked) return;
        try {
          const v = String(r.value || "").trim().toLowerCase();
          if (v === "projected" || v === "safe" || v === "both") {
            localStorage.setItem(PREF_BALANCE_DISPLAY_MODE_KEY, v);
          }
        } catch (_) {}
      });
    });
  }
}

main().catch((e) => {
  if (userPill) userPill.textContent = "Not connected";
  const m = e.message || "Failed to load app";
  show(familiesErr, m);
  show(txErr, m);
  // Even if bootstrap failed (e.g. transient /api/auth/me hiccup), make sure the
  // calendar grid still draws so the user isn't staring at an empty page.
  try {
    renderCalendar();
  } catch (_) {}
});

