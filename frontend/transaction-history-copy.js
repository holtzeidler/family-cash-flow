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

function transactionHistoryChangeSentence(change, options) {
  if (change && change.field === "cancelled") {
    var skipped = change.after === true || change.after === "true";
    var wasSkipped = change.before === true || change.before === "true";
    var namedDate = options && options.nameTheDate ? transactionHistoryValueLabel("date", options.occurrenceDate) : "";
    if (namedDate === "none") namedDate = "";
    if (skipped && !wasSkipped) return namedDate ? namedDate + " was skipped" : "This date was skipped";
    if (wasSkipped && !skipped) return namedDate ? namedDate + " was restored" : "This date was restored";
  }
  var label = transactionHistoryFieldLabel(change && change.field);
  if (!label) return "";
  var before = transactionHistoryValueLabel(change.field, change.before);
  var after = transactionHistoryValueLabel(change.field, change.after);
  return label + " changed from " + before + " to " + after;
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

function transactionHistoryEventHeading(event, options) {
  var recorded = !event || event.recorded !== false;
  var action = event && event.action ? String(event.action) : "";
  var system = event && event.actor_kind === "system";
  var occurrence = event && event.subject_type === "expected_occurrence";
  var namedDate = "";
  if (options && options.nameTheDate && occurrence && event.occurrence_date) {
    namedDate = transactionHistoryValueLabel("date", event.occurrence_date);
    if (namedDate === "none") namedDate = "";
  }
  if (!recorded && action === "created") return "Added";
  if (system && action === "skipped") return namedDate ? "Skipped " + namedDate + " automatically" : "Skipped this date automatically";
  if (occurrence && action === "skipped") return namedDate ? "Skipped " + namedDate : "Skipped this date";
  if (occurrence && action === "restored") return namedDate ? "Restored " + namedDate : "Restored this date";
  if (occurrence) return namedDate ? "Changed " + namedDate : "Changed this date";
  var oneTime = event && (event.subject_type === "transaction" || event.scope === "transaction");
  if (oneTime && action === "deleted") return "Deleted";
  if (oneTime && action === "created") return "Added";
  if (oneTime) return "Changed";
  if (action === "created") return "Added";
  if (action === "split") return "Split the series";
  if (action === "ended") return "Ended the series";
  if (action === "deleted") return "Deleted";
  return "Changed the series";
}

function transactionHistoryEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function transactionHistoryEventHtml(event, whenText, options) {
  var heading = transactionHistoryEventHeading(event, options);
  var actor = event && event.actor_kind === "system" ? "Automatic" : (event && event.actor_label) || "Family member";
  var when = whenText || "";
  var summary =
    event && event.recorded === false
      ? "Added " + when + " by " + actor + "."
      : heading + " · " + when + " · " + actor;
  var changes = event && event.recorded === false ? [] : transactionHistoryVisibleChanges(event && event.changes);
  var sentenceOptions =
    options && options.nameTheDate ? { nameTheDate: true, occurrenceDate: event && event.occurrence_date } : null;
  var lines = "";
  for (var i = 0; i < changes.length; i++) {
    var sentence = transactionHistoryChangeSentence(changes[i], sentenceOptions);
    if (sentence) lines += "<li>" + transactionHistoryEscape(sentence) + "</li>";
  }
  return (
    "<article class=\"tx-history-event\"><p>" +
    transactionHistoryEscape(summary) +
    "</p>" +
    (lines ? "<ul>" + lines + "</ul>" : "") +
    "</article>"
  );
}
