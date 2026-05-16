# 工作台首页 + 外壳 品牌改造 — 设计文档

> 日期：2026-05-16 ｜ 分支：dev

## 背景

营销公开页（首页 / 产品功能 / 价格 / 关于 / 登录注册 / 法律页）已于 2026-05-15 完成品牌改版，视觉切到 logo 的「青绿→天蓝→深蓝」品牌渐变。本次把同一套品牌设计延伸到**用户工作台**（`/dashboard`）的首页与外壳（侧边栏 + 顶栏）。

设计来源：用户提供的设计交付包 `LexSeek UI 重构/ui_kits/dashboard/`（含 Sidebar / TopBar / PromoBanner / StatCard / QuickActions / RecentCases，逆向自现有工作台代码）。

## 范围

**改造**
- 工作台外壳：侧边栏（logo 区 / 菜单 / 用户区）+ 顶栏
- 工作台首页 `/dashboard` 内容区

**不改**
- 工作台子页（案件 / 合同 / 文书 / 检索 / 会员 / 设置 / 工具等）的内容与布局——仅随主题机制继承品牌主色，结构不动
- 后台管理 `/admin`——独立布局，零影响
- shadcn `app/components/ui/**` 基础组件

## 改造机制：主题作用域

营销改版已有 `.theme-brand` 作用域类（`app/assets/css/tailwind.css`），把 `--primary` 改为品牌天蓝并提供 `--wash-page` / `--tint-*` 等 token，挂在 `baseLayout` / 认证页 / 法律页根节点。

本次把 `.theme-brand` **加到工作台布局（`dashboardLayout.vue`）根节点**：
- 整个工作台主色统一为品牌天蓝（亮 `oklch(0.683 0.158 240)`，暗 `oklch(0.755 0.155 230)`）
- 所有工作台子页的 `--primary` 驱动元素（按钮、链接、`bg-primary/10` 选中态等）随之由近黑变天蓝；子页结构不动
- 后台 `/admin` 走 `admin-layout`，拿不到此 class，配色零影响

**已知影响**：`.theme-brand` 会覆盖工作台内「主题色」选择（顶栏 ThemeToggle 的 7 色切换）——工作台将恒为品牌天蓝。这与「整个工作台统一品牌色」的需求一致；主题色切换对后台仍生效。

### token 扩展

`.theme-brand` 现有 `--primary` / `--ring` / `--wash-page` / `--tint-{mint,sky,navy,amber}-{bg,fg}` 已够首页淡彩使用。新增两项：
- `--wash-sidebar`：侧边栏竖向微光晕背景。亮 `linear-gradient(180deg,#F2FBFD 0%,#FFFFFF 35%,#FFFFFF 100%)`，暗 `linear-gradient(180deg,#0E1822 0%,#0A0E18 50%,#0A0E18 100%)`
- `--sidebar-ring`：侧边栏焦点环跟随品牌天蓝

`.dark .theme-brand` 同步加暗色变体。

侧边栏背景经由一条作用域 CSS 规则上色：`.theme-brand [data-sidebar="sidebar"] { background-image: var(--wash-sidebar) }`——不改 shadcn `ui/sidebar` 组件。

## 外壳改造

### 侧边栏

| 部位 | 现状 | 改造后 |
|---|---|---|
| 面板背景 | `bg-sidebar`（off-white 实色） | 叠加 `--wash-sidebar` 品牌微光晕 |
| Logo 区（`logoBox.vue`） | BrandLogo（盒装 logo）+「LexSeek ｜ 法索 AI」 | 保持不动 |
| 菜单选中项（`navMain.vue`） | 灰底圆角 `bg-primary/10` + `text-primary` | 左侧 3px「青→蓝→深蓝」渐变竖条 + `90deg` 青/蓝淡渐变底 + `text-primary` 中粗 |
| 菜单悬停项 | shadcn 默认 | 保持 |
| 用户区头像（`navUser.vue`） | `AvatarFallback` 普通灰底「LS」 | `AvatarFallback` 改品牌渐变填充 + 白字「LS」 |

折叠成图标栏、移动端 Sheet 抽屉、RBAC 菜单数据源均不变。

### 顶栏

`dashboardLayout.vue` 内联 `<header>`：
- 现 `bg-background border-b` → `bg-background/70 backdrop-blur-md border-b`（半透明 + 毛玻璃）
- 高度保持 48px（`h-12`）
- 面包屑、主题切换、移动端 logo / 菜单 / 用户入口均不变
- **不加**通知铃铛（项目无通知系统，详见「设计出入决策」）

## 首页内容改造（`app/pages/dashboard/index.vue`）

整页重写，套用设计稿视觉，**数据接口（`useApi('/api/v1/dashboard')`）、用户信息、跳转、点击行为全部不变**。4 张数据卡 / 4 个快速操作改 v-for 数组驱动（去除内联复制粘贴），全部留在单文件内（重写后 < 500 行，无需拆组件）。

| 区块 | 改造 |
|---|---|
| 分析次数限制提示 | 保持隐藏（`showAnalysisLimits = false`），不动 |
| 活动横幅 | `bg-primary` 平铺 → 品牌渐变横幅（`linear-gradient(95deg,…)`）+ 白色「限时活动」药丸标签 + 两团装饰白光晕 +「点此联系客服」按钮。点击仍调 `wxSupportStore.showQrCode()`。文案沿用现有真实文案 |
| 欢迎语 | 用户名加品牌渐变文字；副标题在「查看您的案件分析概览和最近活动」后补当天日期（dayjs 真实日期） |
| 数据卡片 ×4 | 图标块换品牌四色淡彩（总案件数=sky / 分析次数=mint / 可用积分=navy / 会员等级=amber，用 `--tint-*`）；卡片悬停上浮。积分 / 会员卡片仍可点击跳转 |
| 快速操作 ×4 | 4 图标块换品牌四色淡彩（新建分析 / 我的案件 / 会员中心 / 获取帮助）。**不加**设计稿「小索 AI 助手」渐变卡片 |
| 最新案件 | 卡片悬停上浮；状态徽章沿用现有 `blue-500/10`+`blue-600` / `green-500/10`+`green-600` 手写 Tailwind（即设计系统约定，无需 token 化） |

## 暗色模式

设计稿与 `.theme-brand` 均带完整暗色 token；工作台跟随顶栏「外观模式」切换照常工作。所有新增样式同步给 `.dark .theme-brand` 与 `dark:` 变体。

## 设计出入决策（3 处设计稿与现状冲突，已定）

1. **顶栏通知铃铛**：不加。项目无通知系统，避免无效按钮 / demo 级实现。
2. **活动横幅副文**：不加设计稿新写的「本月仅限新用户，名额有限，先到先得」。保留线上真实运营文案，仅换渐变样式。
3. **小索 AI 助手卡片**：不加。设计稿首页 `QuickActions` 实际只渲染 4 个图标块（`AssistantCard` 在 kit 中定义但未编排进首页），照设计走。

## 文件清单

| 文件 | 改动 |
|---|---|
| `app/assets/css/tailwind.css` | `.theme-brand` / `.dark .theme-brand` 加 `--wash-sidebar`、`--sidebar-ring`；加 `[data-sidebar="sidebar"]` 上色规则；更新注释 |
| `app/layouts/dashboardLayout.vue` | 根节点加 `theme-brand` 作用域；`<header>` 改半透明毛玻璃 |
| `app/components/dashboard/navMain.vue` | 选中项改渐变竖条 + 渐变底 |
| `app/components/dashboard/navUser.vue` | 用户头像块改品牌渐变填充 |
| `app/pages/dashboard/index.vue` | 五大区块整页重写套用品牌视觉，数据 / 行为不变 |

## 验收

- `npx nuxi typecheck` 营销 + 工作台相关文件零类型错误
- 浏览器实测：工作台首页亮 / 暗 / 移动端三态渲染正确，侧边栏折叠正常，控制台无报错
- 真实数据卡片、跳转、活动横幅二维码弹窗、最新案件链接行为不回归
- 后台 `/admin` 配色不受影响
