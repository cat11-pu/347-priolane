// prio.js：入队排序与取队首。队列按出队顺序排列：先比优先级（小者先），
// 同优先级再比投递序（先来先走）。
export function sendOf(queue, row) {
  const next = queue.slice();
  let index = next.length;
  for (let i = 0; i < next.length; i += 1) {
    const current = next[i];
    if (current[1] > row[1] || (current[1] === row[1] && current[2] > row[2])) {
      index = i;
      break;
    }
  }
  next.splice(index, 0, row);
  return next;
}

export function headOf(queue) {
  return queue.length > 0 ? queue[0] : null;
}
