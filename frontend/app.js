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

const CATEGORY_COLOR_PALETTE = [
  "#40E0FF", // cyan
  "#F2C14E", // gold
  "#FF9800", // orange
  "#9C27B0", // purple
  "#F44336", // red
  "#FFEB3B", // yellow
  "#00BCD4", // aqua
  "#9E9E9E", // gray
  "#8FB3C8", // slate
  "#C39BE3", // lavender
  "#000000", // black
  "#4CAF50", // green
];

function renderCategoryColorPicker({ rowEl, swatchesEl, clearBtn, getCategoryId, getBg, setBg, unhideRow = true }) {
  if (!swatchesEl) return;

  function refresh() {
    // Usually show the row in add/edit modals; Add-transaction uses a collapsible panel (unhideRow: false).
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
      clearBtn.hidden = false;
      clearBtn.disabled = !canClear;
      clearBtn.title = canClear ? "Clear color for this transaction (save to apply)" : "No color to clear";
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
        clearBtn.title = "Clear selected color";
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
        const gEl = categoriesTree?.querySelector(`.cat-group[data-group-id="${String(id)}"]`);
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
        const ok = window.confirm("Delete this category? Any transactions using it will be left uncategorized.");
        if (!ok) return;
        await api(`/api/families/${state.activeFamilyId}/categories/${id}`, "DELETE");
        await loadCategories();
        await loadMonthAndCalendar();
        closeCatEditModal();
        return;
      }

      if (kind === "group") {
        const ok = window.confirm(
          "Delete this group? Its categories will be moved to another group."
        );
        if (!ok) return;
        await api(`/api/families/${state.activeFamilyId}/category-groups/${id}`, "DELETE");
        await loadCategories();
        await loadMonthAndCalendar();
        closeCatEditModal();
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
const BALANCE_THRESHOLD_MIN_KEY = "familyCashFlow_balanceThresholdMin";
const BALANCE_THRESHOLD_MAX_KEY = "familyCashFlow_balanceThresholdMax";
const BALANCE_THRESHOLD_FAMILY_ID_KEY = "familyCashFlow_balanceThresholdFamilyId";
/** @deprecated migrate to BALANCE_THRESHOLD_MIN_KEY */
const LOW_BALANCE_THRESHOLD_KEY = "familyCashFlow_lowBalanceThreshold";
let lowBalanceDebounceTimer = null;
let balanceThresholdPersistTimer = null;
let balanceThresholdSavedHideTimer = null;
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

function invalidateLowBalanceAlertCache() {
  lowBalanceLastQuery = { familyId: null, min: null, max: null, mode: null };
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
  {
    const raw = String(text);
    const parts = raw.split("\n");
    const headRaw = parts[0] ? String(parts[0]) : "";
    let headText = escapeHtml(headRaw);
    if (headRaw.trim().startsWith("⚠")) {
      const rest = headRaw.trim().replace(/^⚠\s*/, "");
      headText = `<span class="cash-outlook-icon cash-outlook-icon--warn" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M12 3L2 21h20L12 3z"></path>
          <path d="M12 9v5"></path>
          <path d="M12 17h.01"></path>
        </svg>
      </span>${escapeHtml(rest)}`;
    }
    const bodyRaw = parts.slice(1).join("\n");
    let bodyHtml = "";
    if (bodyRaw) {
      const b = String(bodyRaw).trim();
      const lines = b
        .split("\n")
        .map((s) => String(s || "").trim())
        .filter(Boolean);
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
      if (b.startsWith("CENTER:")) {
        const amt = b.slice("CENTER:".length).trim();
        bodyHtml = `<div class="cash-outlook-line cash-outlook-line--center"><span class="cash-outlook-amt cash-outlook-amt--center">${escapeHtml(
          amt
        )}</span></div>`;
      } else
      if (b.includes("|")) {
        const [l, r] = b.split("|", 2);
        bodyHtml = `<div class="cash-outlook-line"><span class="cash-outlook-date">${escapeHtml(String(l || "").trim())}</span><span class="cash-outlook-amt">${escapeHtml(String(r || "").trim())}</span></div>`;
      } else {
        bodyHtml = `<div class="cash-outlook-line cash-outlook-line--single">${escapeHtml(b)}</div>`;
      }
    }
    sidebarLowBalanceBanner.innerHTML = [`<strong>${headText}</strong>`, bodyHtml].filter(Boolean).join("");
  }
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
      } else
      if (b.startsWith("CENTER:")) {
        const amt = b.slice("CENTER:".length).trim();
        bodyHtml = `<div class="cash-outlook-line cash-outlook-line--center"><span class="cash-outlook-amt cash-outlook-amt--center">${escapeHtml(
          amt
        )}</span></div>`;
      } else
      if (b.includes("|")) {
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
      activateSettingsSection("accounts");
      // Scroll directly to the thresholds section.
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

function openAccountModal(mode = "add") {
  if (!accountModal) return;
  if (accountModalTitle) accountModalTitle.textContent = mode === "edit" ? "Edit Account" : "Add New Account";
  if (addAccountBtn) addAccountBtn.style.display = mode === "edit" ? "none" : "";
  if (saveAccountEditBtn) saveAccountEditBtn.style.display = mode === "edit" ? "" : "none";
  accountModal.classList.add("modal-overlay--open");
  accountModal.setAttribute("aria-hidden", "false");
  try {
    (mode === "edit" ? accountStartingBalance : accountName)?.focus?.();
  } catch (_) {}
}

function closeAccountModal() {
  if (!accountModal) return;
  accountModal.classList.remove("modal-overlay--open");
  accountModal.setAttribute("aria-hidden", "true");
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
const incomeExpenseSubtitle = document.getElementById("incomeExpenseSubtitle");
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
let reportsSafeTransferChartInstance = null;

// Billing (Settings)
const billingPlanEl = document.getElementById("billingPlan");
const billingFrequencyEl = document.getElementById("billingFrequency");
const billingNextDateEl = document.getElementById("billingNextDate");
const billingAccountStatusEl = document.getElementById("billingAccountStatus");

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
  const on = instanceRecurrence.value === "twice_monthly";
  instanceTwiceMonthlyFields.style.display = on ? "block" : "none";
}

const instanceEndsMode = document.getElementById("instanceEndsMode");

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
  instanceRecurrence.addEventListener("change", updateInstanceTwiceMonthlyVisibility);
}
if (instanceEndsMode) {
  instanceEndsMode.addEventListener("change", updateInstanceEndsDetailUi);
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
  txEditDate.addEventListener("change", () => {
    if (transactionEditMode !== "recurring" || !selectedExpectedInstance) return;
    const iso = normalizeIsoDate(txEditDate.value);
    if (!iso) return;
    selectedExpectedMovedToDate = iso;
    show(txEditErr, "");
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

function txAddRepeatsActive() {
  return !!(txAddRecurrence && String(txAddRecurrence.value || "").trim() !== "");
}

function updateTxAddTwiceMonthlyVisibility() {
  if (!txAddTwiceMonthlyFields || !txAddRecurrence) return;
  const on = txAddRecurrence.value === "twice_monthly";
  txAddTwiceMonthlyFields.style.display = on ? "block" : "none";
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
  if (txAddRecurringBlock) txAddRecurringBlock.style.display = repeats ? "block" : "none";
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
{
  const txAddColorToggle = document.getElementById("txAddColorToggle");
  if (txAddColorToggle && txAddCategoryColorRow) {
    txAddColorToggle.addEventListener("click", () => {
      txAddCategoryColorRow.hidden = !txAddCategoryColorRow.hidden;
      const open = !txAddCategoryColorRow.hidden;
      txAddColorToggle.setAttribute("aria-expanded", open ? "true" : "false");
      txAddColorToggle.classList.toggle("is-open", open);
    });
  }
}
updateTxAddRepeatingUi();

{
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await api("/api/auth/logout", "POST");
      try {
        sessionStorage.removeItem(BW_API_ACCESS_TOKEN_KEY);
      } catch (_) {}
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
      if (cashOutlookHead) cashOutlookHead.hidden = false;
      setSidebarLowBalanceBanner("", "off");
      setSidebarHighBalanceBanner("", "off");
      setLowBalanceResult(
        '<div class="k">Balance thresholds</div><div class="v">Add a minimum (optional maximum) in Settings to enable outlook.</div>',
        true
      );
      lowBalanceLastQuery = { familyId: null, min: null, max: null, mode: null };
      setSidebarBalanceThresholdHint("Configure in Settings.");
      return;
    }
    if (cashOutlookHead) cashOutlookHead.hidden = false;

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

    const parts = [];
    if (minOk) {
      if (!lowHit) {
        parts.push(
          `<div class="balance-threshold-result-block"><div class="k">First date ≤ $${fmtMoneyThreshold(btMinEl?.value || "", minVal)}</div><div class="v">None in the next ${lowDays} days.</div></div>`
        );
        setSidebarLowBalanceBanner("✓ Within your target range", "muted");
      } else {
        parts.push(
          `<div class="balance-threshold-result-block"><div class="k">First date ≤ $${fmtMoneyThreshold(btMinEl?.value || "", minVal)}</div><div class="v danger">${fmtDateMDY(lowHit.date)} — $${fmtMoney(lowHit.balance)}</div></div>`
        );
        const bal = Number(lowHit.balance);
        const target = Number(minVal);
        if (Number.isFinite(bal) && bal <= 0) {
          setSidebarLowBalanceBanner(
            `⚠ Transfer cash before ${fmtMonthDay(lowHit.date)}\nCENTER:Balance: ${fmtMoney0SignedDollar(bal)}`,
            "danger"
          );
        } else {
          const shortfall = Math.max(0, target - bal);
          const shortfallDisp = `–$${fmtMoney0(shortfall)}`;
          setSidebarLowBalanceBanner(
            `⚠ Below target on ${fmtMonthDay(lowHit.date)}\nHERO:$${fmtMoney0(Math.abs(bal))} · floor $${fmtMoney0(
              Math.abs(target)
            )} (${shortfallDisp})`,
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
          `✓ Peak balance on ${fmtMonthDay(highHit.date)}\nCENTER:${fmtMoney0SignedDollar(highHit.balance)}`,
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

function schedulePersistBalanceThresholds() {
  const { min, max } = balanceThresholdFieldEls();
  if (!min && !max) return;
  if (balanceThresholdPersistTimer) clearTimeout(balanceThresholdPersistTimer);
  balanceThresholdPersistTimer = setTimeout(() => {
    balanceThresholdPersistTimer = null;
    void saveBalanceThresholds({ silent: true });
  }, 550);
}

function onBalanceThresholdFieldEdited() {
  scheduleLowBalanceRefresh();
  schedulePersistBalanceThresholds();
}

/** Load threshold inputs from the API for the current family, with localStorage fallback for older sessions. */
function hydrateBalanceThresholdInputsFromStorage() {
  const { min: minEl, max: maxEl } = balanceThresholdFieldEls();
  if (!minEl && !maxEl) return;
  try {
    const legacy = localStorage.getItem(LOW_BALANCE_THRESHOLD_KEY) || "";
    const fid = activeFamilyIdForBalanceThresholds();
    const minKey = getBalanceThresholdKey("min", fid);
    const maxKey = getBalanceThresholdKey("max", fid);
    const storedFamilyId = localStorage.getItem(BALANCE_THRESHOLD_FAMILY_ID_KEY) || "";

    // If we don't yet have a valid family id (boot race, transient view switch),
    // do not clear the user's in-progress inputs.
    if (!minKey || !maxKey) return;

    const fam = fid ? (state.families || []).find((x) => Number(x.id) === Number(fid)) : null;

    function pickMinCanonical() {
      if (fam != null && fam.balance_threshold_min != null && fam.balance_threshold_min !== "") {
        const mp = parseBalanceThresholdFieldRaw(String(fam.balance_threshold_min));
        if (mp.ok && !mp.empty) return mp.canonical;
      }
      const s = localStorage.getItem(minKey) || "";
      const mp = parseBalanceThresholdFieldRaw(s);
      return mp.ok && !mp.empty ? mp.canonical : "";
    }

    function pickMaxCanonical() {
      if (fam != null && fam.balance_threshold_max != null && fam.balance_threshold_max !== "") {
        const mp = parseBalanceThresholdMaxFieldRaw(String(fam.balance_threshold_max));
        if (mp.ok && !mp.empty) return mp.canonical;
      }
      const s2 = localStorage.getItem(maxKey) || "";
      const mp2 = parseBalanceThresholdMaxFieldRaw(s2);
      return mp2.ok && !mp2.empty ? mp2.canonical : "";
    }

    const next = pickMinCanonical();
    const next2 = pickMaxCanonical();

    if (minKey && minEl) {
      // Never wipe a non-empty field due to a storage/family mismatch.
      if (!(next === "" && String(minEl.value || "").trim())) minEl.value = next;
    } else if (minEl) minEl.value = "";

    if (maxKey && maxEl) {
      if (!(next2 === "" && String(maxEl.value || "").trim())) maxEl.value = next2;
    } else if (maxEl) maxEl.value = "";

    const allowLegacy =
      !storedFamilyId || (fid != null && storedFamilyId && String(storedFamilyId) === String(fid));
    if (allowLegacy && fid != null) {
      if (legacy && minEl && !minEl.value && minKey && !localStorage.getItem(minKey)) {
        minEl.value = legacy;
        localStorage.setItem(minKey, legacy);
        localStorage.setItem(BALANCE_THRESHOLD_FAMILY_ID_KEY, String(fid));
      }
      if (minEl && !minEl.value && minKey && !localStorage.getItem(minKey)) {
        const oldMin = localStorage.getItem(BALANCE_THRESHOLD_MIN_KEY) || "";
        if (oldMin) {
          minEl.value = oldMin;
          localStorage.setItem(minKey, oldMin);
          localStorage.setItem(BALANCE_THRESHOLD_FAMILY_ID_KEY, String(fid));
        }
      }
      if (maxEl && !maxEl.value && maxKey && !localStorage.getItem(maxKey)) {
        const oldMaxRaw = localStorage.getItem(BALANCE_THRESHOLD_MAX_KEY) || "";
        const oldMx = parseBalanceThresholdMaxFieldRaw(oldMaxRaw);
        if (oldMx.ok && !oldMx.empty) {
          maxEl.value = oldMx.canonical;
          localStorage.setItem(maxKey, oldMx.canonical);
          localStorage.setItem(BALANCE_THRESHOLD_FAMILY_ID_KEY, String(fid));
        }
      }
    }
  } catch (_) {}
  invalidateLowBalanceAlertCache();
}

async function saveBalanceThresholds(opts = {}) {
  const silent = !!opts.silent;
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
  const minKey = getBalanceThresholdKey("min", fidNum);
  const maxKey = getBalanceThresholdKey("max", fidNum);
  if (!minKey || !maxKey) {
    hideThresholdSavedFeedback();
    if (!silent) show(errEl, "Could not save thresholds for this family. Try refreshing the page.");
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

  // While typing: mirror to localStorage only so the sidebar outlook updates without spamming the API.
  if (silent) {
    try {
      if (minEl) localStorage.setItem(minKey, minParsed.empty ? "" : minParsed.canonical);
      if (maxEl) localStorage.setItem(maxKey, maxParsed.empty ? "" : maxParsed.canonical);
      localStorage.setItem(BALANCE_THRESHOLD_FAMILY_ID_KEY, String(fidNum));
      if (minEl) minEl.value = minParsed.empty ? "" : minParsed.canonical;
      if (maxEl) maxEl.value = maxParsed.empty ? "" : maxParsed.canonical;
      state.activeFamilyId = fidNum;
      if (familySelect && Number(fidNum) > 0) {
        try {
          familySelect.value = String(fidNum);
        } catch (_) {}
      }
    } catch (_) {
      return;
    }
    invalidateLowBalanceAlertCache();
    if (lowBalanceDebounceTimer) clearTimeout(lowBalanceDebounceTimer);
    lowBalanceDebounceTimer = null;
    void refreshLowBalanceAlert();
    return;
  }

  try {
    const updated = await api(`/api/families/${fidNum}/forecast-thresholds`, "PATCH", {
      balance_threshold_min: minParsed.empty ? null : minParsed.num,
      balance_threshold_max: maxParsed.empty ? null : maxParsed.num,
    });
    if (updated && Array.isArray(state.families)) {
      const ix = state.families.findIndex((x) => Number(x.id) === Number(fidNum));
      if (ix >= 0) {
        state.families[ix] = { ...state.families[ix], ...updated };
      }
    }
    if (minEl) localStorage.setItem(minKey, minParsed.empty ? "" : minParsed.canonical);
    if (maxEl) localStorage.setItem(maxKey, maxParsed.empty ? "" : maxParsed.canonical);
    localStorage.setItem(BALANCE_THRESHOLD_FAMILY_ID_KEY, String(fidNum));
    if (minEl) minEl.value = minParsed.empty ? "" : minParsed.canonical;
    if (maxEl) maxEl.value = maxParsed.empty ? "" : maxParsed.canonical;
    state.activeFamilyId = fidNum;
    if (familySelect && Number(fidNum) > 0) {
      try {
        familySelect.value = String(fidNum);
      } catch (_) {}
    }
  } catch (e) {
    hideThresholdSavedFeedback();
    show(errEl, e.message || "Could not save thresholds.");
    return;
  }

  lastExplicitBalanceThresholdSaveMs = Date.now();
  show(errEl, "");
  invalidateLowBalanceAlertCache();
  if (lowBalanceDebounceTimer) clearTimeout(lowBalanceDebounceTimer);
  lowBalanceDebounceTimer = null;
  void refreshLowBalanceAlert();
  if (reportsViewPanel && !reportsViewPanel.hidden && lastProjectionDailyForReports?.length > 1 && projectionChartCanvas) {
    drawProjectionChart(lastProjectionDailyForReports);
    renderReportsOperationalPanels();
  }
  if (balanceThresholdSavedHideTimer) clearTimeout(balanceThresholdSavedHideTimer);
  if (savedMsg) {
    savedMsg.textContent = "Saved for this household.";
    savedMsg.hidden = false;
  }
  showBwToast("Forecast rules saved.");
  balanceThresholdSavedHideTimer = window.setTimeout(() => {
    balanceThresholdSavedHideTimer = null;
    if (savedMsg) {
      savedMsg.textContent = "";
      savedMsg.hidden = true;
    }
  }, 5000);
  if (saveBtn) {
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

function initCalendarYearOptions() {
  if (!calendarYear || calendarYear.dataset.populated === "1") return;
  calendarYear.dataset.populated = "1";
  for (let y = 2020; y <= 2030; y++) {
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
  syncCalendarMonthFromPickers();
  let month = String((calendarMonth && calendarMonth.value) || (monthInput && monthInput.value) || "").trim();
  const partsValid = (s) => {
    const p = String(s).split("-");
    const y = Number(p[0]);
    const mi = Number(p[1]);
    return Number.isFinite(y) && Number.isFinite(mi) && mi >= 1 && mi <= 12;
  };
  if (!month || !partsValid(month)) {
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
if (reportsViewPanel && reportsViewPanel.dataset.bwReportsHorizonInit !== "1") {
  reportsViewPanel.dataset.bwReportsHorizonInit = "1";
  reportsViewPanel.addEventListener("click", async (e) => {
    const btn = e.target.closest(".reports-horizon__btn[data-report-days]");
    if (!btn || !reportsViewPanel.contains(btn)) return;
    const d = Number(btn.dataset.reportDays);
    if (!Number.isFinite(d) || d < 1) return;
    if (chartDaysRange) chartDaysRange.value = String(d);
    if (chartDaysLabel) chartDaysLabel.textContent = `${d} days`;
    reportsViewPanel.querySelectorAll(".reports-horizon__btn").forEach((b) => {
      b.classList.toggle("is-active", b === btn);
    });
    try {
      await refreshProjectionChart();
    } catch (err) {
      show(chartErr, err.message || "Failed to update chart");
    }
  });
}
const settingsSidebarNav = document.getElementById("settingsSidebarNav");
const sidebarPendingTxCard = document.getElementById("sidebarPendingTxCard");
const sidebarPendingTxList = document.getElementById("sidebarPendingTxList");
const sidebarPendingTitle = document.getElementById("sidebarPendingTitle");
const catReportStart = document.getElementById("catReportStart");
const catReportEnd = document.getElementById("catReportEnd");

// After account creation, we show a one-time "forecast is ready" modal on first calendar load.
const BW_FORECAST_READY_POPUP_KEY = "bw_forecast_ready_popup";
const BW_FORECAST_READY_MODAL_VERSION = "4";
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

function initReportsLeftNav() {
  if (!reportsViewPanel) return;
  if (reportsViewPanel.dataset.reportsNavInit === "1") return;
  reportsViewPanel.dataset.reportsNavInit = "1";

  const ids = [
    { id: "chartPanel", label: "Balance trendline" },
    { id: "reportCashTiming", label: "Income vs. expense timing" },
    { id: "reportSafeTransfer", label: "Safe-to-transfer outlook" },
    { id: "reportRiskHeatmap", label: "Low balance risk map" },
    { id: "reportObligations", label: "Recurring commitments" },
    { id: "reportCashPressure", label: "Upcoming cash pressure" },
  ].filter((it) => document.getElementById(it.id));

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
  }

  for (const it of ids) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reports-left-nav__item";
    btn.textContent = it.label;
    btn.setAttribute("data-target", it.id);
    btn.addEventListener("click", () => {
      const el = document.getElementById(it.id);
      if (!el) return;
      setActiveNav(it.id);
      showOnlyReport(it.id);
      // Ensure we're not scrolled into a blank spot after hiding other cards.
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    list.appendChild(btn);
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
  if (sidebarPendingTxCard) sidebarPendingTxCard.hidden = v !== "calendar";
  if (v === "transactions") {
    void loadUpcomingTransactionsPanel();
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
    requestAnimationFrame(() => {
      renderReportsOperationalPanels();
    });
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
    const jump = e.target && e.target.closest("#settingsJumpForecastRulesBtn");
    if (!jump) return;
    e.preventDefault();
    activateSettingsSection("forecastRules");
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
  });
}

familySelect.addEventListener("change", async () => {
  state.activeFamilyId = Number(familySelect.value);
  syncActiveFamilyFlags();
  hydrateBalanceThresholdInputsFromStorage();
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

function normalizeNameForCompare(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function hasDuplicateCategoryGroupName(name) {
  const nm = normalizeNameForCompare(name);
  if (!nm) return false;
  const groups = state.categoryTree?.groups || [];
  return groups.some((g) => normalizeNameForCompare(g?.name) === nm);
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

document.getElementById("addCategoryBtn").addEventListener("click", async () => {
  try {
    show(catErr, "");
    if (!state.activeFamilyId) throw new Error("Choose a family first");
    const name = document.getElementById("newCategoryName").value.trim();
    if (!name) throw new Error("Category name is required");
    let gid = defaultNewCategoryGroupId();
    if (newCategoryGroupId && newCategoryGroupId.value) {
      const n = Number(newCategoryGroupId.value);
      if (Number.isFinite(n)) gid = n;
    }
    if (hasDuplicateCategoryNameInGroup(name, gid)) {
      const ok = window.confirm(`A category named "${name}" already exists in this group. Create a duplicate anyway?`);
      if (!ok) return;
    }
    await api(`/api/families/${state.activeFamilyId}/categories`, "POST", { name, group_id: gid });
    document.getElementById("newCategoryName").value = "";
    await loadCategories();
    await loadMonthAndCalendar();
  } catch (e) {
    show(catErr, e.message || "Failed to add category");
  }
});

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

  const focusNewCategoryBtn = document.getElementById("focusNewCategoryBtn");
  const newCategoryNameEl = document.getElementById("newCategoryName");
  if (focusNewCategoryBtn && newCategoryNameEl) {
    focusNewCategoryBtn.addEventListener("click", () => {
      try {
        document.querySelector(".categories-actions")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (_) {}
      try {
        newCategoryNameEl.focus();
        newCategoryNameEl.select();
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
    try {
      show(txAddErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");

      const dateVal = txAddDate?.value || "";
      const notesRaw = txAddNotes?.value?.trim() || "";
      const kind = getRadioValue("txAddKind", "expense");
      const amountVal = txAddAmount?.value || "";
      const categoryId = categoryIdFromCategoryField("txAddCategoryId");
      const repeats = txAddRepeatsActive();
      const desc = descriptionForNewTransaction(categoryId, { recurring: repeats });

      if (!dateVal) throw new Error(repeats ? "Start date is required" : "Date is required");
      if (!amountVal || Number(amountVal) <= 0) throw new Error("Amount must be > 0");
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
        if (recurrenceVal === "twice_monthly") {
          const raw = txAddSecondDayOfMonth && txAddSecondDayOfMonth.value;
          const n = raw !== "" && raw != null ? Number(raw) : NaN;
          if (!Number.isFinite(n) || n < 1 || n > 31) {
            throw new Error("2nd day of month (1–31) is required for twice monthly");
          }
          const startDay = Number(dateVal.slice(8, 10));
          if (n === startDay) {
            throw new Error("2nd day of month must differ from the start date’s day of month");
          }
          secondDayOfMonth = n;
        }

        await api(`/api/families/${state.activeFamilyId}/expected-transactions`, "POST", {
          account_id: Number(accountIdVal),
          start_date: dateVal,
          end_date: endDateVal,
          end_count: endDateVal != null ? null : endCountVal,
          recurrence: recurrenceVal,
          second_day_of_month: secondDayOfMonth,
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
      instanceEndsMode.disabled = false;
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
  if (txEditInner) txEditInner.classList.add("modal--expected-edit");

  const title = document.getElementById("txEditTitle");
  if (title) {
    title.classList.add("sr-only");
    title.textContent = recurring ? "Recurring transaction" : "Edit transaction";
  }
  const modeBanner = document.getElementById("txEditModeBanner");
  if (modeBanner) {
    modeBanner.style.display = "block";
    modeBanner.textContent = recurring ? "Recurring transaction" : "Transaction";
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
    wrapSch.classList.toggle("tx-edit-schedule--locked", !recurring);
  }
  if (instanceRecurrence) {
    if (!recurring) {
      instanceRecurrence.value = "once";
      instanceRecurrence.disabled = true;
      instanceRecurrence.title = "Bank transactions do not repeat. Stored as a single dated entry.";
    } else {
      instanceRecurrence.disabled = false;
      instanceRecurrence.title = "How often this repeats";
    }
  }
  if (instanceSecondDayOfMonth) instanceSecondDayOfMonth.disabled = !recurring;
  if (instanceEndCount) instanceEndCount.disabled = !recurring;
  if (instanceEndsMode) {
    instanceEndsMode.disabled = !recurring;
    if (!recurring) instanceEndsMode.value = "never";
  }
  try { updateInstanceEndsDetailUi(); } catch (_) {}

  const acctCol = document.getElementById("txEditAccountCol");
  if (acctCol) acctCol.style.display = "block";
  if (instanceAccountId) {
    instanceAccountId.disabled = !recurring;
    instanceAccountId.title = recurring
      ? ""
      : "Actual transactions are not tied to an account in the ledger; this is display-only.";
  }

  updateInstanceTwiceMonthlyVisibility();

  const varWrap = document.getElementById("txEditRecurringVariableWrap");
  if (varWrap) varWrap.style.display = recurring ? "block" : "none";

  const prim = document.getElementById("txEditRecurringPrimaryActions");
  if (prim) prim.style.display = "none";

  const saveRow = document.getElementById("txEditSaveRow");
  if (saveRow) saveRow.style.display = "";
  if (txEditSave) txEditSave.style.display = recurring ? "none" : "";
  if (txEditRecurringUpdateBtn) txEditRecurringUpdateBtn.style.display = recurring ? "" : "none";
  const txEditDel = document.getElementById("txEditDelete");
  if (txEditDel) txEditDel.style.display = "";

  if (txEditCancel) {
    txEditCancel.textContent = recurring ? "Close" : "Cancel";
    txEditCancel.classList.toggle("tx-edit-dismiss--close", recurring);
  }

  const notesRowEl = document.getElementById("txEditNotesRow");
  const varWrapEl = document.getElementById("txEditRecurringVariableWrap");
  const schWrap = document.getElementById("txEditRecurringScheduleWrap");
  const acctCol = document.getElementById("txEditAccountCol");
  const panel = document.getElementById("expectedEditInstancePanel");
  // Recurring layout order:
  //   Type → Amount → Category → Color → Date
  //   Recurring group { Recurrence, Ends, Variable amount }
  //   Account
  //   Notes
  if (recurring) {
    if (varWrapEl && schWrap && varWrapEl.parentNode !== schWrap) {
      schWrap.appendChild(varWrapEl);
    }
    if (notesRowEl && acctCol && acctCol.parentNode) {
      acctCol.parentNode.insertBefore(notesRowEl, acctCol.nextSibling);
      notesRowEl.classList.add("tx-edit-notes-row--in-panel");
    }
  } else {
    if (varWrapEl && panel && varWrapEl.parentNode === schWrap) {
      panel.appendChild(varWrapEl);
    }
    if (notesRowEl && varWrapEl && varWrapEl.parentNode) {
      varWrapEl.parentNode.insertBefore(notesRowEl, varWrapEl);
      notesRowEl.classList.add("tx-edit-notes-row--in-panel");
    }
  }
  // Label the recurring schedule wrap so we can group it visually via CSS.
  if (schWrap) {
    schWrap.classList.toggle("tx-edit-recurring-group", recurring);
  }
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
}

function closeTxEditApplyScopeModal() {
  const m = document.getElementById("txEditApplyScopeModal");
  if (!m) return;
  m.classList.remove("modal-overlay--open");
  m.setAttribute("aria-hidden", "true");
  show(document.getElementById("txEditApplyScopeErr"), "");
}

function closeTxEditDeleteScopeModal() {
  const m = document.getElementById("txEditDeleteScopeModal");
  if (!m) return;
  m.classList.remove("modal-overlay--open");
  m.setAttribute("aria-hidden", "true");
  show(document.getElementById("txEditDeleteScopeErr"), "");
}

function openTxEditApplyScopeModal() {
  closeTxEditDeleteScopeModal();
  const m = document.getElementById("txEditApplyScopeModal");
  if (!m) return;
  show(document.getElementById("txEditApplyScopeErr"), "");
  m.classList.add("modal-overlay--open");
  m.setAttribute("aria-hidden", "false");
}

function openTxEditDeleteScopeModal() {
  closeTxEditApplyScopeModal();
  const m = document.getElementById("txEditDeleteScopeModal");
  if (!m) return;
  show(document.getElementById("txEditDeleteScopeErr"), "");
  m.classList.add("modal-overlay--open");
  m.setAttribute("aria-hidden", "false");
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
  let k = String(key || "accounts");
  if (k === "accountDetails") k = "accounts";
  const f = (state.families || []).find((x) => Number(x.id) === Number(state.activeFamilyId));
  const isFamilyAdmin = !!(f && String(f.role || "").toLowerCase() === "admin");
  if (k === "familySharing" && !isFamilyAdmin) k = "accounts";

  document.querySelectorAll("#settingsViewPanel .settings-nav-item, #settingsSidebarNav .settings-nav-item").forEach((btn) => {
    const on = btn.dataset.settingsKey === k;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  document.querySelectorAll("#settingsViewPanel .settings-pane").forEach((pane) => {
    const on = pane.dataset.settingsPane === k;
    pane.classList.toggle("is-active", on);
    pane.hidden = !on;
  });
  if (k === "familySharing") {
    loadFamilyMembersPanel().catch((e) => {
      const el = document.getElementById("familyMembersErr");
      show(el, e.message || String(e));
    });
  }
  if (k === "billing") {
    renderBillingPanel();
  }
}

function openTxAddModal(opts = {}) {
  if (!txAddModal || !txAddDate) return;
  mountTxAddFormInModal();
  const dateVal = opts.date || "";
  const dateNorm = dateVal ? normalizeIsoDate(dateVal) || dateVal : "";
  if (dateNorm && isDateBeforeEarliestStartingBalance(dateNorm)) {
    window.alert("That date is before your starting balance.");
    return;
  }
  applyMinDateToTxAddDateInput();
  txAddDate.value = dateVal;
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
  if (txAddCategoryColorRow) txAddCategoryColorRow.hidden = true;
  const txAddColorToggleEl = document.getElementById("txAddColorToggle");
  if (txAddColorToggleEl) {
    txAddColorToggleEl.setAttribute("aria-expanded", "false");
    txAddColorToggleEl.classList.remove("is-open");
  }
  const kind = opts.kind || "expense";
  const radio = document.querySelector(`input[type="radio"][name="txAddKind"][value="${kind}"]`);
  if (radio) radio.checked = true;
  show(txAddErr, "");
  txAddModal.classList.add("modal-overlay--open");
  txAddModal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => (txAddAmount ? txAddAmount.focus() : txAddDate.focus()));
}

function closeTxAddModal() {
  if (!txAddModal) return;
  txAddModal.classList.remove("modal-overlay--open");
  txAddModal.setAttribute("aria-hidden", "true");
  mountTxAddFormInSidebar();
  if (txAddDate) txAddDate.removeAttribute("min");
  txAddSelectedBgColor = null;
  txAddColorTouched = false;
}

function openReconcileModal(iso) {
  if (!reconcileModal) return;
  const d = normalizeIsoDate(iso) || iso;
  if (alertIfDateBeforeStartingBalance(d)) return;
  reconcileActiveDate = d;
  if (reconcileTitle) reconcileTitle.textContent = reconcileActiveDate ? `Reconcile ${fmtDateLongDisplay(reconcileActiveDate)}` : "Reconcile day";
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
    let savedOk = false;
    let savedDateIso = "";
    try {
      if (transactionEditMode === "recurring") return;
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
      await api(`/api/families/${state.activeFamilyId}/transactions/${id}`, "PUT", {
        date: rawDate,
        kind: getRadioValue("txEditKind", "expense"),
        amount: Number(amountVal),
        description: txEditDescriptionSnapshot,
        notes: txEditNotes && txEditNotes.value.trim() ? txEditNotes.value.trim() : null,
        category_id: categoryIdFromCategoryField("txEditCategoryId"),
        ...(txEditColorTouched
          ? {
              bg_color: normalizeBgColorForSave(txEditSelectedBgColor),
              fg_color: normalizeFgColorForSave(txEditSelectedBgColor),
            }
          : {}),
        reimbursable: txEditReimbursableValue,
      });
      savedOk = true;
      savedDateIso = editDateIso || "";
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
      await loadMonthAndCalendar();
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

if (txAddCancel) {
  txAddCancel.addEventListener("click", () => closeTxAddModal());
}
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

if (calendarGrid) {
  calendarGrid.addEventListener("click", (e) => {
    // Click on an actual transaction line opens the edit modal.
    const part = e.target.closest(".cal-tx-part");
    if (part && calendarGrid.contains(part)) {
      const id = Number(part.dataset.txId);
      if (!id) return;
      const tx = [...(state.monthActualItems || []), ...(state.calendarExtraActualItems || [])].find((t) => Number(t.id) === id);
      if (tx) openTxEditModal(tx);
      return;
    }

    // Click on an empty part of a day cell opens the add transaction modal.
    // (Expected tx lines stopPropagation in their own handler.)
    const cell = e.target.closest(".cal-cell");
    if (!cell || !calendarGrid.contains(cell)) return;
    const iso = cell.dataset.iso;
    if (!iso) return;
    if (alertIfDateBeforeStartingBalance(iso)) return;
    openTxAddModal({ date: iso });
  });
}

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
    upcomingRecurrenceFilter.value = v === "quarterly" ? "all" : v === "semiannual" ? "semiannual" : v;
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

function tmInsightCard(title, body, extraClass = "") {
  const ec = extraClass ? ` ${extraClass}` : "";
  return `<div class="tm-insight-card${ec}"><div class="tm-insight-card__title">${escapeHtml(title)}</div><div class="tm-insight-card__body">${escapeHtml(body)}</div></div>`;
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
    cards.push(
      tmInsightCard(
        "Variable amounts",
        `${varsInRange} recurring ${varsInRange === 1 ? "item" : "items"} in this window still use placeholder amounts—confirm real amounts so your forecast stays tight.`,
        "tm-insight-card--variable"
      )
    );
  } else if (uncat > 0) {
    cards.push(
      tmInsightCard(
        "Uncategorized",
        `${uncat} one-time ${uncat === 1 ? "transaction needs" : "transactions need"} a category. Uncategorized lines can skew what your forecast thinks is safe to spend.`,
        "tm-insight-card--uncat"
      )
    );
  } else if (floorDays > 0) {
    cards.push(
      tmInsightCard(
        "Below comfort threshold",
        `${floorDays} projected ${floorDays === 1 ? "day" : "days"} in this window dip below your minimum balance threshold—tune dates or amounts to recover cushion.`,
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
  let rowCount = 0;
  try {
    rowCount = txListMain ? txListMain.querySelectorAll(".tm-row").length : 0;
  } catch (_) {}
  const latest = tmLatestReconciledIsoBefore(toISODate(new Date()));
  tmForecastNote.classList.remove("tm__forecastNote--status", "tm__forecastNote--tip");
  if (rowCount > 0 && uncat === 0 && latest) {
    tmForecastNote.textContent = `Everything in this list is categorized. Your forecast is reconciled through ${fmtDateMedDisplay(latest)}.`;
    tmForecastNote.classList.add("tm__forecastNote--status");
    tmForecastNote.hidden = false;
  } else {
    tmForecastNote.textContent = "";
    tmForecastNote.hidden = true;
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
  if (mStart && mEnd) {
    const largest = tmLargestExpenseInRange(mStart, mEnd);
    if (largest && largest.amt >= 1) {
      parts.push(
        `<div class="sidebar-fqh__row"><span class="sidebar-fqh__k">Largest bill (month)</span><span class="sidebar-fqh__v">$${fmtMoney(largest.amt)} <span class="sidebar-fqh__d">${escapeHtml(largest.label)} · ${fmtDateMedDisplay(
          largest.iso
        )}</span></span></div>`
      );
    }
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
        `<div class="sidebar-fqh__row"><span class="sidebar-fqh__k">Below threshold</span><span class="sidebar-fqh__v">${floorDays} ${floorDays === 1 ? "day" : "days"} this month</span></div>`
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
chartStart?.addEventListener("change", () => {
  syncChartRangeDisplay();
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
  const disp = document.getElementById("chartRangeDisplayText");
  if (!disp || !chartStart?.value) {
    if (disp) disp.textContent = "—";
    return;
  }
  const days = Number(chartDaysRange?.value);
  if (!Number.isFinite(days) || days < 1) {
    disp.textContent = "—";
    return;
  }
  const end = chartRangeEndIso(chartStart.value, days);
  disp.textContent = `${formatChartRangeLongLabel(chartStart.value)} – ${formatChartRangeLongLabel(end)}`;
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
  let next = addMonthsIso(startIso, 1);
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
  billingPlanEl.textContent = getBillingPlanLabel(plan);
  billingFrequencyEl.textContent = String(freq || "monthly").toLowerCase() === "monthly" ? "Monthly" : String(freq || "—");
  const next = computeNextBillingDate(start, freq);
  billingNextDateEl.textContent = next ? formatShortDateLong(next) : "—";
  if (billingAccountStatusEl) billingAccountStatusEl.textContent = "Active";
}

function ensureProjectionChartDefaults() {
  if (projectionChartDefaultsApplied || typeof Chart === "undefined") return;
  projectionChartDefaultsApplied = true;
  Chart.defaults.color = "#4b5563";
  Chart.defaults.borderColor = "rgba(0,0,0,0.10)";
  Chart.defaults.font.family =
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  Chart.defaults.font.size = 11;
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
  const parts = [];
  if (maxEI >= 0 && maxE > 0) {
    parts.push(
      `<div class="reports-ie-insights__line"><span class="reports-ie-insights__k">Highest expense week</span><span class="reports-ie-insights__v">${escapeHtml(fmtWeekRangeLabel(weeks[maxEI]))} · $${fmtMoney(maxE)}</span></div>`
    );
  }
  if (maxNetI >= 0 && maxNet > 0) {
    parts.push(
      `<div class="reports-ie-insights__line"><span class="reports-ie-insights__k">Largest positive cash week</span><span class="reports-ie-insights__v">${escapeHtml(fmtWeekRangeLabel(weeks[maxNetI]))} · +$${fmtMoney(maxNet)}</span></div>`
    );
  }
  if (deficitWeeks > 0) {
    parts.push(
      `<div class="reports-ie-insights__note">${deficitWeeks} week${deficitWeeks === 1 ? "" : "s"} with expenses above income</div>`
    );
  }
  if (!parts.length) {
    host.innerHTML = "";
    host.hidden = true;
    return;
  }
  host.innerHTML = `<div class="reports-ie-insights__inner">${parts.join("")}</div>`;
  host.hidden = false;
}

function drawIncomeExpenseChart(agg) {
  if (!incomeExpenseChartCanvas) return;
  if (typeof Chart === "undefined") return;

  const ctx = incomeExpenseChartCanvas.getContext("2d");
  if (!ctx) return;

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
    const exp = Number(e || 0);
    if (i === maxExpIdx && maxExp > 0) return "rgba(167, 55, 68, 0.92)";
    if (expGtInc[i]) return "rgba(185, 28, 28, 0.68)";
    return "rgba(167, 55, 68, 0.48)";
  });
  const expenseBorder = expense.map((e, i) => {
    if (!useWeeks) return "rgba(167, 55, 68, 0.75)";
    if (i === maxExpIdx && maxExp > 0) return "rgba(127, 29, 29, 0.95)";
    if (expGtInc[i]) return "rgba(153, 27, 27, 0.85)";
    return "rgba(167, 55, 68, 0.55)";
  });

  destroyIncomeExpenseChart();
  applyIncomeExpenseToggleUi();

  const datasets = [];
  if (incomeExpenseShowNet) {
    datasets.push({
      type: "line",
      label: "Net",
      data: net,
      borderColor: "rgba(71, 85, 105, 0.32)",
      backgroundColor: "transparent",
      borderWidth: 1.25,
      borderDash: [5, 4],
      pointRadius: 0,
      tension: 0.25,
      yAxisID: "y",
      order: 0,
    });
  }
  datasets.push(
    {
      label: "Income",
      data: income,
      backgroundColor: "rgba(11, 61, 46, 0.58)",
      borderColor: "rgba(11, 61, 46, 0.72)",
      borderWidth: 1,
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
          callbacks: {
            title: (items) => {
              const i = items[0]?.dataIndex ?? 0;
              if (useWeeks && agg.weeks[i]) return `Week of ${fmtWeekStartShort(agg.weeks[i])}`;
              return items[0]?.label || "";
            },
            label: (ctx) => {
              const v = ctx.parsed?.y ?? 0;
              const sign = ctx.dataset.label === "Expense" ? "-" : ctx.dataset.label === "Income" ? "+" : "";
              return ` ${ctx.dataset.label}: ${sign}$${fmtMoney(v)}`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: !!incomeExpenseIsStacked,
          grid: { display: false },
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 14, font: { size: 9.5 }, color: "rgba(100, 116, 139, 0.62)" },
        },
        y: {
          stacked: !!incomeExpenseIsStacked,
          grid: { color: "rgba(0,0,0,0.045)", drawBorder: false },
          ticks: {
            font: { size: 9.5 },
            color: "rgba(100, 116, 139, 0.58)",
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
    const end = toISODate(new Date());
    const startD = new Date();
    startD.setDate(startD.getDate() - 119);
    const start = toISODate(startD);
    const r = await api(
      `/api/families/${state.activeFamilyId}/transactions?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`,
      "GET"
    );
    const items = r && r.items ? r.items : [];
    if (!Array.isArray(items) || items.length === 0) {
      destroyIncomeExpenseChart();
      lastIncomeExpenseAggForChart = null;
      setIncomeExpenseEmpty("No data for this range.");
      if (incomeExpenseSubtitle) incomeExpenseSubtitle.textContent = "Last 17 weeks · weekly totals";
      clearInsights();
      return;
    }
    const agg = aggregateIncomeExpenseByWeek(items);
    if (!agg.weeks.length) {
      destroyIncomeExpenseChart();
      lastIncomeExpenseAggForChart = null;
      setIncomeExpenseEmpty("No data for this range.");
      if (incomeExpenseSubtitle) incomeExpenseSubtitle.textContent = "Last 17 weeks · weekly totals";
      clearInsights();
      return;
    }
    if (incomeExpenseSubtitle) incomeExpenseSubtitle.textContent = "Last 17 weeks · weekly totals";
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
  let movedTo = normalizeIsoDate(selectedExpectedMovedToDate || "") || null;
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
    ...(txEditColorTouched
      ? {
          bg_color: normalizeBgColorForSave(txEditSelectedBgColor),
          fg_color: normalizeFgColorForSave(txEditSelectedBgColor),
        }
      : {}),
    moved_to_date: movedTo,
    variable: !!(seriesVariable && seriesVariable.checked),
  };
  await api(
    `/api/families/${state.activeFamilyId}/expected-transactions/${selectedExpectedInstance.expected_transaction_id}/instances/${occ}`,
    "POST",
    payload
  );

  closeTxEditModal();
  // If moved to a different month, jump the UI so it doesn't look like the item "disappeared".
  {
    const movedYm = movedTo ? String(movedTo).slice(0, 7) : "";
    const curYm = (calendarMonth?.value || monthInput?.value || "").slice(0, 7);
    if (movedYm && curYm && movedYm !== curYm) {
      if (monthInput) monthInput.value = movedYm;
      applyCalendarMonthToPickers(movedYm);
      await loadMonthAndCalendar();
      return;
    }
  }
  await refreshExpectedCalendarAndMonth();
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
  const endCountRaw = instanceEndCount?.value != null ? String(instanceEndCount.value).trim() : "";
  const endCountVal = endCountRaw === "" ? null : Number(endCountRaw);
  if (endCountVal != null) {
    if (!Number.isFinite(endCountVal) || endCountVal < 1 || Math.floor(endCountVal) !== endCountVal) {
      throw new Error("Ends after must be a whole number ≥ 1");
    }
  }
  let secondDayVal = meta.second_day_of_month != null ? Number(meta.second_day_of_month) : null;
  if (recurrenceVal === "twice_monthly") {
    const raw = instanceSecondDayOfMonth?.value;
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < 1 || n > 31) throw new Error("Second day of month must be between 1 and 31");
    const startIso = normalizeIsoDate(meta.start_date || "") || meta.start_date || "";
    const startDom = startIso && String(startIso).length >= 10 ? Number(String(startIso).slice(8, 10)) : NaN;
    // When applying from a specific occurrence, the backend treats that occurrence date as the
    // new series start. For twice-monthly series, the "second day" must differ from the *apply*
    // occurrence day. If we're applying from the existing second day, automatically swap days
    // so the schedule stays the same (just flips which day is considered "start" vs "second").
    const occDom = occRaw ? Number(String(occRaw).slice(8, 10)) : NaN;
    if (Number.isFinite(occDom) && n === occDom) {
      if (Number.isFinite(startDom) && startDom !== occDom) {
        secondDayVal = startDom;
      } else {
        throw new Error("Second day of month must be different than the selected occurrence day");
      }
    } else if (Number.isFinite(startDom) && n === startDom) {
      throw new Error("Second day of month must be different than the start date’s day");
    } else {
      secondDayVal = n;
    }
  } else {
    secondDayVal = null;
  }

  const occRaw = selectedExpectedInstance
    ? normalizeIsoDate(selectedExpectedInstance.occurrence_date) || selectedExpectedInstance.occurrence_date
    : null;
  if (!occRaw) {
    throw new Error("Pick an occurrence from the calendar or recurring list to update this date and all future ones.");
  }

  if (String(meta.recurrence || "") === "once") {
    await api(`/api/families/${state.activeFamilyId}/expected-transactions/${seriesId}`, "PUT", {
      account_id: Number(accountId),
      start_date: meta.start_date || "",
      end_date: meta.end_date || null,
      end_count: endCountVal,
      recurrence: recurrenceVal,
      second_day_of_month: recurrenceVal === "twice_monthly" ? secondDayVal : null,
      description: expectedSaveDescription(),
      notes: notesVal,
      kind: getRadioValue("txEditKind", "expense"),
      amount: Number(amount),
      variable: !!(seriesVariable && seriesVariable.checked),
      category_id: categoryId,
      ...(txEditColorTouched
        ? {
            bg_color: normalizeBgColorForSave(txEditSelectedBgColor),
            fg_color: normalizeFgColorForSave(txEditSelectedBgColor),
          }
        : {}),
    });
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
      ...(txEditColorTouched
        ? {
            bg_color: normalizeBgColorForSave(txEditSelectedBgColor),
            fg_color: normalizeFgColorForSave(txEditSelectedBgColor),
          }
        : {}),
    };
    if (recurrenceVal === "twice_monthly") applyBody.second_day_of_month = secondDayVal;
    await api(
      `/api/families/${state.activeFamilyId}/expected-transactions/${seriesId}/apply-from-occurrence/${encodeURIComponent(occRaw)}`,
      "POST",
      applyBody
    );
  }

  closeTxEditModal();
  await refreshExpectedCalendarAndMonth();
}

if (txEditRecurringUpdateBtn) {
  txEditRecurringUpdateBtn.addEventListener("click", () => {
    show(txEditErr, "");
    const pre = validateTxEditBeforeRecurringApply();
    if (pre) {
      show(txEditErr, pre);
      return;
    }
    openTxEditApplyScopeModal();
  });
}

const txEditApplyScopeInstanceBtn = document.getElementById("txEditApplyScopeInstanceBtn");
if (txEditApplyScopeInstanceBtn) {
  txEditApplyScopeInstanceBtn.addEventListener("click", async () => {
    try {
      await saveExpectedInstanceOverride();
    } catch (e) {
      show(document.getElementById("txEditApplyScopeErr"), e.message || "Failed to save override");
    }
  });
}

const txEditApplyScopeSeriesBtn = document.getElementById("txEditApplyScopeSeriesBtn");
if (txEditApplyScopeSeriesBtn) {
  txEditApplyScopeSeriesBtn.addEventListener("click", async () => {
    try {
      await saveExpectedSeriesFromInstance();
    } catch (e) {
      show(document.getElementById("txEditApplyScopeErr"), e.message || "Failed to save");
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

const txEditDeleteScopeInstanceBtn = document.getElementById("txEditDeleteScopeInstanceBtn");
if (txEditDeleteScopeInstanceBtn) {
  txEditDeleteScopeInstanceBtn.addEventListener("click", async () => {
    try {
      await deleteExpectedThisOccurrenceOnlyFromModal();
    } catch (e) {
      show(document.getElementById("txEditDeleteScopeErr"), e.message || "Failed to remove occurrence");
    }
  });
}

const txEditDeleteScopeFutureBtn = document.getElementById("txEditDeleteScopeFutureBtn");
if (txEditDeleteScopeFutureBtn) {
  txEditDeleteScopeFutureBtn.addEventListener("click", async () => {
    try {
      await deleteExpectedThisAndFutureFromModal();
    } catch (e) {
      show(document.getElementById("txEditDeleteScopeErr"), e.message || "Failed to delete future occurrences");
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

  // Hide admin-only tabs for non-admin users (and avoid a flash by defaulting hidden in HTML).
  const tv = document.getElementById("navTransactionView");
  const rv = document.getElementById("navReportsView");
  if (tv) tv.hidden = !state.isPlatformAdmin;
  if (rv) rv.hidden = !state.isPlatformAdmin;
  for (const el of document.querySelectorAll(".admin-only-tab")) {
    el.hidden = !state.isPlatformAdmin;
  }

  // If a non-admin hits a restricted page directly, send them back to Calendar.
  try {
    const p = String(location.pathname || "");
    if (!state.isPlatformAdmin && (p.startsWith("/transactions") || p.startsWith("/reports"))) {
      location.replace("/calendar");
    }
  } catch (_) {}
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
  syncSettingsFamilySharingNav();
}

/** Family “sharing” settings are limited to members whose family role is `admin` (see API FamilyOut.role). */
function syncSettingsFamilySharingNav() {
  const fam = (state.families || []).find((x) => Number(x.id) === Number(state.activeFamilyId));
  const isFamilyAdmin = !!(fam && String(fam.role || "").toLowerCase() === "admin");
  document.querySelectorAll('.settings-nav-item[data-settings-key="familySharing"]').forEach((el) => {
    el.hidden = !isFamilyAdmin;
  });
  if (!isFamilyAdmin) {
    const active = document.querySelector(
      '.settings-nav-item.is-active[data-settings-key="familySharing"]'
    );
    if (active) activateSettingsSection("accounts");
  }
}

async function loadFamilyMembersPanel() {
  const errEl = document.getElementById("familyMembersErr");
  const listEl = document.getElementById("familyMembersList");
  const inviteWrap = document.getElementById("familyInviteWrap");
  show(errEl, "");
  if (!listEl) return;
  if (!state.activeFamilyId) {
    listEl.innerHTML = '<p class="meta">Select a family from the app first.</p>';
    if (inviteWrap) inviteWrap.hidden = true;
    return;
  }
  syncActiveFamilyFlags();
  if (inviteWrap) inviteWrap.hidden = !state.activeFamilyIsOwner;
  const pendingEl = document.getElementById("familyPendingInvites");
  if (pendingEl) {
    pendingEl.innerHTML = "";
    if (state.activeFamilyIsOwner) {
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
  const addLi = document.createElement("li");
  addLi.className = "category-combobox__option category-combobox__option--add";
  addLi.setAttribute("role", "option");
  addLi.textContent = "Add new category…";
  st.list.appendChild(addLi);
}

function applyCategoryComboboxPickFromLi(fieldId, li) {
  if (!li) return;
  if (li.classList.contains("category-combobox__option--add")) {
    void handleAddNewCategoryFromCombobox(fieldId);
    return;
  }
  const id = li.dataset.id;
  const display = li.dataset.display || li.textContent || "";
  if (id) selectCategoryComboboxChoice(fieldId, id, display);
}

async function handleAddNewCategoryFromCombobox(fieldId) {
  const st = categoryComboboxRegistry.get(fieldId);
  if (st) hideCategoryComboboxList(st);
  const name = window.prompt("Name for the new category:");
  if (!name || !String(name).trim()) return;
  try {
    if (!state.activeFamilyId) throw new Error("Choose a family first");
    const gid = defaultNewCategoryGroupId();
    await api(`/api/families/${state.activeFamilyId}/categories`, "POST", { name: String(name).trim(), group_id: gid });
    await loadCategories();
    const trimmed = String(name).trim();
    const newCat = (state.categories || []).find((c) => String(c.name).trim() === trimmed);
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
  input.placeholder = "Type to filter…";
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
}

function syncAllCategoryComboboxes(categories) {
  for (const fid of CATEGORY_COMBOBOX_FIELD_IDS) {
    syncCategoryComboboxCategories(fid, categories);
  }
}

function refreshTxAddColorChipDot() {
  const dot = document.getElementById("txAddColorChipDot");
  if (!dot) return;
  let bg = "";
  const raw = txAddSelectedBgColor;
  if (raw && String(raw).trim().toLowerCase() !== "none") {
    bg = String(raw).trim();
  }
  if (!bg) {
    const catId = categoryIdFromCategoryField("txAddCategoryId");
    if (catId) {
      const st = categoryStyleFromId(catId);
      if (st && st.bg) bg = st.bg;
    }
  }
  if (bg) {
    dot.style.background = bg;
    dot.style.boxShadow = "inset 0 0 0 1px rgba(15, 23, 42, 0.18)";
  } else {
    dot.style.background = "rgba(148, 163, 184, 0.45)";
    dot.style.boxShadow = "inset 0 0 0 1px rgba(15, 23, 42, 0.12)";
  }
}

const txAddCategoryColorPicker = renderCategoryColorPicker({
  rowEl: txAddCategoryColorRow,
  swatchesEl: txAddCategoryColorSwatches,
  clearBtn: txAddCategoryColorClear,
  unhideRow: false,
  getCategoryId: () => categoryIdFromCategoryField("txAddCategoryId"),
  getBg: () => txAddSelectedBgColor,
  setBg: (v) => {
    txAddColorTouched = true;
    txAddSelectedBgColor = v && String(v).trim() ? String(v).trim() : null;
    refreshTxAddColorChipDot();
  },
});
const txEditCategoryColorPicker = renderCategoryColorPicker({
  rowEl: txEditCategoryColorRow,
  swatchesEl: txEditCategoryColorSwatches,
  clearBtn: txEditCategoryColorClear,
  unhideRow: false,
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

function applyTxEditColorPanelOpen(open) {
  const btn = document.getElementById("txEditAddColorBtn");
  const trigger = document.getElementById("txEditAddColorRow");
  const panel = txEditCategoryColorRow;
  if (!panel) return;
  if (open) {
    panel.hidden = false;
    if (trigger) trigger.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "true");
  } else {
    panel.hidden = true;
    if (trigger) trigger.hidden = false;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
}

function updateTxEditAddColorButtonState() {
  applyTxEditColorPanelOpen(!!txEditEffectiveColor());
}

function refreshTxCategoryColorPickers() {
  try {
    if (txAddCategoryColorPicker) txAddCategoryColorPicker.refresh();
    if (txEditCategoryColorPicker) txEditCategoryColorPicker.refresh();
  } catch (_) {}
  try { refreshTxAddColorChipDot(); } catch (_) {}
  try { updateTxEditAddColorButtonState(); } catch (_) {}
}

{
  const addColorBtn = document.getElementById("txEditAddColorBtn");
  if (addColorBtn && txEditCategoryColorRow) {
    addColorBtn.addEventListener("click", () => {
      applyTxEditColorPanelOpen(true);
      try { txEditCategoryColorPicker.refresh(); } catch (_) {}
    });
  }
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
    return;
  }
  if (el instanceof HTMLSelectElement) {
    el.value = categoryIdOrNull != null && categoryIdOrNull !== "" ? String(categoryIdOrNull) : "";
  }
  refreshTxCategoryColorPickers();
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

function renderCategoriesGrid(tree) {
  if (!categoriesTree) return;
  categoriesTree.innerHTML = "";
  const groups = tree?.groups || [];

  if (newCategoryGroupId) {
    newCategoryGroupId.innerHTML = "";
    for (const g of groups) {
      const o = document.createElement("option");
      o.value = String(g.id);
      o.textContent = g.name;
      newCategoryGroupId.appendChild(o);
    }
  }

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No category groups yet. Use + Add group.";
    categoriesTree.appendChild(empty);
    return;
  }

  function clearDragUi() {
    categoriesTree.querySelectorAll(".cat-row.is-drag-over, .cat-group-head.is-drag-over, .cat-group-body.is-drag-over").forEach((x) => {
      x.classList.remove("is-drag-over");
    });
  }

  function mountCategoryRow(c) {
    const row = document.createElement("div");
    row.className = "cat-row";
    row.dataset.categoryId = String(c.id);
    row.draggable = true;

    const nameEl = document.createElement("div");
    nameEl.className = "cat-name cat-drag-handle";
    nameEl.textContent = c.name;
    nameEl.title = categoryDisplayLabel(c);

    const controls = document.createElement("div");
    controls.className = "cat-move-controls";
    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "cat-move-btn";
    upBtn.title = "Move up";
    upBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 14l6-6 6 6" /></svg>`;
    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "cat-move-btn";
    downBtn.title = "Move down";
    downBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 10l6 6 6-6" /></svg>`;
    controls.appendChild(upBtn);
    controls.appendChild(downBtn);

    row.appendChild(nameEl);
    row.appendChild(controls);

    nameEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Find the group from DOM ancestry.
      const groupEl = row.closest(".cat-group");
      const gid = groupEl && groupEl.dataset && groupEl.dataset.groupId ? Number(groupEl.dataset.groupId) : null;
      openCatEditModal({ kind: "category", id: Number(c.id), name: String(c.name), groupId: gid });
    });

    upBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const prev = row.previousElementSibling;
      if (prev && prev.classList.contains("cat-row")) {
        row.parentElement.insertBefore(row, prev);
        scheduleCategoryTreePersist();
      }
    });
    downBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = row.nextElementSibling;
      if (next && next.classList.contains("cat-row")) {
        row.parentElement.insertBefore(next, row);
        scheduleCategoryTreePersist();
      }
    });

    row.addEventListener("dragstart", (e) => {
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `cat:${row.dataset.categoryId}`);
      } catch (_) {}
      row.classList.add("is-dragging");
    });
    row.addEventListener("dragend", () => {
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
      const movingRow = categoriesTree.querySelector(`.cat-row[data-category-id="${movingId}"]`);
      if (!movingRow) return;
      row.parentElement.insertBefore(movingRow, row);
      scheduleCategoryTreePersist();
    });
    return row;
  }

  function mountGroup(g) {
    const wrap = document.createElement("div");
    wrap.className = "cat-group";
    wrap.dataset.groupId = String(g.id);

    const head = document.createElement("div");
    head.className = "cat-group-head";
    head.draggable = true;

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "cat-group-name-input";
    nameInput.dataset.groupName = "1";
    nameInput.value = g.name;
    nameInput.readOnly = true;
    nameInput.disabled = true;
    nameInput.title = "";
    nameInput.tabIndex = -1;
    nameInput.setAttribute("aria-hidden", "true");

    const nameDisplay = document.createElement("div");
    nameDisplay.className = "cat-group-name-display";
    nameDisplay.dataset.groupName = "1";
    nameDisplay.textContent = g.name;
    nameDisplay.title = "Click to edit group name";
    nameDisplay.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCatEditModal({ kind: "group", id: Number(g.id), name: String(nameDisplay.textContent || "") });
    });

    head.appendChild(nameDisplay);
    head.appendChild(nameInput);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "cat-group-edit-btn";
    editBtn.setAttribute("aria-label", "Edit group");
    editBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 20h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16.5 3.5a2.12 2.12 0 013 3L9 17l-4 1 1-4 10.5-10.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    editBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCatEditModal({ kind: "group", id: Number(g.id), name: String(nameDisplay.textContent || "") });
    });
    head.appendChild(editBtn);

    const gControls = document.createElement("div");
    gControls.className = "cat-move-controls";
    const gUp = document.createElement("button");
    gUp.type = "button";
    gUp.className = "cat-move-btn";
    gUp.title = "Move group up";
    gUp.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 14l6-6 6 6" /></svg>`;
    const gDown = document.createElement("button");
    gDown.type = "button";
    gDown.className = "cat-move-btn";
    gDown.title = "Move group down";
    gDown.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 10l6 6 6-6" /></svg>`;
    gControls.appendChild(gUp);
    gControls.appendChild(gDown);
    head.appendChild(gControls);

    head.addEventListener("dragstart", (e) => {
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `group:${wrap.dataset.groupId}`);
      } catch (_) {}
      wrap.classList.add("is-dragging");
    });
    head.addEventListener("dragend", () => {
      wrap.classList.remove("is-dragging");
      clearDragUi();
    });

    const body = document.createElement("div");
    body.className = "cat-group-body";
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
      const movingRow = categoriesTree.querySelector(`.cat-row[data-category-id="${movingId}"]`);
      if (!movingRow) return;
      body.appendChild(movingRow);
      scheduleCategoryTreePersist();
    });

    for (const c of g.categories || []) {
      body.appendChild(mountCategoryRow(c));
    }

    gUp.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const prev = wrap.previousElementSibling;
      if (prev && prev.classList.contains("cat-group")) {
        categoriesTree.insertBefore(wrap, prev);
        scheduleCategoryTreePersist();
      }
    });
    gDown.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = wrap.nextElementSibling;
      if (next && next.classList.contains("cat-group")) {
        categoriesTree.insertBefore(next, wrap);
        scheduleCategoryTreePersist();
      }
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
        const movingRow = categoriesTree.querySelector(`.cat-row[data-category-id="${movingId}"]`);
        if (movingRow) {
          const first = body.querySelector(".cat-row");
          if (first) body.insertBefore(movingRow, first);
          else body.appendChild(movingRow);
          scheduleCategoryTreePersist();
        }
        return;
      }
      if (!raw.startsWith("group:")) return;
      const movingGid = String(raw.slice("group:".length));
      const targetGid = String(wrap.dataset.groupId);
      if (!movingGid || !targetGid || movingGid === targetGid) return;
      const movingEl = categoriesTree.querySelector(`.cat-group[data-group-id="${movingGid}"]`);
      if (!movingEl) return;
      categoriesTree.insertBefore(movingEl, wrap);
      scheduleCategoryTreePersist();
    });

    wrap.appendChild(head);
    wrap.appendChild(body);
    categoriesTree.appendChild(wrap);
  }

  for (const g of groups) {
    mountGroup(g);
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
    for (const gEl of categoriesTree.querySelectorAll(":scope > .cat-group")) {
      const gidRaw = String(gEl.dataset.groupId || "").trim();
      const parsed = Number(gidRaw);
      const gid = gidRaw !== "" && Number.isFinite(parsed) ? parsed : null;
      const nameInput = gEl.querySelector("[data-group-name]");
      const rawName =
        nameInput && "value" in nameInput
          ? String(nameInput.value || "")
          : String(nameInput?.textContent || "");
      const nm = rawName.trim();
      if (!nm) throw new Error("Each group needs a name");
      const ids = [...gEl.querySelectorAll(".cat-group-body .cat-row[data-category-id]")].map((r) => Number(r.dataset.categoryId));
      groups.push({ id: gid, name: nm, category_ids: ids });
    }
    const tree = await api(`/api/families/${state.activeFamilyId}/categories/tree`, "PUT", { groups });
    applyCategoryTreeToState(tree);
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
  const tree = await api(`/api/families/${state.activeFamilyId}/categories/tree`, "GET");
  applyCategoryTreeToState(tree);
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
  const isUncatActual =
    row._type === "actual" &&
    (!row.category_id || cat === "uncategorized" || desc === "uncategorized");
  if (isUncatActual) {
    parts.push("cal-day-tx-line--flow-neutral");
    return parts;
  }

  const kind = String(row.kind || "").toLowerCase();
  if (kind === "income") parts.push("cal-day-tx-line--flow-in");
  else if (kind === "expense") parts.push("cal-day-tx-line--flow-out");
  else parts.push("cal-day-tx-line--flow-neutral");
  return parts;
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
      accountEditId.value = String(account.id);
      accountName.value = account.name || "";
      accountType.value = account.type || "checking";
      accountStartingBalance.value = account.starting_balance ?? "";
      accountStartingBalanceDate.value = account.starting_balance_date || "";
      accountName.disabled = true;
      accountType.disabled = true;
      show(accErr, "Editing selected account's starting balance/date.");
      openAccountModal("edit");
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
}

function setExpectedModalMode() {
  const instPanel = document.getElementById("expectedEditInstancePanel");
  if (instPanel) instPanel.style.display = "block";
}

async function refreshExpectedCalendarAndMonth() {
  await loadExpectedTransactions();
  await loadExpectedCalendar();
  renderSidebarPendingTransactionsForMonth();
  renderMonthSummaryTotalsFromState();
  await loadCalendarMonthDaily();
  renderCalendar();
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
    const v = (selectedExpectedSeriesTx && selectedExpectedSeriesTx.second_day_of_month) != null ? selectedExpectedSeriesTx.second_day_of_month : tx.second_day_of_month;
    instanceSecondDayOfMonth.value = v != null ? String(v) : "";
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
        showBwToast(nowReconciled ? "✓ Reconciled successfully" : "Reconciliation cleared");
      }
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

function recurrenceLabel(value) {
  const v = String(value || "");
  if (v === "yearly") return "Annual";
  if (v === "semiannual") return "Twice yearly";
  if (v === "twice_monthly") return "Twice monthly";
  if (v === "bimonthly") return "Bi-monthly";
  if (v === "biweekly") return "Every 2 weeks";
  if (v === "monthly") return "Monthly";
  if (v === "once") return "Once";
  return v || "—";
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
  } else if (recurrence === "semiannual") {
    // Every 6 months from start.
    if (from <= start) {
      cand = start;
    } else {
      let cur = start;
      // Jump close using month difference, then step by 6.
      const monthsDiff = (from.getFullYear() - start.getFullYear()) * 12 + (from.getMonth() - start.getMonth());
      const steps = Math.max(0, Math.floor(monthsDiff / 6) * 6);
      cur = addMonthsClamped(start, steps, startDom);
      while (cur < from) cur = addMonthsClamped(cur, 6, startDom);
      cand = cur;
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
      cStatus.innerHTML = `<span class="tm-badge ${isUncat ? "tm-badge--uncategorized" : "tm-badge--confirmed"}">${isUncat ? "Uncategorized" : "Confirmed"}</span>`;

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
      opt0.textContent = "Select category…";
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
    const twiceMeta =
      tx.recurrence === "twice_monthly" && tx.second_day_of_month != null && startDom != null && !Number.isNaN(startDom)
        ? `days ${startDom} & ${tx.second_day_of_month}`
        : "";

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

  if (totalsEl.classList.contains("totals--compact")) {
    totalsEl.innerHTML = `
      <div class="totals-compact">
        <div class="totals-compact__row">
          <span class="totals-compact__k">Income</span>
          <span class="totals-compact__v ok">$${fmtMoney(income)}</span>
        </div>
        <div class="totals-compact__row">
          <span class="totals-compact__k">Expenses</span>
          <span class="totals-compact__v danger">$${fmtMoney(expense)}</span>
        </div>
        <div class="totals-compact__row totals-compact__row--net">
          <span class="totals-compact__k">Net</span>
          <span class="totals-compact__v ${net >= 0 ? "ok" : "danger"}">$${fmtMoney(net)}</span>
        </div>
      </div>`;
    return;
  }

  const incomeEl = document.createElement("div");
  incomeEl.className = "total";
  incomeEl.innerHTML = `<div class="k">Income</div><div class="v ok">$${fmtMoney(income)}</div>`;

  const expenseEl = document.createElement("div");
  expenseEl.className = "total";
  expenseEl.innerHTML = `<div class="k">Expense</div><div class="v danger">$${fmtMoney(expense)}</div>`;

  const netEl = document.createElement("div");
  netEl.className = "total";
  netEl.innerHTML = `<div class="k">Net</div><div class="v ${net >= 0 ? "ok" : "danger"}">$${fmtMoney(net)}</div>`;

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
    return;
  }

  setTitle(rows.length);
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const it = r.tx;
    const open = () => {
      const meta = getExpectedSeriesMeta(it?.expected_transaction_id);
      if (meta) openExpectedEditModal(meta, { calendarItem: it });
    };

    const kind = String(it?.kind || "expense");

    const el = document.createElement("div");
    el.className = "pending-attn-item";
    let daysUntil = 999;
    try {
      const t0 = new Date(`${todayIso}T12:00:00`).getTime();
      const t1 = new Date(`${r.sortIso}T12:00:00`).getTime();
      if (Number.isFinite(t0) && Number.isFinite(t1)) daysUntil = Math.round((t1 - t0) / 86400000);
    } catch (_) {}
    if (daysUntil >= 0 && daysUntil <= 3) el.classList.add("is-critical");
    else if (daysUntil >= 0 && daysUntil <= 10) el.classList.add("is-soon");
    el.style.cursor = "pointer";
    el.addEventListener("click", () => open());

    const catLabel = effectiveTransactionCategoryName(it) || "Uncategorized";
    const descFull = String(it?.description || "").trim();
    const notesFull = String(it?.notes || "").trim();
    const hintParts = [descFull, notesFull].filter(Boolean);

    const name = document.createElement("div");
    name.className = `pending-attn-name ${kindFgClass(kind)}`;
    name.textContent = truncate(catLabel, 72);
    name.title = hintParts.length ? `${catLabel} — ${hintParts.join(" · ")}` : catLabel;

    const est = document.createElement("div");
    est.className = "pending-attn-est";
    const amt = Math.abs(toNum(it?.amount));
    const sign = String(kind) === "income" ? "+" : "–";
    est.textContent = `${sign}$${fmtMoney0(amt)}`;
    est.title = `${catLabel} ${sign}$${fmtMoney0(amt)}`;

    const date = document.createElement("div");
    date.className = "pending-attn-date";
    date.textContent = it?.date ? fmtMonthDay(it.date) : "—";

    el.appendChild(name);
    el.appendChild(est);
    el.appendChild(date);
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
        if (!iso) continue;
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
          if (!iso || state.monthDailyBalances.has(iso)) continue;
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

function setCalendarLoadingUi(on) {
  const panel = document.getElementById("calendarPanel");
  if (panel) {
    panel.classList.toggle("calendar-panel--loading", !!on);
    panel.setAttribute("aria-busy", on ? "true" : "false");
  }
  for (const el of [calendarPrevMonth, calendarNextMonth, calendarGoToday, calendarMonthNum, calendarYear, calendarMode]) {
    if (el) el.disabled = !!on;
  }
}

async function loadMonthAndCalendar() {
  try {
    setCalendarLoadingUi(!!state.activeFamilyId);
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
      if (instanceSecondDayOfMonth) instanceSecondDayOfMonth.value = meta.second_day_of_month != null ? String(meta.second_day_of_month) : "";
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
  wrapper.className = "calendar";

  if (calendarDow) {
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
  const MIN_CELL_H = 162;
  const MAX_VISIBLE_TXNS = 2;
  const minBalFloor = readStoredMinBalanceThresholdForReports();
  /** @type {HTMLElement[]} */
  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement("div");
    cell.className = "cal-cell";

    const dayNum = i - offset + 1;
    const isOutOfMonth = dayNum < 1 || dayNum > daysInMonth;
    const dObj = new Date(year, monthIndex, dayNum);
    const iso = toISODate(dObj);
    cell.dataset.iso = iso;
    if (earliestStartIso && iso < earliestStartIso) {
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
        <div class="cal-day-txns"></div>
        <div class="cal-ledger-metrics"></div>
      </div>
    `;
    if (isOutOfMonth) cell.classList.add("cal-cell--out");
    // In-month "past" gray only when we have no starting-balance date; otherwise only
    // cal-cell--before-start tints days before the anchor (days on/after stay white).
    if (!isOutOfMonth && isPast && !earliestStartIso) cell.classList.add("cal-cell--past");
    const txnsEl = cell.querySelector(".cal-day-txns");
    const metricsEl = cell.querySelector(".cal-ledger-metrics");
    const noteEl = cell.querySelector(".cal-forecast-note");

    const dayNumEl = cell.querySelector(".cal-daynum");
    if (dayNumEl) {
      dayNumEl.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openReconcileModal(iso);
      });
    }

    const actualTxs = showActual ? actualTxsByDate.get(iso) || [] : [];
    const expectedItems = showExpected ? expectedByDate.get(iso) || [] : [];
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
      for (const sb of startBalancesByDate.get(iso) || []) combined.push(sb);
      combined.sort((a, b) => {
        const aSb = a && a._type === "start_balance" ? 1 : 0;
        const bSb = b && b._type === "start_balance" ? 1 : 0;
        if (aSb !== bSb) return bSb - aSb;
        const pa = calendarTxnPriority(a);
        const pb = calendarTxnPriority(b);
        if (pb !== pa) return pb - pa;
        return txSortCalendarDayImpact(a, b);
      });
    }

    if (showDetails) {
      const isExpanded = !!(state.calendarExpandedDays && state.calendarExpandedDays.has(iso));
      const visibleRows = isExpanded ? combined : combined.slice(0, MAX_VISIBLE_TXNS);
      const hiddenCount = Math.max(0, combined.length - visibleRows.length);

      // Render a compact, forecast-first list. Expand only on demand.
      for (let vri = 0; vri < visibleRows.length; vri++) {
        const row = visibleRows[vri];
        const isExpected = row._type === "expected";
        const isStartBalance = row._type === "start_balance";
        const line = document.createElement("div");
        line.className = isExpected
          ? "cal-day-tx-line cal-day-tx-line--expected"
          : isStartBalance
            ? "cal-day-tx-line cal-day-tx-line--start-balance"
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
        if (!isExpected && !isStartBalance) line.dataset.txId = String(row.id);

        // Match list UIs: prefer category (from API string or category_id → state.categories).
        // Forecast rows used to always show description (e.g. "ComEd") even when category was "Gas".
        const categoryName = isStartBalance ? "" : effectiveTransactionCategoryName(row);
        const descRaw = isExpected || isStartBalance ? row.description || "(expected)" : (row.description || "Uncategorized").trim();
        const labelRaw = categoryName || descRaw;
        // Keep labels short so they don't wrap into the amount column.
        const label = truncate(labelRaw, 48);

        const labelSpan = document.createElement("span");
        labelSpan.className = "cal-tx-label";
        labelSpan.textContent = `${label} `;

        const labelWrap = document.createElement("span");
        labelWrap.className = "cal-tx-label-wrap";
        if (isStartBalance) {
          line.title = "Starting balance — your forecast begins here";
          const flag = document.createElement("span");
          flag.className = "cal-tx-start-flag";
          flag.setAttribute("aria-hidden", "true");
          flag.innerHTML =
            '<svg viewBox="0 0 12 14" width="11" height="13" focusable="false"><path fill="currentColor" d="M0.75 0h1.25v14H0.75V0zm2.75 1.5L11 5.2 3.5 8.9V1.5z"/></svg>';
          labelWrap.appendChild(flag);
        }
        labelWrap.appendChild(labelSpan);

        const amtSpan = document.createElement("span");
        amtSpan.className = "cal-amt";
        if (!isStartBalance) {
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
            if (alertIfDateBeforeStartingBalance(iso)) return;
            const meta = getExpectedSeriesMeta(row.expected_transaction_id);
            if (meta) openExpectedEditModal(meta, { calendarItem: row });
          });
        }

        txnsEl.appendChild(line);
      }

      if (hiddenCount > 0 && txnsEl) {
        const moreBtn = document.createElement("button");
        moreBtn.type = "button";
        moreBtn.className = "cal-day-more";
        moreBtn.textContent = `+${hiddenCount} more`;
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
    }

    if (!showDetails || combined.length === 0) {
      cell.classList.add("cal-cell--no-tx");
    }

    if (iso === monthRecoveryIso && !isOutOfMonth && !cell.classList.contains("cal-cell--before-start")) {
      cell.classList.add("cal-cell--recovery-milestone");
    }

    const dayBal = state.monthDailyBalances.get(iso);

    if (dayBal && metricsEl) {
      const endNum = Number(dayBal.end ?? 0);
      const txNetNum = Number(dayBal.tx_net);
      const balParts = ["cal-stat", "cal-balance"];
      const hasFloor = minBalFloor != null && Number.isFinite(minBalFloor) && minBalFloor > 0;
      if (Number.isFinite(endNum)) {
        if (endNum < 0) {
          balParts.push("is-negative", "cal-balance--risk");
        } else if (isOutOfMonth) {
          balParts.push("is-muted");
        } else {
          if (hasFloor && endNum < minBalFloor) {
            balParts.push("cal-balance--below-floor");
          } else if (hasFloor && endNum < minBalFloor * 1.25) {
            balParts.push("cal-balance--watch-zone");
          } else if (monthLowPointIso === iso) {
            balParts.push("cal-balance--month-low-mark");
          } else if (isPast) {
            balParts.push("cal-balance--quiet", "cal-balance--past-day");
          } else {
            balParts.push("cal-balance--quiet");
          }
        }
      }
      const belowFloor = hasFloor && Number.isFinite(endNum) && endNum >= 0 && endNum < minBalFloor;
      const negativeBal = Number.isFinite(endNum) && endNum < 0;
      const watchOnly = hasFloor && Number.isFinite(endNum) && endNum >= minBalFloor && endNum < minBalFloor * 1.25;
      if (
        iso === monthRecoveryIso &&
        !isOutOfMonth &&
        Number.isFinite(endNum) &&
        endNum >= 0 &&
        !negativeBal &&
        !(hasFloor && endNum < minBalFloor * 1.25)
      ) {
        balParts.push("cal-balance--recovery-milestone");
      } else if (
        stabilizingDay &&
        !isOutOfMonth &&
        Number.isFinite(endNum) &&
        endNum >= 0 &&
        !negativeBal &&
        !belowFloor
      ) {
        balParts.push("cal-balance--stabilizing");
      } else if (
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
        negativeBal
          ? `<span class="cal-balance-risk-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="11" height="11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 2.25L14 13.75H2L8 2.25z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/><path d="M8 6.25v3M8 11.1v.01" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></span>`
          : "";
      const warnIcon =
        belowFloor && !negativeBal
          ? `<span class="cal-balance-warn-icon" aria-hidden="true" title="Below your balance floor"><svg viewBox="0 0 16 16" width="11" height="11" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 2.25L14 13.75H2L8 2.25z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round" fill="none"/><path d="M8 6.25v3M8 11.1v.01" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/></svg></span>`
          : "";
      metricsEl.innerHTML = `<div class="cal-balance-strip${stripCue ? ` ${stripCue}` : ""}"><div class="cal-balance-strip__row">${riskIcon}${warnIcon}<div class="${balanceClass}" title="Projected end-of-day balance">$${fmtMoneyParens(
        endNum
      )}</div></div></div>`;
    }

    if (
      minBalFloor != null &&
      Number.isFinite(minBalFloor) &&
      minBalFloor > 0 &&
      dayBal &&
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

    wrapper.appendChild(cell);
    cells.push(cell);
  }

  calendarGrid.appendChild(wrapper);

  // Expand each week row to fit all transactions, keeping all 7 days the same height.
  try {
    if (showDetails) {
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
}

function readStoredMinBalanceThresholdForReports() {
  const fid = activeFamilyIdForBalanceThresholds();
  if (fid == null) return null;
  const k = getBalanceThresholdKey("min", fid);
  if (!k) return null;
  let raw = "";
  try {
    raw = localStorage.getItem(k) || "";
  } catch (_) {}
  const n = Number(String(raw).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function weekKeyMondayFromIso(iso) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return toISODate(d);
}

function aggregateIncomeExpenseByWeek(items) {
  /** @type {Map<string,{income:number,expense:number}>} */
  const byWeek = new Map();
  for (const it of items || []) {
    const iso = it && it.date ? String(it.date) : "";
    if (!iso || iso.length < 10) continue;
    const wk = weekKeyMondayFromIso(iso);
    if (!wk) continue;
    const kind = String(it.kind || "");
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
  const n = items.length;
  const balances = items.map((d) => Number(d.total_balance ?? 0));
  const out = [];
  for (let i = 0; i < n; i++) {
    let minF = Number.POSITIVE_INFINITY;
    for (let j = i; j < n; j++) {
      minF = Math.min(minF, balances[j]);
    }
    out.push(Math.max(0, minF - floor));
  }
  return out;
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

/** Conversational recurrence copy for the obligations report (does not replace `recurrenceLabel` elsewhere). */
function obligationRecurrenceLabel(raw) {
  const v = String(raw || "").toLowerCase();
  if (v === "yearly" || v === "annual") return "Once per year";
  if (v === "semiannual") return "Every 6 months";
  if (v === "twice_monthly") return "Twice a month";
  if (v === "bimonthly") return "Every 2 months";
  if (v === "biweekly") return "Every 2 weeks";
  if (v === "weekly") return "Every week";
  if (v === "monthly") return "Every month";
  if (v === "once") return "Once";
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
  const base = String(tx.description || "Scheduled expense").trim() || "Scheduled expense";
  const cn = categoryNameForPressure(tx.category_id);
  if (!cn) return base;
  return `${base} · ${cn}`;
}

function balanceAfterPressureClass(after, floor) {
  if (after == null || !Number.isFinite(after)) return "reports-pressure-bal--unknown";
  if (after < 0) return "reports-pressure-bal--neg";
  if (floor != null && after < floor * 0.5) return "reports-pressure-bal--low";
  if (floor != null && after < floor * 1.05) return "reports-pressure-bal--caution";
  return "reports-pressure-bal--ok";
}

function computePressureRecoveryLabel(daily, impactIso, afterBal) {
  const thr = readStoredMinBalanceThresholdForReports();
  const target = thr != null ? thr : 0;
  if (afterBal == null || !Number.isFinite(afterBal)) {
    return { label: "Outside forecast range", cls: "reports-pressure-rec--muted" };
  }
  const norm = (s) => normalizeIsoDate(s) || "";
  const imp = norm(impactIso);
  const rows = (daily || [])
    .slice()
    .sort((a, b) => norm(a.date).localeCompare(norm(b.date)));
  const idx = rows.findIndex((r) => norm(r.date) === imp);
  if (idx < 0) {
    return { label: "Outside forecast range", cls: "reports-pressure-rec--muted" };
  }
  if (afterBal >= target) {
    return {
      label: thr != null ? "Above your floor" : "In the black",
      cls: "reports-pressure-rec--ok",
    };
  }
  for (let j = idx + 1; j < rows.length; j++) {
    const b = Number(rows[j].total_balance ?? 0);
    if (b >= target) {
      return { label: fmtObligationNextDate(norm(rows[j].date)), cls: "reports-pressure-rec--date" };
    }
  }
  return { label: "Outside forecast range", cls: "reports-pressure-rec--muted" };
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
  if (r === "bimonthly") return a / 2;
  if (r === "semiannual") return a / 6;
  if (r === "yearly" || r === "annual") return a / 12;
  return a;
}

function renderReportsBalanceTakeaway(items, dateLabels, values) {
  const el = document.getElementById("reportsBalanceTakeaway");
  if (!el) return;
  el.replaceChildren();
  if (!items?.length || values.length < 2) {
    el.hidden = true;
    return;
  }
  const thr = readStoredMinBalanceThresholdForReports();
  let lowIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[lowIdx]) lowIdx = i;
  }
  const minV = Number(values[lowIdx]);
  const lowIso = String(dateLabels[lowIdx] || "");

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

  const stack = document.createElement("div");
  stack.className = "reports-takeaway-stack";

  const addLine = (cls, text) => {
    const line = document.createElement("div");
    line.className = cls;
    line.textContent = text;
    stack.appendChild(line);
  };

  if (firstNeg >= 0) {
    const d0 = fmtMonthDay(String(dateLabels[firstNeg] || ""));
    const dip = Math.abs(minV);
    const lowMoney = minV < 0 ? `−$${fmtMoney(dip)}` : `$${fmtMoney(minV)}`;
    addLine("reports-takeaway__kicker", `Negative starting ${d0}`);
    addLine("reports-takeaway__stat", `Projected low: ${lowMoney}`);
    if (recoveryPos >= 0) {
      const dRec = fmtMonthDay(String(dateLabels[recoveryPos] || ""));
      addLine("reports-takeaway__detail", `Back to zero by ${dRec}`);
    } else {
      const dLast = fmtMonthDay(String(dateLabels[lastNegIdx] || ""));
      addLine("reports-takeaway__detail", `Below zero through ${dLast}`);
    }
    let worstI = -1;
    let worstNet = 0;
    for (let i = firstNeg; i <= lastNegIdx; i++) {
      const net = Number(items[i]?.net_cashflow ?? 0);
      if (Number.isFinite(net) && net < worstNet) {
        worstNet = net;
        worstI = i;
      }
    }
    if (worstI >= 0 && worstNet < -250) {
      const dn = fmtMonthDay(String(dateLabels[worstI] || ""));
      const p = document.createElement("p");
      p.className = "reports-takeaway__driver";
      p.textContent = `Largest single-day drain in this stretch: −$${fmtMoney(Math.abs(worstNet))} (${dn}).`;
      stack.appendChild(p);
    }
  } else if (thr != null && Number.isFinite(thr) && thr > 0 && minV < thr) {
    addLine("reports-takeaway__lead", "Approaching your comfort floor");
    addLine("reports-takeaway__stat", `Low: $${fmtMoney(minV)}`);
    addLine("reports-takeaway__detail", `Near your $${fmtMoney(thr)} floor on ${fmtMonthDay(lowIso)}`);
  } else {
    addLine("reports-takeaway__lead", `Low near $${fmtMoney(minV)} on ${fmtMonthDay(lowIso)}`);
    addLine("reports-takeaway__detail reports-takeaway__detail--muted", "Stays above zero in this window.");
  }

  el.appendChild(stack);
  el.hidden = false;
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
  const pills = [];
  const hasNeg = negSpans.length > 0;
  const secondary = hasNeg ? "reports-legend__item reports-legend__item--secondary" : "reports-legend__item";

  if (hasNeg) {
    const sp = negSpans[0];
    const a = escapeHtml(fmtMonthDay(String(dateLabels[sp.a] || "")));
    const b = escapeHtml(fmtMonthDay(String(dateLabels[sp.b] || "")));
    const negTxt = sp.a === sp.b ? `Negative · ${a}` : `Negative · ${a} – ${b}`;
    pills.push(`<span class="reports-legend__item reports-legend__item--risk reports-legend__item--primary">${negTxt}</span>`);
  }

  pills.push(
    `<span class="${secondary}">Lowest <strong>$${fmtMoney(values[lowIdx])}</strong> · ${escapeHtml(fmtMonthDay(lowIso))}</span>`
  );

  if (worstOutflow) {
    pills.push(
      `<span class="${secondary}">Large outflow <strong>−$${fmtMoney(Math.abs(worstOutflow.net))}</strong> · ${escapeHtml(fmtMonthDay(worstOutflow.iso))}</span>`
    );
  }

  if (thr != null && Number.isFinite(thr) && thr > 0) {
    pills.push(
      `<span class="reports-legend__item reports-legend__item--floor reports-legend__item--muted">Floor $${fmtMoney(thr)}</span>`
    );
  }

  const maxPills = 4;
  el.innerHTML = `<div class="reports-legend__inner">${pills.slice(0, maxPills).join("")}</div>`;
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
    return;
  }
  if (floor == null) {
    if (emptyEl) {
      emptyEl.style.display = "flex";
      emptyEl.textContent = "Set a minimum balance in Settings to see safe-to-transfer headroom.";
    }
    if (statsEl) {
      statsEl.innerHTML =
        '<p class="meta">Safe transfer uses your saved minimum balance as a floor across the remaining forecast path.</p>';
    }
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";
  const labels = items.map((d) => d.date);
  const series = computeSafeToTransferSeries(items, floor);
  const hi = Math.max(...series);
  const lo = Math.min(...series);
  const avg = series.reduce((a, b) => a + b, 0) / series.length;
  if (statsEl) {
    statsEl.innerHTML = `<div class="reports-mini-stats__row">
      <div><span class="k">High</span><span class="v">$${fmtMoney(hi)}</span></div>
      <div><span class="k">Low</span><span class="v">$${fmtMoney(lo)}</span></div>
      <div><span class="k">Average</span><span class="v">$${fmtMoney(avg)}</span></div>
    </div>`;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  reportsSafeTransferChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Safe to move",
          data: series,
          borderColor: "rgba(11, 61, 46, 0.88)",
          backgroundColor: "rgba(11, 61, 46, 0.08)",
          borderWidth: 2,
          fill: true,
          tension: 0.2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (t) => formatProjectionTooltipDate(labels[t[0]?.dataIndex ?? 0]),
            label: (c) => ` Headroom $${fmtMoney(c.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
        },
        y: {
          grid: { color: "rgba(0,0,0,0.05)", drawBorder: false },
          ticks: {
            callback: (v) => "$" + fmtMoney0(v),
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

function renderReportsRiskHeatmap(daily) {
  const host = document.getElementById("reportsRiskHeatmapGrid");
  const insightEl = document.getElementById("reportsRiskHeatmapInsight");
  if (!host) return;
  host.innerHTML = "";
  const items = (daily || []).slice(0, 60);
  const thr = readStoredMinBalanceThresholdForReports();

  const setInsight = (text, hidden) => {
    if (!insightEl) return;
    insightEl.textContent = text || "";
    insightEl.hidden = !!hidden || !text;
  };

  if (!items.length) {
    setInsight("", true);
    return;
  }

  const isTightForStreak = (bal) => (thr != null ? bal < thr : bal < 0);
  let run = 0;
  let runStart = -1;
  let bestLen = 0;
  let bestStartIso = "";
  for (let i = 0; i < items.length; i++) {
    const bal = Number(items[i].total_balance ?? 0);
    if (isTightForStreak(bal)) {
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

  if (bestLen >= 2 && bestStartIso) {
    setInsight(
      thr != null
        ? `Projected below your $${fmtMoney(thr)} floor for ${bestLen} straight days beginning ${fmtMonthDay(bestStartIso)}.`
        : `Projected negative balance for ${bestLen} straight days beginning ${fmtMonthDay(bestStartIso)}.`,
      false
    );
  } else if (bestLen === 1 && bestStartIso) {
    setInsight(
      thr != null
        ? `Projected below your $${fmtMoney(thr)} floor on ${fmtMonthDay(bestStartIso)}.`
        : `Projected negative balance on ${fmtMonthDay(bestStartIso)}.`,
      false
    );
  } else if (thr != null) {
    setInsight("No below-floor days in the next 60 days.", false);
  } else {
    const anyNeg = items.some((row) => Number(row.total_balance ?? 0) < 0);
    setInsight(
      anyNeg
        ? "Set a minimum balance in Settings to flag cushion risk and below-target streaks."
        : "No projected negative days in this window. Set a minimum balance in Settings to tune cushion bands.",
      false
    );
  }

  const firstIso = String(items[0].date || "");
  const firstDt = new Date(`${firstIso}T12:00:00`);
  const lead = Number.isNaN(firstDt.getTime()) ? 0 : (firstDt.getDay() + 6) % 7;
  for (let p = 0; p < lead; p++) {
    const ph = document.createElement("div");
    ph.className = "reports-risk-pad";
    ph.setAttribute("aria-hidden", "true");
    host.appendChild(ph);
  }

  let prevMonth = -1;
  for (const row of items) {
    const iso = String(row.date || "");
    const bal = Number(row.total_balance ?? 0);
    let cls = "reports-risk-cell--safe";
    if (bal < 0) cls = "reports-risk-cell--neg";
    else if (thr != null && bal < thr * 0.5) cls = "reports-risk-cell--low";
    else if (thr != null && bal < thr * 1.05) cls = "reports-risk-cell--caution";

    const dt = new Date(`${iso}T12:00:00`);
    const dom = Number.isNaN(dt.getTime()) ? 0 : dt.getDate();
    const m0 = Number.isNaN(dt.getTime()) ? -1 : dt.getMonth();

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `reports-risk-cell ${cls}`;
    if (m0 !== prevMonth) {
      cell.classList.add("reports-risk-cell--month-start");
      cell.dataset.month = Number.isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("en-US", { month: "short" });
      prevMonth = m0;
    }

    let tip = `${fmtDateMedDisplay(iso)} — Projected ${fmtMoney0SignedDollar(bal)}`;
    if (thr != null) {
      const gap = bal - thr;
      tip += ` · ${gap < 0 ? "" : "+"}$${fmtMoney0(Math.abs(gap))} vs $${fmtMoney0(thr)} floor`;
    }
    tip += " — Click to open Forecast for this month.";
    cell.title = tip;
    cell.setAttribute("aria-label", `${fmtDateMedDisplay(iso)}, projected ${fmtMoney0SignedDollar(bal)}. Open forecast.`);

    const dEl = document.createElement("span");
    dEl.className = "reports-risk-cell__d";
    dEl.textContent = String(dom || "");
    const bEl = document.createElement("span");
    bEl.className = "reports-risk-cell__b";
    bEl.textContent = fmtMoneyCompactTile(bal);
    cell.appendChild(dEl);
    cell.appendChild(bEl);
    cell.addEventListener("click", () => navigateToCalendarForRiskDay(iso));
    host.appendChild(cell);
  }

  const used = lead + items.length;
  const trail = (7 - (used % 7)) % 7;
  for (let p = 0; p < trail; p++) {
    const ph = document.createElement("div");
    ph.className = "reports-risk-pad";
    ph.setAttribute("aria-hidden", "true");
    host.appendChild(ph);
  }
}

function renderReportsObligations() {
  const body = document.getElementById("reportsObligationBody");
  const foot = document.getElementById("reportsObligationFoot");
  const summaryWrap = document.getElementById("reportsObligationSummary");
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
    if (!allRows.length) {
      summaryWrap.hidden = true;
      if (statTotal) statTotal.textContent = "—";
      if (statLargest) statLargest.textContent = "—";
      if (statWeek) statWeek.textContent = "—";
    } else {
      summaryWrap.hidden = false;
      const totalEst = allRows.reduce((a, r) => a + r.est, 0);
      let largest = allRows[0];
      for (const r of allRows) {
        if (r.amt > largest.amt) largest = r;
      }
      const due7 = allRows.filter((r) => r.nextIso >= todayIso && r.nextIso <= weekEndIso);
      const due7Sum = due7.reduce((a, r) => a + r.amt, 0);
      if (statTotal) statTotal.textContent = `$${fmtMoney(totalEst)}`;
      if (statLargest) statLargest.textContent = `${largest.desc} · $${fmtMoney(largest.amt)}`;
      if (statWeek) statWeek.textContent = due7.length ? `$${fmtMoney(due7Sum)} · ${due7.length} due` : "—";
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
    th.textContent = g;
    headTr.appendChild(th);
    body.appendChild(headTr);

    for (const r of list) {
      const tr = document.createElement("tr");
      if (r.isLarge) tr.classList.add("reports-obligation-row--large");
      const pill = r.isLarge ? `<span class="reports-obligation-pill">Large</span>` : "";
      tr.innerHTML = `<td class="reports-obligation-desc">${escapeHtml(r.desc)}${pill ? ` ${pill}` : ""}</td><td class="num reports-obligation-amt">$${fmtMoney(
        r.amt
      )}</td><td class="reports-obligation-freq">${escapeHtml(r.recLabel)}</td><td>${escapeHtml(
        fmtObligationNextDate(r.nextIso)
      )}</td><td class="num reports-ob-est">$${fmtMoney(r.est)}</td>`;
      body.appendChild(tr);
    }

    const subTr = document.createElement("tr");
    subTr.className = "reports-obligation-subtotal";
    subTr.innerHTML = `<td colspan="4" class="reports-obligation-subtotal__k">${escapeHtml(g)} · Est. monthly (this view)</td><td class="num reports-ob-est">$${fmtMoney(
      subEst
    )}</td>`;
    body.appendChild(subTr);
  }

  if (foot && rows.length) {
    const tr = document.createElement("tr");
    tr.className = "reports-obligation-grand";
    tr.innerHTML = `<td colspan="4">Total · Est. monthly (this view)</td><td class="num reports-ob-est">$${fmtMoney(grandEst)}</td>`;
    foot.appendChild(tr);
  }
}

function renderReportsCashPressure(daily) {
  const body = document.getElementById("reportsPressureBody");
  const hint = document.getElementById("reportsPressureHint");
  const summaryEl = document.getElementById("reportsPressureSummary");
  const statLargest = document.getElementById("reportsPressureStatLargest");
  const statLowBal = document.getElementById("reportsPressureStatLowBal");
  const statCount = document.getElementById("reportsPressureStatCount");
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
      amt,
      after,
      recovery: computePressureRecoveryLabel(daily, nextIso, after),
    });
  }
  hits.sort((a, b) => String(a.iso).localeCompare(String(b.iso)));

  if (hint) {
    hint.textContent = hits.length
      ? 'Sorted by impact date. "Balance after" is end-of-day projected total; recovery is first day back above your floor (Settings) or in the black.'
      : "No scheduled outflows of $400+ in the next 90 days.";
  }

  if (summaryEl) {
    if (!hits.length) {
      summaryEl.hidden = true;
      if (statLargest) statLargest.textContent = "—";
      if (statLowBal) statLowBal.textContent = "—";
      if (statCount) statCount.textContent = "—";
    } else {
      summaryEl.hidden = false;
      let maxHit = hits[0];
      for (const h of hits) {
        if (h.amt > maxHit.amt) maxHit = h;
      }
      const withBal = hits.filter((h) => h.after != null && Number.isFinite(h.after));
      let lowLine = "Outside forecast range";
      if (withBal.length) {
        let low = withBal[0];
        for (const h of withBal) {
          if (h.after < low.after) low = h;
        }
        lowLine = `${fmtObligationNextDate(low.iso)} · ${fmtMoney0SignedDollar(low.after)}`;
      }
      if (statLargest) statLargest.textContent = `${maxHit.desc} · $${fmtMoney(maxHit.amt)}`;
      if (statLowBal) statLowBal.textContent = lowLine;
      if (statCount) statCount.textContent = String(hits.length);
    }
  }

  for (const h of hits) {
    const tr = document.createElement("tr");
    tr.className = "reports-pressure-row";
    const balCls = balanceAfterPressureClass(h.after, floor);
    let balHtml;
    if (h.after != null && Number.isFinite(h.after)) {
      balHtml = `<td class="num reports-pressure-bal ${balCls}">${fmtMoney0SignedDollar(h.after)}</td>`;
    } else {
      balHtml = `<td class="num reports-pressure-bal reports-pressure-bal--unknown">Outside forecast range</td>`;
    }
    const rec = h.recovery || { label: "Outside forecast range", cls: "reports-pressure-rec--muted" };
    tr.innerHTML = `<td class="reports-pressure-date">${escapeHtml(fmtObligationNextDate(h.iso))}</td><td class="reports-pressure-days">${escapeHtml(
      formatDaysUntilImpact(todayIso, h.iso)
    )}</td><td class="reports-pressure-desc">${escapeHtml(h.desc)}</td><td class="num reports-pressure-amt">$${fmtMoney(
      h.amt
    )}</td>${balHtml}<td class="reports-pressure-rec ${rec.cls}">${escapeHtml(rec.label)}</td>`;
    body.appendChild(tr);
  }
  if (!hits.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="reports-table__empty">No upcoming pressure rows.</td>`;
    body.appendChild(tr);
  }
}

function renderReportsOperationalPanels() {
  const daily = lastProjectionDailyForReports || [];
  drawReportsSafeTransferChart(daily);
  renderReportsRiskHeatmap(daily);
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
  if (onReports && items.length === values.length) {
    const ranked = items
      .map((row, i) => ({ i, n: Number(row?.net_cashflow ?? NaN) }))
      .filter((x) => Number.isFinite(x.n) && x.n < 0)
      .sort((a, b) => a.n - b.n)
      .slice(0, 3);
    for (const x of ranked) outflowMarkers.add(x.i);
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

  const negFillBelow =
    onReports ? "rgba(185, 28, 28, 0.014)" : "rgba(167, 55, 68, 0.12)";
  const negFillBelowEnd = onReports ? "rgba(185, 28, 28, 0.018)" : "rgba(167, 55, 68, 0.12)";
  const posFillAbove = onReports ? "rgba(11, 61, 46, 0.045)" : "rgba(11, 61, 46, 0.12)";

  const datasets = [
    {
      label: "Balance",
      data: values,
      borderColor: "rgba(11, 61, 46, 0.92)",
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
        g.addColorStop(0, posFillAbove);
        g.addColorStop(t, posFillAbove);
        g.addColorStop(t, negFillBelow);
        g.addColorStop(1, negFillBelowEnd);
        return g;
      },
      borderWidth: onReports ? 2.25 : 2,
      fill: true,
      tension: onReports ? 0.26 : 0.15,
      pointRadius,
      pointHoverRadius: 5,
      pointBackgroundColor,
      segment: {
        borderColor: (ctx) => {
          const y0 = ctx.p0.parsed.y;
          const y1 = ctx.p1.parsed.y;
          const mid = (Number(y0) + Number(y1)) / 2;
          return mid >= 0 ? "rgba(11, 61, 46, 0.92)" : "rgba(167, 55, 68, 0.9)";
        },
      },
    },
  ];
  if (thr != null) {
    datasets.push({
      label: "Minimum",
      data: dateLabels.map(() => thr),
      borderColor: onReports ? "rgba(100, 116, 139, 0.38)" : "rgba(75, 85, 99, 0.55)",
      borderWidth: onReports ? 1 : 1.5,
      borderDash: onReports ? [6, 5] : [5, 5],
      pointRadius: 0,
      fill: false,
      tension: 0,
    });
  }
  if (onReports && outflowMarkers.size) {
    datasets.push({
      label: "Heavy outflow days",
      data: values.map((v, i) => (outflowMarkers.has(i) ? v : null)),
      borderColor: "rgba(0, 0, 0, 0)",
      backgroundColor: "rgba(62, 99, 221, 0.88)",
      borderWidth: 0,
      pointRadius: values.map((_, i) => (outflowMarkers.has(i) ? 4 : 0)),
      pointHoverRadius: 5,
      pointStyle: "circle",
      showLine: false,
      spanGaps: false,
    });
  }

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
            padding: { top: 12, right: 8, bottom: 4, left: 0 },
          }
        : undefined,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
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
              if (ctx.dataset.label === "Minimum") return ` Floor $${fmtMoney(ctx.parsed.y)}`;
              if (ctx.dataset.label === "Heavy outflow days") {
                const i = ctx.dataIndex;
                const net = Number(items[i]?.net_cashflow ?? 0);
                if (!Number.isFinite(net)) return "";
                return ` Large outflow −$${fmtMoney(Math.abs(net))}`;
              }
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
            color: "rgba(148, 163, 184, 0.22)",
            lineWidth: onReports ? 1 : 1,
            drawTicks: false,
          },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 8,
            maxRotation: 0,
            color: onReports ? "rgba(100, 116, 139, 0.55)" : undefined,
            font: onReports ? { size: 10, weight: "500" } : undefined,
            callback: function (tickValue) {
              const lbl = typeof tickValue === "number" ? dateLabels[tickValue] : tickValue;
              if (lbl == null || lbl === "") return "";
              return formatProjectionAxisDate(String(lbl));
            },
          },
        },
        y: {
          grid: {
            color: onReports ? "rgba(148, 163, 184, 0.2)" : "rgba(0,0,0,0.045)",
            drawBorder: false,
          },
          ticks: {
            maxTicksLimit: 6,
            color: onReports ? "rgba(100, 116, 139, 0.52)" : undefined,
            font: onReports ? { size: 10, weight: "500" } : undefined,
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
  const price = getTrialContinueMonthlyPriceDisplay();
  el.textContent = `$${price}/month after trial unless canceled.`;
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
      <h3 id="bwForecastReadyTitle">✓ Your forecast is ready</h3>
      <div id="bwForecastReadyDesc" class="bw-forecast-ready__body">
        <p class="bw-forecast-ready__tagline">See what’s coming before it happens.</p>
        <p class="bw-forecast-ready__can-now">You can now:</p>
        <ul class="bw-forecast-ready__can-list">
          <li>forecast upcoming balances</li>
          <li>track recurring income &amp; bills</li>
          <li>spot low-balance periods before they happen</li>
        </ul>
        <ul class="bw-forecast-ready__fine-list" aria-label="Trial and pricing">
          <li>14-day free trial included.</li>
          <li><span id="bwForecastReadyPricingLine">$5.99/month after trial unless canceled.</span></li>
        </ul>
      </div>
      <div class="modal-actions bw-forecast-ready__actions">
        <button type="button" class="bw-forecast-ready__cta" id="bwForecastReadyCloseBtn">Start your free trial</button>
      </div>
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
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  wrap.querySelector("#bwForecastReadyCloseBtn")?.addEventListener("click", close);
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
    modal.querySelector("#bwForecastReadyCloseBtn")?.focus?.();
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
  if (chartStart) chartStart.value = toISODate(new Date());
}

function setDefaultAccountStartDate() {
  if (accountStartingBalanceDate) accountStartingBalanceDate.value = toISODate(new Date());
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
  await loadFamilies();
  if (state.activeFamilyId) {
    await loadCategories();
    await loadAccounts();
    await loadExpectedTransactions();
  }
  await loadMonthAndCalendar();
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
    if (bt.saveBtn) {
      bt.saveBtn.addEventListener("click", () => void saveBalanceThresholds());
    }
    await refreshLowBalanceAlert();
  }
}

main().catch((e) => {
  if (userPill) userPill.textContent = "Not connected";
  const m = e.message || "Failed to load app";
  show(familiesErr, m);
  show(txErr, m);
});

