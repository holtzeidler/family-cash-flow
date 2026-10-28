/** Plain-language labels for transaction history. No network calls. */

function transactionHistoryRecurrenceLabel(value) {
  var labels = {
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
  var key = String(value || "").toLowerCase();
  if (!key || key === "once") return labels.once;
  return labels[key] || key;
}

function transactionHistoryFieldLabel(field) {
  var labels = {
    amount: "Amount",
    recurrence: "Repeat",
    description: "Description",
    notes: "Notes",
    kind: "Type",
    date: "Date",
    start_date: "Starts",
    end_date: "Ends",
    end_count: "Number of times",
    cancelled: "Skipped",
    moved_to_date: "Moved to",
    account_name: "Account",
    category_name: "Category",
    reimbursable: "Reimbursable",
    variable: "Variable amount",
    day_of_month: "Day of month",
    second_day_of_month: "Second day",
    second_occurrence_month: "Second month",
  };
  return labels[field] || "";
}

function transactionHistoryMoney(value) {
  var amount = Number(value);
  if (!isFinite(amount)) return String(value);
  return "$" + amount.toFixed(2);
}

function transactionHistoryValueLabel(field, value) {
  if (value == null || value === "") return "none";
  if (field === "amount") return transactionHistoryMoney(value);
  if (field === "recurrence") return transactionHistoryRecurrenceLabel(value);
  if (field === "kind") {
    var kind = String(value).toLowerCase();
    if (kind === "income") return "Income";
    if (kind === "expense") return "Expense";
    return String(value);
  }
  if (field === "cancelled" || field === "reimbursable" || field === "variable") {
    return value === true || value === "true" ? "Yes" : "No";
  }
  if (field === "date" || field === "start_date" || field === "end_date" || field === "moved_to_date") {
    var match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return String(value);
    var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    var month = months[Number(match[2]) - 1] || match[2];
    return month + " " + Number(match[3]) + ", " + match[1];
  }
  return String(value);
}

function transactionHistoryDetailOrder(field) {
  var order = [
    "amount",
    "description",
    "category_name",
    "recurrence",
    "start_date",
    "date",
    "end_date",
    "end_count",
    "account_name",
    "kind",
    "notes",
    "moved_to_date",
    "reimbursable",
    "variable",
    "day_of_month",
    "second_day_of_month",
    "second_occurrence_month",
  ];
  var index = order.indexOf(field);
  return index === -1 ? order.length : index;
}

function transactionHistoryDetailLine(change, isCreate) {
  if (!change || change.field === "cancelled") return "";
  var label = transactionHistoryFieldLabel(change.field);
  if (!label) return "";
  var beforeEmpty = change.before == null || change.before === "";
  var afterEmpty = change.after == null || change.after === "";
  if (isCreate) {
    if (afterEmpty || change.after === false || change.after === "false") return "";
    return label + ": " + transactionHistoryValueLabel(change.field, change.after);
  }
  if (beforeEmpty && afterEmpty) return "";
  if (beforeEmpty) return label + ": " + transactionHistoryValueLabel(change.field, change.after);
  if (afterEmpty) {
    return label + ": " + transactionHistoryValueLabel(change.field, change.before) + " → none";
  }
  if (String(change.before) === String(change.after)) return "";
  return (
    label +
    ": " +
    transactionHistoryValueLabel(change.field, change.before) +
    " → " +
    transactionHistoryValueLabel(change.field, change.after)
  );
}

function transactionHistoryVisibleChanges(changes) {
  var list = changes || [];
  var visible = [];
  for (var i = 0; i < list.length; i++) {
    var field = list[i] && list[i].field;
    if (field === "account_id" || field === "category_id") continue;
    if (!transactionHistoryFieldLabel(field)) continue;
    visible.push(list[i]);
  }
  return visible;
}

function transactionHistoryOccurrenceDateText(event) {
  if (!event || !event.occurrence_date) return "";
  var label = transactionHistoryValueLabel("date", event.occurrence_date);
  return label === "none" ? "" : label;
}

function transactionHistoryEventHeading(event) {
  var recorded = !event || event.recorded !== false;
  var action = event && event.action ? String(event.action) : "";
  var system = event && event.actor_kind === "system";
  var occurrence = event && event.subject_type === "expected_occurrence";
  var oneTime = event && (event.subject_type === "transaction" || event.scope === "transaction");
  var namedDate = occurrence ? transactionHistoryOccurrenceDateText(event) : "";
  if (!recorded) return oneTime ? "Created transaction" : "Created recurring transaction";
  if (system && action === "skipped") {
    return namedDate ? "Skipped " + namedDate + " automatically" : "Skipped occurrence automatically";
  }
  if (action === "skipped") return namedDate ? "Skipped " + namedDate : "Skipped occurrence";
  if (action === "restored") return namedDate ? "Restored " + namedDate : "Restored occurrence";
  if (occurrence) return namedDate ? "Updated " + namedDate : "Updated occurrence";
  if (oneTime && action === "deleted") return "Deleted transaction";
  if (oneTime && action === "created") return "Created transaction";
  if (oneTime) return "Updated transaction";
  if (action === "created") return "Created recurring transaction";
  if (action === "split") return "Split the series";
  if (action === "ended") return "Ended the series";
  if (action === "deleted") return "Deleted recurring transaction";
  return "Updated recurring transaction";
}

function transactionHistorySummaryText(info) {
  info = info || {};
  var parts = [];
  var description = String(info.description || "").trim();
  if (description) parts.push(description);
  if (info.amount != null && String(info.amount).trim() !== "" && isFinite(Number(info.amount))) {
    parts.push(transactionHistoryMoney(info.amount));
  }
  var recurrence = String(info.recurrence || "").trim().toLowerCase();
  if (recurrence && recurrence !== "once") parts.push(transactionHistoryRecurrenceLabel(recurrence));
  return parts.join(" · ");
}

function transactionHistoryTimelineEvents(payload) {
  var source = [];
  if (payload && payload.events && payload.events.length) {
    source = payload.events.slice();
  } else if (payload) {
    source = []
      .concat(payload.occurrence_events || [])
      .concat(payload.other_occurrence_events || [])
      .concat(payload.series_events || []);
  }
  var seen = {};
  var unique = [];
  for (var i = 0; i < source.length; i++) {
    var event = source[i];
    if (!event) continue;
    var key = [
      event.id == null ? "" : event.id,
      event.subject_type || "",
      event.subject_id == null ? "" : event.subject_id,
      event.occurrence_date || "",
      event.action || "",
      event.recorded === false ? "0" : "1",
    ].join("|");
    if (seen[key]) continue;
    seen[key] = true;
    unique.push(event);
  }
  unique.sort(function (a, b) {
    var as = String((a && a.created_at) || "");
    var bs = String((b && b.created_at) || "");
    if (as !== bs) return as < bs ? 1 : -1;
    return (Number(b && b.id) || 0) - (Number(a && a.id) || 0);
  });
  return unique;
}

function transactionHistoryEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function transactionHistoryEventHtml(event, whenText) {
  var heading = transactionHistoryEventHeading(event);
  var actor = event && event.actor_kind === "system" ? "Automatic" : (event && event.actor_label) || "Family member";
  var when = whenText || "";
  var meta = when && actor ? when + " · " + actor : when || actor;
  var isCreate = !event || event.recorded === false || event.action === "created";
  var changes = event && event.recorded === false ? [] : transactionHistoryVisibleChanges(event && event.changes);
  changes = changes.slice().sort(function (a, b) {
    return transactionHistoryDetailOrder(a && a.field) - transactionHistoryDetailOrder(b && b.field);
  });
  var lines = "";
  for (var i = 0; i < changes.length; i++) {
    var sentence = transactionHistoryDetailLine(changes[i], isCreate);
    if (sentence) lines += "<li>" + transactionHistoryEscape(sentence) + "</li>";
  }
  return (
    "<article class=\"tx-history-event\">" +
    "<h3 class=\"tx-history-title\">" +
    transactionHistoryEscape(heading) +
    "</h3>" +
    (meta ? "<p class=\"tx-history-meta\">" + transactionHistoryEscape(meta) + "</p>" : "") +
    (lines ? "<ul class=\"tx-history-details\">" + lines + "</ul>" : "") +
    "</article>"
  );
}

function transactionHistoryPanelHtml(payload, formatStamp) {
  if (!payload) return "<p class=\"tx-history-empty\">History could not be loaded.</p>";
  var events = transactionHistoryTimelineEvents(payload);
  var note = payload.earlier_edits_note
    ? "<p class=\"tx-history-note\">" + transactionHistoryEscape(payload.earlier_edits_note) + "</p>"
    : "";
  if (!events.length) {
    return "<p class=\"tx-history-empty\">Changes from now on will appear here.</p>" + note;
  }
  var items = "";
  for (var i = 0; i < events.length; i++) {
    var when = formatStamp ? formatStamp(events[i].created_at) : "";
    items += transactionHistoryEventHtml(events[i], when);
  }
  return "<div class=\"tx-history-timeline\">" + items + "</div>" + note;
}
