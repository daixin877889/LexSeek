# 合同审查详情页 · 重设计方案

日期：2026-05-17
设计来源：`/Users/daixin/Downloads/ui_kits/dashboard/ContractReviewDetailPage.jsx`
令牌来源：`/Users/daixin/Downloads/LexSeek UI 重构/colors_and_type.css`（权威 token）

## 背景

依据 ui_kits 设计套件，对「合同审查详情页」（`/dashboard/contract/[id]`）做重设计。
此页是前序「合同审查列表页重做」（`2026-05-16-contract-review-page-redesign-design.md`）
明确"另行安排"的延后项，属于 dashboard 逐页重做计划的一环。

设计稿文件头注释写着"结构 1:1 复刻、布局/元素不改、只换配色"，但设计稿本身相比
现有页面做了三处交互层面的改动（详见「已确认决策」）。注释与内容自相矛盾，已就范围
与用户确认：**以设计稿实际内容为准**。

## 范围

**本次改造（设计稿覆盖 + 用户确认连带）：**

| 区域 | 文件 | 改动类型 |
|---|---|---|
| 主容器 / 头部 / 横幅 | `assistant/contract/ContractReviewPanel.vue` | 头部操作栏、未保存提示、本轮变化横幅、只读横幅按设计稿重做；三栏框架保留 |
| 左栏·版本时间线 | `assistant/contract/ContractVersionTimeline.vue` | 视觉重做（节点、收起态、备注编辑） |
| 中栏·合同预览 | `assistant/contract/ContractDocxPreview.vue` | 段落高亮配色、hover「＋」按钮重做 |
| 右栏·风险清单 | `assistant/contract/RiskListPanel.vue` | 结构级改动：新增 [风险清单/审查总览] 标签、风险分速览条；卡片不再就地展开；挂载详情抽屉 |
| 风险卡 | `assistant/contract/RiskCard.vue` | 改成纯卡片；点击改为打开抽屉 |
| **风险详情抽屉（新建）** | `assistant/contract/RiskDetailPanel.vue` | 全新组件：覆盖整个风险栏的详情抽屉，带上一条/下一条导航 |
| 条款差异 | `assistant/contract/RiskClauseDiff.vue` | 视觉重做 |
| 批注气泡 | `assistant/contract/AnnotationBubble.vue` | 视觉重做 |
| 审查总览 | `assistant/contract/OverviewPanel.vue` | 视觉重做；从"常驻顶部"变为"总览标签页内容" |
| 审查进度 | `assistant/contract/ReviewProgress.vue` | 视觉对齐（无设计稿，按新风格） |
| 风险编辑弹窗 | `assistant/contract/RiskEditDialog.vue` | 内容布局按设计稿重做，shadcn Dialog 外壳保留 |
| 导出 PDF 弹窗 | `assistant/contract/ExportPdfDialog.vue` | 同上 |
| 保存版本弹窗 | `assistant/contract/ContractSaveVersionDialog.vue` | 同上 |
| 上传新版本弹窗 | `assistant/contract/ContractUploadNewVersionDialog.vue` | 同上（含分步进度） |
| 立场选择弹窗 | `assistant/contract/StanceSelectionDialog.vue` | 视觉对齐（无设计稿，按新风格） |
| 风险等级配色 | `app/utils/contractRiskLevelStyle.ts` | 取值微调对齐设计稿 |

**不在本次范围：**

- 合同审查**列表页**（`/dashboard/contract`）——已由 `2026-05-16-contract-review-page-redesign-design.md` 覆盖；其专属组件 `ContractCreateReviewForm.vue`、`ContractReviewCard.vue` 不属详情页。
- 跨业务共享组件 `InterruptDispatcher.vue`、`ai/QueuePausedBanner.vue`——不专属合同审查，本次不动。
- 所有后端接口、composable 业务逻辑、数据结构——零改动。

**传导提示：** `ContractReviewPanel` 及其子组件同时被「案件详情页的合同 Tab」与「通用问答跳转的合同审查」复用。重做后这些入口的合同审查界面会一并更新——符合既定"逐页重做、直接改公共组件"策略。

## 已确认决策

1. **重构范围 = 照搬设计稿结构**：采用抽屉式风险详情 + 总览独立标签页 + 风险分速览条，完整还原设计稿的布局与交互，不止换配色。
2. **非完成态一起调视觉**：审查进行中、等待上传空态、立场选择弹窗也按新视觉风格调一致——**只调外观，不碰实时流 / 状态机逻辑**。
3. **去掉设计稿头部的"返回"箭头**：真实页面在 dashboard 布局内、顶部已有面包屑导航，设计稿的返回箭头是独立预览稿的补偿件，不实现。
4. 实现方式：原地改造现有 14 个组件与 1 个配色工具文件，新建 1 个详情抽屉组件，业务逻辑零改动。

## 设计令牌映射（设计稿 → 项目）

设计稿用 `var(--xxx)` 占位令牌 + 少量硬编码；实现时一律映射到 `app/assets/css/tailwind.css`
既有令牌，**不新增、不硬编码颜色**。详情页处于 `.theme-brand` 作用域（挂在 dashboard
布局根节点），`--primary` 即品牌天蓝。

| 设计稿 | 项目令牌 / 工具类 |
|---|---|
| `--card / --border / --foreground / --muted-foreground / --muted / --background / --popover / --primary / --destructive` | 同名 shadcn 令牌：`bg-card` `border` `text-muted-foreground` `text-primary` 等 |
| 实心主按钮、分段控件选中态、抽屉发送按钮 `135deg,#1E9EED,#090380` | `bg-gradient-brand-button text-white` |
| `var(--primary)` 微底（未保存胶囊、总评框、批注 AI 头像、聚焦环） | `bg-primary/10` `text-primary` `border-primary` `bg-primary/5` |
| 风险等级语义色（高=红 中=橙 低=灰蓝） | 收口在 `contractRiskLevelStyle.ts`，见下「风险等级配色」 |
| quote 字符级高亮 `--quote-default/focused/pinned` | 已是全局 `::highlight(quote-*)` 规则（红色下划线），**无需改动** |
| 设计稿硬编码 rgba 风险微染（如 `rgba(220,38,38,0.05)`） | Tailwind 语义类带透明度（如 `bg-red-600/5`），保证深色模式不糊 |
| `--shadow-md / --shadow-lg` | 同名 `shadow-md` `shadow-lg` |

## 风险等级配色（`contractRiskLevelStyle.ts`）

设计稿 `RISK_LV` 取值与现有 `contractRiskLevelStyle.ts` 已基本一致，仅需微调：

| 等级 | 实心徽章（深底白字） | 文档段落左竖线 / 微染底 |
|---|---|---|
| 高 high | `bg-red-500 text-white` | `border-red-600` + `bg-red-600/[0.045]`（保持现状） |
| 中 medium | `bg-orange-500 text-white` | `border-amber-600` + `bg-amber-600/[0.05]`（保持现状） |
| 低 low | `bg-slate-400 text-white`（现 `bg-gray-400`，改 slate 对齐设计稿） | `border-sky-600` + `bg-sky-600/[0.045]`（保持现状） |

聚焦 / 钉住 / 悬停态的段落底色加深与内描边规则保持现有 `RISK_LEVEL_DOCX_FOCUS_CLASS` /
`RISK_LEVEL_DOCX_HOVER_BG`，不变。客户修订处置徽章 `CLIENT_REDLINE_BADGE` 配色不变。

## 区块设计

### 1. 头部与三栏框架（`ContractReviewPanel.vue`）

- 三栏布局保留：版本时间线 ｜ 合同预览 ｜ 风险清单。≥1024px 走可拖拽分栏（`ResizablePanelGroup`），<1024px 上下堆叠（预览上、风险下）。分栏比例持久化逻辑不变。
- **工作区操作栏**：重做成设计稿 `CrdHeader` 的紧凑栏（约 36px 高，`bg-card` + 下边框）。左侧"未保存"小胶囊（`bg-primary/10 text-primary` + 小圆点）；右侧"上传新版本""保存新版本"两个描边小按钮（`h-7 text-xs`）。**不含返回箭头**。
- **本轮变化横幅**：重做成设计稿 `ChangeBanner` 样式——`bg-primary/5` + 上边框 `border-primary/20`、`TrendingUp` 图标、"本轮变化"加粗 + 摘要文案截断、右侧关闭按钮。
- **只读横幅**（历史版本预览）：重做，左侧 `History` 图标 + "查看历史版本 vN"，右侧"返回工作区"链接。
- 三栏容器圆角 / 边框 / 留白对齐设计稿 `crd-main`（gap-2、padding-2，预览栏 `bg-muted/40` 描边，风险栏 `bg-card` 描边）——与现状接近，仅微调。

### 2. 左栏·版本时间线（`ContractVersionTimeline.vue`）

- 重做视觉：节点圆点、连接竖线、选中态（`bg-primary/10` + `border-primary/30`、文字 `text-primary`）、收起态（仅圆点 + vN）、律师备注的查看 / 编辑态。
- 折叠开关、备注编辑保存 / 取消的交互与本地状态保留不变。
- 收起 / 展开宽度（48px / 220px）与持久化 key `contract-timeline-collapsed` 不变。

### 3. 中栏·合同预览（`ContractDocxPreview.vue`）

- `docx-preview` 渲染、锚点定位、quote 高亮、fetchSeq 防护等逻辑**全部不动**。
- 段落风险高亮配色对齐设计稿（红 / 琥珀 / 蓝三色微染底 + 等级色左竖线）——取值已在 `contractRiskLevelStyle.ts`，保持。
- hover 段落浮现的「＋新增风险」按钮重做：品牌色圆形按钮（`bg-primary text-primary-foreground`）、悬浮投影。
- 空态"等待合同上传…"文案按新风格刷新（见「区块 9」）。

### 4. 右栏·风险清单（`RiskListPanel.vue`）

结构级改动：

- **顶部 2 段标签** `[风险清单 N] [审查总览]`：`bg-muted` 容器内分段控件，选中段 `bg-card` + 轻投影。
- **"风险清单"标签内容**：
  - 紧接一条**风险分速览条**（始终可见）：左侧"风险分 NN/100"、分隔线、高 / 中 / 低三色圆点 + 计数。
  - 下方风险卡滚动区。分组保留：外部新增 / 主清单 / 已处置折叠 / 原文已修改（孤立）/ 客户已移除。
  - "隐藏已处置"开关、各分组的折叠 / 展开逻辑不变。
- **"审查总览"标签内容**：整屏渲染 `OverviewPanel`（见区块 7）。
- **风险卡不再就地展开**：点卡片 → `emit('focusRisk', id)`；详情由抽屉承载。
- **去重改进**：当前"外部新增"分组在 `RiskListPanel` 内有一段独立的展开模板（与 `RiskCard` 重复）。重做后外部新增风险统一走 `RiskCard`（`variant="external"`）+ 抽屉，删除重复模板。
- **底部操作栏**重做：导出评审报告 = 描边按钮；下载批注 Word = `bg-gradient-brand-button` 渐变按钮 + 下拉箭头，下拉菜单仍用 shadcn `DropdownMenu`（批注 / 修订 / 两者并存三选项）。
- `riskTab`（list / overview）为组件内本地 `ref`，默认 `list`，不持久化。

### 5. 风险详情抽屉（新组件 `RiskDetailPanel.vue`）

承载原先散落在 `RiskCard` 内联展开区的全部详情渲染。

- **挂载位置**：`RiskListPanel` 内，`position: absolute; inset: 0` 覆盖整个风险栏；`focusedRiskId` 非空时渲染。`bg-card`、圆角、左向投影（抽屉属强调元素，保留阴影）。
- **抽屉头**：风险等级徽章 + 风险类别 + `‹ 第N/共M ›` 上下条导航 + 关闭按钮。
- **抽屉体**（可滚动）：状态徽章行（钉在原文 / 已处置 / AI 已重审 / 客户修订 / 匹配检查项）→ 问题概述 → 分段 / 对照布局段控 → 条款差异（`RiskClauseDiff`）→ 法律依据 → 条款分析 → 法律风险 → 修改建议 → 批注对话线（`AnnotationBubble` 列表 + 回复输入框）。
- **抽屉底**：编辑 / 删除 / 标记已处理 / 标记忽略（已处置时显示"撤销处置"）；孤立风险显示"查看原始语境"。
- **键盘**：← → 切换上一条 / 下一条（按当前风险清单展示顺序），Esc 关闭。沿用现有键盘事件守卫（输入框内、弹窗打开时不触发）。
- **只读模式**：编辑 / 处置 / 回复输入框全部禁用。
- "分段 / 对照"布局段控从原 `RiskListPanel` 顶部移入抽屉内（对齐设计稿）；偏好仍持久化到 `contract-review-risk-card-layout`。

### 6. 风险卡 / 条款差异 / 批注气泡

**`RiskCard.vue`** → 纯卡片：

- 第一行：等级徽章 + 风险类别（溢出省略）+ 钉按钮 + 右向箭头（指示"点开抽屉"，取代原下向箭头）。
- 第二行：自动换行的状态徽章（已处置 / AI 已重审 / 客户修订 / 匹配检查项 / 未定位）。
- 下方：2 行截断的问题概述。
- 卡片底色按 选中 / 钉住 / 悬停 / 刚新增 分态着色（等级色微染），孤立 / 外部新增变体保留左竖线着色。
- 删除全部内联展开（`CardContent` 详情区）——详情迁入抽屉。

**`RiskClauseDiff.vue`** → 视觉重做：

- 字段标签（小图标 + 文字）；完整原文（问题片段下划线高亮）；问题片段（琥珀微底框 `bg-amber-600/8` + 描边）；建议改写（绿色微底框）。
- "对照"模式：行内增删差异（删除红色删除线、新增绿色）。diff 算法逻辑不变。

**`AnnotationBubble.vue`** → 视觉重做：

- 22px 圆头像（AI = `bg-primary/10 text-primary`、律师 = `bg-muted text-muted-foreground`）+ 姓名 + 时间 + 删除按钮 + 正文。

### 7. 审查总览（`OverviewPanel.vue`）

- 视觉重做：环形仪表盘（conic-gradient 风险分）+ 三色计数格 + 高 / 中 / 低要点分组（可点跳转风险）+ 审查清单对照（命中 / 未命中折叠）+ 总评（品牌左竖线 `border-l-4 border-primary` + `bg-primary/5` 微底框）。
- 位置从"常驻风险清单顶部"改为"审查总览标签页的内容"——组件本身重做样式，挂载点由 `RiskListPanel` 的标签切换控制。
- `useContractOverview` / `useContractPlaybookMatch` 逻辑不变。

### 8. 弹窗

风险编辑 / 导出 PDF / 保存版本 / 上传新版本 4 个弹窗：

- **外壳继续用 shadcn `Dialog`**（项目标准、`ui/` 禁改、自带 a11y 与进出场动画）。
- 内容布局按设计稿重做：表单字段、单选项、上传弹窗的拖拽区 + 分步进度。
- 主操作按钮用 `bg-gradient-brand-button`；取消按钮用描边。
- 每个 `DialogContent` 至少补一行 `DialogDescription`（可 `sr-only`）兜底 a11y 告警。
- 弹窗的提交 / 校验 / emit 逻辑不变。

### 9. 非完成态

- **审查进度条**（`ReviewProgress.vue`）：视觉对齐新风格（无设计稿，按新视觉判断处理）。
- **状态横幅**（"AI 正在逐条审查…"）：重做成与 `ChangeBanner` 一致的横幅样式（`bg-primary/10` + `Loader2` 旋转）。
- **空状态**（"等待合同上传…"）：按新风格刷新。
- **立场选择弹窗**（`StanceSelectionDialog.vue`）：视觉对齐（shadcn Dialog 内容重做）。
- 以上**仅调外观**，不改实时流订阅、状态机、SSE、版本管理任何逻辑。

### 10. 交互 / 状态变化

- "点风险卡"从"就地展开"改为"打开抽屉"：`focusedRiskId`（来自 `useContractRiskHighlight`）统一驱动抽屉显隐 + 合同预览高亮。点合同正文高亮段落、点总览要点同样设 `focusedRiskId` → 抽屉打开。
- 移除原先 `RiskListPanel` / `RiskCard` 的就地展开开关（`expandedId`）。
- 详情区操作（编辑 / 删除 / 处置 / 批注增删）的 emit 出口从 `RiskCard` 迁移到 `RiskDetailPanel`；上层 `ContractReviewPanel` 的业务处理函数（`handleArchiveRisk` / `handleAddAnnotation` / `handleCreateRisk` 等）签名与实现不变。
- 新增组件内本地状态：`riskTab`（list / overview）、抽屉显隐（由 `focusedRiskId` 派生）。
- 抽屉上下条导航新增 ← → 键盘支持（现有代码无此功能）。
- 所有 composable（`useContractReview*` / `useContractRiskHighlight` / `useContractReviewVersion` / `useContractReviewExport`）业务逻辑零改动。

## 不改动 / 保留

- 后端所有接口、`#shared/types/contract` 类型、数据结构。
- 全部 composable 的业务逻辑（实时审查流、版本管理、风险锚点定位 / 高亮、导出、立场流程、中断处理）。
- `docx-preview` 渲染链路与 quote 高亮全局 CSS。
- 弹窗的提交 / 校验规则。
- `definePageMeta`（layout / title / icon）、页面 `[id].vue` 的来源条与关联案件逻辑。
- localStorage key：`contract-timeline-collapsed`、`contract-review-risk-card-layout`、`contract-review-split-*`、`contract-hide-archived-risks`、`contract-review-export-mode`。

## 动效

- 抽屉：进出场轻微滑入 + 投影过渡（CSS transition）。
- 卡片：悬停 / 选中态底色与描边过渡（约 0.14s）。
- 标签 / 段控切换：选中段背景过渡。
- 横幅、弹窗：沿用现有 / shadcn 动画。
- 均用 CSS transition，不引入额外动画库。

## 响应式

按 `ui_kits/DESIGN-MANIFEST.json` 视口矩阵验证（360 / 390 / 430 / 820 / 1024 / 1366 / 1440 / 1920），无横向溢出。

- ≥1024px：三栏可拖拽分栏。
- <1024px：合同预览与风险清单上下堆叠（现状逻辑保留）。
- 抽屉在窄屏覆盖堆叠后的风险栏区域，不溢出。

## 暗色模式

全部通过项目主题令牌实现，深色模式自动适配，不写死颜色。设计稿硬编码 rgba 一律换成
带透明度的 Tailwind 语义类。文档纸面（`docx-preview`）按现有约定恒为白色、不随主题翻转。

## 测试策略

- **单元测试**（Vitest）：每个组件改完先跑其相关单测；风险等级配色若有单测同步更新取值。组件层重点覆盖——抽屉的上下条导航边界（首条 / 末条禁用）、标签切换、`focusedRiskId` 驱动抽屉显隐、只读模式禁用态。
- **类型检查**：`npx nuxi typecheck`。
- **全量测试**：所有组件改完后统一跑一次全量，确认业务逻辑无回归。
- **E2E**（chrome-devtools）：完成态三栏渲染、点卡片开抽屉、抽屉上下条 / ← → / Esc、风险清单 ↔ 审查总览标签切换、4 个弹窗、深色模式、各视口无横滚。
- 收尾用 `simplify` 技能优化代码。
