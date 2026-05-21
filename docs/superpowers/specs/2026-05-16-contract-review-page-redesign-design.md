# 合同审查列表页 · 重设计方案

日期：2026-05-16
设计来源：`/Users/daixin/Downloads/ui_kits/dashboard/ContractPage.jsx` + `_shared.jsx`

## 背景

依据 ui_kits 设计套件，对「合同审查」列表页（`/dashboard/contract`）做重设计。
本次不只是换皮：设计稿把「新建审查」从弹窗改成页面内常驻卡片、审查历史从表格改成
卡片列表，属于结构级调整。功能与数据流保持不变。

属于 dashboard 逐页重做计划的一环（前序：创建案件页 `2026-05-16-create-case-page-redesign-design.md`）。

## 范围

**本次改造（设计稿覆盖）：**
- 页头（采用设计套件的 eyebrow 页头样式）
- 新建审查：弹窗 → 页面内常驻卡片
- 筛选条：状态下拉 → 分段控件 + 搜索框
- 审查历史：桌面表格 / 移动卡片 → 桌面与移动统一卡片列表
- 空态、加载态按新风格刷新

**不在本次范围：**
- 合同审查详情/报告页（`/dashboard/contract/[id]`）——设计稿未覆盖，另行安排
- 后端接口——不改动（详见「数据与接口」）
- 合同详情页 `RiskListPanel` 的业务逻辑——仅因共享组件重构而连带换新样式（见下）

## 已确认决策

1. 改造范围：仅列表页。
2. 新建审查：改成页面内常驻卡片。
3. 筛选：保留状态筛选（改成分段控件样式），**不做风险筛选**——风险等级非数据库字段，
   后端无法直接按风险查询，且无对应排序字段。
4. 列表形态：桌面端也改成卡片列表。
5. 实现方案 A：抽出共享「新建审查表单」组件，列表页内嵌、弹窗引用，零逻辑重复。

## 实现方案（方案 A）

`NewReviewDialog.vue` 同时被本列表页与合同详情页的 `RiskListPanel.vue` 使用，**不能删**。
把新建审查的全部逻辑（选择文件 / 文件库 / 粘贴文本 / 提交）抽进一个共享表单组件：

| 组件 | 职责 | 变更类型 |
|---|---|---|
| `pages/dashboard/contract/index.vue` | 页面编排：页头、内嵌新建卡片、筛选条、卡片列表、分页、删除确认、`?new=1` 滚动高亮 | 重写 template |
| `assistant/contract/ContractCreateReviewForm.vue` | **新增**。共享新建审查表单：标题行（标题 + 分段 Tab）、上传/文件库/粘贴、提交。props `caseId`，emit `created` | 新增 |
| `assistant/contract/ContractReviewCard.vue` | **新增**。单条审查记录卡片 | 新增 |
| `assistant/contract/NewReviewDialog.vue` | 重构为「Dialog 外壳 + 引用 ContractCreateReviewForm」。a11y 用 `sr-only` 的 `DialogTitle/DialogDescription` 兜底 | 重构 |

**副作用（已知并接受）：** 合同详情页 `RiskListPanel` 里的「新建审查」弹窗内部样式会
一并换新——同一套设计系统，行为不变，视觉更统一。

## 设计令牌映射（设计稿 → 项目）

设计稿用占位令牌，实现时一律映射到 `app/assets/css/tailwind.css` 既有令牌，**不新增、不硬编码颜色**。
设计套件令牌（`--tint-*`、品牌渐变等）经核对已在 `tailwind.css` 就位（含浅色 + 暗色）。

| 设计稿 | 项目令牌 / 工具类 |
|---|---|
| `--card / --border / --foreground / --muted-foreground / --muted / --primary / --destructive` | 同名 shadcn 令牌：`bg-card` `border-border` `text-muted-foreground` 等 |
| `PrimaryButton` 两段渐变 `135deg,#1E9EED,#090380` | `bg-gradient-brand-button`（两段品牌按钮渐变，与设计稿一致；符合品牌按钮规范） |
| 上传进度条渐变 `90deg,#1E9EED,#090380` | `bg-gradient-brand-button` |
| `TintIcon tint="navy"`（文件图标底） | `--tint-navy-bg` / `--tint-navy-fg`（已在 tailwind.css） |
| 拖拽上传区微光底纹 | 复用 `tailwind.css` 已有的拖拽区品牌微光底纹样式 |
| 状态徽章配色 | 沿用 `index.vue` 现有 `STATUS_CLASS`（pending=muted、reviewing/awaiting_stance/rebuilding=primary、completed=emerald、failed=rose），仅微调 |

## 区块设计

### 1. 页头

采用设计套件 `_shared.jsx` 的 `PageHeader` 样式：
- eyebrow：小号大写、品牌色、字距放宽——文案「CONTRACT REVIEW · 合同审查」
- 标题：「合同审查」，约 28px / 700、字距收紧
- 副标题：「一键扫描合同条款风险、缺失项与改进建议」，`text-muted-foreground`
- 移除原右上角「新建审查」按钮——新建已变为下方常驻卡片

> 这是首个采用 eyebrow 页头的 dashboard 列表页，确立后续列表页的页头范式。

### 2. 新建审查卡片（`ContractCreateReviewForm.vue`，内嵌在页面顶部卡片中）

卡片头部一行：左侧标题「发起新的合同审查」+ 副标题；右侧分段 Tab `[选择文件 | 粘贴文本]`。

**「选择文件」Tab：**
- 拖拽区：虚线描边圆角块，品牌微光底纹；拖拽中高亮品牌色描边。**只负责本机 .docx 上传**
  （拖入或点击 → 原生文件选择器，`accept=".docx"`）。上传中显示品牌渐变进度条 + 百分比。
- 拖拽区下方「── 或 ──」分隔线 + 独立按钮「从文件库选择已上传的合同」→ 打开
  `caseAnalysis/materialSelector.vue`（复用现有文件库弹窗）。
- 已选文件态：文件卡（染色文件图标 + 文件名 + 大小 + 来源「本机上传 / 来自文件库」+「已就绪」徽章 + 移除按钮）。
- 底部：左「支持 .docx · 单文件 ≤ 20 MB」，右「开始审查」按钮（`bg-gradient-brand-button`，未就绪禁用）。

**「粘贴文本」Tab：**
- `Textarea`（等宽字体）+ 字数计数 `N / 50,000 字`，超限标红。
- 底部「开始审查」按钮，空文本禁用。

**提交行为：** 调 `POST /api/v1/assistant/contract/reviews`（`sourceType: 'upload' | 'paste'`，
带 `caseId`），成功 `emit('created', reviewId)`。列表页接收后 `toast.success` + 跳转
`/dashboard/contract/{reviewId}`（保留现有行为）。设计稿那条「已发起…排队中」绿色提示条
是 demo 占位，不实现。

校验沿用现状：`.docx` 后缀、≤ 20 MB、粘贴 ≤ 50000 字；非法时 `toast.warning`。

### 3. 筛选条

- 状态筛选：分段控件，`bg-muted` 容器内 5 个分段——`全部 / 审查中 / 等待立场 / 已完成 / 失败`。
  选中态按设计稿用 `bg-card` + 轻投影（iOS 式分段控件，**非渐变药丸**），与设计稿一致。
- 搜索框：右侧，前置放大镜图标，`refDebounced` 300ms 防抖（沿用现状）。
- 移除原「重置」按钮——点「全部」分段即清状态、搜索框自带清除。
- 设计稿的「排序」下拉依赖评分字段，真实数据无评分，不实现。
- 移动端：分段控件与搜索框上下两行排布，分段控件可横向滚动避免溢出。

### 4. 审查历史卡片列表（`ContractReviewCard.vue`）

区块标题「审查历史」+ 灰色计数「共 N 份」。

桌面与移动统一为卡片列表（取代桌面表格）。单卡内容：
- 左侧：染色文件图标（`tint navy`，内嵌 `FileText`）。
- 主体：合同名（粗体，溢出省略）；下一行元信息——状态徽章、合同类型、风险条数、时间。
- 风险条数：`N 高`（红）/ `N 中`（琥珀）；`totalRiskCount === 0` 显示「—」。
- 归属案件：若 `caseId` 存在，显示「归属案件 #X」。
- 整卡可点击跳转 `/dashboard/contract/{id}`；静息无阴影，hover 才显阴影 + 主色描边
  （遵循项目卡片阴影规范）。
- 删除：右上角小图标按钮，桌面 hover 显现 / 移动端常显；点击走现有
  `useAlertDialogStore.showErrorDialog` 删除确认（保留现状，不丢功能）。
- 设计稿单卡里的「评分 X/100」「查看报告」按钮：评分无对应字段不展示；整卡可点已替代
  「查看报告」按钮，不单设按钮（与现状一致）。

分页：沿用 `general/pagination.vue`，`PAGE_SIZE = 20` 不变。

### 5. 空态 / 加载态

- 加载态：居中 `Loader2` 旋转 + 「加载中…」。
- 空态：虚线描边圆角块 + `FileText` 图标 + 「暂无合同审查记录」+ 引导文案
  （引导改为「在上方卡片上传或粘贴合同，开始第一次扫描」，因新建入口已上移为常驻卡片）。
- 均按新卡片风格刷新样式。

### 6. `?new=1&caseId=X` 入口行为

案件详情页「新建合同审查」入口仍跳 `/dashboard/contract?new=1&caseId=X`。
新行为：页面挂载后不再自动弹窗，而是**滚动到新建审查卡片并短暂高亮描边**（约 2s 的
品牌色 ring，CSS 过渡）；`caseId` 通过 prop 传入 `ContractCreateReviewForm`，新建的
审查归属该案件。

## 数据与接口

- 列表接口 `GET /api/v1/assistant/contract/reviews`：沿用 `skip / take / status / q / caseId`
  查询参数，**不改后端**。
- 新建接口 `POST /api/v1/assistant/contract/reviews`、删除接口 `DELETE …/{id}`：不变。
- `ReviewListItem` 类型不变；`REVIEW_STATUS_LABEL` 仍从 `#shared/types/contract` 单一来源 import。

## 动效

- 拖拽区：拖入时描边/底色过渡（约 0.15s）。
- 上传进度条：宽度过渡。
- 卡片：hover 阴影 + 描边过渡（约 0.15–0.2s）。
- `?new=1` 高亮：进入时品牌色 ring，约 2s 后淡出。
- 弹窗（`NewReviewDialog`）：沿用 shadcn Dialog 进出场动画。
- 均用 CSS transition / 关键帧。

## 响应式

按 `ui_kits/DESIGN-MANIFEST.json` 视口矩阵验证（360 / 390 / 430 / 820 / 1024 / 1366 / 1440 / 1920），
无横向溢出。
- 新建卡片头部：窄屏标题与分段 Tab 换行堆叠。
- 筛选条：窄屏分段控件与搜索框分两行。
- 历史卡片列表：流式宽度，单列。

## 暗色模式

全部通过项目主题令牌实现，深色模式自动适配，不写死颜色。

## 不改动 / 保留

- 后端所有接口、`ReviewListItem` 数据结构。
- 新建审查的校验规则、上传链路（`useBatchUpload` / `useFileStore`）、文件库弹窗
  （`materialSelector.vue`）、提交后跳详情页的行为。
- 删除确认弹窗（`useAlertDialogStore`）。
- `definePageMeta`（layout / title / icon）。
- 合同详情页 `RiskListPanel` 的业务逻辑（仅其内嵌弹窗连带换新样式）。

## 测试策略

- 组件单测（Vitest）：`ContractCreateReviewForm` 的校验分支（非 .docx / 超大 / 空粘贴 /
  超长粘贴）、Tab 切换、提交 emit；`ContractReviewCard` 的风险条数渲染与状态徽章。
- E2E（chrome-devtools）：上传 .docx 发起审查、粘贴文本发起审查、状态分段筛选、搜索防抖、
  删除确认、`?new=1` 滚动高亮、暗色模式与各视口无溢出。
