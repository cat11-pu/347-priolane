// priolane.js：按处理预算处理事件，用尽的连着载压账；收尾不限预算清账
import { sendOf, headOf } from "./prio.js";

function codeOf(spec, key, fallback) {
  const value = spec && spec[key];
  return typeof value === "string" && value ? value : fallback;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function normalizeState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  return {
    queue: Array.isArray(state.queue) ? state.queue.slice() : [],
    popped: Array.isArray(state.popped) ? state.popped.slice() : [],
    ledger: Array.isArray(state.ledger) ? state.ledger.slice() : [],
    applied: Array.isArray(state.applied) ? state.applied.slice() : [],
    seq: Number.isInteger(state.seq) ? state.seq : null
  };
}

function ensureSeq(state) {
  if (state.seq === null) {
    state.seq = state.queue.reduce(function (top, row) {
      return Math.max(top, Number.isInteger(row && row[2]) ? row[2] : 0);
    }, 0);
  }
}

// 结构、任务号、优先级先校验，与预算无关
function validateEvent(spec, event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    fail(codeOf(spec, "event_error_code", "E_BAD_EVENT"));
  }
  if (event.kind !== "push" && event.kind !== "pop") {
    fail(codeOf(spec, "event_error_code", "E_BAD_EVENT"));
  }
  if (event.kind === "push") {
    if (!Number.isInteger(event.task) || event.task <= 0) {
      fail(codeOf(spec, "bad_task_code", "E_BAD_TASK"));
    }
    if (!Number.isInteger(event.priority)) {
      fail(codeOf(spec, "bad_prio_code", "E_BAD_PRIORITY"));
    }
  }
}

// 账上一条事件的内部形态：[kind, task, priority, id]
function toItem(event) {
  if (event.kind === "push") return ["push", event.task, event.priority, event.id];
  return ["pop", null, null, event.id];
}

function applyItem(spec, state, item) {
  if (item[0] === "push") {
    for (const row of state.queue) {
      if (row[0] === item[1]) fail(codeOf(spec, "dup_code", "E_DUP_TASK"));
    }
    state.seq += 1;
    state.queue = sendOf(state.queue, [item[1], item[2], state.seq]);
  } else {
    const head = headOf(state.queue);
    if (!head) fail(codeOf(spec, "empty_code", "E_EMPTY"));
    state.queue = state.queue.filter(function (row) { return row !== head; });
    state.popped.push(head[0]);
  }
  if (item[3] !== undefined && state.applied.indexOf(item[3]) === -1) {
    state.applied.push(item[3]);
  }
}

export function step(spec) {
  const src = spec && typeof spec === "object" ? spec : {};
  const state = normalizeState(src.state);
  ensureSeq(state);
  const events = Array.isArray(src.events) ? src.events : [];
  const backlog = state.ledger;
  state.ledger = [];

  const fresh = [];
  let judged = backlog.length;
  for (const event of events) {
    if (event && typeof event === "object" && event.id !== undefined
        && state.applied.indexOf(event.id) !== -1) {
      continue; // 重放已处理过的事件，不新增工作
    }
    validateEvent(src, event);
    judged += 1;
    fresh.push(toItem(event));
  }

  const work = backlog.concat(fresh);
  let budget = Number.isFinite(src.budget) ? Math.max(0, Math.floor(src.budget)) : work.length;
  let served = 0;
  const rest = [];
  for (const item of work) {
    if (budget > 0) {
      budget -= 1;
      served += 1;
      applyItem(src, state, item);
    } else {
      rest.push(item);
    }
  }
  state.ledger = rest;

  return {
    state: state,
    served: served,
    ledger_before: rest.length,
    ledger: rest.map(function (item) { return [item[0], item[1], item[2]]; }),
    judged: judged,
    judged_bound: backlog.length + events.length
  };
}

export function close(spec) {
  const src = spec && typeof spec === "object" ? spec : {};
  const state = normalizeState(src.state);
  ensureSeq(state);
  const pending = state.ledger;
  state.ledger = [];
  let catchup = 0;
  for (const item of pending) {
    applyItem(src, state, item);
    catchup += 1;
  }
  return { state: state, catchup: catchup };
}
