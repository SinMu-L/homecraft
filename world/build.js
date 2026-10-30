// 极目的书房：一面书架墙、一张书桌、一块显示最新文章的公告板。
// 依据 docs/worlds.md 的 World API 编写；坐标可按需微调。
import * as THREE from 'three';
import { buildIsland } from '@engine/world/terrain.js';
import { buildForest } from '@engine/world/landscape.js';
import { BoxBatch } from '@engine/world/blocks.js';
import { canvasTexture } from '@engine/world/textures.js';
import { pixelText } from '@engine/world/pixel-text.js';
import { ISLAND, TREES } from './layout.js';
import posts from './posts.js';

export function build({ grid, layer }) {
  buildIsland(grid, ISLAND, { surfaceAt: () => 'grass', corner: 10, wobble: 0 });
  const forest = buildForest(grid, layer, TREES);

  // 书房：x -5..4，z 6..14，朝南开门，不封顶（第三人称镜头不会被挡）。
  grid.fill(-4, -1, 7, 4, 0, 13, 'planks'); // 室内地板：替换草方块，地面仍在 y = 0
  grid.fill(-5, 0, 6, 5, 3, 7, 'plaster'); // 后墙
  grid.fill(-5, 0, 6, -1, 3, 7, 'bookshelf'); // 后墙西侧：整面书架
  grid.fill(-5, 0, 6, -4, 3, 14, 'plaster'); // 左墙
  grid.fill(4, 0, 6, 5, 3, 14, 'plaster'); // 右墙
  grid.fill(-5, 0, 13, 5, 3, 14, 'plaster'); // 前墙
  grid.fill(0, 0, 13, 2, 3, 14, null); // 两米宽的门（正对出生点）
  grid.fill(0, -1, 14, 2, 0, 18, 'pavers'); // 门口到出生点的小路

  // 书桌靠右墙（BoxBatch：y 是底面）
  const B = new BoxBatch(layer);
  B.box(3.0, 0, 9.5, 0.8, 0.75, 1.8, { tex: 'oak', top: 'wood_panel' });

  // 公告板和"电脑屏幕"各是一张贴图平面：两台 draw call
  const planes = [
    panel(1.2, 2.0, 7.02, 4.4, 1.8, boardTexture()),
    panel(3.3, 1.25, 9.5, 1.2, 0.7, screenTexture(), -Math.PI / 2),
  ];

  return {
    batches: { static: B },
    planes,
    obstacles: [{ x0: 2.55, x1: 3.45, z0: 8.55, z1: 10.45, level: 0 }],
    hotspots: [
      { id: 'library', box: new THREE.Box3(new THREE.Vector3(-5, 0, 6), new THREE.Vector3(-2, 3, 7.4)) },
      { id: 'blog', box: new THREE.Box3(new THREE.Vector3(2.5, 0, 8.5), new THREE.Vector3(3.6, 2, 10.5)) },
    ],
    forest,
  };
}

function panel(x, y, z, w, h, map, ry = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  return mesh;
}

// 墙上那块木板：标题用像素字，正文用系统字体（像素字体没有中文）。
function boardTexture() {
  return canvasTexture(
    880,
    360,
    (ctx, w, h) => {
      ctx.fillStyle = '#2f2a24';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#6b5636';
      ctx.lineWidth = 12;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      pixelText(ctx, 'LATEST POSTS', 28, 26, 3, '#e9d9ae');
      posts.slice(0, 6).forEach((p, i) => {
        const y = 104 + i * 40;
        ctx.font = '500 20px "Microsoft YaHei", "PingFang SC", sans-serif';
        ctx.fillStyle = '#b9a781';
        ctx.fillText(p.date, 28, y);
        ctx.fillStyle = '#f4ead2';
        ctx.fillText(p.title, 140, y, w - 168);
      });
    },
    { pixelated: false },
  );
}

function screenTexture() {
  return canvasTexture(
    448,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#11161b';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#2b3a46';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, w - 8, h - 8);
      pixelText(ctx, 'BLOG', 28, 30, 5, '#7fd1ff');
      pixelText(ctx, 'SINMU.XYZ', 28, 96, 3, '#d9e6f2');
      ctx.font = '500 18px "Microsoft YaHei", "PingFang SC", sans-serif';
      ctx.fillStyle = '#9fb3c8';
      ctx.fillText('按 F 打开博客', 28, 200);
    },
    { pixelated: false },
  );
}
