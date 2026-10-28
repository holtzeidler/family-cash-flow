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

var historyTestPayload = {
  events: [
    {
      id: 3,
      recorded: true,
      action: "skipped",
      actor_kind: "user",
      actor_label: "Zeidler Family",
      subject_type: "expected_occurrence",
      subject_id: 179,
      occurrence_date: "2026-12-15",
      created_at: "2026-10-28T17:46:54",
      changes: [{ field: "cancelled", before: false, after: true }],
    },
    {
      id: 2,
      recorded: true,
      action: "updated",
      actor_kind: "user",
      actor_label: "Zeidler Family",
      subject_type: "expected_series",
      subject_id: 179,
      created_at: "2026-10-28T17:45:45",
      changes: [{ field: "amount", before: "12.00", after: "15.00" }],
    },
    {
      id: 1,
      recorded: true,
      action: "created",
      actor_kind: "user",
      actor_label: "Zeidler Family",
      subject_type: "expected_series",
      subject_id: 179,
      created_at: "2026-10-28T17:45:09",
      changes: [
        { field: "account_id", before: null, after: 1 },
        { field: "account_name", before: null, after: "Zeidler Checking" },
        { field: "start_date", before: null, after: "2026-11-15" },
        { field: "recurrence", before: null, after: "monthly" },
        { field: "description", before: null, after: "Gas" },
        { field: "notes", before: null, after: "History Test" },
        { field: "kind", before: null, after: "expense" },
        { field: "amount", before: null, after: "12.00" },
        { field: "category_id", before: null, after: 15 },
        { field: "category_name", before: null, after: "Gas" },
      ],
    },
  ],
  earlier_edits_note: null,
};

check(
  "summary names the transaction",
  transactionHistorySummaryText({ description: "Gas", amount: "15.00", recurrence: "monthly" }) ===
    "Gas · $15.00 · Every month"
);
check(
  "creation line states the initial amount",
  transactionHistoryDetailLine({ field: "amount", before: null, after: "12.00" }, true) === "Amount: $12.00"
);
check(
  "edit line uses an arrow",
  transactionHistoryDetailLine({ field: "amount", before: "12.00", after: "15.00" }, false) ===
    "Amount: $12.00 → $15.00"
);
check(
  "skip detail is not repeated",
  transactionHistoryDetailLine({ field: "cancelled", before: false, after: true }, false) === ""
);
check(
  "skip title names the date",
  transactionHistoryEventHeading({
    action: "skipped",
    actor_kind: "user",
    subject_type: "expected_occurrence",
    occurrence_date: "2026-12-15",
    recorded: true,
  }) === "Skipped December 15, 2026"
);
check(
  "restore title names the date",
  transactionHistoryEventHeading({
    action: "restored",
    subject_type: "expected_occurrence",
    occurrence_date: "2026-12-15",
    recorded: true,
  }) === "Restored December 15, 2026"
);
check(
  "series update title",
  transactionHistoryEventHeading({ action: "updated", subject_type: "expected_series", recorded: true }) ===
    "Updated recurring transaction"
);
check(
  "unrecorded series still has an honest title",
  transactionHistoryEventHeading({ action: "created", recorded: false, subject_type: "expected_series" }) ===
    "Created recurring transaction"
);
check(
  "automatic skip names the date",
  transactionHistoryEventHeading({
    action: "skipped",
    actor_kind: "system",
    subject_type: "expected_occurrence",
    occurrence_date: "2026-10-10",
    recorded: true,
  }) === "Skipped October 10, 2026 automatically"
);

var panel = transactionHistoryPanelHtml(historyTestPayload, function () {
  return "Oct 28, 2026, 5:46 PM";
});
var skipAt = panel.indexOf("Skipped December 15, 2026");
var updateAt = panel.indexOf("Updated recurring transaction");
var createAt = panel.indexOf("Created recurring transaction");
check("timeline is newest first", skipAt !== -1 && skipAt < updateAt && updateAt < createAt);
check("creation does not say changed from none", panel.indexOf("changed from none") === -1);
check("creation shows the starting amount", panel.indexOf("Amount: $12.00") !== -1);
check("creation keeps the notes", panel.indexOf("Notes: History Test") !== -1);
check("edit uses an arrow", panel.indexOf("Amount: $12.00 → $15.00") !== -1);
check("skip has no repeated bullet", panel.indexOf("was skipped") === -1);
check("account id is not shown", panel.indexOf(">1<") === -1 && panel.indexOf("Account: 1") === -1);
check("account name is shown", panel.indexOf("Account: Zeidler Checking") !== -1);

var duplicated = transactionHistoryPanelHtml(
  {
    events: [historyTestPayload.events[0], historyTestPayload.events[0]],
    occurrence_events: [historyTestPayload.events[0]],
    other_occurrence_events: [historyTestPayload.events[0]],
    series_events: [],
  },
  function () {
    return "";
  }
);
check("duplicate events are shown once", duplicated.split("Skipped December 15, 2026").length === 2);

var linked = transactionHistoryTimelineEvents({
  events: [
    {
      id: 8,
      recorded: true,
      action: "created",
      subject_type: "expected_series",
      subject_id: 200,
      created_at: "2026-03-10T12:00:00",
      changes: [],
    },
    {
      id: 7,
      recorded: true,
      action: "split",
      subject_type: "expected_series",
      subject_id: 179,
      created_at: "2026-03-10T12:00:00",
      changes: [],
    },
    {
      id: 4,
      recorded: true,
      action: "skipped",
      subject_type: "expected_occurrence",
      subject_id: 179,
      occurrence_date: "2026-02-10",
      created_at: "2026-02-01T12:00:00",
      changes: [],
    },
  ],
});
check("linked series keeps both sides and the occurrence", linked.length === 3);
check(
  "linked series stays newest first",
  linked[2].action === "skipped" && linked[0].id === 8
);

var unrecorded = transactionHistoryPanelHtml(
  {
    events: [
      {
        id: null,
        recorded: false,
        action: "created",
        actor_kind: "user",
        actor_label: "Zeidler Family",
        subject_type: "expected_series",
        subject_id: 165,
        created_at: "2026-09-09T14:22:27",
        changes: [],
      },
    ],
    earlier_edits_note: "Changes before history was turned on were not recorded.",
  },
  function () {
    return "Sep 9, 2026, 2:22 PM";
  }
);
check("unrecorded history states that older edits are missing", unrecorded.indexOf("Changes before history was turned on were not recorded.") !== -1);
check("unrecorded history does not invent an amount", unrecorded.indexOf("Amount:") === -1);

var hostile = transactionHistoryEventHtml(
  {
    recorded: true,
    action: "updated",
    actor_kind: "user",
    actor_label: '<img src=x onerror="alert(1)">',
    subject_type: "transaction",
    occurrence_date: "<script>",
    changes: [{ field: "notes", before: "ok", after: '<script>alert(1)</script> & "quoted"' }],
  },
  "Oct 28, 2026, 4:00 PM"
);
check("actor markup is not raw html", hostile.indexOf("<img") === -1);
check("note markup is not raw html", hostile.indexOf("<script>") === -1);
check("note markup is escaped", hostile.indexOf("&lt;script&gt;alert(1)&lt;/script&gt;") !== -1);
check("quotes in notes are escaped", hostile.indexOf("&quot;quoted&quot;") !== -1);
check("ampersand in notes is escaped", hostile.indexOf("&amp;") !== -1);
check("long values use the wrapping detail list", hostile.indexOf("tx-history-details") !== -1);

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
