// prio.js：入队排序与取队首（按出队顺序：先比优先级、再比投递序）
function compare(a, b) {
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

export function sendOf(queue, row) {
  const next = (Array.isArray(queue) ? queue : []).slice();
  next.push(row);
  next.sort(compare);
  return next;
}

export function headOf(queue) {
  if (!Array.isArray(queue) || queue.length === 0) return null;
  let best = queue[0];
  for (const row of queue) {
    if (compare(row, best) < 0) best = row;
  }
  return best;
}
