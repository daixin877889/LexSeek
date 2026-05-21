# 工作台与我的案件 · 阴影统一方案

日期：2026-05-16

## 背景

当前 dashboard 多个页面的阴影深浅、有无不统一，视觉上「看起来很奇怪」。本次先统一
「工作台首页」与「我的案件页」，并把 dashboard 公共框架（侧边栏 / 顶栏）纳入核对范围。
同时沉淀一份最小阴影规范，作为后续全站 UI 统一的基准。

## 现状梳理

### 工作台首页（`app/pages/dashboard/index.vue`）

| 元素 | 当前阴影 |
|---|---|
| 活动横幅 | `shadow-[0_10px_25px_-10px_rgba(9,3,128,0.4)]`（自定义品牌长投影） |
| 数据概览卡 ×4 | `shadow-sm` + `hover:shadow-md` + `hover:-translate-y-1` |
| 快速操作卡 ×4 | `shadow-sm` + `hover:shadow-md` + `hover:-translate-y-1` |
| 最新案件行 | `shadow-sm` + `hover:shadow-md` + `hover:-translate-y-0.5` |

### 我的案件页（`app/pages/dashboard/cases/index.vue` 及子组件）

| 元素 | 当前阴影 |
|---|---|
| 新建案件按钮 | `shadow-lg shadow-primary/25` |
| 快速统计卡 ×3（`<Card>`） | `shadow-sm`（Card 默认），无 hover |
| 筛选工具栏 | 无投影 ← **问题：与相邻统计卡不一致** |
| 视图切换选中态 | `shadow-sm` |
| CasesGrid 卡 | `shadow-sm` + `hover:shadow-md` + `hover:-translate-y-1` |
| CasesList 行 | `shadow-sm` + `hover:shadow-md` + `hover:-translate-y-0.5` |
| CasesMobile 卡 | `shadow-sm`，无 hover（用 `active:scale`） |
| CasesEmpty 按钮 | `shadow-lg shadow-primary/20` ← **问题：与新建案件按钮不一致** |
| CasesEmpty 容器 | 无投影（虚线描边空态，合理保留） |

### 公共框架

侧边栏（shadcn `Sidebar` 默认 variant）、顶栏 `header`（`border-b`）、logo 区、导航
组件——**全部无投影，统一靠描边（border）分隔**。本身已一致，也是应用外壳的标准做法。

## 阴影规范（v1，最小版）

| 层级 | 适用元素 | 阴影做法 | Tailwind 类 |
|---|---|---|---|
| 外壳 | 侧边栏、顶栏、logo 区 | 无投影，描边分隔 | `border` / `border-b`，不加 `shadow-*` |
| 卡片·静息 | 统计卡、工具栏、列表 / 网格 / 移动卡片、概览卡、快速操作卡 | 轻投影 | `shadow-sm` |
| 卡片·悬停 | 可悬停浮起的卡片 | 中投影 + 轻微上浮 | `transition hover:shadow-md hover:-translate-y-1` |
| 品牌 CTA 按钮 | 渐变 / 主色主按钮 | 品牌色光晕，透明度统一 25% | `shadow-lg shadow-primary/25` |
| 促销横幅 | 工作台活动条 | 品牌长投影（hero 层级，刻意突出） | `shadow-[0_10px_25px_-10px_rgba(9,3,128,0.4)]` |
| 分段控件 | 视图切换选中项 | 轻投影（表示当前项浮起） | `shadow-sm` |

## 改动清单

仅涉及「我的案件」相关的 2 个文件，3 处改动：

1. **筛选工具栏**（`cases/index.vue`）——容器加 `shadow-sm`，与正上方统计卡一致。
2. **空状态按钮**（`CasesEmpty.vue`）——`shadow-primary/20` → `shadow-primary/25`，与新建案件按钮一致。
3. **3 张快速统计卡**（`cases/index.vue`）——补 `transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md`，与工作台统计卡的悬停表现对齐。

## 不改动

- 工作台：活动横幅、数据概览卡、快速操作卡、最新案件行——已统一。
- 工作台 4 张统计卡的悬停——保留现状（用户决定，含点不动的卡也保留上浮）。
- 公共框架——核对后确认已一致，无代码改动。

## 范围外（留待后续全站标准）

- `/dashboard/settings`、`/dashboard/membership` 等其它 dashboard 子页
- admin 后台
- 营销页 / 认证页 / 法律页
