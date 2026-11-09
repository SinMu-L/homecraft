// Build the Homecraft show-home example. The engine calls build() once at boot,
// then setup() once the player exists.
import { buildIsland } from '@engine/world/terrain.js';
import { buildForest } from '@engine/world/landscape.js';
import { defineHouseBlocks, surfaceAt, buildPool, buildShell } from './house.js';
import { furnish } from './furnish.js';
import { buildOuter } from './outer.js';
import { buildMountain } from './mountain.js';
import { buildRoofAccess } from './roof-access.js';
import { createStainless } from './stainless.js';
import { createVertec } from './vertec.js';
import { createGolem, createVillager, createTrader, createAnimal, createArenaFighters } from './mobs.js';
import { BoxBatch } from '@engine/world/blocks.js';
import { ISLAND, FOREST, COURT, RIM, MOBS, ARENA } from './layout.js';

export function build({ grid, layer, materials, stage }) {
  // The kitchen's brushed steel is a real metal, with its own room reflection.
  materials.boxMetal = createStainless(stage);
  defineHouseBlocks(grid);
  buildIsland(grid, ISLAND, { surfaceAt });
  buildPool(grid);
  buildShell(grid);
  const forest = buildForest(grid, layer, FOREST);
  const furn = furnish({ layer });
  // 擂台：东边新陆地上一个抬高的石质方台，四角立柱围一圈栏。
  const arena = buildArena(layer);
  furn.batches.arena = arena.batch;
  // The pier and sailboat, the mountain and the roof's outside stair are
  // ground of their own, outside the block grid.
  const outer = buildOuter(layer, materials), mountain = buildMountain(layer, materials), roofAccess = buildRoofAccess(layer, materials);
  stage.scene.add(outer.group, mountain.group, roofAccess.group);
  return {
    batches: furn.batches, planes: furn.planes, obstacles: furn.obstacles, lights: furn.lights, bakes: furn.lighting,
    hotspots: furn.hotspots, animated: furn.animated, surfaces: furn.surfaces, forest,
    sites: [outer, mountain], sitesAfter: [roofAccess],
    named: { outer, mountain, roofAccess, drawMap },
  };
}

// 擂台：9×9 米的石台，离地 0.6 米，四角 2.4 米高的立柱，柱顶连一圈横梁
// 当围栏，南面留一个 2 米宽的缺口当入口。台面用石板，立柱用深板岩。
function buildArena(layer) {
  const B = new BoxBatch(layer);
  const A = ARENA;
  const STONE = { tex: 'stone' }, DEEP = { tex: 'deepslate' }, STEEL = { tex: 'steel' };
  const x0 = A.cx - A.half, x1 = A.cx + A.half, z0 = A.cz - A.half, z1 = A.cz + A.half;
  const top = A.top;                        // 台面高度
  // 台面：一整块厚石板（9×0.6×9），顶面齐 top
  B.box(A.cx, top - 0.6, A.cz, A.half * 2, 0.6, A.half * 2, STONE);
  // 台面四周一圈深板岩边沿，高出台面 0.1 米当围挡
  const rim = 0.1;
  for (const [cx, cz, w, d] of [
    [A.cx, z0, A.half * 2, 0.2],
    [A.cx, z1, A.half * 2, 0.2],
    [x0, A.cz, 0.2, A.half * 2],
    [x1, A.cz, 0.2, A.half * 2],
  ]) B.box(cx, top, cz, w, rim, d, DEEP);
  // 四角立柱 2.4 米高，0.3×0.3
  const postH = 2.4;
  for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    B.box(px, top, pz, 0.3, postH, 0.3, DEEP);
  }
  // 立柱顶横梁连成围栏（钢索感）：北、东、西三条边整条，南边留 2 米缺口当入口
  const beamY = top + postH - 0.1, beam = 0.06;
  const gap = 1.0;   // 入口半宽
  // 北边整条
  B.box(A.cx, beamY, z0, A.half * 2, beam, beam, STEEL);
  // 东、西边整条
  B.box(x0, beamY, A.cz, beam, beam, A.half * 2, STEEL);
  B.box(x1, beamY, A.cz, beam, beam, A.half * 2, STEEL);
  // 南边留缺口：入口两侧各一段
  B.box(A.cx - (A.half + gap) / 2, beamY, z1, A.half - gap, beam, beam, STEEL);
  B.box(A.cx + (A.half + gap) / 2, beamY, z1, A.half - gap, beam, beam, STEEL);
  // 台面下四个支墩到地面，让台子看起来是架起来的
  for (const [px, pz] of [[x0 + 0.5, z0 + 0.5], [x1 - 0.5, z0 + 0.5], [x0 + 0.5, z1 - 0.5], [x1 - 0.5, z1 - 0.5]]) {
    B.box(px, 0, pz, 0.4, top - 0.6, 0.4, DEEP);
  }
  return { batch: B };
}

// The half court on the radar, painted as it is on the floor.
function drawMap(ctx, X, Z, PPM) {
  ctx.fillStyle = '#2b2e31';
  ctx.fillRect(X(COURT.x0 - 1), Z(COURT.z0 - 1), (COURT.x1 - COURT.x0 + 2) * PPM, (COURT.z1 - COURT.z0 + 2) * PPM);
  ctx.fillStyle = '#d9ae76';
  ctx.fillRect(X(COURT.x0), Z(COURT.z0), (COURT.x1 - COURT.x0) * PPM, (COURT.z1 - COURT.z0) * PPM);
  ctx.fillStyle = '#b92d28';
  ctx.fillRect(X(COURT.x0), Z(RIM.z - 2.45), 5.8 * PPM, 4.9 * PPM);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const courtSide = Math.min((COURT.z1 - COURT.z0) / 2 - 0.9, 6.7);
  ctx.arc(X(RIM.x), Z(RIM.z), 6.75 * PPM, -Math.asin(courtSide / 6.75), Math.asin(courtSide / 6.75));
  ctx.stroke();
  ctx.strokeRect(X(COURT.x0), Z(COURT.z0), (COURT.x1 - COURT.x0) * PPM, (COURT.z1 - COURT.z0) * PPM);
}

// The moving parts the engine does not know about: the Vertec in the gym
// (jump beside it and the vanes swing), the sailboat rocking at the pier,
// and the island's inhabitants.
export function setup({ stage, world, player, avatar, sound, nav }) {
  const vertec = createVertec({ avatar, sound });
  stage.scene.add(vertec.mesh);
  // 岛上的居民：一只会巡逻的铁傀儡、两个干活的村民、一个牵羊驼的商人，
  // 以及后山脚下的鸡牛羊猪。
  const mobs = [
    createGolem(MOBS.golem),
    ...MOBS.villagers.map(v => createVillager(v)),
    createTrader(MOBS.trader),
    ...MOBS.animals.map(a => createAnimal(a)),
  ];
  // 擂台上的两个斗士：铁傀儡和僵尸互相引用，死后原地重生继续打。
  const { golem: golemFighter, zombie: zombieFighter } = createArenaFighters(ARENA);
  mobs.push(golemFighter, zombieFighter);
  for (const m of mobs) stage.scene.add(m.root);
  return {
    update(dt) {
      vertec.update(dt, player);
      world.outer.update(dt, stage.camera);
      for (const m of mobs) m.update(dt, nav, player);
    },
  };
}
