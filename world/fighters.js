// 擂台上的两名斗士：铁傀儡和僵尸。
//
// 造型不再是「整条胳膊/整条腿」一块，而是一副真正的骨架：骨盆 → 腰 →
// 胸 → 颈，肩 → 肘，髋 → 膝。每根骨头只做刚体旋转，关节处垫一块略大的
// 方块盖住接缝，所以弯肘、屈膝时不会裂开。整副骨架蒙在同一块 SkinnedMesh
// 上，一只斗士仍然只占一次 draw call（外加脚下的圆影）。
//
// 动作全部程序化：警戒架势、垫步、扭腰出拳、受击后仰、跪倒、起身。没有
// 关键帧文件，也不在每帧分配对象；状态机和姿势都是预先建好的数字。
import * as THREE from 'three';

const BLOB_GEO = new THREE.CircleGeometry(1, 16);
const BLOB_MAT = new THREE.MeshBasicMaterial({
  color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false,
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ---- 姿势 ----------------------------------------------------------------
// 一个姿势就是一组数字：body/chest/head 各三个欧拉角，两条胳膊各六个
// （肩 xyz、肘 xyz），两条腿各九个（髋 xyz、膝 xyz、踝 xyz）。bodyY 是
// 骨盆的额外下沉量，bodyZ 是前后重心。
function makePose() {
  return {
    body: [0, 0, 0], bodyY: 0, bodyZ: 0,
    chest: [0, 0, 0],
    head: [0, 0, 0],
    arms: [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]],
    // 髋 xyz、膝 xyz、踝 xyz：脚掌单独一根骨头，落地时能保持水平。
    legs: [[0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]],
  };
}

function copyPose(dst, src) {
  for (let i = 0; i < 3; i++) {
    dst.body[i] = src.body[i];
    dst.chest[i] = src.chest[i];
    dst.head[i] = src.head[i];
  }
  dst.bodyY = src.bodyY;
  dst.bodyZ = src.bodyZ;
  for (let a = 0; a < 2; a++) {
    for (let i = 0; i < 6; i++) dst.arms[a][i] = src.arms[a][i];
    for (let i = 0; i < 9; i++) dst.legs[a][i] = src.legs[a][i];
  }
}

// 指数趋近；dt <= 0 时直接对齐（首帧、重生）。
function settlePose(cur, goal, dt, rate) {
  const k = dt > 0 ? 1 - Math.exp(-dt * rate) : 1;
  for (let i = 0; i < 3; i++) {
    cur.body[i] += (goal.body[i] - cur.body[i]) * k;
    cur.chest[i] += (goal.chest[i] - cur.chest[i]) * k;
    cur.head[i] += (goal.head[i] - cur.head[i]) * k;
  }
  cur.bodyY += (goal.bodyY - cur.bodyY) * k;
  cur.bodyZ += (goal.bodyZ - cur.bodyZ) * k;
  for (let a = 0; a < 2; a++) {
    for (let i = 0; i < 6; i++) cur.arms[a][i] += (goal.arms[a][i] - cur.arms[a][i]) * k;
    for (let i = 0; i < 9; i++) cur.legs[a][i] += (goal.legs[a][i] - cur.legs[a][i]) * k;
  }
}

// ---- 骨架与蒙皮 ----------------------------------------------------------
// boneDefs 是相对父骨骼的静止位置；boxes 是相对所属骨骼的方块。两者都
// 在建模空间里算好再写进同一块 BufferGeometry，每个方块整块绑到一根
// 骨头上（权重 1），弯关节时方块之间不会互相拉扯变形。
const BONE = (name, parent, x, y, z) => ({ name, parent, x, y, z });
const PART = (bone, w, h, d, x, y, z, color) => ({ bone, w, h, d, x, y, z, color });

function buildRig({ name, boneDefs, boxes, dims, shadow }) {
  const root = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });

  // 每根骨头的静止世界位置（父级累加；静止旋转都是 0）。
  const rest = {};
  const boneIndex = new Map();
  boneDefs.forEach((def, i) => {
    boneIndex.set(def.name, i);
    const p = def.parent ? rest[def.parent] : [0, 0, 0];
    rest[def.name] = [p[0] + def.x, p[1] + def.y, p[2] + def.z];
  });

  const position = [], normal = [], color = [], index = [], skinIndex = [], skinWeight = [];
  const c = new THREE.Color();
  let base = 0;
  for (const b of boxes) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d);
    const r = rest[b.bone];
    g.translate(r[0] + b.x, r[1] + b.y, r[2] + b.z);
    const p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array;
    const bi = boneIndex.get(b.bone);
    c.set(b.color);
    for (let i = 0; i < p.length; i += 3) {
      position.push(p[i], p[i + 1], p[i + 2]);
      normal.push(n[i], n[i + 1], n[i + 2]);
      color.push(c.r, c.g, c.b);
      skinIndex.push(bi, 0, 0, 0);
      skinWeight.push(1, 0, 0, 0);
    }
    for (let i = 0; i < ix.length; i++) index.push(ix[i] + base);
    base += g.attributes.position.count;
    g.dispose();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geo.setIndex(index);
  geo.computeBoundingSphere();

  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.name = name;

  const bones = [];
  const byName = {};
  for (const def of boneDefs) {
    const bone = new THREE.Bone();
    bone.name = def.name;
    bone.position.set(def.x, def.y, def.z);
    bone.rotation.order = 'YXZ';
    const parent = def.parent ? byName[def.parent] : mesh;
    parent.add(bone);
    byName[def.name] = bone;
    bones.push(bone);
  }
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  // 蒙皮后的包围球比静止姿势略大：倒地、抬臂都还在里面。
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, dims.hipY + 0.35, 0), dims.radius ?? 2.2);
  mesh.frustumCulled = true;
  root.add(mesh);

  const shadowMesh = new THREE.Mesh(BLOB_GEO, BLOB_MAT);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = 0.014;
  shadowMesh.scale.set(shadow.sx ?? 1, shadow.sz ?? 1, 1);
  root.add(shadowMesh);

  const joints = {
    body: byName.body,
    chest: byName.chest,
    head: byName.head,
    arms: [
      { shoulder: byName.shoulderR, elbow: byName.elbowR },
      { shoulder: byName.shoulderL, elbow: byName.elbowL },
    ],
    legs: [
      { hip: byName.hipR, knee: byName.kneeR, ankle: byName.ankleR },
      { hip: byName.hipL, knee: byName.kneeL, ankle: byName.ankleL },
    ],
  };

  return { root, mesh, material, shadow: shadowMesh, bones: joints, dims, allBones: bones };
}

// ---- 铁傀儡斗士 ----------------------------------------------------------
function golemRig() {
  const iron = 0xd8d4c8, dark = 0x9d9a8e, vine = 0x5d7a37, flower = 0xb8392f, eye = 0x1a1f22;
  const HIP = 1.35, THIGH = 0.68, SHIN = 0.55, FOOT = 0.12;
  const WAIST = 0.16, NECK = 0.93, SHX = 0.66, SHY = 0.78, UPPER = 0.58;
  const boneDefs = [
    BONE('body', null, 0, HIP, 0),
    BONE('chest', 'body', 0, WAIST, 0),
    BONE('head', 'chest', 0, NECK, 0),
    BONE('shoulderR', 'chest', -SHX, SHY, 0),
    BONE('elbowR', 'shoulderR', 0, -UPPER, 0),
    BONE('shoulderL', 'chest', SHX, SHY, 0),
    BONE('elbowL', 'shoulderL', 0, -UPPER, 0),
    BONE('hipR', 'body', -0.27, 0, 0),
    BONE('kneeR', 'hipR', 0, -THIGH, 0),
    BONE('ankleR', 'kneeR', 0, -SHIN, 0),
    BONE('hipL', 'body', 0.27, 0, 0),
    BONE('kneeL', 'hipL', 0, -THIGH, 0),
    BONE('ankleL', 'kneeL', 0, -SHIN, 0),
  ];
  const boxes = [
    // 骨盆与腰带
    PART('body', 0.98, 0.34, 0.66, 0, 0, 0, iron),
    PART('body', 1.02, 0.12, 0.68, 0, 0.13, 0, dark),
    // 胸腔、肩台、胸口的藤蔓
    PART('chest', 1.04, 0.84, 0.68, 0, 0.42, 0, iron),
    PART('chest', 1.34, 0.26, 0.74, 0, 0.78, 0, iron),
    PART('chest', 0.9, 0.12, 0.7, 0, 0.92, 0, dark),
    PART('chest', 0.34, 0.32, 0.03, -0.12, 0.48, 0.345, vine),
    PART('chest', 0.22, 0.16, 0.03, 0.2, 0.34, 0.345, vine),
    PART('chest', 0.1, 0.1, 0.04, -0.2, 0.56, 0.355, flower),
    PART('chest', 0.5, 0.06, 0.06, 0, 0.86, 0.37, dark),
    // 头
    PART('head', 0.56, 0.5, 0.5, 0, 0.25, 0, iron),
    PART('head', 0.52, 0.1, 0.52, 0, 0.02, 0, dark),
    PART('head', 0.1, 0.07, 0.02, -0.12, 0.3, 0.255, eye),
    PART('head', 0.1, 0.07, 0.02, 0.12, 0.3, 0.255, eye),
    PART('head', 0.1, 0.16, 0.08, 0, 0.18, 0.27, dark),
    // 胳膊：肩块 + 上臂 / 肘块 + 前臂 + 拳头
    ...[-1, 1].flatMap((s) => {
      const sh = s < 0 ? 'shoulderR' : 'shoulderL';
      const el = s < 0 ? 'elbowR' : 'elbowL';
      return [
        PART(sh, 0.36, 0.3, 0.36, 0, 0, 0, dark),
        PART(sh, 0.28, UPPER, 0.3, 0, -UPPER / 2, 0, iron),
        PART(el, 0.32, 0.26, 0.32, 0, 0, 0, dark),
        PART(el, 0.26, 0.52, 0.28, 0, -0.26, 0, iron),
        PART(el, 0.3, 0.22, 0.32, 0, -0.59, 0.02, dark),
      ];
    }),
    // 腿：髋块 + 大腿 / 膝块 + 小腿 + 脚
    ...[-1, 1].flatMap((s) => {
      const hip = s < 0 ? 'hipR' : 'hipL';
      const knee = s < 0 ? 'kneeR' : 'kneeL';
      const ankle = s < 0 ? 'ankleR' : 'ankleL';
      return [
        PART(hip, 0.36, 0.3, 0.36, 0, 0, 0, dark),
        PART(hip, 0.32, THIGH, 0.34, 0, -THIGH / 2, 0, iron),
        PART(knee, 0.34, 0.26, 0.36, 0, 0, 0, dark),
        PART(knee, 0.3, SHIN, 0.32, 0, -SHIN / 2, 0, iron),
        PART(ankle, 0.34, FOOT, 0.46, 0, -FOOT / 2, 0.08, dark),
      ];
    }),
  ];
  return buildRig({
    name: 'iron-golem-fighter',
    boneDefs, boxes,
    dims: { hipY: HIP, thigh: THIGH, shin: SHIN, foot: FOOT, radius: 2.6 },
    shadow: { sx: 1.15, sz: 0.9 },
  });
}

// ---- 僵尸斗士 ------------------------------------------------------------
function zombieRig() {
  const skin = 0x4f7a3f, dark = 0x35522a, shirt = 0x6b8aa0, pants = 0x3a3f4a, eye = 0x1a1a1a;
  const HIP = 0.94, THIGH = 0.46, SHIN = 0.38, FOOT = 0.10;
  const WAIST = 0.12, NECK = 0.62, SHX = 0.34, SHY = 0.5, UPPER = 0.4;
  const boneDefs = [
    BONE('body', null, 0, HIP, 0),
    BONE('chest', 'body', 0, WAIST, 0),
    BONE('head', 'chest', 0, NECK, 0),
    BONE('shoulderR', 'chest', -SHX, SHY, 0),
    BONE('elbowR', 'shoulderR', 0, -UPPER, 0),
    BONE('shoulderL', 'chest', SHX, SHY, 0),
    BONE('elbowL', 'shoulderL', 0, -UPPER, 0),
    BONE('hipR', 'body', -0.15, 0, 0),
    BONE('kneeR', 'hipR', 0, -THIGH, 0),
    BONE('ankleR', 'kneeR', 0, -SHIN, 0),
    BONE('hipL', 'body', 0.15, 0, 0),
    BONE('kneeL', 'hipL', 0, -THIGH, 0),
    BONE('ankleL', 'kneeL', 0, -SHIN, 0),
  ];
  const boxes = [
    PART('body', 0.5, 0.28, 0.34, 0, 0, 0, pants),
    PART('body', 0.52, 0.12, 0.36, 0, 0.1, 0, dark),
    PART('chest', 0.54, 0.6, 0.38, 0, 0.32, 0, shirt),
    PART('chest', 0.56, 0.08, 0.4, 0, 0.03, 0, dark),
    PART('chest', 0.3, 0.08, 0.3, 0, 0.62, 0.02, skin),
    PART('head', 0.44, 0.44, 0.42, 0, 0.22, 0, skin),
    PART('head', 0.07, 0.09, 0.02, -0.11, 0.25, 0.215, eye),
    PART('head', 0.07, 0.09, 0.02, 0.11, 0.25, 0.215, eye),
    PART('head', 0.16, 0.03, 0.02, 0, 0.1, 0.215, dark),
    ...[-1, 1].flatMap((s) => {
      const sh = s < 0 ? 'shoulderR' : 'shoulderL';
      const el = s < 0 ? 'elbowR' : 'elbowL';
      return [
        PART(sh, 0.2, 0.18, 0.22, 0, 0, 0, shirt),
        PART(sh, 0.18, UPPER, 0.2, 0, -UPPER / 2, 0, skin),
        PART(el, 0.19, 0.16, 0.21, 0, 0, 0, skin),
        PART(el, 0.17, 0.36, 0.19, 0, -0.18, 0, skin),
        PART(el, 0.19, 0.16, 0.2, 0, -0.4, 0.02, skin),
      ];
    }),
    ...[-1, 1].flatMap((s) => {
      const hip = s < 0 ? 'hipR' : 'hipL';
      const knee = s < 0 ? 'kneeR' : 'kneeL';
      const ankle = s < 0 ? 'ankleR' : 'ankleL';
      return [
        PART(hip, 0.22, 0.2, 0.24, 0, 0, 0, pants),
        PART(hip, 0.2, THIGH, 0.22, 0, -THIGH / 2, 0, pants),
        PART(knee, 0.21, 0.16, 0.23, 0, 0, 0, pants),
        PART(knee, 0.19, SHIN, 0.21, 0, -SHIN / 2, 0, pants),
        PART(ankle, 0.22, FOOT, 0.32, 0, -FOOT / 2, 0.06, dark),
      ];
    }),
  ];
  return buildRig({
    name: 'zombie-fighter',
    boneDefs, boxes,
    dims: { hipY: HIP, thigh: THIGH, shin: SHIN, foot: FOOT, radius: 2.0 },
    shadow: { sx: 1.0, sz: 1.0 },
  });
}

// ---- 风格与招式 ----------------------------------------------------------
const GOLEM_STYLE = {
  seed: 0.7,
  speed: 1.0, turn: 5.2, range: 1.75, separation: 1.02,
  hurtTime: 0.42, hurtPush: 0.95, respawn: 3.2, riseTime: 1.15,
  startDelay: 0.85, attackOffset: 2, circleDir: 1, circleTime: 2.8,
  headHeight: 2.65,
  guard: {
    hip: -0.16, knee: 0.36, hipZ: 0.06, chest: 0.07, head: -0.02,
    shoulder: -0.78, shoulderZ: 0.13, elbow: -1.65, elbowZ: 0.04,
  },
  gait: { stride: 0.5, knee: 0.7, arm: 0.18, bob: 0.02, freq: 6.5 },
  attacks: [
    { kind: 'overhead', arm: 0, wind: 0.34, strike: 0.18, recover: 0.55, damage: 20, reach: 2.1, lunge: 0.45, twist: 0.1, rest: 0.5 },
    { kind: 'hook', arm: 0, wind: 0.26, strike: 0.13, recover: 0.42, damage: 16, reach: 2.0, lunge: 0.35, twist: 0.55, rest: 0.35 },
    { kind: 'straight', arm: 1, wind: 0.18, strike: 0.1, recover: 0.32, damage: 11, reach: 2.0, lunge: 0.3, twist: 0.45, rest: 0.3 },
  ],
  death: {
    pitch: -1.1, drop: 0.55, chest: -0.2, head: 0.35, headYaw: -0.25, headRoll: 0.12,
    hip: -0.9, knee: 1.55, hipZ: 0.22,
    shoulder: 0.35, shoulderZ: 0.55, elbow: -0.35,
  },
};

const ZOMBIE_STYLE = {
  seed: 2.1, twitch: true,
  speed: 1.3, turn: 7.2, range: 1.55, separation: 0.92,
  hurtTime: 0.3, hurtPush: 1.25, respawn: 2.8, riseTime: 0.95,
  startDelay: 0.55, attackOffset: 0, circleDir: -1, circleTime: 2.2,
  headHeight: 1.95,
  guard: {
    hip: -0.22, knee: 0.46, hipZ: 0.04, chest: 0.12, head: 0.04,
    shoulder: -1.0, shoulderZ: 0.07, elbow: -0.55, elbowZ: 0.03,
  },
  gait: { stride: 0.55, knee: 0.8, arm: 0.22, bob: 0.03, freq: 8.5 },
  attacks: [
    { kind: 'flail', arm: 0, wind: 0.1, strike: 0.08, recover: 0.2, damage: 8, reach: 1.65, lunge: 0.5, twist: 0.6, rest: 0.18 },
    { kind: 'lunge', arm: 1, wind: 0.16, strike: 0.1, recover: 0.28, damage: 13, reach: 1.75, lunge: 0.8, twist: 0.2, rest: 0.25 },
    { kind: 'hook', arm: 1, wind: 0.12, strike: 0.08, recover: 0.22, damage: 10, reach: 1.65, lunge: 0.55, twist: 0.65, rest: 0.2 },
  ],
  death: {
    pitch: 1.2, drop: 0.4, chest: 0.45, head: 0.5, headYaw: 0.3, headRoll: -0.15,
    hip: -0.6, knee: 1.2, hipZ: 0.18,
    shoulder: 0.55, shoulderZ: 0.45, elbow: -0.2,
  },
};

// ---- 姿态：警戒、走步、出拳、受击、倒地 -----------------------------------
function guardPose(goal, style, t, seed) {
  const g = style.guard;
  const sway = Math.sin(t * 1.6 + seed);
  const breathe = Math.sin(t * 2.1 + seed);
  goal.body[0] = g.chest * 0.25;
  goal.body[1] = 0;
  goal.body[2] = sway * 0.012;
  goal.bodyY = breathe * 0.006;
  goal.bodyZ = 0;
  goal.chest[0] = g.chest + breathe * 0.008;
  goal.chest[1] = sway * 0.015;
  goal.chest[2] = 0;
  goal.head[0] = g.head - breathe * 0.005;
  goal.head[1] = sway * 0.03;
  goal.head[2] = 0;
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    goal.arms[i][0] = g.shoulder + breathe * 0.01;
    goal.arms[i][1] = 0;
    goal.arms[i][2] = side * g.shoulderZ;
    goal.arms[i][3] = g.elbow;
    goal.arms[i][4] = 0;
    goal.arms[i][5] = side * g.elbowZ;
    goal.legs[i][0] = g.hip + sway * 0.01 * side;
    goal.legs[i][1] = 0;
    goal.legs[i][2] = side * g.hipZ;
    goal.legs[i][3] = g.knee;
    goal.legs[i][4] = 0;
    goal.legs[i][5] = 0;
    // 踝关节反向抵消髋和膝，脚掌始终踩平。
    goal.legs[i][6] = -(goal.legs[i][0] + goal.legs[i][3]);
    goal.legs[i][7] = 0;
    goal.legs[i][8] = -goal.legs[i][2];
  }
  // 僵尸不是标准站姿：头会歪，胳膊会抽。
  if (style.twitch) {
    goal.head[2] = Math.sin(t * 2.7 + seed) * 0.05;
    goal.arms[0][0] += Math.sin(t * 1.3 + seed) * 0.06;
    goal.arms[1][0] += Math.sin(t * 1.1 + seed + 1) * 0.06;
  }
}

// 垫步：前後摆腿、抬膝、身体上下、胸腔反向扭转，胳膊反向摆。
function applyGait(goal, style, phase, forward, side, amount) {
  if (amount <= 0.001) return;
  const g = style.gait;
  const s = Math.sin(phase);
  const dir = forward < 0 ? -1 : 1;
  for (let i = 0; i < 2; i++) {
    const sign = i === 0 ? 1 : -1;
    const swing = s * sign * dir;
    goal.legs[i][0] += -swing * g.stride * amount;
    goal.legs[i][2] += -side * sign * 0.12 * amount;
    goal.legs[i][3] += Math.max(0, swing) * g.knee * amount;
    goal.legs[i][6] = -(goal.legs[i][0] + goal.legs[i][3]) - Math.max(0, swing) * 0.12 * amount;
    goal.legs[i][8] = -goal.legs[i][2];
    goal.arms[i][0] += swing * g.arm * amount;
  }
  goal.chest[1] += -s * 0.05 * amount;
  goal.body[2] += side * 0.03 * amount;
  goal.bodyY += Math.abs(s) * g.bob * amount;
}

// 出拳。所有数值都在这里算，不建临时对象；动作分成蓄力、命中、收招
// 三段，命中段把肩、肘、腰、胯一起送出去。
function applyAttack(goal, style, attack, u) {
  const g = style.guard;
  const arm = attack.arm;
  const side = arm === 0 ? -1 : 1;
  const twistSign = arm === 0 ? 1 : -1;
  const w = attack.wind, s = attack.strike, r = attack.recover;
  const sEnd = w + s;

  let windSx = g.shoulder, windSz = side * g.shoulderZ, windEx = g.elbow;
  let hitSx = g.shoulder, hitSz = side * g.shoulderZ, hitEx = g.elbow;
  let windChestY = 0, hitChestY = 0;
  let windBodyX = 0, hitBodyX = 0, windBodyY = 0, hitBodyY = 0;
  let both = false;

  switch (attack.kind) {
    case 'straight':
      windSx = g.shoulder + 0.3; windSz = side * g.shoulderZ; windEx = g.elbow - 0.35;
      windChestY = -attack.twist * 0.7 * twistSign; windBodyX = -0.02;
      hitSx = -1.55; hitSz = side * 0.05; hitEx = -0.08;
      hitChestY = attack.twist * twistSign; hitBodyX = 0.16; hitBodyY = 0.01;
      break;
    case 'hook':
      // 右拳先向外侧拉开，再横着扫过身体；左拳相反。
      windSx = -1.0; windSz = side * 0.45; windEx = -1.45;
      windChestY = -attack.twist * 0.8 * twistSign;
      hitSx = -1.1; hitSz = -side * 0.95; hitEx = -1.0;
      hitChestY = attack.twist * 1.1 * twistSign; hitBodyX = 0.12; hitBodyY = 0.01;
      break;
    case 'flail':
      windSx = -1.4; windSz = side * 0.9; windEx = -0.3;
      windChestY = attack.twist * twistSign; windBodyX = 0.05;
      hitSx = -0.9; hitSz = -side * 1.1; hitEx = -0.9;
      hitChestY = -attack.twist * 0.9 * twistSign; hitBodyX = 0.18;
      break;
    case 'overhead':
      both = true;
      windSx = -2.65; windEx = -0.35; windBodyX = -0.12;
      hitSx = -0.55; hitEx = -0.15; hitBodyX = 0.38; hitBodyY = -0.05;
      break;
    case 'lunge':
      both = true;
      windSx = -0.9; windEx = -1.8; windBodyX = -0.06;
      hitSx = -1.5; hitEx = -0.12; hitBodyX = 0.3; hitBodyY = -0.03;
      break;
  }

  let k, sx, sz, ex, chestY, bodyX, bodyY;
  if (u < w) {
    k = smooth(u / w);
    sx = lerp(g.shoulder, windSx, k); sz = lerp(side * g.shoulderZ, windSz, k);
    ex = lerp(g.elbow, windEx, k); chestY = lerp(0, windChestY, k);
    bodyX = lerp(0, windBodyX, k); bodyY = lerp(0, windBodyY, k);
  } else if (u < sEnd) {
    k = smooth((u - w) / s);
    sx = lerp(windSx, hitSx, k); sz = lerp(windSz, hitSz, k);
    ex = lerp(windEx, hitEx, k); chestY = lerp(windChestY, hitChestY, k);
    bodyX = lerp(windBodyX, hitBodyX, k); bodyY = lerp(windBodyY, hitBodyY, k);
  } else {
    k = smooth((u - sEnd) / r);
    sx = lerp(hitSx, g.shoulder, k); sz = lerp(hitSz, side * g.shoulderZ, k);
    ex = lerp(hitEx, g.elbow, k); chestY = lerp(hitChestY, 0, k);
    bodyX = lerp(hitBodyX, 0, k); bodyY = lerp(hitBodyY, 0, k);
  }

  goal.arms[arm][0] = sx;
  goal.arms[arm][1] = 0;
  goal.arms[arm][2] = sz;
  goal.arms[arm][3] = ex;
  goal.arms[arm][4] = 0;
  goal.arms[arm][5] = side * g.elbowZ;
  if (both) {
    const other = 1 - arm;
    goal.arms[other][0] = sx;
    goal.arms[other][1] = 0;
    goal.arms[other][2] = sz;
    goal.arms[other][3] = ex;
    goal.arms[other][4] = 0;
    goal.arms[other][5] = side * g.elbowZ;
  }

  goal.chest[1] += chestY * 0.72;
  goal.body[1] += chestY * 0.3;
  goal.body[0] += bodyX;
  goal.bodyY += bodyY;
  goal.chest[0] += bodyX * 0.3;
  goal.head[1] -= chestY * 0.32;
}

// 受击：头先甩，胸腔后仰，胳膊被打散，膝盖弯一下。
function applyHurt(goal, style, p) {
  const flinch = Math.sin(clamp(p * 1.7, 0, 1) * Math.PI);
  goal.body[0] -= flinch * 0.18;
  goal.body[2] += flinch * 0.07;
  goal.chest[0] -= flinch * 0.12;
  goal.chest[1] += flinch * 0.28;
  goal.head[0] -= flinch * 0.28;
  goal.head[2] += flinch * 0.12;
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    goal.arms[i][0] += flinch * 0.32;
    goal.arms[i][2] += side * flinch * 0.18;
    goal.arms[i][3] += flinch * 0.22;
    goal.legs[i][0] -= flinch * 0.08;
    goal.legs[i][3] += flinch * 0.18;
    goal.legs[i][6] = -(goal.legs[i][0] + goal.legs[i][3]);
  }
  goal.bodyY -= flinch * 0.035;
}

// 倒地：先屈膝塌下去，再向后/向前倒，最后摊平。与受击分开，因为死亡
// 不需要回弹，而且要保证身体落在地面之上。
function applyDeath(goal, style, p) {
  const d = style.death;
  const buckle = smooth(Math.min(1, p / 0.35));
  const fall = smooth(clamp((p - 0.2) / 0.55, 0, 1));
  const settle = smooth(clamp((p - 0.7) / 0.3, 0, 1));
  goal.body[0] = lerp(0, d.pitch, fall) + settle * 0.06;
  goal.body[1] = 0;
  goal.body[2] = d.roll ? d.roll * fall : 0;
  goal.bodyY = -lerp(0, d.drop, fall) + Math.sin(p * Math.PI * 3) * 0.018 * (1 - settle);
  goal.chest[0] = lerp(0, d.chest, fall);
  goal.chest[1] = d.headYaw * 0.25 * fall;
  goal.head[0] = lerp(0, d.head, fall);
  goal.head[1] = d.headYaw * fall;
  goal.head[2] = d.headRoll * fall;
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    goal.arms[i][0] = lerp(style.guard.shoulder, d.shoulder, fall);
    goal.arms[i][2] = side * lerp(style.guard.shoulderZ, d.shoulderZ, fall);
    goal.arms[i][3] = lerp(style.guard.elbow, d.elbow, fall);
    goal.legs[i][0] = lerp(style.guard.hip, d.hip, buckle);
    goal.legs[i][2] = side * lerp(style.guard.hipZ, d.hipZ, fall);
    goal.legs[i][3] = lerp(style.guard.knee, d.knee, buckle);
    goal.legs[i][6] = -(goal.legs[i][0] + goal.legs[i][3]) * 0.45;
    goal.legs[i][8] = -goal.legs[i][2] * 0.5;
  }
}

// ---- 斗士控制器 ----------------------------------------------------------
function createFighter({ rig, style, home, foeRef, arena }) {
  const { root, mesh, material, bones, dims } = rig;
  const pose = makePose(), goal = makePose();
  let hp = 100, state = 'FIGHT', timer = 0, cooldown = style.startDelay;
  let phase = 0, attack = null, attackT = 0, attackHit = false, attackIndex = style.attackOffset;
  let hurtT = 0, hurtX = 0, hurtZ = 0, deathT = 0, riseT = 0;
  let vx = 0, vz = 0, flash = 0, circleDir = style.circleDir, circleT = 0;

  // 站姿高度：脚底贴地时骨盆离地多高。膝盖弯得越深，骨盆越低，
  // 所以蹲伏时脚不会浮起来。
  function stanceHeight() {
    let h = 0;
    for (let i = 0; i < 2; i++) {
      const hip = pose.legs[i][0], knee = pose.legs[i][3], hipZ = pose.legs[i][2];
      const hi = dims.foot
        + (dims.thigh * Math.cos(hip) + dims.shin * Math.cos(hip + knee)) * Math.cos(hipZ);
      if (hi > h) h = hi;
    }
    return h;
  }

  function applyBones(dt) {
    bones.body.rotation.set(pose.body[0], pose.body[1], pose.body[2]);
    bones.body.position.set(0, Math.max(0.12, stanceHeight() + pose.bodyY), pose.bodyZ);
    bones.chest.rotation.set(pose.chest[0], pose.chest[1], pose.chest[2]);
    bones.head.rotation.set(pose.head[0], pose.head[1], pose.head[2]);
    for (let i = 0; i < 2; i++) {
      const a = pose.arms[i], l = pose.legs[i];
      bones.arms[i].shoulder.rotation.set(a[0], a[1], a[2]);
      bones.arms[i].elbow.rotation.set(a[3], a[4], a[5]);
      bones.legs[i].hip.rotation.set(l[0], l[1], l[2]);
      bones.legs[i].knee.rotation.set(l[3], l[4], l[5]);
      bones.legs[i].ankle.rotation.set(l[6], l[7], l[8]);
    }
    // 每帧用蒙皮包围盒做一次落地修正，保证脚、手和倒地时的身体不会
    // 压进台面。两个斗士总共只有一千多个顶点，这点开销可以忽略。
    root.updateMatrixWorld(true);
    mesh.skeleton.update();
    mesh.computeBoundingBox();
    // 包围盒在 mesh 的局部空间里；mesh 的原点就是脚下，所以地面是 y=0。
    const floor = 0.005;
    const low = mesh.boundingBox.min.y;
    if (low < floor) {
      bones.body.position.y += floor - low;
      root.updateMatrixWorld(true);
      mesh.skeleton.update();
    }
    if (flash > 0) {
      flash = Math.max(0, flash - dt * 3.6);
      material.emissive.setRGB(flash * 0.4, flash * 0.035, flash * 0.02);
    } else if (material.emissive.r > 0) {
      material.emissive.setRGB(0, 0, 0);
    }
  }

  function reset(rise) {
    hp = 100; state = rise ? 'RISE' : 'FIGHT'; timer = 0; cooldown = rise ? 0.35 : style.startDelay;
    attack = null; attackT = 0; attackHit = false; hurtT = 0; deathT = 0; riseT = 0;
    vx = 0; vz = 0; flash = 0; circleT = 0; circleDir = style.circleDir;
    root.position.set(home.x, home.y ?? 0, home.z);
    root.rotation.y = home.yaw;
    guardPose(goal, style, 0, style.seed);
    copyPose(pose, goal);
    if (rise) {
      // 从地上撑起来：先单膝蹲着，再站直。屈膝本身就会把骨盆降下来，
      // 不再额外下压 bodyY，否则脚会穿进台面。
      pose.bodyY = 0;
      pose.body[0] = 0.22;
      pose.chest[0] = 0.2;
      pose.head[0] = 0.25;
      pose.legs[0][0] = -0.7; pose.legs[0][3] = 1.15;
      pose.legs[1][0] = -0.35; pose.legs[1][3] = 0.75;
      pose.legs[0][6] = -(pose.legs[0][0] + pose.legs[0][3]);
      pose.legs[1][6] = -(pose.legs[1][0] + pose.legs[1][3]);
      pose.arms[0][0] = -0.3; pose.arms[0][3] = -0.6;
      pose.arms[1][0] = -0.3; pose.arms[1][3] = -0.6;
    }
    applyBones(0);
  }

  function startAttack(atk) {
    attack = atk; attackT = 0; attackHit = false; state = 'ATTACK';
    cooldown = atk.wind + atk.strike + atk.recover + (atk.rest ?? 0.25);
  }

  function hurt(dmg, fromX = root.position.x, fromZ = root.position.z - 1) {
    if (state === 'DEAD' || state === 'RISE') return;
    hp -= dmg;
    flash = 1;
    if (hp <= 0) {
      hp = 0; state = 'DEAD'; deathT = 0; attack = null; vx = 0; vz = 0;
      return;
    }
    // 出拳一旦开始就不容易被一记轻拳打断：铁傀儡能顶着僵尸的连击把
    // 锤子砸完，僵尸也能把一套连击打完。这样双方都有还手的机会。
    if (state === 'ATTACK') return;
    const dx = root.position.x - fromX, dz = root.position.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    hurtX = dx / d; hurtZ = dz / d;
    hurtT = 0; state = 'HURT'; attack = null;
    cooldown = Math.max(cooldown, 0.25);
  }

  function updateDead(dt) {
    deathT += dt;
    const p = Math.min(1, deathT / 0.95);
    guardPose(goal, style, timer, style.seed);
    applyDeath(goal, style, p);
    settlePose(pose, goal, dt, 6);
    applyBones(dt);
    if (deathT >= style.respawn) reset(true);
  }

  function updateRise(dt) {
    riseT += dt;
    guardPose(goal, style, timer, style.seed);
    settlePose(pose, goal, dt, 3.6);
    applyBones(dt);
    if (riseT >= style.riseTime) { state = 'FIGHT'; cooldown = 0.45; }
  }

  function update(dt, nav, player) {
    timer += dt;
    if (state === 'DEAD') { updateDead(dt); return; }
    if (state === 'RISE') { updateRise(dt); return; }
    const foe = foeRef.get();
    if (!foe) {
      guardPose(goal, style, timer, style.seed);
      settlePose(pose, goal, dt, 8);
      applyBones(dt);
      return;
    }

    const dx = foe.root.position.x - root.position.x;
    const dz = foe.root.position.z - root.position.z;
    const d = Math.max(0.001, Math.hypot(dx, dz));
    const fx = dx / d, fz = dz / d;

    // 始终面向对手；出拳时胸腔再额外扭。
    const goalYaw = Math.atan2(dx, dz);
    const diff = Math.atan2(Math.sin(goalYaw - root.rotation.y), Math.cos(goalYaw - root.rotation.y));
    root.rotation.y += diff * Math.min(1, dt * style.turn);

    let targetVx = 0, targetVz = 0;

    if (state === 'HURT') {
      hurtT += dt;
      const p = hurtT / style.hurtTime;
      const push = Math.max(0, 1 - p) * style.hurtPush;
      targetVx = hurtX * push;
      targetVz = hurtZ * push;
      if (hurtT >= style.hurtTime) { state = 'FIGHT'; cooldown = Math.max(cooldown, 0.12); }
    } else if (state === 'ATTACK') {
      attackT += dt;
      const sEnd = attack.wind + attack.strike;
      if (attackT > attack.wind && attackT < sEnd) {
        const sp = Math.sin(Math.PI * (attackT - attack.wind) / attack.strike);
        const step = attack.lunge * sp * dt / attack.strike;
        root.position.x += fx * step;
        root.position.z += fz * step;
      }
      if (!attackHit && attackT >= attack.wind + attack.strike * 0.55) {
        attackHit = true;
        if (!foe.isDead() && Math.hypot(foe.root.position.x - root.position.x, foe.root.position.z - root.position.z) <= attack.reach + 0.15) {
          foe.hurt(attack.damage, root.position.x, root.position.z);
        }
      }
      if (attackT >= attack.wind + attack.strike + attack.recover) {
        cooldown = attack.rest ?? 0.25;
        state = 'FIGHT'; attack = null;
      }
    } else {
      cooldown -= dt;
      // 保持在攻击距离上；太远就压上，太近就退半步。
      let radial = 0;
      if (d > style.range + 0.15) radial = 1;
      else if (d < style.range - 0.3) radial = -0.7;
      // 绕着对手转，不要一直正对着推。
      circleT += dt;
      if (circleT > style.circleTime) { circleT = 0; circleDir *= -1; }
      const tangent = d < style.range + 0.55 ? circleDir * 0.45 : 0;
      targetVx = (fx * radial + fz * tangent) * style.speed;
      targetVz = (fz * radial - fx * tangent) * style.speed;
      if (cooldown <= 0 && d < style.range + 0.4) {
        const atk = style.attacks[attackIndex % style.attacks.length];
        attackIndex++;
        if (d < atk.reach + 0.3) startAttack(atk);
        else cooldown = 0.25;
      }
    }

    const accel = 1 - Math.exp(-dt * 7);
    vx += (targetVx - vx) * accel;
    vz += (targetVz - vz) * accel;
    root.position.x += vx * dt;
    root.position.z += vz * dt;

    // 两个人不能穿模。
    const sepX = foe.root.position.x - root.position.x;
    const sepZ = foe.root.position.z - root.position.z;
    const sepD = Math.hypot(sepX, sepZ);
    if (sepD < style.separation && sepD > 0.001) {
      const push = (style.separation - sepD) * 0.5;
      root.position.x -= sepX / sepD * push;
      root.position.z -= sepZ / sepD * push;
    }

    if (arena) {
      const margin = 0.75;
      const minX = arena.cx - arena.half + margin, maxX = arena.cx + arena.half - margin;
      const minZ = arena.cz - arena.half + margin, maxZ = arena.cz + arena.half - margin;
      if (root.position.x < minX || root.position.x > maxX) circleDir *= -1;
      if (root.position.z < minZ || root.position.z > maxZ) circleDir *= -1;
      root.position.x = clamp(root.position.x, minX, maxX);
      root.position.z = clamp(root.position.z, minZ, maxZ);
    }

    // 姿势：先摆警戒，再叠加步法、出拳或受击。
    guardPose(goal, style, timer, style.seed);
    const speedNow = Math.hypot(vx, vz);
    if (speedNow > 0.03) {
      const amount = clamp(speedNow / style.speed, 0, 1);
      const forward = vx * fx + vz * fz;
      const side = vx * -fz + vz * fx;
      applyGait(goal, style, phase, forward, side / Math.max(speedNow, 0.001), amount);
      phase += dt * style.gait.freq * (0.35 + 0.65 * amount);
    }
    if (state === 'ATTACK' && attack) applyAttack(goal, style, attack, attackT);
    if (state === 'HURT') applyHurt(goal, style, hurtT / style.hurtTime);

    let rate = 14;
    if (state === 'ATTACK') rate = attackT < attack.wind ? 20 : 28;
    if (state === 'HURT') rate = 26;
    settlePose(pose, goal, dt, rate);
    applyBones(dt);
  }

  reset(false);
  return {
    root, mesh, bones, style, update,
    isDead: () => state === 'DEAD',
    hurt,
    get hp() { return hp; },
    get state() { return state; },
    get cooldown() { return cooldown; },
    get attackIndex() { return attackIndex; },
    sync() { root.updateMatrixWorld(true); mesh.skeleton.update(); },
  };
}

// ---- 对外组装 ------------------------------------------------------------
export function createFighterGolem({ x, z, yaw, y, foeRef, arena }) {
  return createFighter({ rig: golemRig(), style: GOLEM_STYLE, home: { x, z, yaw, y }, foeRef, arena });
}

export function createFighterZombie({ x, z, yaw, y, foeRef, arena }) {
  return createFighter({ rig: zombieRig(), style: ZOMBIE_STYLE, home: { x, z, yaw, y }, foeRef, arena });
}

// 把两个斗士接成一对：各自通过 foeRef 指向对方。引用必须最后再接，
// 否则创建第二个时第一个还拿不到对手。
export function createArenaFighters(arena) {
  const golemRef = { get: () => null }, zombieRef = { get: () => null };
  const golem = createFighterGolem({ ...arena.golem, foeRef: zombieRef, arena });
  const zombie = createFighterZombie({ ...arena.zombie, foeRef: golemRef, arena });
  golemRef.get = () => golem;
  zombieRef.get = () => zombie;
  return { golem, zombie };
}
