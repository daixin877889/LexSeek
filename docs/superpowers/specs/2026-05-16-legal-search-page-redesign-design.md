# 法律法规检索页改造设计

> 日期：2026-05-16
> 范围：按 `~/Downloads/ui_kits/dashboard/LegalSearchPage.jsx` 设计稿重做 `/dashboard/legal` 检索 + 列表页 UI。

## 背景

法律法规检索页是 dashboard UI 逐页翻新工作的一站。设计稿位于
`~/Downloads/ui_kits/dashboard/LegalSearchPage.jsx`，配套基础组件在 `_shared.jsx`，
设计 token 权威源为 `~/Downloads/LexSeek UI 重构/colors_and_type.css`。

当前页面功能完整（双模式检索：搜全文 / 搜法条），本次为**纯视觉改造 + 设计稿新增的 3 个元素**，
不改动业务逻辑与数据流向。

## 改造范围

### 涉及文件

| 文件 | 改动 |
|------|------|
| `app/pages/dashboard/legal/index.vue` | 页头、热门检索区、搜全文结果标题/排序/耗时、搜法条结果卡片区 |
| `app/components/legal-search/UnifiedSearchPanel.vue` | 检索面板整体重做（Tab / 搜索输入 / 筛选区） |
| `app/components/legal-search/LegalList.vue` | 桌面表格 + 底部分页重做 |
| `app/components/legal-search/LegalListMobile.vue` | 移动端卡片重做 |
| `app/components/legal-search/StatusBadge.vue` | **新增**：统一的类型 / 状态徽章 |
| `app/composables/useLegalSearch.ts` | 加排序参数（sortBy/sortOrder）+ 检索耗时计时 |
| `app/composables/useArticleSearch.ts` | 加检索耗时计时 |

### 明确不动

- 法条预览页 `app/pages/dashboard/legal/preview/[id].vue` 及其专属组件
  （`LegalPreviewDocument.vue` / `LegalPreviewList.vue`）—— 设计稿未覆盖。
- 法条详情弹窗 `ArticleDetailDialog.vue` —— 设计稿未覆盖，仅其入口（法条卡片）重做。
- 后端接口 —— `server/api/v1/legal/list.get.ts` 已支持 `sortBy/sortOrder`，仅前端接通；
  搜法条接口不变。
- 全局样式文件 `app/assets/css/tailwind.css` —— 状态徽章用项目现有 Tailwind 调色板实现，
  不引入 `colors_and_type.css` 中尚未合入的 `--status-progress-*` / `--status-done-*` token。

## 设计规格

### 1. 页头

页面顶部用设计稿 `PageHeader` 结构，直接在 `index.vue` 模板内写（项目当前无共享 PageHeader 组件，
保持与本次范围聚焦）：

- 小标（eyebrow）：`LEGAL SEARCH · 法律法规检索`，品牌蓝色（`text-primary`）、大写、字距 `tracking`。
- 主标题：`法律法规检索`，`text-2xl md:text-3xl font-bold`。
- 副标题：`覆盖法律 · 行政法规 · 司法解释 · 指导意见，支持法规全文检索与法条语义检索。`，
  `text-sm text-muted-foreground`。

### 2. 检索面板（UnifiedSearchPanel.vue）

一张圆角卡片（`rounded-xl border overflow-hidden`，内部分段，卡片本身 padding 0），三段结构：

**第一段 — 模式切换 Tab**

下划线式 Tab（`搜全文` / `搜法条`），选中态：品牌蓝文字 + 2px 品牌蓝下划线；
未选中：`text-muted-foreground`。改用两个原生 `button` 实现下划线样式，
不再用 shadcn `TabsList` 的灰底胶囊样式。Tab 切换逻辑（`update:activeTab`）保持不变。

**第二段 — 搜索输入行**（上边框分隔）

- 左侧放大镜图标（lucide `Search`）。
- 中间无边框输入框，占满剩余宽度；占位文案按 Tab 区分（沿用当前文案）。
- 右侧「检索」按钮：品牌渐变（`bg-gradient-brand-button`），白字。
- 回车 / 点击均触发检索；沿用当前 `canSearch`（关键词为空则禁用）逻辑与 `loading` 态。

**第三段 — 筛选区**（上边框分隔，浅灰底 `bg-muted/40`）

- 第一行「法律类型」：行内 label + 胶囊按钮组（全部 / 法律 / 行政法规 / 司法解释 / 指导意见）。
  选中态：品牌浅底（`bg-primary/10`）+ 品牌蓝文字；未选中：透明底 + 常规文字。
- 第二行：
  - 「发文机关」（仅搜全文 Tab 显示）：**保留现有可搜索下拉**（`Popover` + 搜索框 combobox），
    重新配色对齐设计稿。理由：真实发文机关数据量大，设计稿的简易原生 `select` 容纳不下。
  - 「生效状态」下拉（全部状态 / 现行有效 / 尚未生效 / 已失效）。
  - 「重置筛选」按钮，`ml-auto` 靠右；描边样式。

`UnifiedSearchPanel` 的 props / emits 接口保持不变（`v-model` 绑定项不增不减），仅模板与样式重做。

### 3. 热门检索区（新增）

检索面板下方一行：

- lucide `Flame` 图标（**不用设计稿的 🔥 emoji**，遵守项目铁律）。
- 「热门检索」label：`text-xs font-semibold text-muted-foreground`，大写字距。
- 一排圆角标签按钮（`rounded-full border bg-card`）。

词表为 `index.vue` 内的前端常量（一组通用法律检索词，如「民法典 合同编」「劳动合同法 §39」
「公司法司法解释（四）」「建设工程施工合同 资质」「招标投标法」）。点击标签 →
填入当前 Tab 的搜索框并立即触发检索。

### 4. 搜全文结果区

**结果标题行**

- 左侧 h2：`找到 {total} 部法律法规（耗时 {elapsed} 秒）`，total 千分位格式化。
- 右侧排序下拉，落地 3 个选项：
  - 按发布日期（默认，`sortBy=publishDate&sortOrder=desc`）
  - 按生效日期（`sortBy=effectiveDate&sortOrder=desc`）
  - 按名称（`sortBy=name&sortOrder=asc`）
- 设计稿里的「按相关性」「按法律位阶」后端无对应能力，不纳入（不做假下拉）。
- 切换排序触发重新检索并回到第 1 页。

**结果表格（LegalList.vue）**

- 卡片容器 `rounded-xl border overflow-hidden`，内部 padding 0。
- 表头浅灰底（`bg-muted/50`），5 列：法律名称（含文号副行）/ 类型 / 发文机关 / 生效日期 / 生效状态。
- 数据行整行可点、`hover:bg-muted/50`，选中行 `bg-muted/30`。
- 类型、生效状态用新增 `StatusBadge` 组件。
- 加载态保留骨架屏，空态保留。

**底部分页**

- 移入表格卡片底部（上边框分隔），左侧「显示第 X–Y 条，共 N 条」，右侧页码。
- 当前页用品牌渐变高亮（`bg-gradient-brand-button` + 白字），其余页描边。
- 分页逻辑（省略号、上/下一页）沿用 `LegalList.vue` 现有 `visiblePages` 实现，仅重新配色。

### 5. 搜法条结果区（index.vue 内）

- 标题 h2：`找到 {total} 条相关法条 · 按语义相似度排序`。
- 卡片列表（`flex flex-col gap-3`），每张卡：
  - 顶行：类型徽章（`StatusBadge`）+ 法条号（品牌蓝、加粗）+ 右侧相似度徽章
    （小圆点 + `相似度 XX.X%`，`ml-auto`）。
  - 法律名称 h3。
  - 章节面包屑，`text-xs text-muted-foreground`。
  - 高亮摘录：3 行截断（`line-clamp-3`），命中关键词高亮（沿用现有 `highlightContent`）。
- **法条号来源说明**：法条搜索结果（`LawSearchResultItem`）没有独立的"条号"字段，
  但 `chapter_hierarchy` 数组由 `buildChapterHierarchy` 构建、含 L5（条级标题）。
  因此：取 `chapter_hierarchy` 末段，若匹配 `第…条` 形式（正则 `/^第[一二三四五六七八九十百千零〇\d]+条/`）
  则作为"法条号"单独展示、其余段作为面包屑；不匹配时不展示法条号、整串作为面包屑。
  此为纯展示层拆分，不伪造数据。
- 列表底部居中提示：`点击法条卡片可查看完整条文与关联案例`。
- 卡片点击仍打开现有 `ArticleDetailDialog`（弹窗本身不改）。
- 加载 / 错误 / 空态保留，重新配色对齐卡片风格。

### 6. 状态徽章组件（StatusBadge.vue · 新增）

设计稿用单一 `StatusPill`（`tone` 区分色调）承载类型与生效状态两类徽章。新建
`app/components/legal-search/StatusBadge.vue`：

- props：`tone: 'info' | 'success' | 'warn' | 'muted'`，默认 `info`。
- 样式：`inline-flex rounded px-2 py-0.5 text-xs font-medium border`，按 tone 取色。
- 色调映射（项目现有 Tailwind 调色板，亮 / 暗双色安全）：

| tone | 用途 | 亮色 | 暗色 |
|------|------|------|------|
| info | 法律 / 尚未生效 | `bg-blue-500/10 text-blue-600 border-blue-500/20` | `dark:text-blue-300` |
| success | 行政法规 / 现行有效 | `bg-emerald-500/10 text-emerald-600 border-emerald-500/20` | `dark:text-emerald-300` |
| warn | 司法解释 | `bg-amber-500/10 text-amber-600 border-amber-500/20` | `dark:text-amber-300` |
| muted | 指导意见 / 已失效 | `bg-muted text-muted-foreground border-border` | 同左 |

类型 → tone 映射：法律 `info`、行政法规 `success`、司法解释 `warn`、指导意见 `muted`。
生效状态 → tone 映射：现行有效 `success`、尚未生效 `info`、已失效 `muted`。

`LegalList.vue` / `LegalListMobile.vue` / `index.vue` 法条卡片三处统一调用，
取代当前零散的 shadcn `Badge` 用法。

### 7. 数据层改动

**useLegalSearch.ts**

- `filters` 增加 `sortBy` / `sortOrder`（默认 `publishDate` / `desc`）。
- `search()` 构建 query 时带上 `sortBy` / `sortOrder`。
- 新增 `searchElapsed: Ref<number>`：`search()` 请求前 `performance.now()`，
  响应后计算差值（秒，保留 2 位小数）。
- 新增 `setSort(sortBy, sortOrder)` 方法：更新排序并回到第 1 页重新检索。

**useArticleSearch.ts**

- 新增 `searchElapsed: Ref<number>`，`searchArticles()` 同样前后计时。

## 暗色模式

所有新增 / 改动元素（页头、检索面板、热门检索标签、状态徽章、结果卡片、分页）
均用 CSS 变量 token 或项目语义 Tailwind 类，渐变按钮用 `bg-gradient-brand-button`。
完成后在浏览器亮色 + 暗色下逐项核对。

## 验证

纯 UI 改造，无法走 TDD。完成后：

1. `bun run typecheck` 通过。
2. chrome-devtools 在**亮色 + 暗色**下实测关键路径：
   - Tab 切换（搜全文 ↔ 搜法条）
   - 搜全文：输入检索、法律类型胶囊、发文机关下拉、生效状态、重置筛选
   - 搜法条：输入检索、法律类型胶囊
   - 热门检索标签点击
   - 搜全文排序下拉切换
   - 表格分页翻页
   - 空态 / 加载态 / 搜法条错误态
   - 检索耗时显示正确
3. 用 `simplify` 技能优化代码。
