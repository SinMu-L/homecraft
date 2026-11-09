// 世界逻辑的 Node 测试：不需要浏览器，也不需要 WebGL。
//
// three.js 直接用 vendor/ 里的模块 —— 通过一个解析钩子把裸标识符 "three"
// 指过去，这样 world/ 下的模块可以原样导入。渲染器的部分测不了，但场景图
// 数学（包围球、视锥裁剪）和状态机都是纯 JS，可以真跑。
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const THREE_URL = pathToFileURL(resolve(root, 'vendor/three/three.module.min.js')).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const THREE = await import(THREE_URL);
const { createFighterGolem, createArenaFighters } = await import(pathToFileURL(resolve(root, 'world/mobs.js')).href);
const { ARENA } = await import(pathToFileURL(resolve(root, 'world/layout.js')).href);

// ---- 断言小工具 ----------------------------------------------------------
let passed = 0;
const failures = [];
function ok(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---- 一对互相引用的斗士 --------------------------------------------------
// 直接调 build.js 用的那个函数，测的就是线上接线，而不是测试里另抄一份。
function makePair() {
  return createArenaFighters(ARENA);
}

function tick(pair, seconds, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    pair.golem.update(dt, null, null);
    pair.zombie.update(dt, null, null);
  }
}

// 骨头上的 Mesh（带顶点色）；脚下的影子是普通圆片，颜色属性不同，排除掉。
function boneMeshes(f) {
  const out = [];
  f.root.traverse(o => { if (o.isMesh && o.geometry.attributes.color) out.push(o); });
  return out;
}

// 从某点看向某点的视锥，和引擎渲染时用的是同一套数学。
function frustumAt(position, target, fov = 62, aspect = 1.6) {
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 300);
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(new THREE.Vector3(target[0], target[1], target[2]));
  camera.updateMatrixWorld(true);
  return new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

const worldPos = o => o.getWorldPosition(new THREE.Vector3());

// 所有骨头几何在世界空间里的包围盒（不含脚下的影子）。
function boneBox(f) {
  f.root.updateMatrixWorld(true);
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  for (const m of boneMeshes(f)) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    tmp.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    box.union(tmp);
  }
  return box;
}

console.log('\n# 出生位置');
{
  const { golem, zombie } = makePair();
  ok('铁傀儡出生在台面高度', near(golem.root.position.y, ARENA.top), `y=${golem.root.position.y}`);
  ok('僵尸出生在台面高度', near(zombie.root.position.y, ARENA.top), `y=${zombie.root.position.y}`);
  ok('铁傀儡出生在预设站位', near(golem.root.position.x, ARENA.golem.x) && near(golem.root.position.z, ARENA.golem.z),
    `(${golem.root.position.x}, ${golem.root.position.z})`);
  ok('僵尸出生在预设站位', near(zombie.root.position.x, ARENA.zombie.x) && near(zombie.root.position.z, ARENA.zombie.z),
    `(${zombie.root.position.x}, ${zombie.root.position.z})`);
  ok('两人都在擂台范围内',
    Math.abs(golem.root.position.x - ARENA.cx) <= ARENA.half &&
    Math.abs(zombie.root.position.x - ARENA.cx) <= ARENA.half);
}

console.log('\n# 骨架结构（普通 Mesh，不是 InstancedMesh）');
{
  const { golem, zombie } = makePair();
  for (const [name, f] of [['铁傀儡', golem], ['僵尸', zombie]]) {
    const meshes = boneMeshes(f);
    ok(`${name}有 5 块骨头几何`, meshes.length === 5, `count=${meshes.length}`);
    ok(`${name}没有用 InstancedMesh`, meshes.every(m => !m.isInstancedMesh));
    ok(`${name}几何带顶点色`, meshes.every(m => !!m.geometry.attributes.color));
    ok(`${name}几何带法线`, meshes.every(m => !!m.geometry.attributes.normal));
    ok(`${name}几何有三角面`, meshes.every(m => m.geometry.index && m.geometry.index.count > 0));
    ok(`${name}每块几何都有包围球`, meshes.every(m => m.geometry.boundingSphere && Number.isFinite(m.geometry.boundingSphere.radius)));
    ok(`${name}包围球不为空`, meshes.every(m => m.geometry.boundingSphere.radius > 0.05));
    ok(`${name}骨头都挂在 root 下`, meshes.every(m => { let p = m; while (p) { if (p === f.root) return true; p = p.parent; } return false; }));
  }
}

console.log('\n# 站在擂台边能看见斗士');
{
  const { golem, zombie } = makePair();
  golem.root.updateMatrixWorld(true);
  zombie.root.updateMatrixWorld(true);
  // 站在擂台北侧往南看（玩家 teleport(44, 6) 之后大致就是这个视角）。
  const view = frustumAt([ARENA.cx, ARENA.top + 2, ARENA.cz - 8], [ARENA.cx, ARENA.top + 1, ARENA.cz]);
  for (const [name, f] of [['铁傀儡', golem], ['僵尸', zombie]]) {
    const meshes = boneMeshes(f);
    ok(`视锥里有${name}的每一块骨头`, meshes.every(m => view.intersectsObject(m)),
      `${meshes.filter(m => !view.intersectsObject(m)).length} 块被裁掉`);
  }
  // 远处视角仍然会被裁掉，说明裁剪本身还在工作。
  const far = frustumAt([0, 2, 0], [0, 2, -20]);
  ok('远处视角下会被裁掉', boneMeshes(golem).every(m => !far.intersectsObject(m)));
}

console.log('\n# 互相引用（不能各打各的）');
{
  const { golem, zombie } = makePair();
  const start = Math.hypot(golem.root.position.x - zombie.root.position.x, golem.root.position.z - zombie.root.position.z);
  tick({ golem, zombie }, 1.5);
  const now = Math.hypot(golem.root.position.x - zombie.root.position.x, golem.root.position.z - zombie.root.position.z);
  // 接反了（各自指向自己）时距离恒为 0，两人原地不动，这条会挂。
  ok('开局是分开的', start > 3, `start=${start.toFixed(2)}`);
  ok('会朝对手走过去', now < start - 1, `start=${start.toFixed(2)} → now=${now.toFixed(2)}`);
  ok('铁傀儡往东走', golem.root.position.x > ARENA.golem.x, `x=${golem.root.position.x.toFixed(2)}`);
  ok('僵尸往西走', zombie.root.position.x < ARENA.zombie.x, `x=${zombie.root.position.x.toFixed(2)}`);
}

console.log('\n# 对打状态机');
{
  const { golem, zombie } = makePair();
  let golemDeaths = 0, zombieDeaths = 0;
  let gDead = false, zDead = false, respawned = 0;
  for (let i = 0; i < 60 * 120; i++) {           // 模拟两分钟
    golem.update(1 / 60, null, null);
    zombie.update(1 / 60, null, null);
    if (!gDead && golem.isDead()) golemDeaths++;
    if (!zDead && zombie.isDead()) zombieDeaths++;
    if (gDead && !golem.isDead()) respawned++;
    if (zDead && !zombie.isDead()) respawned++;
    gDead = golem.isDead();
    zDead = zombie.isDead();
  }
  ok('铁傀儡被打死过', golemDeaths >= 1, `deaths=${golemDeaths}`);
  ok('僵尸被打死过', zombieDeaths >= 1, `deaths=${zombieDeaths}`);
  ok('死后会重生', respawned >= 2, `respawns=${respawned}`);
}

console.log('\n# 打完架还在擂台上');
{
  const { golem, zombie } = makePair();
  // 斗士会打死对方后回到各自站位重生，所以要记录整段时间里最近的一次距离。
  let closest = Infinity;
  for (let i = 0; i < 60 * 30; i++) {
    golem.update(1 / 60, null, null);
    zombie.update(1 / 60, null, null);
    closest = Math.min(closest, Math.hypot(
      golem.root.position.x - zombie.root.position.x,
      golem.root.position.z - zombie.root.position.z,
    ));
  }
  for (const [name, f] of [['铁傀儡', golem], ['僵尸', zombie]]) {
    ok(`${name}没掉下台面`, near(f.root.position.y, ARENA.top), `y=${f.root.position.y}`);
    ok(`${name}还在擂台范围内`,
      Math.abs(f.root.position.x - ARENA.cx) <= ARENA.half + 0.5 &&
      Math.abs(f.root.position.z - ARENA.cz) <= ARENA.half + 0.5,
      `(${f.root.position.x.toFixed(2)}, ${f.root.position.z.toFixed(2)})`);
  }
  // 互相靠近过，说明确实会走向对手，而不是各站各的。
  ok('两人靠到了攻击距离内', closest <= 2.0, `closest=${closest.toFixed(2)}`);
}

console.log('\n# 骨头真的在擂台上');
{
  const { golem, zombie } = makePair();
  tick({ golem, zombie }, 5);
  for (const [name, f] of [['铁傀儡', golem], ['僵尸', zombie]]) {
    f.root.updateMatrixWorld(true);
    const pts = boneMeshes(f).map(worldPos);
    ok(`${name}骨头坐标没有 NaN`, pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)));
    const box = boneBox(f), size = box.getSize(new THREE.Vector3());
    ok(`${name}站在台面上`, box.min.y >= ARENA.top - 0.25, `minY=${box.min.y.toFixed(2)}`);
    ok(`${name}身高合理`, size.y > 1.5 && size.y < 4, `height=${size.y.toFixed(2)}`);
    ok(`${name}宽度合理`, size.x > 0.4 && size.z > 0.4, `w=${size.x.toFixed(2)} d=${size.z.toFixed(2)}`);
    // 骨头彼此分得开，不是全塌在一个点上（InstancedMesh 那个 bug 的症状）。
    const spread = Math.max(size.x, size.z);
    ok(`${name}骨头没有塌成一坨`, spread > 0.6, `spread=${spread.toFixed(2)}`);
    ok(`${name}骨头都在擂台附近`,
      box.min.x > ARENA.cx - ARENA.half - 1 && box.max.x < ARENA.cx + ARENA.half + 1 &&
      box.min.z > ARENA.cz - ARENA.half - 1 && box.max.z < ARENA.cz + ARENA.half + 1,
      `x=[${box.min.x.toFixed(2)}, ${box.max.x.toFixed(2)}] z=[${box.min.z.toFixed(2)}, ${box.max.z.toFixed(2)}]`);
  }
}

console.log('\n# 边界情况');
{
  const lone = createFighterGolem({ x: ARENA.golem.x, z: ARENA.golem.z, yaw: 0, y: ARENA.top, foeRef: { get: () => null } });
  let threw = null;
  try { for (let i = 0; i < 120; i++) lone.update(1 / 60, null, null); } catch (e) { threw = e; }
  ok('没有对手时不抛异常', threw === null, threw?.message);
  ok('没有对手时原地待着', near(lone.root.position.x, ARENA.golem.x) && near(lone.root.position.z, ARENA.golem.z));

  const { golem } = makePair();
  ok('打不死的不会变成死亡', (() => {
    for (let i = 0; i < 20; i++) golem.hurt(1);
    return !golem.isDead();
  })());
}

// ---- 汇总 ----------------------------------------------------------------
console.log('');
if (failures.length) {
  console.log(`失败 ${failures.length} 项，通过 ${passed} 项：`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`全部通过：${passed} 项`);
