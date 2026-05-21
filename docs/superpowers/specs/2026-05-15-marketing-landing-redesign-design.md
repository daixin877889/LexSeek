# LexSeek 营销首页品牌重设计 — 设计文档

> 日期：2026-05-15
> 状态：待评审
> 设计来源：Claude Design 交付包 `lexseek-ui`（`ui_kits/marketing/index.html` 及其组件）

---

## 1 · 背景与目标

LexSeek 的品牌 logo 是一套青绿 → 天蓝 → 深蓝的渐变标识。当前营销首页（`/`）沿用全站默认的「Zinc 近黑色」配色，视觉上与品牌 logo 不呼应。

设计师在 Claude Design 中与产品方反复打磨，产出了一份首页品牌重设计稿。本次目标：**把这份设计稿忠实落地到首页 `app/pages/index.vue`**，让品牌渐变成为首页的视觉主线。

设计稿交付包当前解压在 `/tmp/lexseek_design/lexseek-ui/`，关键参考：
- `project/ui_kits/marketing/` — 首页各区块的 React 原型（视觉与尺寸的权威来源）
- `project/colors_and_type.css` — 全套配色令牌
- `project/assets/module-icons/` — 15 个法律领域 SVG 图标

---

## 2 · 范围

### 本次范围
- 重做首页 `app/pages/index.vue` 的 7 个区块。
- 新增一套品牌配色令牌，并通过一个 `.theme-brand` 作用域类应用到营销公开页布局。
- 重做营销公开页共用的顶部导航栏与页脚（位于 `baseLayout.vue`）。

### 不在本次范围
- 产品功能 / 价格方案 / 关于我们 / 法律条款等其它公开页的**正文**改版（它们会随导航/页脚一起拿到新外壳，正文留待后续各自一轮）。
- 工作台、后台、登录/注册页 — 这些用独立布局，保持现状不变；其品牌化由交付包里 `dashboard/`、`auth/` 两套 UI kit 在后续任务完成。

---

## 3 · 关键决策

| 决策 | 结论 | 理由 |
|---|---|---|
| 主题系统 | **融入，增量叠加，不推翻** | 现有 8 主题 + 明暗模式 + 防闪烁脚本完好；范围限定营销页，推翻会连带破坏工作台/后台。设计稿本身也是「在 Zinc 之上叠加品牌层」。 |
| 品牌色作用域 | 新增 `.theme-brand` 作用域类，挂在营销公开页布局最外层 | 复用项目现成的 `.theme-rose`/`.theme-blue` 同款写法；工作台/后台用别的布局拿不到该 class，配色零影响。 |
| 字体 | 保持系统字体栈（苹方/微软雅黑），**不引入** Inter + Noto Sans SC | 与产品现状一致；设计包文档明确「以代码库为准，Inter/Noto 仅为可移植替身」；避免额外网络字体加载拖慢首屏。 |
| 「AI 原生办案工作台」区块 | **保留**，用品牌配色重做 | 产品方明确要求保留。设计稿无此屏，重做时复用痛点/功能屏的卡片视觉语言，不自创新样式。 |
| 首页代码组织 | 由 347 行内联代码**拆分为 7 个区块组件** | 改版后单文件会超 500 行（项目拆分红线）；设计稿本身即按区块模块化。 |
| 导航/页脚 | 从 `baseLayout.vue` **抽成独立组件**后重做 | 新导航含抽屉菜单，逻辑变重；抽离后布局文件保持精简。 |
| 移动端菜单 | 用项目现成的 shadcn-vue `Sheet` | 不自造抽屉轮子；行为与动画与设计稿等价。 |
| 按钮/卡片 | 用 shadcn-vue `Button`/`Card` 打底，渐变样式以 class 叠加 | 符合项目 UI 规范。 |

---

## 4 · 配色令牌层

全部新增令牌追加进 `app/assets/css/tailwind.css`，**不修改任何现有令牌**。

### 4.1 品牌色常量（追加进 `:root`，明暗通用）

| 令牌 | 值 |
|---|---|
| `--brand-mint` | `#1EEDC4` |
| `--brand-sky` | `#1E9EED` |
| `--brand-navy` | `#090380` |
| `--brand-mint-soft` | `#E0F8F1` |
| `--brand-sky-soft` | `#E1F1FE` |
| `--brand-navy-soft` | `#E5E4F2` |
| `--gradient-brand` | `linear-gradient(135deg, #1EEDC4 0%, #1E9EED 50%, #090380 100%)` |
| `--gradient-brand-soft` | `linear-gradient(97deg, #E0F8F1 0%, #E1F1FE 50%, #E5E4F2 100%)` |

### 4.2 `.theme-brand` 作用域类

`.theme-brand` 把主色改为品牌天蓝，并提供随明暗切换的品牌专用令牌。它是**布局固定 class**，不加入 8 主题切换器。

**`.theme-brand`（浅色）**

| 令牌 | 值 |
|---|---|
| `--primary` | `oklch(0.683 0.158 240)` （= 品牌天蓝） |
| `--primary-foreground` | `oklch(0.985 0 0)` |
| `--ring` | `oklch(0.683 0.158 240)` |
| `--wash-page` | `linear-gradient(180deg, #FFFFFF 0%, #F2FBFD 35%, #ECF3FE 100%)` |
| `--tint-mint-bg` / `--tint-mint-fg` | `linear-gradient(135deg,#C8F7EA,#9DEDD3)` / `#0BA47C` |
| `--tint-sky-bg` / `--tint-sky-fg` | `linear-gradient(135deg,#CFE9FE,#94CBFA)` / `#0A78D8` |
| `--tint-navy-bg` / `--tint-navy-fg` | `linear-gradient(135deg,#D7D5EE,#B0AADE)` / `#5048C0` |

**`.dark .theme-brand`（深色，用后代选择器匹配 `<html>` 上的 `.dark`）**

| 令牌 | 值 |
|---|---|
| `--primary` | `oklch(0.755 0.155 230)` （提亮以适配近黑底） |
| `--primary-foreground` | `oklch(0.145 0 0)` |
| `--ring` | `oklch(0.755 0.155 230)` |
| `--wash-page` | `linear-gradient(180deg, #0F1115 0%, #0E1822 50%, #0B0F2A 100%)` |
| `--tint-mint-bg` / `--tint-mint-fg` | `linear-gradient(135deg,rgba(30,237,196,.22),rgba(30,237,196,.1))` / `#5BFCD4` |
| `--tint-sky-bg` / `--tint-sky-fg` | `linear-gradient(135deg,rgba(30,158,237,.26),rgba(30,158,237,.12))` / `#82CCFF` |
| `--tint-navy-bg` / `--tint-navy-fg` | `linear-gradient(135deg,rgba(148,140,255,.26),rgba(148,140,255,.12))` / `#BEB8FF` |

### 4.3 Tailwind 工具类暴露
- 渐变（明暗通用）`--gradient-brand` / `--gradient-brand-soft`：按现有 `@theme static` 里 `--background-image-gradient-custom` 的写法登记，生成 `bg-*` 工具类。
- 随明暗变化的令牌（`--wash-page`、`--tint-*`、`--primary`）：保持为 CSS 变量，组件内用 `var()` 或 Tailwind 任意值 `bg-[image:var(--wash-page)]` 引用。

### 4.4 作用域生效原理
- `--primary`/`--ring` 在 `.theme-brand` 子树内被覆盖 → 营销页内的 shadcn `Button`、focus ring、导航选中态、区块小标题自动变品牌天蓝。
- `--background`/`--card`/`--muted` 等**不被** `.theme-brand` 改写 → 营销页底色仍是白（浅）/ 近黑（深），由品牌渐变区块与天蓝点缀承载品牌感。
- 工作台/后台用 `dashboardLayout`/`admin-layout`，拿不到 `.theme-brand`，`--primary` 仍是 Zinc 近黑 → 完全不受影响。

---

## 5 · 首页结构（7 屏）

页面背景明暗交替：开场底纹 → 白 → muted → 白 → muted → 白 → 品牌渐变。所有区块横向最大宽度 1200px 居中；尺寸/间距/阴影/圆角以交付包 `ui_kits/marketing/*.jsx` 为像素权威。

| # | 区块 | 组件 | 要点 |
|---|---|---|---|
| 1 | 开场 Hero | `LandingHero.vue` | `--wash-page` 底纹 + 两团模糊光晕；NEW 徽章 pill；渐变描边大标题（「专为执业律师打造的」+ 渐变行「AI 办案智能体工作台」）；副文案；双按钮（主按钮文案随登录态在「免费体验/开始分析」间切换，→ `/dashboard/cases/create`；次按钮「了解更多」→ `/features`）；信任行 3 项；右侧 16:9 视频井（`--gradient-brand` 描边框，`<video>` 源与海报沿用 `https://lexseek.cn/video/vcr.mp4`、`/cover.png`）。 |
| 2 | 行业痛点 | `LandingPainPoints.vue` | 小标题「THE PROBLEM · 行业痛点」+ 渐变 H2；3 张统计卡（50%/75%/50%）：顶部 3px 渐变描边、角落柔光、渐变大数字、hover 上浮；配色轮替 mint/sky/navy。文案沿用现有。 |
| 3 | AI 原生办案工作台（保留） | `LandingSolutions.vue` | 保留 3 支柱卡片（分析引擎 / 智能生成系统 / 协同管理平台，含「(即将上线)」）及现有文案；用品牌配色重做：品牌色调图标井（lucide 图标）、底部按钮改品牌渐变。视觉语言取自痛点/功能屏，不自创。背景 muted。 |
| 4 | 核心功能 | `LandingFeatures.vue` | 背景 muted；小标题「FEATURES · 核心能力」+ 渐变 H2；8 张功能卡（手机 2 列 / 桌面 4 列），每卡一个领域图标井（48×48 圆角，mint/sky/navy 色调轮替），图标用 `module-icon` SVG 经 `mask-image` 上色；hover 上浮。 |
| 5 | 三步流程 | `LandingWorkflow.vue` | 小标题「HOW IT WORKS」+ 渐变 H2；3 张步骤卡（输入案情 / AI 分析 / 获取结果），每卡含大号编号水印（01/02/03）、柔光晕、色调图标井；卡间渐变虚线箭头连接（移动端堆叠并隐藏箭头）。 |
| 6 | 办案工具 | `LandingTools.vue` | 背景 muted；小标题「UTILITY TOOLS」+ 渐变 H2；保留现有 10 个工具卡及其 `/dashboard/tools/*` 跳转链接与现有图标，套天蓝色调图标井（手机 2 列 / 平板 3 列 / 桌面 5 列）。 |
| 7 | 行动号召 | `LandingCta.vue` | 满幅 `--gradient-brand` 背景、白色文字；模糊光晕 + 淡 mono logo 水印；磨砂白圆盘里嵌彩色 logo；标题「立即开始使用 LexSeek」；双按钮（白底主按钮 → `/dashboard/cases/create`；磨砂边框次按钮「了解更多」→ `/features`）。 |

> 设计稿移除了现有首页「功能屏」「流程屏」下方重复的居中 CTA 按钮——改版后整页 CTA 按钮只出现在 Hero、Solutions、行动号召三处。

---

## 6 · 导航栏与页脚

从 `baseLayout.vue` 抽出为 `app/components/general/MarketingHeader.vue` 与 `MarketingFooter.vue`，`baseLayout.vue` 收敛为「`.theme-brand` 外壳 + Header + `<slot/>` + Footer」。

### MarketingHeader.vue
- 吸顶、底部细线、半透明背景 + 毛玻璃模糊。
- 左侧：`BrandLogo` + 文字标 `LexSeek｜法索 AI`（带 `translate="no"` 防翻译插件）+ 4 个导航链接（首页/产品功能/价格方案/关于我们，带选中态）。
- 右侧：保留现有 `GeneralThemeToggle` 主题切换器；**保留登录态分支** —— 未登录显示「登录」链接 + 品牌渐变「免费注册」按钮；已登录显示「个人中心」+ 用户下拉菜单（沿用现有 `DropdownMenu`、登出逻辑、`?redirect=` 参数）。
- 移动端：汉堡按钮 → shadcn-vue `Sheet` 抽屉，内含 logo、导航链接、登录态对应的 CTA。

### MarketingFooter.vue
- 顶部细线、muted 背景。
- 左侧：`© 2025 上海盛熙律泓教育科技有限公司` + 工信部备案链接（沪ICP备2025118451号）。
- 右侧：隐私政策 / 使用条款 / 联系我们（链接沿用 `/privacy-agreement`、`/terms-of-use`、`/about/#contact`）。

---

## 7 · 文件清单

### 新增
- `app/components/landing/LandingHero.vue`
- `app/components/landing/LandingPainPoints.vue`
- `app/components/landing/LandingSolutions.vue`
- `app/components/landing/LandingFeatures.vue`
- `app/components/landing/LandingWorkflow.vue`
- `app/components/landing/LandingTools.vue`
- `app/components/landing/LandingCta.vue`
- `app/components/general/MarketingHeader.vue`
- `app/components/general/MarketingFooter.vue`

### 修改
- `app/assets/css/tailwind.css` — 追加第 4 节的品牌令牌层。
- `app/pages/index.vue` — 模板改为按序拼装 7 个区块组件；保留 `definePageMeta`、`useSiteSeo`、`softwareApplicationLd` 等 SEO 逻辑。
- `app/layouts/baseLayout.vue` — 根节点加 `theme-brand` class；导航/页脚换成新组件；导航相关逻辑随组件迁移。

### 资源核对
- 功能屏需要 `summary / chronicle / cause / claim / defense / evidence / trend / lawyerLetter` 共 8 个领域图标。核对 `public/images/module_icon/`，缺失的从交付包 `assets/module-icons/`（含全部 15 个）补入。
- logo 复用项目现有 `/logo.svg`（彩色）与 `/logo-white.svg`（行动号召区水印用）。
- 业务组件需显式 `import`（项目已关目录扫描）。

---

## 8 · 暗色模式与响应式

- **暗色**：全程使用第 4 节令牌，`.dark` 由 `<html>` 上的现有逻辑控制，`.dark .theme-brand` 提供品牌令牌深色值，组件无需写死颜色。
- **响应式**：用 Tailwind 标准断点 `md:`(768) / `lg:`(1024) / `sm:`(640) 替代设计稿原型里的 `data-resp` 写法。断点行为：Hero 双栏 → 单栏堆叠；痛点/功能/工具网格逐级降列；流程屏堆叠并隐藏连接箭头；导航在 `lg` 以下收为汉堡 + `Sheet` 抽屉。

---

## 9 · 测试与验收

- **类型检查**：`bun run typecheck`（即 `nuxi typecheck`）。
- **视觉走查**：用 chrome-devtools 打开开发服务器，将实现页面与交付包 `ui_kits/marketing/index.html` **并排逐屏比对**——覆盖 7 屏、明/暗两态、桌面/移动两种宽度、移动端抽屉开合。
- **单元测试**：本页为展示型页面，可单测的逻辑面极小（仅「按钮文案随登录态切换」）。按需为该 computed 行为补一个轻量测试即可，不强行铺测试。
- 编码完成后按项目规范执行 `simplify` 技能优化代码。

---

## 10 · 已知取舍与待确认项

1. **字体**（已定）：保持系统字体栈，英文字母与设计稿的 Inter 略有差异，中文几乎无差。
2. **NEW 徽章文案**：Hero 徽章为「合同审查 · quote 字符级高亮已上线」。该功能在代码库已有实现（见 `tailwind.css` 的 `::highlight(quote-*)` 与近期 contract 提交），文案属实；**请确认是否同意在首页公开宣告该功能**。
3. **功能屏 8 项文案**：设计稿的 8 项与现首页有 2 项不同——设计稿用「判决趋势预测」「律师函生成」，现首页为「法律合理性审查和判决趋势预测」「分析历史记录」。**建议按设计稿，请确认**。
4. **主题切换器在营销页的表现**：营销页固定 `.theme-brand`，顶栏 8 色调色板在营销页点击不产生视觉变化（明暗切换仍正常）。是否后续在营销页隐藏调色板，不在本次范围。
