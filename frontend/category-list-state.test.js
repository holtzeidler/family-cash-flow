const fs = require("fs");
const path = require("path");
const { categoryListView } = require("./category-list-state.js");

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

const loading = categoryListView("loading", 0);
assert(loading.showLoading && !loading.showEmpty && !loading.showTree && !loading.allowAdd, "loading hides the list and add actions");

const failed = categoryListView("error", 4);
assert(failed.showError && !failed.showEmpty && !failed.showTree && !failed.allowAdd, "error offers retry instead of an empty list");

const empty = categoryListView("ready", 0);
assert(empty.showEmpty && !empty.showLoading && !empty.showTree && empty.allowAdd, "empty appears only after a successful load");

const ready = categoryListView("ready", 3);
assert(ready.showTree && ready.allowAdd && !ready.showLoading && !ready.showEmpty, "a loaded list stays visible");

const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const mainStart = app.indexOf("async function main()");
const early = app.indexOf("categoriesBootstrap = loadCategories()", mainStart);
const forecast = app.indexOf("await loadMonthAndCalendar()", mainStart);
assert(early !== -1 && forecast !== -1 && early < forecast, "categories start before the forecast month request");
assert(app.includes("Loading your categories…"), "loading copy");
assert(app.includes("We couldn't load your categories. Please try again."), "error copy");
assert(app.includes('retry.textContent = "Retry"'), "retry button");
assert(!app.includes('row.classList.add("is-unused")'), "unused categories are not faded");

const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
assert(!css.includes(".cats-cat.is-unused"), "unused category fade is removed");

console.log("category list state checks ok");
