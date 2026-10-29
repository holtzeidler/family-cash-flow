const fs = require("fs");
const path = require("path");
const {
  categoryCreateResolution,
  beginCategoryCreate,
  finishCategoryCreate,
  categoryNoteAfterTyping,
  manageCategoriesAction,
} = require("./category-create-state");

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

const categories = [
  { id: 4, name: "Allowance", group_id: 9, group_name: "Other" },
  { id: 5, name: "Paycheck", group_id: 2, group_name: "Income" },
];

const duplicate = categoryCreateResolution(" allowance ", categories, 9);
assert(duplicate.action === "reuse" && duplicate.category.id === 4, "an existing name in the same group is reused");

const otherGroup = categoryCreateResolution("Paycheck", categories, 9);
assert(otherGroup.action === "reuse" && otherGroup.category.id === 5, "an existing matching name is reused");

const fresh = categoryCreateResolution("Dog walking", categories, 9);
assert(fresh.action === "create", "a new name can be created");

const blocked = beginCategoryCreate(true, "Allowance");
assert(blocked.started === false && blocked.saveEnabled === false, "a second create does not start while one is pending");

const pending = beginCategoryCreate(false, "Allowance");
assert(pending.started === true, "the first create starts");
assert(pending.pending === true, "creation stays pending until it finishes");
assert(pending.note === "Creating category…", "pending creation tells the customer to wait");
assert(pending.saveEnabled === false, "save stays off while creation is pending");

const saved = finishCategoryCreate(pending, {
  ok: true,
  category: { id: 8, name: "Allowance" },
  groupLabel: "Other",
});
assert(saved.selectedId === 8, "success selects the new category");
assert(saved.note === "Added Allowance to Other.", "success names the category and its group");
assert(saved.saveEnabled === true && saved.retry === false, "save returns after a successful create");

const failed = finishCategoryCreate(pending, { ok: false, error: "The server could not add that category." });
assert(failed.name === "Allowance", "a failure keeps the typed name");
assert(failed.retry === true, "a failure can be retried");
assert(failed.saveEnabled === true, "save returns after a failed create so the transaction is not submitted by the create");
assert(failed.selectedId == null, "a failure does not select a category");
assert(failed.note.includes("could not add"), "a failure shows the error");

assert(categoryNoteAfterTyping("Allowance", "All") === "", "typing a different name clears the earlier confirmation");
assert(categoryNoteAfterTyping("Allowance", "Allowance") === null, "the confirmation can remain while that name is still shown");

const stay = manageCategoriesAction(true);
assert(stay.navigate === false && stay.message, "a draft transaction is not left behind");
const go = manageCategoriesAction(false);
assert(go.navigate === true, "an empty transaction can open category management");

const appSrc = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
assert(appSrc.includes('note: "Creating category…"') || appSrc.includes("Creating category…"), "the editor shows the pending message");
assert(appSrc.includes("Manage categories…"), "the picker offers category management");
assert(appSrc.includes("setCategoryCreateSaveLock(true)"), "save is disabled while a category is being created");
assert(appSrc.includes("retryName: name"), "a failed create can be retried");
assert(!appSrc.includes("window.alert(err.message || \"Failed to add category\")"), "category creation does not use a blocking alert");

const createStart = appSrc.indexOf("async function createCategoryFromCombobox");
const createEnd = appSrc.indexOf("function onCategoryComboboxKeydown", createStart);
const createBody = appSrc.slice(createStart, createEnd);
assert(!createBody.includes("/transactions"), "creating a category does not create a transaction");
assert(!/recurrence/i.test(createBody), "creating a category does not change Repeat");

console.log("category create checks ok");
