#!/usr/bin/env node
// 从 Gmeek 博客同步文章清单，生成 world/posts.js。
// 用法：node tools/sync-blog.mjs
// CI 在构建前自动运行；本地写完博客后手动跑一次即可。
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BLOG = process.env.BLOG_ORIGIN || 'https://blog.sinmu.xyz/';
const HIDE_LABELS = new Set([]); // 想隐藏的标签放进来，例如 'draft'
const MAX = 200;

const source = new URL('postList.json', BLOG);
const res = await fetch(source, { headers: { 'user-agent': 'homecraft-sync' } });
if (!res.ok) throw new Error(`postList.json: HTTP ${res.status}`);

const raw = await res.json();
const posts = Object.entries(raw)
  .filter(([key]) => key !== 'labelColorDict')
  .map(([id, p]) => ({ id, ...p }))
  .filter((p) => p.postUrl && p.postTitle)
  .filter((p) => !(p.labels || []).some((label) => HIDE_LABELS.has(label)))
  .map((p) => ({
    id: p.id,
    title: p.postTitle,
    url: new URL(p.postUrl, BLOG).href,
    date: p.createdDate || '',
    labels: p.labels || [],
    color: p.dateLabelColor || '#1f883d',
  }))
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, MAX);

if (!posts.length) throw new Error('没有解析到文章，检查 postList.json 的结构是否变了');

const out = fileURLToPath(new URL('../world/posts.js', import.meta.url));
const body = [
  '// 由 tools/sync-blog.mjs 自动生成，请勿手工编辑。',
  `// 数据源：${source.href}`,
  `export default ${JSON.stringify(posts, null, 2)};`,
  '',
].join('\n');

await writeFile(out, body);
console.log(`world/posts.js <- ${posts.length} 篇（最新：${posts[0].date} ${posts[0].title}）`);
