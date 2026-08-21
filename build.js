/**
 * FogCraft 数据构建脚本（可选工具，不影响游戏运行）
 * 用法：node build.js
 *
 * 功能：
 *  1. 解析 items_zh.txt（每行 "英文id=中文名"）为映射表
 *  2. 扫描 item/ 目录获取全部图片文件名
 *  3. 取交集生成 [{id,name,icon}] 数组，替换 index.html 中的占位符
 *  4. 按图片内容 MD5 自动识别同纹组（贴图相同但 id 不同的物品，如
 *     waxed_copper_block / copper_block），注入 ICON_GROUPS 占位符
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const TXT_FILE = path.join(ROOT, 'items_zh.txt');
const ITEM_DIR = path.join(ROOT, 'item');
const HTML_FILE = path.join(ROOT, 'index.html');
const PLACEHOLDER = '/*__ITEMS_DATA__*/';

// ---- 1. 解析 items_zh.txt ----
const txt = fs.readFileSync(TXT_FILE, 'utf8').replace(/^\uFEFF/, ''); // 去除 BOM
const zhMap = new Map();
for (const line of txt.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const eq = line.indexOf('=');
  if (eq < 0) continue;
  const id = line.slice(0, eq).trim();
  const name = line.slice(eq + 1).trim();
  if (id && name) zhMap.set(id, name);
}

// ---- 2. 扫描 item/ 目录 ----
const files = fs.readdirSync(ITEM_DIR).filter(f => f.endsWith('.png'));

// ---- 3. 取交集 ----
const items = [];
const skippedNoZh = [];   // 有图但 items_zh.txt 无中文名
// 读取线索数据（由 fetch-clues.js 生成，可为空）
const CLUES_FILE = path.join(ROOT, 'data', 'clues.json');
let cluesMap = {};
if (fs.existsSync(CLUES_FILE)) {
  cluesMap = JSON.parse(fs.readFileSync(CLUES_FILE, 'utf8'));
}
for (const f of files) {
  const id = path.basename(f, '.png');
  if (zhMap.has(id)) {
    const item = { id, name: zhMap.get(id), icon: 'item/' + f };
    if (Array.isArray(cluesMap[id]) && cluesMap[id].length === 6) item.clues = cluesMap[id];
    items.push(item);
  } else {
    skippedNoZh.push(f);
  }
}
const withClues = items.filter(it => it.clues).length;
const txtNoImg = [...zhMap.keys()].filter(k => !files.includes(k + '.png')); // 有中文名但无图

// ---- 3.5 同纹组：按图片内容 MD5 自动分组（贴图相同但 id 不同的物品归为一组，不硬编码） ----
const hashOf = f => crypto.createHash('md5').update(fs.readFileSync(path.join(ITEM_DIR, f))).digest('hex');
const hashMap = new Map(); // md5 -> [id, ...]
for (const it of items) {
  const h = hashOf(it.id + '.png');
  if (!hashMap.has(h)) hashMap.set(h, []);
  hashMap.get(h).push(it.id);
}
const iconGroups = [...hashMap.values()].filter(g => g.length > 1).sort(); // 仅保留真正同纹的组

// ---- 4. 校验 ----
const dupId = items.filter((it, i) => items.findIndex(x => x.id === it.id) !== i);
const emptyName = items.filter(it => !it.name);

// ---- 5. 注入 index.html（幂等：先还原已注入状态，再替换占位符） ----
const json = JSON.stringify(items);
const GROUP_PLACEHOLDER = '/*__ICON_GROUPS__*/';
let html = fs.readFileSync(HTML_FILE, 'utf8');
// 还原：const ITEMS = [数据];（或旧版残留 [数据][];）-> const ITEMS = /*__ITEMS_DATA__*/;
html = html.replace(/const ITEMS = \[[\s\S]*?\](\[\])?;/, 'const ITEMS = ' + PLACEHOLDER + ';');
if (!html.includes(PLACEHOLDER)) {
  console.error('❌ index.html 中未找到占位符 ' + PLACEHOLDER + '，请先创建含占位符的模板');
  process.exit(1);
}
// 还原：const ICON_GROUPS = [数据]; -> const ICON_GROUPS = /*__ICON_GROUPS__*/ [];（模板默认空数组）
html = html.replace(/const ICON_GROUPS = \[[\s\S]*?\];/, 'const ICON_GROUPS = ' + GROUP_PLACEHOLDER + ' [];');
if (!html.includes(GROUP_PLACEHOLDER)) {
  console.error('❌ index.html 中未找到同纹组占位符 ' + GROUP_PLACEHOLDER + '，请先在数据层添加 const ICON_GROUPS = ' + GROUP_PLACEHOLDER + ' [];');
  process.exit(1);
}
html = html.replace(PLACEHOLDER, json);
html = html.replace(/\/\*__ICON_GROUPS__\*\/\s*\[\]/, JSON.stringify(iconGroups));
fs.writeFileSync(HTML_FILE, html, 'utf8');

// ---- 6. 输出统计 ----
console.log('========== FogCraft 数据构建完成 ==========');
console.log('items_zh.txt 条目数      : ' + zhMap.size);
console.log('item/ 图片数             : ' + files.length);
console.log('生成物品数(交集)         : ' + items.length);
console.log('含 6 条线索的物品        : ' + withClues + ' / ' + items.length);
console.log('跳过(有图无中文名)       : ' + skippedNoZh.length + (skippedNoZh.length ? '  e.g. ' + skippedNoZh.slice(0, 3).join(', ') : ''));
console.log('txt有但无图              : ' + txtNoImg.length + (txtNoImg.length ? '  e.g. ' + txtNoImg.slice(0, 3).join(', ') : ''));
console.log('id 重复                  : ' + dupId.length);
console.log('中文名为空               : ' + emptyName.length);
console.log('同纹组(贴图相同)          : ' + iconGroups.length + ' 组，涉及 ' + iconGroups.reduce((s, g) => s + g.length, 0) + ' 个物品，e.g. ' + (iconGroups[0] || []).join(' / '));
console.log('index.html 数据体积      : ' + (json.length / 1024).toFixed(1) + ' KB');
console.log('首条: ' + JSON.stringify(items[0]));
console.log('末条: ' + JSON.stringify(items[items.length - 1]));
