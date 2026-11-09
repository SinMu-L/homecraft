// 岛上的居民：铁傀儡、村民、卖药水的商人，以及基础动物。
// 每个生物是一个 InstancedMesh —— 所有方块都是它的实例，一只生物只占
// 一次 draw call（外加一片 blob 阴影）。矩阵只在姿态真的变了才上传，
// 和 engine/world/avatar.js 里猫狗的做法一致。
import * as THREE from 'three';

// ---- 造型工具 ------------------------------------------------------------
// 每只生物用一个 Group 树描述骨架，方块挂在骨架上；上传时把每块方块的
// 局部矩阵乘上骨架的世界矩阵，写进同一个实例缓冲。
// 几何和材质在模块级共享：8 只生物只用一份 BoxGeometry、一份阴影几何与材质。
const CUBE = new THREE.BoxGeometry(1, 1, 1);
const BLOB_GEO = new THREE.CircleGeometry(1, 12);
const BLOB_MAT = new THREE.MeshBasicMaterial({
  color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false,
});
function rig() {
  const root = new THREE.Group();
  const parts = [];
  const group = (parent, x, y, z) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const at = (x, y, z, w, h, d) => new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d),
  );
  const box = (parent, w, h, d, color, x, y, z) => parts.push({
    parent, color, local: at(x, y, z, w, h, d),
  });
  // `sphere` 是包围球（视锥裁剪用），`blob` 是脚下的影子。
  function build(name, sphere, blob) {
    const mesh = new THREE.InstancedMesh(CUBE, new THREE.MeshLambertMaterial(), parts.length);
    mesh.name = name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.boundingSphere = sphere;
    const color = new THREE.Color();
    parts.forEach((p, i) => mesh.setColorAt(i, color.set(p.color)));
    const shadow = new THREE.Mesh(BLOB_GEO, BLOB_MAT);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.014;
    shadow.scale.set(blob.sx ?? 1, blob.sz ?? 1, 1);
    root.add(mesh, shadow);
    const m = new THREE.Matrix4();
    function upload() {
      root.updateMatrixWorld(true);
      parts.forEach((p, i) => {
        m.multiplyMatrices(p.parent.matrixWorld, p.local);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    return { root, mesh, shadow, upload };
  }
  return { root, group, box, build };
}

// ---- 铁傀儡 --------------------------------------------------------------
// 四格高、肩膀极宽，胸口一层藤蔓。走路时躯干轻微上下、手臂前后摆。
export function createGolem({ x, z, yaw }) {
  const { root, group, box, build } = rig();
  const iron = 0xd8d4c8, dark = 0x9d9a8e, vine = 0x5d7a37, flower = 0xb8392f, eye = 0x1a1f22;
  const body = group(root, 0, 0, 0);
  const torso = group(body, 0, 1.62, 0);
  box(torso, 1.0, 0.72, 0.62, iron, 0, 0.36, 0);
  box(torso, 1.0, 0.18, 0.64, dark, 0, -0.02, 0);          // 胯部
  // 胸口藤蔓
  box(torso, 0.34, 0.30, 0.03, vine, -0.12, 0.44, 0.32);
  box(torso, 0.22, 0.16, 0.03, vine, 0.20, 0.30, 0.32);
  box(torso, 0.1, 0.1, 0.04, flower, -0.20, 0.52, 0.33);
  const head = group(torso, 0, 0.72, 0);
  box(head, 0.52, 0.46, 0.46, iron, 0, 0.23, 0);
  box(head, 0.5, 0.1, 0.48, dark, 0, 0.02, 0);
  for (const s of [-1, 1]) box(head, 0.1, 0.07, 0.02, eye, s * 0.12, 0.3, 0.235);
  box(head, 0.5, 0.06, 0.06, dark, 0, 0.44, 0);
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = group(torso, s * 0.62, 0.64, 0);
    box(shoulder, 0.26, 0.86, 0.28, iron, 0, -0.4, 0);
    box(shoulder, 0.22, 0.24, 0.24, dark, 0, -0.9, 0);
    arms.push(shoulder);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = group(body, s * 0.24, 1.02, 0);
    box(hip, 0.28, 0.9, 0.3, iron, 0, -0.45, 0);
    box(hip, 0.3, 0.1, 0.36, dark, 0, -0.94, 0.02);
    legs.push(hip);
  }
  const { root: _r, mesh, upload } = build(
    'iron-golem', new THREE.Sphere(new THREE.Vector3(x, 1.7, z), 2.4), { radius: 0.85, opacity: 0.26, sx: 1.15, sz: 0.9 },
  );
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  let t = Math.random() * 6;
  upload();
  // 在露台一带随机巡逻（走 A* 路径，不会卡进墙里）；玩家走近时停下盯着他。
  const feet = walker({ root, home: { x, z }, range: 6.5, speed: 0.62 });
  let navRef = null, headYaw = 0;
  const NOTICE = 6.5;   // 多远开始注意到玩家
  function update(dt, nav, player) {
    t += dt;
    if (nav) navRef = nav;
    // 玩家在附近就停下来看他
    let facing = false;
    if (player) {
      const dx = player.pos.x - root.position.x, dz = player.pos.z - root.position.z;
      const d = Math.hypot(dx, dz);
      facing = d < NOTICE && player.y < 2;
      if (facing) {
        // 身体转向玩家（视线高度对不上也无所谓，铁傀儡本来就低头看人）
        const goal = Math.atan2(dx, dz);
        const diff = Math.atan2(Math.sin(goal - root.rotation.y), Math.cos(goal - root.rotation.y));
        root.rotation.y += diff * Math.min(1, dt * 3.2);
      }
    }
    const walk = !facing && feet.step(dt, navRef);
    const swing = walk ? Math.sin(t * 5.2) * 0.5 : 0;
    legs[0].rotation.x = swing; legs[1].rotation.x = -swing;
    arms[0].rotation.x = -swing * 0.8; arms[1].rotation.x = swing * 0.8;
    // 看着玩家时头部微微前倾，像在打量
    headYaw += ((facing ? -0.16 : 0) - headYaw) * Math.min(1, dt * 4);
    head.rotation.x = headYaw;
    torso.position.y = 1.62 + (walk ? Math.abs(Math.sin(t * 5.2)) * 0.035 : Math.sin(t * 0.9) * 0.012);
    upload();
  }
  return { root, mesh, update };
}

// ---- 会走路的居民 --------------------------------------------------------
// 村民、铁傀儡、商人都用这一套：在一小块区域里挑一个能站的目标，用 nav 的
// A* 走过去，到了就发呆一会儿再挑下一个。没有可走的路就原地待着。
// 碰撞由 nav.canStand 保证，不会走进家具和墙里。
function walker({ root, home, range, speed }) {
  let path = null, point = 0, wait = 0.6 + Math.random() * 2.2, heading = root.rotation.y;

  function pick(nav) {
    // 厨房和咖啡吧周围障碍多，先按半径随机撒点，多试几次；都不行就退一档
    // 用 nav.nearestStand 找最近的一块空地。
    for (let tries = 0; tries < 24; tries++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * range;
      const tx = home.x + Math.sin(a) * r, tz = home.z + Math.cos(a) * r;
      if (!nav.canStand(tx, tz) || Math.abs(nav.heightAt(tx, tz)) > 0.5) continue;
      const p = nav.findPath({ x: root.position.x, z: root.position.z }, { x: tx, z: tz });
      if (p?.length) { path = p; point = 0; return true; }
    }
    // 兜底：在自己周围找一处能站的地方，哪怕只挪一小步。
    const a = Math.random() * Math.PI * 2;
    const spot = nav.nearestStand(root.position.x + Math.sin(a) * 1.6, root.position.z + Math.cos(a) * 1.6);
    if (spot && Math.hypot(spot.x - root.position.x, spot.z - root.position.z) > 0.4) {
      const p = nav.findPath({ x: root.position.x, z: root.position.z }, spot);
      if (p?.length) { path = p; point = 0; return true; }
      path = [spot]; point = 0; return true;
    }
    return false;
  }

  // 返回 true 表示这一帧在走路（调用方据此摆动腿和手臂）。
  function step(dt, nav) {
    if (!nav) return false;
    if (path) {
      const next = path[point];
      const dx = next.x - root.position.x, dz = next.z - root.position.z;
      const d = Math.hypot(dx, dz);
      const move = Math.min(d, dt * speed);
      if (d > 0.001) {
        root.position.x += dx / d * move;
        root.position.z += dz / d * move;
        heading = Math.atan2(dx, dz);
      }
      // 平滑转向，不要瞬间甩头
      const diff = Math.atan2(Math.sin(heading - root.rotation.y), Math.cos(heading - root.rotation.y));
      root.rotation.y += diff * Math.min(1, dt * 7);
      if (d <= move + 0.001 && ++point >= path.length) {
        path = null;
        wait = 1.6 + Math.random() * 4.5;
      }
      return true;
    }
    wait -= dt;
    if (wait <= 0) { if (!pick(nav)) wait = 1.5; }
    return false;
  }

  return { step, get walking() { return !!path; } };
}

// ---- 村民 ----------------------------------------------------------------
// 长鼻子、绿袍、双手抱在身前。`work` 决定他在干什么：
// 'chop' 在灶台前切菜，'sip' 端着杯子，'idle' 只是站着张望。
export function createVillager({ x, z, yaw, robe = 0x6b7b52, work = 'idle' }) {
  const { root, group, box, build } = rig();
  const skin = 0xb08d6b, nose = 0x9a7654, eye = 0x2b2420, dark = 0x3f4a33;
  const body = group(root, 0, 0, 0);
  const torso = group(body, 0, 1.05, 0);
  box(torso, 0.52, 0.72, 0.34, robe, 0, 0.36, 0);           // 袍身
  box(torso, 0.54, 0.16, 0.36, dark, 0, 0.02, 0);            // 下摆
  box(torso, 0.3, 0.12, 0.05, dark, 0, 0.5, 0.18);           // 前襟
  const head = group(torso, 0, 0.72, 0);
  box(head, 0.44, 0.42, 0.4, skin, 0, 0.2, 0);
  box(head, 0.16, 0.2, 0.16, nose, 0, 0.16, 0.26);           // 长鼻子
  for (const s of [-1, 1]) {
    box(head, 0.07, 0.09, 0.02, eye, s * 0.13, 0.26, 0.205);
    box(head, 0.06, 0.16, 0.16, skin, s * 0.24, 0.2, 0);      // 耳朵
  }
  box(head, 0.46, 0.12, 0.42, dark, 0, 0.44, 0);              // 头发
  // 双手抱在身前
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = group(torso, s * 0.32, 0.6, 0);
    box(shoulder, 0.16, 0.5, 0.18, robe, 0, -0.22, 0);
    box(shoulder, 0.15, 0.14, 0.15, skin, 0, -0.5, 0.06);
    shoulder.rotation.x = -1.15;
    arms.push(shoulder);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = group(body, s * 0.14, 0.72, 0);
    box(hip, 0.18, 0.7, 0.2, dark, 0, -0.35, 0);
    legs.push(hip);
  }
  const { root: _r, mesh, upload } = build(
    'villager', new THREE.Sphere(new THREE.Vector3(x, 1.0, z), 1.6), { radius: 0.42, opacity: 0.2 },
  );
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  let t = Math.random() * 5;
  upload();
  // 在家的周围几米内随机走动；停下时才做工作动作。
  const feet = walker({ root, home: { x, z }, range: 3.4, speed: 0.85 });
  let navRef = null;
  function update(dt, nav) {
    t += dt;
    if (nav) navRef = nav;
    const moving = feet.step(dt, navRef);
    if (moving) {
      // 走路：腿交替、手臂轻轻前后、不再做工作动作
      const stride = Math.sin(t * 7);
      legs[0].rotation.x = stride * 0.42; legs[1].rotation.x = -stride * 0.42;
      arms[0].rotation.x = -1.15 + stride * 0.16;
      arms[1].rotation.x = -1.15 - stride * 0.16;
      torso.rotation.x = 0; head.rotation.x = 0;
    } else if (work === 'chop') {
      // 切菜：右臂上下，身体轻微起伏
      legs[0].rotation.x = legs[1].rotation.x = 0;
      arms[1].rotation.x = -1.15 + Math.abs(Math.sin(t * 6)) * 0.55;
      arms[0].rotation.x = -1.15;
      torso.rotation.x = Math.sin(t * 6) * 0.05;
    } else if (work === 'sip') {
      // 端杯子：手臂抬到嘴边，偶尔抿一口
      legs[0].rotation.x = legs[1].rotation.x = 0;
      const lift = 0.5 + Math.max(0, Math.sin(t * 0.8)) * 0.35;
      arms[1].rotation.x = -1.15;
      arms[0].rotation.x = -1.15 - lift;
      head.rotation.x = -Math.max(0, Math.sin(t * 0.8)) * 0.18;
    } else {
      legs[0].rotation.x = legs[1].rotation.x = 0;
      arms[0].rotation.x = arms[1].rotation.x = -1.15;
      head.rotation.y = Math.sin(t * 0.55) * 0.5;
    }
    torso.position.y = 1.05 + Math.sin(t * 1.6) * 0.012;
    upload();
  }
  return { root, mesh, update };
}

// ---- 卖药水的商人 + 两只羊驼 ----------------------------------------------
// 蓝紫长袍、背着货囊，牵着两只羊驼站在院子里。
export function createTrader({ x, z, yaw }) {
  const { root, group, box, build } = rig();
  const robe = 0x4a4e8c, trim = 0xb8a44e, skin = 0xb08d6b, nose = 0x9a7654, eye = 0x2b2420, pack = 0x6b4f2e;
  const body = group(root, 0, 0, 0);
  const torso = group(body, 0, 1.05, 0);
  box(torso, 0.52, 0.72, 0.34, robe, 0, 0.36, 0);
  box(torso, 0.54, 0.14, 0.36, trim, 0, 0.03, 0);
  box(torso, 0.24, 0.1, 0.04, trim, 0, 0.52, 0.185);
  const head = group(torso, 0, 0.72, 0);
  box(head, 0.44, 0.42, 0.4, skin, 0, 0.2, 0);
  box(head, 0.16, 0.2, 0.16, nose, 0, 0.16, 0.26);
  for (const s of [-1, 1]) box(head, 0.07, 0.09, 0.02, eye, s * 0.13, 0.26, 0.205);
  box(head, 0.5, 0.16, 0.44, trim, 0, 0.44, 0);              // 帽子
  box(head, 0.5, 0.05, 0.4, trim, 0, 0.54, 0.24);            // 帽檐
  // 背后的货囊
  box(torso, 0.4, 0.36, 0.2, pack, 0, 0.42, -0.26);
  box(torso, 0.12, 0.12, 0.06, trim, 0, 0.5, -0.37);
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = group(torso, s * 0.32, 0.6, 0);
    box(shoulder, 0.16, 0.5, 0.18, robe, 0, -0.22, 0);
    box(shoulder, 0.15, 0.14, 0.15, skin, 0, -0.5, 0.04);
    arms.push(shoulder);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = group(body, s * 0.14, 0.72, 0);
    box(hip, 0.18, 0.7, 0.2, 0x3a3d6b, 0, -0.35, 0);
    legs.push(hip);
  }
  // 两只羊驼拴在旁边，头朝向人
  const llamas = [];
  for (const [i, s] of [-1, 1].entries()) {
    const wool = [0xd9cba4, 0xc9b98f][i], coat = 0x8a7a5c;
    const lb = group(root, s * 1.15, 0, -0.15);
    lb.rotation.y = -s * 0.5;
    box(lb, 0.42, 0.5, 0.72, wool, 0, 1.0, 0);                // 身体
    const neck = group(lb, 0, 1.26, 0.3);
    neck.rotation.x = -0.42;
    box(neck, 0.22, 0.55, 0.24, wool, 0, 0.26, 0);
    const lh = group(neck, 0, 0.52, 0.02);
    box(lh, 0.26, 0.24, 0.3, coat, 0, 0.1, 0.06);
    for (const e of [-1, 1]) box(lh, 0.07, 0.11, 0.06, coat, e * 0.1, 0.28, 0);  // 耳朵
    for (const lx of [-0.14, 0.14]) for (const lz of [-0.26, 0.26]) {
      box(lb, 0.12, 0.78, 0.14, coat, lx, 0.39, lz);
    }
    llamas.push({ neck, lh, phase: Math.random() * 4 });
  }
  const { root: _r, mesh, upload } = build(
    'wandering-trader', new THREE.Sphere(new THREE.Vector3(x, 1.1, z), 2.2), { radius: 0.95, opacity: 0.22, sx: 1.9, sz: 0.9 },
  );
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  let t = Math.random() * 7;
  upload();
  function update(dt) {
    t += dt;
    // 商人：招呼客人，右手偶尔抬起
    arms[1].rotation.x = -0.3 + Math.max(0, Math.sin(t * 0.7)) * 0.9;
    arms[0].rotation.x = -0.1 + Math.sin(t * 0.9) * 0.06;
    head.rotation.y = Math.sin(t * 0.5) * 0.35;
    torso.position.y = 1.05 + Math.sin(t * 1.5) * 0.012;
    // 羊驼：低头吃草、抬头发呆
    for (const l of llamas) {
      const graze = Math.max(0, Math.sin(t * 0.32 + l.phase));
      l.neck.rotation.x = -0.42 + graze * 0.55;
      l.lh.rotation.x = graze * -0.35;
    }
    upload();
  }
  return { root, mesh, update };
}

// ---- 基础动物（鸡 / 牛 / 羊 / 猪）-----------------------------------------
// 都做成小步巡逻：在给点附近随机挪动，遇到障碍就换个方向。
export function createAnimal({ kind, x, z, yaw }) {
  const { root, group, box, build } = rig();
  const body = group(root, 0, 0, 0);
  let legs = [], head = null, wander = 1.1, radius = 0.3;

  if (kind === 'chicken') {
    const white = 0xf2efe6, beak = 0xd9a441, comb = 0xc0392b;
    box(body, 0.28, 0.26, 0.32, white, 0, 0.44, 0);
    box(body, 0.24, 0.2, 0.26, white, 0, 0.62, 0.04);
    head = group(body, 0, 0.7, 0.16);
    box(head, 0.2, 0.2, 0.2, white, 0, 0.06, 0);
    box(head, 0.07, 0.06, 0.09, beak, 0, 0.02, 0.13);
    box(head, 0.06, 0.08, 0.12, comb, 0, 0.17, 0.02);
    for (const s of [-1, 1]) box(head, 0.04, 0.04, 0.02, 0x1a1a1a, s * 0.06, 0.08, 0.1);
    for (const lx of [-0.08, 0.08]) box(body, 0.05, 0.3, 0.05, beak, lx, 0.15, 0.02);
    box(body, 0.16, 0.05, 0.2, white, 0, 0.32, -0.2);          // 尾
    wander = 0.8; radius = 0.22;
  } else if (kind === 'cow') {
    const hide = 0x3b3531, white = 0xeeeae0, pink = 0xc99a94, horn = 0xd8cfae;
    box(body, 0.6, 0.62, 1.05, hide, 0, 0.96, 0);
    box(body, 0.62, 0.28, 0.6, white, 0, 0.86, 0.1);
    box(body, 0.4, 0.34, 0.3, white, 0, 1.12, -0.25);
    head = group(body, 0, 1.24, 0.52);
    box(head, 0.4, 0.36, 0.34, hide, 0, 0, 0);
    box(head, 0.3, 0.2, 0.16, pink, 0, -0.06, 0.2);
    for (const s of [-1, 1]) {
      box(head, 0.06, 0.16, 0.06, horn, s * 0.14, 0.2, -0.02);
      box(head, 0.04, 0.04, 0.02, 0x141414, s * 0.12, 0.06, 0.18);
    }
    for (const lx of [-0.2, 0.2]) for (const lz of [-0.34, 0.34]) {
      const hip = group(body, lx, 0.66, lz);
      box(hip, 0.16, 0.66, 0.18, hide, 0, -0.33, 0);
      legs.push(hip);
    }
    wander = 0.9; radius = 0.5;
  } else if (kind === 'sheep') {
    const wool = 0xece7da, face = 0xb9a894, foot = 0x54504a;
    box(body, 0.56, 0.56, 0.9, wool, 0, 0.9, 0);
    box(body, 0.6, 0.5, 0.62, wool, 0, 1.0, -0.06);
    head = group(body, 0, 1.14, 0.46);
    box(head, 0.3, 0.3, 0.3, face, 0, 0, 0);
    box(head, 0.34, 0.16, 0.16, wool, 0, 0.16, -0.02);
    for (const s of [-1, 1]) box(head, 0.05, 0.05, 0.02, 0x141414, s * 0.08, 0.04, 0.16);
    for (const lx of [-0.17, 0.17]) for (const lz of [-0.28, 0.28]) {
      const hip = group(body, lx, 0.62, lz);
      box(hip, 0.13, 0.62, 0.15, foot, 0, -0.31, 0);
      legs.push(hip);
    }
    wander = 0.85; radius = 0.42;
  } else {
    const pink = 0xe0a8a4, snout = 0xc78f8b, dark = 0x9c6a68;
    box(body, 0.52, 0.46, 0.8, pink, 0, 0.66, 0);
    head = group(body, 0, 0.78, 0.44);
    box(head, 0.38, 0.34, 0.3, pink, 0, 0, 0);
    box(head, 0.16, 0.14, 0.08, snout, 0, -0.05, 0.17);
    for (const s of [-1, 1]) {
      box(head, 0.05, 0.05, 0.02, 0x141414, s * 0.1, 0.07, 0.16);
      box(head, 0.1, 0.1, 0.04, dark, s * 0.14, 0.16, 0.1);
    }
    for (const lx of [-0.16, 0.16]) for (const lz of [-0.24, 0.24]) {
      const hip = group(body, lx, 0.44, lz);
      box(hip, 0.13, 0.44, 0.15, pink, 0, -0.22, 0);
      legs.push(hip);
    }
    wander = 0.7; radius = 0.4;
  }

  const { root: _r, mesh, upload } = build(
    `animal-${kind}`, new THREE.Sphere(new THREE.Vector3(x, 0.7, z), radius * 3), { radius, opacity: 0.2 },
  );
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  let t = Math.random() * 8, dir = Math.random() * Math.PI * 2, moving = 0;
  upload();
  function update(dt, nav) {
    t += dt;
    // 走走停停：moving 是剩余步数，耗尽后发呆一会儿
    moving -= dt;
    if (moving <= 0) {
      moving = 0.8 + Math.random() * 2.4;
      dir = Math.random() * Math.PI * 2;
    }
    const speed = wander * dt;
    const nx = root.position.x + Math.sin(dir) * speed;
    const nz = root.position.z + Math.cos(dir) * speed;
    const ok = !nav || (nav.canStand(nx, nz) && Math.hypot(nx - x, nz - z) < 6);
    if (ok) {
      root.position.x = nx;
      root.position.z = nz;
      const goal = -dir + Math.PI;
      const diff = Math.atan2(Math.sin(goal - root.rotation.y), Math.cos(goal - root.rotation.y));
      root.rotation.y += diff * Math.min(1, dt * 8);
    } else { moving = 0; }
    // 走路的腿部交替 + 头部轻微摆动
    const stride = Math.sin(t * 6.5);
    legs.forEach((leg, i) => { leg.rotation.x = stride * 0.35 * (i % 2 ? 1 : -1); });
    if (head) head.rotation.x = Math.sin(t * 1.3) * 0.08;
    body.position.y = Math.abs(Math.sin(t * 6.5)) * 0.012;
    upload();
  }
  return { root, mesh, update };
}

// 擂台斗士的骨架、动作和战斗逻辑在 fighters.js；这里保留原有导出，
// 让 build.js 和测试不用改导入路径。
export { createFighterGolem, createFighterZombie, createArenaFighters } from './fighters.js';
