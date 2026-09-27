// priolane.js：按共用处理预算消化事件，用尽后未处理事件压账，跨轮携带；
// 收尾时不限预算把账清完。事件结构：{ id, kind:"push", task, priority } 或 { id, kind:"pop" }。
import { sendOf, headOf } from "./prio.js";

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function codeOf(spec, key, fallback) {
  return (spec && spec[key]) || fallback;
}

// 账上每条压成 [kind, task, priority]（pop 用 null 占位）；id 与投递序挂在
// 不可枚举属性上随内存态带走，JSON 序列化不可见，不影响账的对外形状。
function makeEntry(kind, task, priority, id, order) {
  const entry = [kind, task === undefined || task === null ? null : task,
    priority === undefined || priority === null ? null : priority];
  if (id !== undefined && id !== null) {
    Object.defineProperty(entry, "id", { value: id, enumerable: false, configurable: true, writable: true });
  }
  if (order !== undefined && order !== null) {
    Object.defineProperty(entry, "order", { value: order, enumerable: false, configurable: true, writable: true });
  }
  return entry;
}

function entryFromEvent(event, order) {
  if (event.kind === "push") {
    return makeEntry("push", event.task, event.priority, event.id, order);
  }
  return makeEntry("pop", null, null, event.id, null);
}

// 静态校验：结构、任务号、优先级，与预算无关，先于处理全部跑完。
function validate(event, spec) {
  const badEvent = codeOf(spec, "event_error_code", "E_BAD_EVENT");
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw failure(badEvent, "事件必须是对象");
  }
  if (event.kind !== "push" && event.kind !== "pop") {
    throw failure(badEvent, "不支持的事件类型");
  }
  if (event.kind === "push") {
    if (!Object.prototype.hasOwnProperty.call(event, "task")
        || !Object.prototype.hasOwnProperty.call(event, "priority")) {
      throw failure(badEvent, "push 事件必须带 task 与 priority");
    }
    if (!Number.isInteger(event.task) || event.task <= 0) {
      throw failure(codeOf(spec, "bad_task_code", "E_BAD_TASK"), "任务号必须是正整数");
    }
    if (!Number.isInteger(event.priority)) {
      throw failure(codeOf(spec, "bad_prio_code", "E_BAD_PRIORITY"), "优先级必须是整数");
    }
  } else if (Object.prototype.hasOwnProperty.call(event, "task")
             || Object.prototype.hasOwnProperty.call(event, "priority")) {
    throw failure(badEvent, "pop 事件不带参数");
  }
}

function cloneState(state) {
  const source = state || {};
  return {
    queue: (source.queue || []).map(function (row) { return row.slice(); }),
    popped: (source.popped || []).slice(),
    ledger: (source.ledger || []).slice(),
    applied: (source.applied || []).slice(),
    seq: Number.isInteger(source.seq) ? source.seq : 0
  };
}

// 运行时消化一条：重复投递 / 空队出队按当前队列判，不合法即抛错。
function applyEntry(st, entry, spec) {
  if (entry[0] === "push") {
    const duplicated = st.queue.some(function (row) { return row[0] === entry[1]; });
    if (duplicated) {
      throw failure(codeOf(spec, "dup_code", "E_DUP_TASK"), "任务已在队中");
    }
    let order = entry.order;
    if (!Number.isInteger(order)) {
      st.seq += 1;
      order = st.seq;
    }
    st.queue = sendOf(st.queue, [entry[1], entry[2], order]);
  } else {
    const head = headOf(st.queue);
    if (head === null) {
      throw failure(codeOf(spec, "empty_code", "E_EMPTY"), "队列为空，不能出队");
    }
    st.queue = st.queue.slice(1);
    st.popped.push(head[0]);
  }
}

function markApplied(st, appliedSet, entry) {
  const id = entry.id;
  if (id !== undefined && id !== null && !appliedSet.has(id)) {
    appliedSet.add(id);
    st.applied.push(id);
  }
}

function budgetOf(spec) {
  return Number.isInteger(spec.budget) && spec.budget > 0 ? spec.budget : 0;
}

export function step(spec) {
  const source = spec || {};
  const st = cloneState(source.state);
  const appliedSet = new Set(st.applied);
  const events = Array.isArray(source.events) ? source.events : [];

  // 重放不新增：已处理过或已压在账上的事件整批跳过，
  // 不校验、不占预算、不再压账。
  const parkedIds = new Set(st.ledger.map(function (entry) { return entry.id; })
    .filter(function (id) { return id !== undefined && id !== null; }));
  const fresh = [];
  for (const event of events) {
    const already = event !== null && typeof event === "object"
      && event.id !== undefined && event.id !== null
      && (appliedSet.has(event.id) || parkedIds.has(event.id));
    if (!already) fresh.push(event);
  }

  for (const event of fresh) validate(event, source);

  // 投递序在投递时刻确定（即使事件马上压账也先占序），保证拆轮与全量同序。
  let seq = st.seq;
  const incoming = fresh.map(function (event) {
    let order = null;
    if (event.kind === "push") {
      seq += 1;
      order = seq;
    }
    return entryFromEvent(event, order);
  });

  // 先清旧账，再消化本批；预算用尽后剩余（旧账尾数连新事件）原样压账。
  const work = st.ledger.concat(incoming);
  const budget = budgetOf(source);
  let served = 0;
  for (let i = 0; i < work.length; i += 1) {
    if (served >= budget) {
      st.ledger = work.slice(i);
      st.seq = seq;
      return {
        state: st,
        served: served,
        ledger_before: st.ledger.length,
        ledger: st.ledger,
        judged: events.length,
        judged_bound: events.length
      };
    }
    applyEntry(st, work[i], source);
    markApplied(st, appliedSet, work[i]);
    served += 1;
  }

  st.ledger = [];
  st.seq = seq;
  return {
    state: st,
    served: served,
    ledger_before: 0,
    ledger: st.ledger,
    judged: events.length,
    judged_bound: events.length
  };
}

export function close(spec) {
  const source = spec || {};
  const st = cloneState(source.state);
  const appliedSet = new Set(st.applied);
  const backlog = st.ledger;
  let catchup = 0;
  for (const entry of backlog) {
    applyEntry(st, entry, source);
    markApplied(st, appliedSet, entry);
    catchup += 1;
  }
  st.ledger = [];
  return { state: st, catchup: catchup };
}
