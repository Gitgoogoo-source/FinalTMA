const NEIGHBORS = Object.freeze([
  Object.freeze({ x: -1, y: 0 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 0, y: 1 }),
]);

export function findGridPath(start, goal, walkableKeys, blockedKeys) {
  const startKey = cellKey(start);
  const goalKey = cellKey(goal);
  if (
    startKey === goalKey ||
    !walkableKeys.has(goalKey) ||
    blockedKeys.has(goalKey)
  )
    return [];

  const open = [{ cell: start, score: manhattan(start, goal) }];
  const openKeys = new Set([startKey]);
  const cameFrom = new Map();
  const distance = new Map([[startKey, 0]]);

  while (open.length > 0) {
    open.sort((left, right) => left.score - right.score);
    const current = open.shift().cell;
    const currentKey = cellKey(current);
    openKeys.delete(currentKey);
    if (currentKey === goalKey)
      return reconstructPath(cameFrom, current, startKey);

    for (const offset of NEIGHBORS) {
      const next = { x: current.x + offset.x, y: current.y + offset.y };
      const nextKey = cellKey(next);
      if (!walkableKeys.has(nextKey) || blockedKeys.has(nextKey)) continue;
      const nextDistance = (distance.get(currentKey) ?? 0) + 1;
      if (nextDistance >= (distance.get(nextKey) ?? Number.POSITIVE_INFINITY))
        continue;
      cameFrom.set(nextKey, current);
      distance.set(nextKey, nextDistance);
      if (openKeys.has(nextKey)) {
        const queued = open.find((entry) => cellKey(entry.cell) === nextKey);
        if (queued) queued.score = nextDistance + manhattan(next, goal);
        continue;
      }
      open.push({ cell: next, score: nextDistance + manhattan(next, goal) });
      openKeys.add(nextKey);
    }
  }

  return [];
}

function reconstructPath(cameFrom, goal, startKey) {
  const path = [goal];
  let current = goal;
  while (cameFrom.has(cellKey(current))) {
    current = cameFrom.get(cellKey(current));
    if (cellKey(current) !== startKey) path.push(current);
  }
  path.reverse();
  return path;
}

function manhattan(left, right) {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}
