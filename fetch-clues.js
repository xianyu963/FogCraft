/**
 * FogCraft 线索生成脚本（第二步）
 * 用法：node fetch-clues.js
 *
 * 数据源：中文 Minecraft Wiki API（zh.minecraft.wiki）
 *   - Module:Item maxstack values           堆叠数
 *   - Module:Item durability values         耐久值
 *   - Module:Item food properties values    食物（饥饿值、饱食度）
 *   - Module:Item burn duration values      燃料燃烧时长（游戏刻）
 *   - Module:Item attribute modifier values 攻击伤害 / 护甲值
 *   - Module:Item creative category values  创造分类
 *   - Module:Item rarity values             稀有度
 *   - Module:Item renewable values          可再生
 *
 * 输出：data/clues.json  { "<id>": ["线索1", ..., "线索6"] }
 * 线索梯度：1 最泛（类型）→ 6 最具体（属性组合），全部为游戏机制信息。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const WIKI = 'https://zh.minecraft.wiki/w/';
const UA = { headers: { 'User-Agent': 'FogCraft-clue-bot/1.0 (guess game)' } };
const CACHE_FILE = path.join(DATA_DIR, 'wiki-modules-cache.json');

const MODULES = {
  maxstack:   'Module:Item maxstack values',
  durability: 'Module:Item durability values',
  food:       'Module:Item food properties values',
  burn:       'Module:Item burn duration values',
  attr:       'Module:Item attribute modifier values',
  category:   'Module:Item creative category values',
  rarity:     'Module:Item rarity values',
  renewable:  'Module:Item renewable values',
};

/* ================= Lua 子集解析器 ================= */
function parseLua(src) {
  let pos = 0;
  const skipWs = () => {
    while (pos < src.length) {
      const c = src[pos];
      if (/\s/.test(c)) { pos++; continue; }
      if (c === '-' && src[pos + 1] === '-') {           // 注释
        while (pos < src.length && src[pos] !== '\n') pos++;
        continue;
      }
      break;
    }
  };
  const parseValue = () => {
    skipWs();
    const c = src[pos];
    if (c === "'" || c === '"') {                        // 字符串
      const q = c; pos++;
      let s = '';
      while (pos < src.length && src[pos] !== q) s += src[pos++];
      pos++;
      return s;
    }
    if (c === '{') {                                     // 表
      pos++;
      const obj = {};
      const arr = [];
      let hasNamed = false;
      skipWs();
      while (pos < src.length && src[pos] !== '}') {
        skipWs();
        let key = null;
        if (src[pos] === '[') {                          // ['key'] = 或 [1] =
          pos++; skipWs();
          if (src[pos] === "'" || src[pos] === '"') key = parseValue();
          else {
            let n = '';
            while (/[\d-]/.test(src[pos])) n += src[pos++];
            key = Number(n);
          }
          skipWs();
          if (src[pos] === ']') pos++;
          skipWs();
          if (src[pos] === '=') pos++;
          hasNamed = true;
        } else if (/[A-Za-z_]/.test(src[pos])) {         // key =
          let n = '';
          while (/[A-Za-z0-9_]/.test(src[pos])) n += src[pos++];
          key = n; hasNamed = true;
          skipWs();
          if (src[pos] === '=') pos++;
        }
        const v = parseValue();
        if (key !== null) obj[key] = v;
        else arr.push(v);
        skipWs();
        if (src[pos] === ',') pos++;
        skipWs();
      }
      pos++;                                             // }
      if (!hasNamed && arr.length) return arr;
      if (hasNamed) {
        for (let i = 0; i < arr.length; i++) obj[i] = arr[i];
      }
      return obj;
    }
    // 数字
    let n = '';
    while (pos < src.length && /[0-9.+-]/.test(src[pos])) n += src[pos++];
    return Number(n);
  };
  skipWs();
  while (pos < src.length && !/[\[{'"0-9-]/.test(src[pos])) pos++;  // 跳过 return
  return parseValue();
}

/* ================= 抓取模块（带缓存与重试） ================= */
async function fetchModule(name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(WIKI + encodeURIComponent(MODULES[name]) + '?action=raw', UA);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const t = await r.text();
      return t;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(x => setTimeout(x, 1500 * attempt));
    }
  }
}

async function loadAllData() {
  if (fs.existsSync(CACHE_FILE)) {
    console.log('使用缓存: ' + CACHE_FILE);
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const raw = {};
  for (const name of Object.keys(MODULES)) {
    const t = await fetchModule(name);
    raw[name] = parseLua(t);
    console.log('✓ ' + MODULES[name] + ' -> ' +
      Object.keys(raw[name]).length + ' 条');
    await new Promise(x => setTimeout(x, 400));
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(raw), 'utf8');
  return raw;
}

/* ================= 读取物品列表 ================= */
function loadItems() {
  const txt = fs.readFileSync(path.join(ROOT, 'items_zh.txt'), 'utf8').replace(/^\uFEFF/, '');
  const items = [];
  const files = fs.readdirSync(path.join(ROOT, 'item')).filter(f => f.endsWith('.png'));
  const zhMap = new Map();
  for (const line of txt.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq > 0) zhMap.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  for (const f of files) {
    const id = path.basename(f, '.png');
    if (zhMap.has(id)) items.push({ id, name: zhMap.get(id) });
  }
  return items;
}

/* ================= 数据取值工具 ================= */
const get = (D, key, id) => (D[key] && D[key][id] !== undefined ? D[key][id] : undefined);
const fmt = n => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

function getAttack(D, id) {
  const a = D.attr[id];
  if (!a) return null;
  let max = 0;
  for (const slot of Object.values(a)) {
    for (const m of slot || []) {
      if (m.attribute === 'attack_damage' && m.operation === 'add_value' && m.amount > max) max = m.amount;
    }
  }
  // wiki 存的是加成值，实际攻击力 = 加成 + 空手基础 1
  return max ? max + 1 : null;
}
function getArmor(D, id) {
  const a = D.attr[id];
  if (!a) return null;
  let sum = 0;
  for (const slot of Object.values(a)) {
    for (const m of slot || []) {
      if (m.attribute === 'armor' && m.operation === 'add_value') sum += m.amount;
    }
  }
  return sum || null;
}
const burnSec = D => id => { const t = get(D, 'burn', id); return t ? Math.round(t / 20) : null; };

/* ================= 类型分类 ================= */
function classifyType(id, D) {
  if (/spawn_egg$/.test(id)) return '杂项';   // 刷怪蛋创造分类为 nature，需特判
  const food = get(D, 'food', id);
  if (food) return '食物';
  const attack = getAttack(D, id), armor = getArmor(D, id);
  if (attack && !/_axe$/.test(id) && !/harness/.test(id)) return '武器';
  if (armor || /(_helmet|_chestplate|_leggings|_boots|_harness|elytra)$/.test(id)) return '护甲';
  if (/(_axe|_pickaxe|_shovel|_hoe|fishing_rod|shears|brush|spyglass|flint_and_steel|_bucket|bone_meal|clock|compass|_map|_on_a_stick|lead|name_tag|saddle|bundle|recovery_compass)$/.test(id)) return '工具';
  if (/(_ore|ancient_debris|raw_|_ingot$|_nugget$|diamond$|emerald$|coal$|redstone$|lapis_lazuli$|quartz$|amethyst_shard|netherite_scrap|glowstone_dust|nether_star|ender_pearl|blaze_rod|blaze_powder|slime_ball|magma_cream|ghast_tear|phantom_membrane|shulker_shell|nautilus_shell|heart_of_the_sea|echo_shard|disc_fragment|^(iron|gold|diamond|emerald|lapis|redstone|coal|copper|netherite|quartz)_block$)/.test(id)) return '矿物';
  if (/(_sapling|_leaves|_log$|_wood$|_flower|_tulip|_seeds$|_crop|_vine|_mushroom|cactus|bamboo|sugar_cane|kelp|_wart|_roots|_fungus|chorus_|pitcher|torchflower|wildflowers|_bush|cocoa|wheat$|carrot$|potato$|beetroot$|melon$|pumpkin$|apple$|sweet_berries|glow_berries|_sapling)/.test(id)) return '植物';
  const cat = get(D, 'category', id);
  if (cat === 'construction' || cat === 'nature') return '方块';
  return '杂项';
}

/* ================= 获取途径规则 ================= */
function getAcquire(id, D) {
  const R = [
    [/(spawn_egg|command_block|barrier|light|structure_block|jigsaw)$/, '只能通过创造模式或命令获得'],
    [/^apple$/, '主要从橡树树叶上掉落'],
    [/^sweet_berries$/, '在甜浆果丛中采集'],
    [/^glow_berries$/, '在洞穴藤蔓上采集'],
    [/^chorus_fruit$/, '在末地岛屿上采集获得'],
    [/^melon_slice$/, '通过种植西瓜获得'],
    [/^(carrot|potato|beetroot)$/, '通过种植获得'],
    [/^poisonous_potato$/, '种植土豆时偶尔获得'],
    [/^(raw_cod|raw_salmon)$/, '通过钓鱼获得'],
    [/^golden_apple$/, '由苹果与金锭合成'],
    [/^enchanted_golden_apple$/, '仅存在于遗迹箱子中'],
    [/dragon_egg/, '由末影龙首次被击败后掉落'],
    [/totem_of_undying/, '由唤魔者掉落获得'],
    [/elytra/, '可在末地船的战利品箱中找到'],
    [/nether_star/, '击败凋灵后掉落获得'],
    [/dragon_head|dragon_breath/, '与末影龙战斗相关的掉落物'],
    [/smithing_template$/, '需要通过探索遗迹获得'],
    [/pottery_sherd$/, '可通过考古挖掘获得'],
    [/music_disc_/, '由骷髅击杀苦力怕时掉落'],
    [/_ore$|ancient_debris/, '主要从地下矿脉中挖掘获得'],
    [/raw_(iron|gold|copper)$/, '从对应矿石中直接挖掘获得'],
    [/netherite_ingot/, '由下界合金碎片与金锭合成'],
    [/netherite_scrap/, '由远古残骸烧炼获得'],
    [/^(iron|gold|copper|netherite)_ingot$/, '通常由矿石烧炼获得'],
    [/_nugget$/, '由对应锭分解或合成获得'],
    [/^(diamond|emerald|lapis_lazuli|redstone|coal|quartz|amethyst_shard)$/, '通过挖掘矿石获得'],
    [/(_seeds$|pitcher_pod|torchflower_seeds)/, '通过种植可以收获更多'],
    [/_sapling$/, '砍伐树木时掉落'],
    [/stripped_|_log$|_wood$/, '砍伐树木获得'],
    [/_planks$/, '由原木加工而成'],
    [/cooked_|baked_potato|dried_kelp/, '由生食或原材烧炼获得'],
    [/charcoal/, '由原木烧炼获得'],
    [/^egg$/, '由鸡产下'],
    [/^snowball$/, '由雪块挖掘或雪傀儡掉落'],
    [/^flint$/, '挖掘沙砾时掉落'],
    [/^clay_ball$/, '挖掘黏土块获得'],
    [/^stick$/, '由木板加工而成'],
    [/^paper$/, '由甘蔗加工而成'],
    [/^book$/, '由纸与皮革合成'],
    [/^sugar$/, '由甘蔗加工获得'],
    [/^wheat$/, '通过种植小麦获得'],
    [/^(bread|cookie|cake|pumpkin_pie)$/, '通过合成获得'],
    [/stew$/, '通过烹饪或合成获得'],
    [/^(beef|porkchop|chicken|mutton|rabbit)$/, '从相应动物身上掉落'],
    [/raw_/, '从相应生物或环境中获得'],
    [/^white_wool$/, '从羊身上剪下获得'],
    [/_wool$/, '从羊身上剪下或染色获得'],
    [/_carpet$/, '由羊毛加工而成'],
    [/^leather$/, '从牛或马身上掉落'],
    [/^feather$/, '从鸡身上掉落'],
    [/^bone$/, '从骷髅身上掉落'],
    [/^string$/, '从蜘蛛身上掉落'],
    [/^gunpowder$/, '从苦力怕身上掉落'],
    [/^spider_eye$/, '从蜘蛛身上掉落'],
    [/fermented_spider_eye/, '通过酿造合成'],
    [/^blaze_rod$/, '从烈焰人身上掉落'],
    [/^blaze_powder$/, '由烈焰棒加工而成'],
    [/^ender_pearl$/, '从末影人身上掉落'],
    [/^ghast_tear$/, '从恶魂身上掉落'],
    [/^magma_cream$/, '从岩浆怪身上掉落'],
    [/^slime_ball$/, '从史莱姆身上掉落'],
    [/^phantom_membrane$/, '从幻翼身上掉落'],
    [/^shulker_shell$/, '从潜影贝身上掉落'],
    [/^nautilus_shell$/, '通过钓鱼或从溺尸身上获得'],
    [/^heart_of_the_sea$/, '通过海底探险获得'],
    [/^echo_shard$/, '可在远古城市的箱子中找到'],
    [/^disc_fragment$/, '从远古守卫者身上掉落'],
    [/^goat_horn$/, '让山羊撞击方块后掉落'],
    [/^scute$/, '从海龟身上掉落'],
    [/^armadillo_scute$/, '从犰狳身上掉落'],
    [/^wolf_armor$/, '由犰狳鳞甲合成'],
    [/^honey_bottle$/, '从蜂巢中采集'],
    [/^honeycomb$/, '从蜂巢中采集'],
    [/^ink_sac$/, '从鱿鱼身上掉落'],
    [/^glow_ink_sac$/, '从发光鱿鱼身上掉落'],
    [/^cocoa_beans$/, '生长在丛林树的树干上'],
    [/nether_wart/, '在下界要塞中种植'],
    [/wither_skeleton_skull/, '从凋灵骷髅身上掉落'],
    [/^(skeleton_skull|zombie_head|creeper_head)$/, '由相应生物被击杀时掉落'],
    [/^experience_bottle$/, '通过交易或钓鱼获得'],
    [/^saddle$/, '可在战利品箱或交易中获得'],
    [/^name_tag$/, '可在战利品箱或钓鱼中获得'],
    [/^lead$/, '由线合成'],
    [/^sponge$/, '从远古守卫者身上掉落'],
    [/^(potion|splash_potion|lingering_potion)$/, '通过酿造获得'],
    [/^dragon_breath$/, '收集末影龙的吐息'],
    [/_(shulker_box)$/, '由潜影壳合成'],
    [/^ender_chest$/, '由末影珍珠合成'],
    [/^respawn_anchor$/, '由哭泣的黑曜石合成'],
    [/^lodestone$/, '由下界合金锭合成'],
    [/^crying_obsidian$/, '与猪灵以物易物获得'],
    [/^banner_pattern$/, '可通过合成或探索获得'],
    [/^player_head$/, '仅能通过命令或苦力怕爆炸获得'],
    [/_bucket$/, '通过合成或与生物互动获得'],
    [/_dye$/, '由植物或矿物加工获得'],
    [/netherite_/, '由锻造台升级获得'],
  ];
  for (const [re, txt] of R) {
    if (re.test(id)) return txt;
  }
  const cat = get(D, 'category', id);
  if (get(D, 'food', id)) return '可以通过合成获得';   // 食物：未命中特例规则时按合成兜底
  if (cat === 'construction' || cat === 'nature') return '可以通过合成或采集获得';
  return '可以通过合成获得';
}

/* ================= 线索生成 ================= */
function genClues(item, D) {
  const id = item.id;
  const type = classifyType(id, D);
  const stack = get(D, 'maxstack', id) || 64;
  const dur = get(D, 'durability', id);
  const food = get(D, 'food', id);
  const burn = burnSec(D)(id);
  const attack = getAttack(D, id);
  const armor = getArmor(D, id);
  const rarity = get(D, 'rarity', id);
  const ren = get(D, 'renewable', id);
  const cat = get(D, 'category', id);

  const c = [];

  /* 线索1：类型（最泛） */
  c.push('这是一种' + type);

  /* 线索2：堆叠 */
  c.push(stack === 1 ? '无法堆叠，只能持有一个'
    : stack === 16 ? '最多堆叠 16 个'
    : '最多堆叠 64 个');

  /* 线索3：获取途径 */
  c.push(getAcquire(id, D));

  /* 线索4：主属性 */
  if (/spawn_egg$/.test(id)) c.push('用于生成对应的生物');
  else if (attack) c.push('攻击伤害 ' + fmt(attack) + ' 点');
  else if (armor) c.push('提供 ' + fmt(armor) + ' 点护甲值');
  else if (food) c.push('食用恢复 ' + fmt(food[0]) + ' 点饥饿值');
  else if (burn) c.push('可作燃料，燃烧 ' + burn + ' 秒');
  else if (dur) c.push('耐久为 ' + dur + ' 点');
  else if (cat === 'construction') c.push('主要用于建筑和装饰');
  else if (cat === 'nature') c.push('常用于建筑或自然装饰');
  else if (food === undefined) c.push('属于特殊功能物品');

  /* 线索5：次属性 / 机制 */
  let c5 = null;
  if (/spawn_egg$/.test(id)) c5 = '主要供创造模式使用';
  else if (food && food[1]) c5 = '食用后饱食度加 ' + fmt(food[1]);
  if (!c5 && burn && c[3] !== '可作燃料，燃烧 ' + burn + ' 秒') c5 = '可作燃料，燃烧 ' + burn + ' 秒';
  if (!c5 && dur && c[3] !== '耐久为 ' + dur + ' 点') c5 = '耐久为 ' + dur + ' 点';
  if (!c5 && attack && c[3] !== '攻击伤害 ' + fmt(attack) + ' 点') c5 = '攻击伤害 ' + fmt(attack) + ' 点';
  if (!c5 && armor && c[3] !== '提供 ' + fmt(armor) + ' 点护甲值') c5 = '提供 ' + fmt(armor) + ' 点护甲值';
  if (!c5 && (dur || /^(bow|crossbow|shield|enchanted_book)$/.test(id) || /_book$/.test(id))) c5 = '可以在附魔台上附魔';
  const rar = String(rarity || '').toLowerCase();
  if (!c5 && (rar === 'epic' || rar === 'rare')) c5 = rar === 'epic' ? '属于史诗级稀有物品' : '属于较稀有的物品';
  if (!c5 && /(_ore$|raw_|ancient_debris|netherite_scrap)/.test(id)) c5 = '属于不可再生资源';
  if (!c5 && type === '方块') c5 = '可被精准采集保留';
  if (!c5) c5 = '可用于多种合成配方';
  c.push(c5);

  /* 线索6：最具体（属性组合） */
  const used = new Set([c[3], c[4]]);
  const cands = [];
  if (attack && dur) cands.push('攻击' + fmt(attack) + '点、耐久' + dur);
  if (armor && dur) cands.push('护甲' + fmt(armor) + '点、耐久' + dur);
  if (food && burn) cands.push('恢复' + fmt(food[0]) + '饥饿、可燃' + burn + '秒');
  if (attack && burn) cands.push('攻击' + fmt(attack) + '点、可燃' + burn + '秒');
  if (dur && burn) cands.push('耐久' + dur + '、可燃' + burn + '秒');
  if (food && food[1]) cands.push('恢复' + fmt(food[0]) + '饥饿、饱食' + fmt(food[1]));
  if (armor && food) cands.push('护甲' + fmt(armor) + '点、恢复' + fmt(food[0]) + '饥饿');
  if (attack && food) cands.push('攻击' + fmt(attack) + '点、恢复' + fmt(food[0]) + '饥饿');
  if (attack && armor) cands.push('攻击' + fmt(attack) + '点、护甲' + fmt(armor) + '点');
  let c6 = cands.find(x => !used.has(x));
  if (/spawn_egg$/.test(id)) c6 = '生成生物用的特殊物品';
  if (!c6 && attack) c6 = '攻击伤害' + fmt(attack) + '点';
  if (!c6 && armor) c6 = '护甲值' + fmt(armor) + '点';
  if (!c6 && food) c6 = '恢复' + fmt(food[0]) + '点饥饿';
  if (!c6 && burn) c6 = '燃烧时长' + burn + '秒';
  if (!c6 && dur) c6 = '耐久' + dur + '点';
  if (!c6 && stack === 1) c6 = '仅能携带一个的独特物品';
  if (!c6) c6 = type === '方块' ? '适合建筑与装饰的方块' : '用途多样的实用物品';
  c.push(c6);

  return c;
}

/* ================= 主流程 ================= */
async function main() {
  console.log('========== FogCraft 线索生成 ==========');
  const D = await loadAllData();
  const items = loadItems();
  console.log('物品总数: ' + items.length);

  const clues = {};
  let missing = 0;
  const typeStats = {};
  const longClues = [];

  for (const it of items) {
    const cs = genClues(it, D);
    clues[it.id] = cs;
    // 校验：6 条、每条 ≤15 字（汉字+数字混合计数，宽松上限）
    if (cs.length !== 6) { console.error('❌ 线索数异常: ' + it.id); process.exit(1); }
    for (const c of cs) {
      if (c.length > 15) longClues.push(it.id + ': ' + c);
    }
    if (!get(D, 'maxstack', it.id) && !get(D, 'durability', it.id) && !get(D, 'food', it.id) && !get(D, 'burn', it.id) && !D.attr[it.id]) {
      missing++;
    }
    const t = classifyType(it.id, D);
    typeStats[t] = (typeStats[t] || 0) + 1;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'clues.json'), JSON.stringify(clues, null, 1), 'utf8');
  console.log('\n✔ 已写入 data/clues.json（' + Object.keys(clues).length + ' 个物品）');
  console.log('类型分布: ' + JSON.stringify(typeStats));
  console.log('完全无属性数据(规则兜底): ' + missing);
  console.log('超 15 字线索: ' + longClues.length);
  longClues.slice(0, 10).forEach(x => console.log('  ⚠ ' + x));

  // 抽样展示
  console.log('\n--- 抽样 ---');
  for (const id of ['diamond_sword', 'apple', 'coal', 'white_wool', 'creeper_spawn_egg', 'oak_log', 'golden_carrot', 'elytra']) {
    if (clues[id]) {
      console.log('[' + id + ']');
      clues[id].forEach((c, i) => console.log('  #' + (i + 1) + ' ' + c));
    }
  }
}
main().catch(e => { console.error('❌ 失败: ' + e.message); process.exit(1); });
