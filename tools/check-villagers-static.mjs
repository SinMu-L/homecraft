// Offline geometry check for villagers.
// Verifies each villager's (x, z) is not inside any forbidden static region
// declared in docs/villager.md §3. Pure Node, no browser, no Three.js.
//
// It does NOT check nav.canStand (that needs the runtime nav grid) — run
// tools/check-villagers.mjs against a live server for that. This catches the
// hard errors: a villager spawned in the pool, the court, a doorway, etc.
//
// Region constants are copied from world/layout.js. If layout.js changes them,
// update ZONES below to match. Usage: node tools/check-villagers-static.mjs
import { readFileSync } from 'node:fs';

// --- Zones (copied from world/layout.js) -----------------------------------
// Each zone is {x0,x1,z0,z1}. A point (x,z) is inside if x0 <= x < x1 && z0 <= z < z1
// (half-open, matching grid.fill in AGENTS.md).
const ZONES = {
  POOL:      { x0: -13, x1: 3,   z0: 24,   z1: 30  },
  COURT:     { x0: -19, x1: -7,  z0: -2.5, z1: 10.5 },
  LOFT:      { x0: -20, x1: -3,  z0: -12,  z1: -4  },  // second floor; ground-floor villager must not be "under" it implicitly
  STAIRS:    { x0: -6.8, x1: -3, z0: -4,   z1: 4   },
  GARAGE:    { x0: 11,  x1: 20,  z0: -12,  z1: 3   },
  DRIVEWAY:  { x0: 25,  x1: 38,  z0: -10,  z1: -3  },
  SECRET:    { x0: -20, x1: -17, z0: -12,  z1: -9  },
};

// DOORWAY and EXIT are the front-door fly-out / walk-out points (layout.js lines 144-145).
// A villager standing exactly on these blocks the house exit.
const DOORWAY = [{ x: 0.5, z: 15 }, { x: 0.5, z: 18 }];
const EXIT    = { x: 0.5, z: 18.6 };

// The portal pad: visitors step out here; a villager on it blocks arrivals.
const PORTAL = { x: 8.5, z: 25.5, r: 1.7 };  // ~1.7 m wide per AGENTS.md

// TERRACE is the walkway along the south facade — villagers patrol 3.4 m, so
// spawning on the terrace is allowed but flagged as "patrol may reach walkway".
const TERRACE = { x0: -21, x1: 25, z0: 17, z1: 21 };

// ISLAND bounds: a villager off the island is a hard error.
const ISLAND = { x0: -36, x1: 38, z0: -26, z1: 31 };

// --- Read villagers from world/layout.js -----------------------------------
const layout = readFileSync(new URL('../world/layout.js', import.meta.url), 'utf8');
const m = layout.match(/villagers:\s*\[([\s\S]*?)\]/);
if (!m) { console.log('Could not find MOBS.villagers in world/layout.js'); process.exit(1); }
const entries = [...m[1].matchAll(/\{([^{}]*)\}/g)].map(x => x[1].trim());
if (!entries.length) { console.log('No villager entries found.'); process.exit(1); }

const villagers = entries.map(s => Object.fromEntries(s.split(',').map(p => {
  const [k, ...v] = p.trim().split(/[:\s]+/);
  const val = v.join(' ').trim();
  const n = Number(val);
  return [k, isNaN(n) ? val.replace(/['"]/g, '') : n];
})));

// --- Checks ----------------------------------------------------------------
const inside = (z, x, zz) => x >= z.x0 && x < z.x1 && zz >= z.z0 && zz < z.z1;
const near = (p, x, zz, r) => Math.hypot(x - p.x, zz - p.z) < r;

let problems = 0;
console.log('Villager static geometry check:\n');
for (const v of villagers) {
  const hits = [];

  // Hard errors: villager is inside a forbidden region.
  if (inside(ZONES.POOL, v.x, v.z))     hits.push('inside POOL');
  if (inside(ZONES.COURT, v.x, v.z))    hits.push('inside COURT');
  if (inside(ZONES.STAIRS, v.x, v.z))   hits.push('on STAIRS');
  if (inside(ZONES.SECRET, v.x, v.z))   hits.push('inside SECRET room');
  if (inside(ZONES.DRIVEWAY, v.x, v.z)) hits.push('on DRIVEWAY');
  if (DOORWAY.some(d => Math.hypot(v.x - d.x, v.z - d.z) < 1)) hits.push('on DOORWAY');
  if (Math.hypot(v.x - EXIT.x, v.z - EXIT.z) < 1)              hits.push('on EXIT');
  if (near(PORTAL, v.x, v.z, PORTAL.r)) hits.push('on PORTAL pad');

  // Off-island: villager坐标 outside ISLAND bounds.
  if (!inside(ISLAND, v.x, v.z)) hits.push('OFF ISLAND');

  // Warnings: not forbidden, but the 3.4 m patrol radius may reach a walkway.
  const onTerrace = inside(TERRACE, v.x, v.z);
  const patrolReachesTerrace = inside(TERRACE, v.x, v.z) || (() => {
    // Closest point on terrace rect to (v.x, v.z), then distance.
    const cx = Math.max(TERRACE.x0, Math.min(v.x, TERRACE.x1));
    const cz = Math.max(TERRACE.z0, Math.min(v.z, TERRACE.z1));
    return Math.hypot(v.x - cx, v.z - cz) < 3.4;
  })();
  const patrolReachesExit = Math.hypot(v.x - EXIT.x, v.z - EXIT.z) < 3.4;

  const status = hits.length ? 'FAIL' : 'OK';
  if (hits.length) problems++;
  console.log(`  [${status}] x=${v.x} z=${v.z} yaw=${v.yaw} station=${v.station} work=${v.work}`);
  if (hits.length) console.log(`         -> ${hits.join('; ')}`);
  if (!hits.length) {
    const warns = [];
    if (patrolReachesTerrace) warns.push('patrol (3.4m) reaches TERRACE walkway');
    if (patrolReachesExit) warns.push('patrol (3.4m) reaches house EXIT');
    if (warns.length) console.log(`         (warn: ${warns.join('; ')})`);
  }
}

console.log(
  problems === 0
    ? '\nAll villagers clear of forbidden static regions.'
    : `\n${problems} villager(s) in a forbidden region — see FAIL above.`
);
process.exit(problems ? 1 : 0);
