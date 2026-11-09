/**
 * Recurring edit copy: identify the occurrence, and describe apply-scope
 * without implying a series change unless the user chooses one.
 */

const TX_EDIT_SCOPE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function txEditScopeNormalizeIso(raw) {
  if (raw == null || raw === "") return "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(raw));
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function formatTxEditMonthDay(raw) {
  const iso = txEditScopeNormalizeIso(raw);
  if (!iso) return "";
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (!Number.isFinite(month) || month < 1 || month > 12 || !Number.isFinite(day)) return iso;
  return `${TX_EDIT_SCOPE_MONTHS[month - 1]} ${day}`;
}

function formatTxEditOccurrenceBanner(iso, { fromUpcoming = false, confirmOccurrence = false } = {}) {
  const label = formatTxEditMonthDay(iso);
  if (confirmOccurrence) {
    return {
      title: label ? `Confirm ${label}` : "Confirm this amount",
      hint: "",
    };
  }
  if (!label) {
    return {
      title: "Recurring transaction",
      hint: fromUpcoming ? "Starts on the next upcoming occurrence." : "",
    };
  }
  return {
    title: `Editing ${label}`,
    hint: fromUpcoming ? "Starts on the next upcoming occurrence." : "",
  };
}

function detectTxEditSeriesOnlyChanges(baseline, current) {
  if (!baseline || !current) return [];
  const names = [];
  if (String(baseline.notes || "") !== String(current.notes || "")) names.push("Notes");
  const repeatChanged =
    String(baseline.recurrence || "") !== String(current.recurrence || "") ||
    String(baseline.secondDay || "") !== String(current.secondDay || "");
  if (repeatChanged) names.push("Repeat");
  const baselineEnds =
    String(baseline.endsMode || "never") === "after_count"
      ? `after:${baseline.endCount || ""}`
      : "never";
  const currentEnds =
    String(current.endsMode || "never") === "after_count"
      ? `after:${current.endCount || ""}`
      : "never";
  if (baselineEnds !== currentEnds) names.push("Ends");
  return names;
}

function formatTxEditSeriesOnlyError(fieldNames) {
  const names = Array.isArray(fieldNames) ? fieldNames.filter(Boolean) : [];
  if (!names.length) return "";
  const list =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  const verb = names.length === 1 ? "applies" : "apply";
  return `${list} ${verb} to the series. Choose This and future occurrences, or undo those series changes to save only this date.`;
}

function formatTxEditApplyScopeCopy({
  openedIso,
  editedIso,
  seriesFieldNames = [],
} = {}) {
  const opened = txEditScopeNormalizeIso(openedIso);
  const edited = txEditScopeNormalizeIso(editedIso);
  const openedLabel = formatTxEditMonthDay(opened);
  const editedLabel = formatTxEditMonthDay(edited);
  const dateMoved = !!(opened && edited && opened !== edited);
  const seriesNames = Array.isArray(seriesFieldNames) ? seriesFieldNames.filter(Boolean) : [];
  const seriesDirty = seriesNames.length > 0;

  const instanceTitle = dateMoved && openedLabel && editedLabel
    ? `Move only ${openedLabel} to ${editedLabel}`
    : "Only this occurrence";
  const instanceHint = dateMoved && openedLabel
    ? `Moves ${openedLabel} only. Later dates stay on the original schedule.`
    : openedLabel
      ? `Updates ${openedLabel} only. Later dates stay as they are.`
      : "Only this date changes. Later dates stay as they are.";

  const seriesTitle = dateMoved
    ? "Change this and future scheduled dates"
    : "This and future occurrences";
  const seriesHint = dateMoved && openedLabel
    ? `Reschedules ${openedLabel} and later dates. Earlier dates stay.`
    : "Updates this date and every later occurrence in the series.";

  let helper = "Choose whether to update just this occurrence or future ones too.";
  if (dateMoved && openedLabel && editedLabel) {
    helper = `You're moving ${openedLabel}. This does not have to change the rest of the series.`;
  } else if (openedLabel) {
    helper = `${openedLabel} is one date in a recurring series.`;
  }

  return {
    instanceTitle,
    instanceHint,
    seriesTitle,
    seriesHint,
    helper,
    seriesNotice: seriesDirty ? formatTxEditSeriesOnlyError(seriesNames) : "",
    seriesDirty,
    recommended: seriesDirty ? "series" : "instance",
    defaultChoice: seriesDirty ? "series" : "instance",
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    formatTxEditMonthDay,
    formatTxEditOccurrenceBanner,
    detectTxEditSeriesOnlyChanges,
    formatTxEditSeriesOnlyError,
    formatTxEditApplyScopeCopy,
  };
}
