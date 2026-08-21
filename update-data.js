/**
 * FogCraft 一键数据更新脚本
 * 用法：node update-data.js [--accept-fallback] [--no-clues]
 * 退出码：0 = 检测到更新（数据已同步，CI 提交变更）；1 = 无新物品（CI 静默结束）
 * CI 配套：.github/workflows/auto-update.yml 每月 1 号 00:00 UTC 自动执行
 *
 * 功能（Minecraft 发布新版本后自动同步新物品）：
 *  1. 扫描 item/*.png 与 items_zh.txt 对比，输出"新物品"与"图片缺失"清单
 *  2. 通过 Minecraft Wiki API（minecraft.wiki/api.php，langlinks=zh）获取
 *     缺失物品的官方中文名；查询失败（网络异常/无此条目）时用
 *     "ID 去下划线首字母大写"作临时名写入 missing_names.txt 供人工核对
 *     （加 --accept-fallback 可让临时名也直接入库，立即纳入游戏）
 *  3. 自动追加 items_zh.txt（格式保持 "ID=中文名"，一行一个，CRLF）
 *  4. 检测到更新时自动执行 fetch-clues.js（已有则调用，生成线索；--no-clues 跳过）
 *  5. 检测到更新时自动执行 build.js 重新构建 index.html（无 build.js 时直接注入占位符）
 *  6. 有更新时在根目录写入 .last-update（ISO 时间戳），供 CI 与人工查看
 *
 * 尊重 Wiki 限流：固定 User-Agent + 每请求间隔 500ms + 10s 超时
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const TXT_FILE = path.join(ROOT, 'items_zh.txt');
const ITEM_DIR = path.join(ROOT, 'item');
const MISSING_FILE = path.join(ROOT, 'missing_names.txt');
const HTML_FILE = path.join(ROOT, 'index.html');
const PLACEHOLDER = '/*__ITEMS_DATA__*/';

const UA = 'FogCraft-Update/1.0 (Minecraft item guess game data sync)';
const API = 'https://minecraft.wiki/api.php';
const DELAY_MS = 500;          // 请求间隔，避免被限流
const TIMEOUT_MS = 10000;

const ACCEPT_FALLBACK = process.argv.includes('--accept-fallback');   // 查询失败的临时名也写入 items_zh.txt
const RUN_CLUES = !process.argv.includes('--no-clues');                // 跳过 fetch-clues.js

/* ================= 基础读写 ================= */
// 解析 items_zh.txt -> Map(id -> 中文名)，同时探测行尾符
function readZhMap(){
  const txt = fs.readFileSync(TXT_FILE, 'utf8').replace(/^\uFEFF/, '');
  const map = new Map();
  for (const line of txt.split(/\r?\n/)){
    if (!line.trim()) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const id = line.slice(0, eq).trim();
    const name = line.slice(eq + 1).trim();
    if (id && name) map.set(id, name);
  }
  return { map, eol: txt.includes('\r\n') ? '\r\n' : '\n', tail: txt.endsWith('\n') };
}
function scanImages(){
  return fs.readdirSync(ITEM_DIR)
    .filter(f => f.endsWith('.png'))
    .map(f => path.basename(f, '.png'));
}
// "diamond_sword" -> "Diamond Sword"（Wiki 页面标题 / 临时中文名兜底）
function toTitle(id){
  return id.split('_').map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ');
}
// 中文名清理：防止破坏 "ID=名" 行格式
const cleanName = s => String(s).replace(/[=\r\n]/g, ' ').trim();

/* ================= Wiki API（langlinks=zh 获取官方中文名） ================= */
function wikiQuery(title){
  return new Promise((resolve, reject) => {
    const url = API + '?action=query&format=json&prop=langlinks&lllang=zh&titles=' + encodeURIComponent(title);
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const pages = (j.query && j.query.pages) || {};
          const page = Object.values(pages)[0];
          if (page && !page.missing && Array.isArray(page.langlinks)){
            const zh = page.langlinks.find(l => l.lang === 'zh');
            // minecraft.wiki 的 langlinks 用 "*" 字段（个别镜像用 title），两者兼容
            if (zh && (zh['*'] || zh.title)) return resolve(cleanName(zh['*'] || zh.title));
          }
          resolve(null);   // 页面不存在或无中文链接
        } catch (e){ reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('请求超时')));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// git 是否可用（仅用于提示 Actions 前置条件，不阻断本地运行）
function gitAvailable(){
  try {
    return spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch (e){ return false; }
}

/* ================= 无 build.js 时的兜底注入（直接替换 index.html 占位符） ================= */
function injectFallback(){
  const { map } = readZhMap();
  const imgIds = scanImages();
  const items = imgIds.filter(id => map.has(id)).map(id => ({ id, name: map.get(id), icon: 'item/' + id + '.png' }));
  let html = fs.readFileSync(HTML_FILE, 'utf8');
  if (!html.includes(PLACEHOLDER)){
    console.error('❌ index.html 中未找到占位符 ' + PLACEHOLDER + '，无法自动注入');
    return;
  }
  html = html.replace(/const ITEMS = \[[\s\S]*?\](\[\])?;/, 'const ITEMS = ' + PLACEHOLDER + ';');
  html = html.replace(PLACEHOLDER, JSON.stringify(items));
  fs.writeFileSync(HTML_FILE, html, 'utf8');
  console.log('✔ 已直接注入 index.html（' + items.length + ' 个物品，无 build.js 兜底模式）');
}

/* ================= 主流程 ================= */
async function main(){
  console.log('========== FogCraft 一键数据更新 ==========');
  const { map, eol, tail } = readZhMap();
  const imgIds = scanImages();
  const newIds = imgIds.filter(id => !map.has(id));           // 有图无中文名
  const missingImgs = [...map.keys()].filter(id => !imgIds.includes(id));   // 有中文名无图

  console.log('扫描 item/ 图片     : ' + imgIds.length + ' 个');
  console.log('items_zh.txt 条目   : ' + map.size + ' 个');
  if (newIds.length > 0){
    console.log('\n发现 ' + newIds.length + ' 个新物品: ' + newIds.join(', '));
  } else {
    console.log('\n✔ 未发现新物品');
  }
  if (missingImgs.length > 0){
    console.log('⚠ 警告：' + missingImgs.length + ' 个物品图片缺失: ' + missingImgs.join(', '));
  } else {
    console.log('✔ 无图片缺失');
  }

  // ---- 2. 获取缺失物品中文名（Wiki API，顺序请求 + 500ms 间隔） ----
  let ok = 0, fail = 0;
  const toAppend = [];        // 写入 items_zh.txt 的行
  const toMissing = [];       // 写入 missing_names.txt 的行（临时名）
  for (const id of newIds){
    let name = null;
    try {
      name = await wikiQuery(toTitle(id));
    } catch (e){
      name = null;
    }
    await sleep(DELAY_MS);
    if (name){
      ok++;
      toAppend.push(id + '=' + name);
      console.log('  ✅ ' + id + ' = ' + name + '（Wiki）');
    } else {
      fail++;
      const tmp = toTitle(id);   // 临时名：去下划线首字母大写
      toMissing.push(id + '=' + tmp);
      console.log('  ⚠ ' + id + '：Wiki 查询失败，临时名 "' + tmp + '" 待人工核对');
      if (ACCEPT_FALLBACK) toAppend.push(id + '=' + tmp);   // 立即纳入游戏
    }
  }

  // ---- 3. 写入 items_zh.txt（追加，保持原行尾） ----
  if (toAppend.length > 0){
    const sep = tail ? '' : eol;
    fs.appendFileSync(TXT_FILE, sep + toAppend.join(eol) + eol, 'utf8');
    console.log('\n✔ 已追加 ' + toAppend.length + ' 条到 items_zh.txt' + (ACCEPT_FALLBACK && fail > 0 ? '（含临时名，请尽快人工核对）' : ''));
  }
  if (toMissing.length > 0){
    fs.appendFileSync(MISSING_FILE, toMissing.join(eol) + eol, 'utf8');
    console.log('⚠ 已写入 missing_names.txt（' + toMissing.length + ' 条待人工核对）');
  }

  // ---- 4. 判定本次是否有数据变化（有变化才走线索/构建/CI 提交路径） ----
  const HAS_UPDATE = toAppend.length > 0 || toMissing.length > 0;

  if (HAS_UPDATE){
    // 4a. 线索：已有 fetch-clues.js 则自动调用（全量重生成，幂等）
    if (RUN_CLUES && fs.existsSync(path.join(ROOT, 'fetch-clues.js'))){
      console.log('\n-- 生成线索（node fetch-clues.js） --');
      const r = spawnSync(process.execPath, ['fetch-clues.js'], { cwd: ROOT, stdio: 'inherit' });
      if (r.status !== 0) console.log('⚠ fetch-clues.js 退出码 ' + r.status + '（可稍后手动运行）');
    }

    // 4b. 重新构建游戏数据（无 build.js 时直接注入 index.html 占位符）
    console.log('\n-- 构建游戏数据（node build.js） --');
    if (fs.existsSync(path.join(ROOT, 'build.js'))){
      const r = spawnSync(process.execPath, ['build.js'], { cwd: ROOT, stdio: 'inherit' });
      if (r.status !== 0){
        console.error('❌ build.js 执行失败（退出码 ' + r.status + '）');
        process.exit(1);
      }
    } else {
      injectFallback();
    }

    // 4c. 记录本次更新时间戳（ISO 格式）
    fs.writeFileSync(path.join(ROOT, '.last-update'), new Date().toISOString() + '\n', 'utf8');
    console.log('✔ 已写入 .last-update');

    // 4d. 本地无 git 时提示（CI 环境由 Actions 自动提交推送）
    if (!gitAvailable()){
      console.log('ℹ 提示：请先初始化 Git 并推送到 GitHub 仓库，以便使用 Actions 自动更新');
    }
  } else {
    console.log('\n-- 跳过线索生成与构建（无数据变化） --');
  }

  // ---- 5. 最终统计 ----
  const { map: after } = readZhMap();
  const inGame = imgIds.filter(id => after.has(id)).length;
  console.log('\n========== 最终统计 ==========');
  console.log('总物品数(图片 ∩ 中文名) : ' + inGame);
  console.log('新增物品数              : ' + newIds.length);
  console.log('缺失图片数              : ' + missingImgs.length);
  console.log('API 成功 / 失败         : ' + ok + ' / ' + fail);
  console.log('待人工核对              : ' + toMissing.length + ' 条（missing_names.txt）');
  console.log('================================');

  // ---- 6. 退出码：0 = 有更新（CI 提交变更）；1 = 无新物品（CI 静默结束） ----
  if (HAS_UPDATE){
    console.log('✅ 有更新');
    process.exit(0);
  }
  console.log('⏳ 无新物品');
  process.exit(1);
}
main().catch(e => { console.error('❌ 更新失败: ' + e.message); process.exit(1); });
