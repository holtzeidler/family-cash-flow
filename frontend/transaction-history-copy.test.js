if (typeof load === "function") {
  load("frontend/transaction-history-copy.js");
} else {
  var fs = require("fs");
  var path = require("path");
  eval(fs.readFileSync(path.join(__dirname, "transaction-history-copy.js"), "utf8"));
}

var failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
}

check(
  "repeat sentence",
  transactionHistoryChangeSentence({ field: "recurrence", before: "monthly", after: "weekly" }) ===
    "Repeat changed from Every month to Every week"
);
check(
  "amount sentence",
  transactionHistoryChangeSentence({ field: "amount", before: "200.00", after: "50.00" }) ===
    "Amount changed from $200.00 to $50.00"
);
check(
  "system heading",
  transactionHistoryEventHeading({
    action: "skipped",
    actor_kind: "system",
    subject_type: "expected_occurrence",
    recorded: true,
  }) === "Skipped this date automatically"
);
check(
  "unrecorded heading",
  transactionHistoryEventHeading({ action: "created", recorded: false, subject_type: "expected_series" }) === "Added"
);
check(
  "this date heading",
  transactionHistoryEventHeading({ action: "updated", subject_type: "expected_occurrence", recorded: true }) ===
    "Changed this date"
);
check(
  "series heading",
  transactionHistoryEventHeading({ action: "updated", subject_type: "expected_series", recorded: true }) ===
    "Changed the series"
);
check(
  "one-time heading",
  transactionHistoryEventHeading({ action: "updated", subject_type: "transaction", recorded: true }) === "Changed"
);
check(
  "skip sentence",
  transactionHistoryChangeSentence({ field: "cancelled", before: false, after: true }) === "This date was skipped"
);
check(
  "other date heading names the occurrence",
  transactionHistoryEventHeading(
    {
      action: "skipped",
      actor_kind: "user",
      subject_type: "expected_occurrence",
      occurrence_date: "2026-12-15",
      recorded: true,
    },
    { nameTheDate: true }
  ) === "Skipped December 15, 2026"
);
check(
  "other date sentence names the occurrence",
  transactionHistoryChangeSentence(
    { field: "cancelled", before: false, after: true },
    { nameTheDate: true, occurrenceDate: "2026-12-15" }
  ) === "December 15, 2026 was skipped"
);
var namedSkip = transactionHistoryEventHtml(
  {
    recorded: true,
    action: "skipped",
    actor_kind: "user",
    actor_label: "Smoke History",
    subject_type: "expected_occurrence",
    occurrence_date: "<script>",
    changes: [{ field: "cancelled", before: false, after: true }],
  },
  "Oct 28, 2026, 4:00 PM",
  { nameTheDate: true }
);
check("named occurrence date is escaped", namedSkip.indexOf("<script>") === -1);
check("named occurrence date is escaped as text", namedSkip.indexOf("&lt;script&gt;") !== -1);

var hostile = transactionHistoryEventHtml(
  {
    recorded: true,
    action: "updated",
    actor_kind: "user",
    actor_label: '<img src=x onerror="alert(1)">',
    subject_type: "transaction",
    changes: [{ field: "notes", before: "ok", after: '<script>alert(1)</script> & "quoted"' }],
  },
  "Oct 28, 2026, 4:00 PM"
);
check("actor markup is not raw html", hostile.indexOf("<img") === -1);
check("note markup is not raw html", hostile.indexOf("<script>") === -1);
check("note markup is escaped", hostile.indexOf("&lt;script&gt;alert(1)&lt;/script&gt;") !== -1);
check("quotes in notes are escaped", hostile.indexOf("&quot;quoted&quot;") !== -1);
check("ampersand in notes is escaped", hostile.indexOf("&amp;") !== -1);

var visible = transactionHistoryVisibleChanges([
  { field: "account_id", before: 1, after: 2 },
  { field: "account_name", before: "Checking", after: "Savings" },
  { field: "category_id", before: 9, after: 4 },
  { field: "amount", before: "200.00", after: "50.00" },
]);
check("hides account and category ids", visible.length === 2);
check(
  "keeps the account name",
  visible.some(function (change) {
    return change.field === "account_name";
  })
);

if (failures.length) {
  throw new Error(failures.join("; "));
}
