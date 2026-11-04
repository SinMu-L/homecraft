# Villager Specification

A villager is one entry in the `MOBS.villagers` array in [`world/layout.js`](../world/layout.js), rendered by `createVillager` in [`world/mobs.js`](../world/mobs.js). This document fixes how an entry is filled, where it is placed, and how it is checked — so adding a villager is filling one entry, not editing three files.

## 0. Boundary

- The body rig, colours below, and `work` animations live in [`world/mobs.js`](../world/mobs.js). This document covers **only the data layer**: how `MOBS.villagers` is filled and how `setup()` in [`world/build.js`](../world/build.js) mounts them.
- Adding a new `work` action, or changing the body shape / non-robe colours, means editing `mobs.js`. It is **out of scope** here. The actions registered today are listed in §2.
- Colours not listed below (`skin`, `hair`, `nose`, `trim`) are constants inside `createVillager`. They cannot be set per villager without a code change; do not pretend otherwise in the data.

## 1. Fields

One villager = one object in `MOBS.villagers`.

| Field | Type | Default | Constraint | Meaning |
|---|---|---|---|---|
| `x` | number | required | integer or `.5`; must pass `nav.canStand(x, z)` | Spawn x, in metres |
| `z` | number | required | integer or `.5`; must pass `nav.canStand(x, z)` | Spawn z, in metres |
| `yaw` | number | required | radians; `0` faces south (+z), `π` faces north | Body facing |
| `station` | string | optional | must be an existing `id` in `STATIONS` | The station this villager belongs to |
| `robe` | hex | `0x6b7b52` | 6-digit hex | Robe colour |
| `work` | enum | `'idle'` | `'chop'` \| `'sip'` \| `'idle'` | Action, see §2 |

Unrecognised fields are ignored by `createVillager` today, but must not be added — they mislead later readers. Keep an entry to the fields above.

## 2. `work` actions

Each action implies a posture **and an environment it needs**. Picking an action without that environment is the main cause of a villager looking wrong.

| Value | Arms | Body | Environment required | If missing |
|---|---|---|---|---|
| `chop` | right arm chops up/down | slight bob | a counter-height surface (~0.9 m) in front, within reach | chops empty air |
| `sip` | left hand raised to mouth | head tilts back occasionally | a cup-height surface (~1.1 m) beside the hand | drinks nothing |
| `idle` | both arms folded across chest | head glances left/right | none | safe default |

When unsure, use `idle`. It has no environment dependency and never looks broken.

## 3. Coordinates and facing

The project coordinate system applies: one block = one metre, x east, z south, y up, ground `y = 0`. `yaw 0` faces south (+z).

**Facing a point.** To make a villager at `(x, z)` face a furniture point `(tx, tz)`:

```
yaw = Math.atan2(tx - x, tz - z)
```

This matches the `atan2(dx, dz)` convention used throughout `mobs.js`.

**When `station` is set.** Stand the villager 1–2 m from `STATION.at`, facing the same direction as the station's `look`, or facing the relevant furniture point per §2. The station link is semantic — it says "this villager belongs to this area" — and does not move the villager automatically.

**Patrol radius.** `createVillager` patrols within 3.4 m of `(x, z)` via `walker`. Therefore the 3.4 m circle around the spawn must be clear of walkways, doorways, and the station's own standing spot, or the villager will wander onto the path.

**Forbidden spawn zones.** Do not place a villager on: `obstacles` (furniture collision bounds), `DOORWAY`, `EXIT`, `POOL`, or inside the `COURT` playing area. The character is 1.8 m tall and ~0.5 m wide; leave at least a 1.2 m passage past the villager.

## 4. Mounting

Villagers are mounted in `setup()` in [`world/build.js`](../world/build.js), **not** in `build()`. `nav` is only available in `setup`:

```js
const mobs = [
  createGolem(MOBS.golem),
  ...MOBS.villagers.map(v => createVillager(v)),
  createTrader(MOBS.trader),
  ...MOBS.animals.map(a => createAnimal(a)),
];
for (const m of mobs) stage.scene.add(m.root);
```

Do not add a villager in `build()` — it renders, but `nav` is null there so the `walker` cannot path and the villager stands frozen.

## 5. Checking

After adding a villager, run these from the browser console. `__home.nav` is exposed; `MOBS` and `STATIONS` are module internals and are **not** on `__home`, so paste the coordinates you wrote.

**5.1 Standability and height.** Paste your villagers, get a diagnosis:

```js
[
  { x: 17.6, z: 6.6, yaw: 3.6, station: 'coffee', work: 'chop' },
  { x: 15.2, z: 12.0, yaw: 0.4, station: 'coffee', work: 'sip' },
].map(v => {
  const canStand = __home.nav.canStand(v.x, v.z);
  const floor = __home.nav.heightAt(v.x, v.z);
  return { ...v, canStand, floor };
});
```

Every entry must read `canStand: true`. `floor` should be `0` for a ground-floor villager, or `LOFT.y` for a second-floor one.

**5.2 Stand beside it and check facing.**

```js
__home.teleport(17.6, 5.6);   // 1 m south of the villager, looking +z
```

Confirm the villager faces the intended furniture, not a wall or empty space.

**5.3 Draw cost.** Each villager is one `InstancedMesh` + one blob shadow = +1 draw call. Open the URL with `?debug` and check the draw-call count does not exceed the budget (60).

**5.4 Passage.** Walk past the villager at normal speed. The 3.4 m patrol circle must not push it onto the main walkway, and the player must be able to pass on at least one side.

## 6. Worked example

The two existing villagers, rewritten with `station` filled in:

```js
// world/layout.js
villagers: [
  { x: 17.6, z: 6.6, yaw: 3.6, station: 'coffee', work: 'chop' },   // at the stove
  { x: 15.2, z: 12.0, yaw: 0.4, station: 'coffee', work: 'sip' },   // at the coffee bar
],
```

To add a third villager idling by the library, fill one entry — nothing else:

```js
{ x: -3.5, z: -3.0, yaw: 0, station: 'library', work: 'idle' }
```

Then run §5.1 and §5.2 with the new coordinates.
