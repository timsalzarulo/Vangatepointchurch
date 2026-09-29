'use strict';

// "North Campus › Kids › Check-in" for every area (the church root is omitted).
function areaPaths(areas) {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const cache = new Map();
  const pathOf = (id, seen = new Set()) => {
    if (cache.has(id)) return cache.get(id);
    const a = byId.get(id);
    if (!a || seen.has(id)) return [];
    seen.add(id);
    const parts = a.kind === 'church' ? [] : [...pathOf(a.parent_id, seen), a.name];
    cache.set(id, parts);
    return parts;
  };
  const out = new Map();
  for (const a of areas) out.set(a.id, pathOf(a.id).join(' › ') || a.name);
  return out;
}

const CHILD_KIND = { church: 'campus', campus: 'department', department: 'team', team: 'group', group: 'group' };

module.exports = { areaPaths, CHILD_KIND };
