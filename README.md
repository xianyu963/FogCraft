> 🧠 **提示**：本项目代码及数据由 AI 辅助编程工具生成，人类仅负责整体设计、测试与部署。
# 🎮 FogCraft · MC 迷雾猜物

> **在迷雾中辨认 Minecraft 物品** —— 一款纯静态、单文件的 Minecraft 物品猜谜游戏，无需安装、无需后端，打开即玩。

---

## ✨ 核心功能

| 功能 | 说明 |
|---|---|
| 🧩 **四种模式** | 标准模式 · 每日挑战（全球同题）· 限时竞速（60s 抢答）· 拼字挑战（Wordle 风格） |
| 🌫️ **动态迷雾** | 物品图标被迷雾遮挡，按住拖动即可擦拭揭示，模拟"挖开方块"的体验 |
| 🔊 **MC 原声音效** | 直连 Minecraft Wiki 官方音频（拾取经验球、箱子开启、玩家升级……），加载失败静默降级 |
| ✨ **附魔台粒子** | Canvas 粒子特效，还原附魔台的神秘光效 |
| 📊 **统计面板** | 四模式数据独立汇总（正确率 / 连对 / 最高分 / 平均尝试），支持二次确认重置 |
| 📸 **每日分享图** | 每日挑战完成后一键生成 1200×630 分享图（像素风 Canvas 绘制） |
| 📖 **拼字参考列表** | 显示与目标同字数的全部物品，帮助缩小猜测范围 |
| 🔥 **连续天数 & 硬核模式** | 每日连续打卡天数记录；硬核模式答错即结算 |
| ⚙️ **防御性上线** | Cloudflare Pages 缓存策略（`_headers`），PNG 永久缓存、仅预加载当前+下一题 2 张图 |

## 🛠️ 技术栈

- **纯 HTML + CSS + JavaScript**：无框架、无外部依赖，单文件 `index.html`（含全部样式与逻辑，约 2100 行）
- **Canvas 2D**：分享图绘制、附魔台粒子特效
- **localStorage**：进度、统计、设置的持久化（`fogcraft_*` 前缀键名）
- **Node.js**（仅开发 / CI 使用）：`update-data.js` 自动同步新物品、`fetch-clues.js` 生成线索、`build.js` 注入数据

## 📂 项目结构

```
FogCraft/
├── index.html            # 游戏本体（样式 + 逻辑 + 数据全部内嵌，单文件）
├── item/                 # 1488 张物品图标 PNG（官方图床来源）
├── items_zh.txt          # 物品 ID=中文名 映射表（一行一条，自动更新维护）
├── data/
│   ├── clues.json        # 物品线索库（每个物品 6 条线索，由 fetch-clues.js 生成）
│   └── wiki-modules-cache.json  # Minecraft Wiki 模块缓存（加速线索抓取）
├── update-data.js        # 一键数据更新：检测新物品 → Wiki 查中文名 → 生成线索 → 重建游戏
├── fetch-clues.js        # 线索抓取生成器（调用 Minecraft Wiki API）
├── build.js              # 数据构建脚本：items_zh.txt + item/ → 注入 index.html
├── server.js             # 本地预览服务器（可选，含与生产一致的缓存策略）
├── _headers              # Cloudflare Pages 缓存配置（PNG 永久缓存等）
├── .last-update          # 最近一次数据自动更新的时间戳（ISO 格式）
└── .github/workflows/
    └── auto-update.yml   # GitHub Actions：每月 1 号自动同步 Minecraft 新物品
```

## 🚀 快速开始

**方式一：直接双击** —— 用浏览器打开 `index.html` 即可游玩（数据已内嵌，无需任何服务器）。

**方式二：本地 HTTP 服务器**（推荐，音效与图片加载体验更佳）：

```bash
# Python
python -m http.server 8000

# 或 Node.js
node server.js
```

然后访问 `http://localhost:8000`。

## 🔄 自动更新机制

- 仓库已配置 **GitHub Actions**（`.github/workflows/auto-update.yml`）
- 每月 1 号 00:00 UTC（北京时间 08:00）自动执行 `update-data.js`：
  1. 扫描 `item/` 与 `items_zh.txt` 对比，发现新物品
  2. 通过 Minecraft Wiki API 获取官方中文名（失败时写入 `missing_names.txt` 待人工核对）
  3. 自动生成线索（`fetch-clues.js`）并重建游戏数据（`build.js`）
  4. 有更新时自动提交推送，Cloudflare Pages 随即自动重新部署
- 也可在仓库 Actions 页面手动触发（`workflow_dispatch`）

## 📝 数据来源

- **物品列表与中文名**：[Minecraft Wiki（minecraft.wiki）](https://minecraft.wiki)，通过官方 `api.php`（langlinks=zh）获取
- **物品图标**：Minecraft Wiki 官方图床的 128×128 像素图标（约 1488 张）
- **音效**：Minecraft Wiki 官方音频直链（.ogg）
- 数据仅用于非商业同人用途

## 🧩 配置说明

**新增物品**（Minecraft 更新后自动完成，也可手动）：
1. 将图标 PNG 放入 `item/`（文件名 = 英文 ID）
2. 在 `items_zh.txt` 追加一行 `物品id=中文名`
3. 运行 `node update-data.js`（或 `node build.js`）重建数据

**调整线索生成规则**：编辑 `fetch-clues.js`（线索模板、禁用句、数值约束），然后运行 `node fetch-clues.js` 重新生成 `data/clues.json`。线索格式为每个物品 6 条：类别 → 获取方式 → 生存关联 → 唯一特征 → 配方/用途 → 唯一锁定句。

**部署上线**：推荐 Cloudflare Pages（免费、无限带宽、自动应用 `_headers` 缓存策略），仓库链接导入即可。

## 📄 许可证

本项目为**非商用同人作品**，遵守 [Mojang EULA](https://www.minecraft.net/eula)。Minecraft 及其相关资产归 Mojang Studios 所有。代码部分仅供学习交流，请勿用于商业用途。

## 🙏 致谢

- [Minecraft Wiki](https://minecraft.wiki) —— 物品数据、中文名、图标与音效来源
- Mojang Studios —— 创造了 Minecraft 这个伟大的游戏
- 所有为 FogCraft 贡献数据与代码的社区玩家

## 🤖 关于 AI 辅助

本项目的**代码实现（HTML/CSS/JavaScript）及数据抓取脚本**由 [Qoder](https://qoder.com) AI 编程助手辅助生成。

> **人类贡献**：游戏机制设计、UI/UX 交互原型、数据校验、测试验收及项目部署由xian_yu963完成。

所有 Minecraft 相关资产（物品图标、音效名称等）版权归 Mojang Studios 所有，本项目仅供非商业同人学习交流。
