import assert from "node:assert";
import { sendOf, headOf } from "../prio.js";
import { step, close } from "../priolane.js";
import { render } from "../app.js";

const base = {
  budget: 1,
  state: { queue: [], popped: [], ledger: [], applied: [] },
  events: [{ id: 1, kind: "push", task: 1, priority: 2 }],
  bad_task_code: "E_BAD_TASK", bad_prio_code: "E_BAD_PRIORITY",
  dup_code: "E_DUP_TASK", empty_code: "E_EMPTY",
  event_error_code: "E_BAD_EVENT"
};

let failed = 0;
function check(name, fn) {
  try { fn(); console.log("ok " + name); } catch (e) { failed += 1; console.log("FAIL " + name + " :: " + e.message); }
}

check("sendOf returns a list", () => {
  assert.ok(Array.isArray(sendOf([], [1, 2, 1])));
});

check("headOf returns a row or nothing", () => {
  const got = headOf([[1, 2, 1]]);
  assert.ok(got === null || Array.isArray(got));
});

check("step returns a state", () => {
  assert.strictEqual(typeof step(base).state, "object");
});

check("close returns a state", () => {
  assert.strictEqual(typeof close(base).state, "object");
});

check("render counts events", () => {
  assert.strictEqual(typeof render(base).count_events, "number");
});

console.log("5 cases, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
