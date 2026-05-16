# 创建案件页 · 视觉重设计方案

日期：2026-05-16
设计来源：`/Users/daixin/Downloads/ui_kits/dashboard/NewCasePage.jsx`

## 背景

依据 ui_kits 设计套件，对「创建案件」页（`/dashboard/cases/create`）的「AI 创建」视图做
视觉重设计。保持页面结构与功能不变，仅升级视觉层。

## 范围

**本次改造（设计稿覆盖）：**
- 欢迎横幅
- AI 案情输入框
- 案例卡 + 区块标题
- 手动创建入口
- 材料选择弹窗（含上传模式）

**不在本次范围：**
- 「填表确认」步骤（`step='confirm'` 视图 + `ManualForm.vue` + 底部操作栏）——设计稿未覆盖，保持现状
- 通用上传组件 `general/fileUploader.vue` 的内部视觉——沿用，不重做
- 其它使用到这些共享组件的页面——不单独处理（见「共享组件策略」）

## 共享组件策略（已与用户确认）

创建案件页由一批跨页面共享的组件拼装。本次**直接改公共组件**，新样式同步生效到所有使用方；
其它页面的整体 UI 后续会按各自设计稿持续更新，届时与新组件样式自然统一。

| 共享组件 | 其它使用方 |
|---|---|
| `caseAnalysis/welcome.vue` | 案件分析、案件详情、智能助手、合同审查新建、文书草稿 等 9 处 |
| `ai/AiPromptInput.vue` | 智能助手、案件分析、AiChat 等 8 处 |
| `caseAnalysis/example.vue` | 案件分析等 |
| `caseAnalysis/materialSelector.vue` | 案件分析等 |

## 设计令牌映射（设计稿 → 项目）

设计稿用的是占位令牌，实现时一律映射到 `app/assets/css/tailwind.css` 既有令牌，
**不新增、不硬编码颜色**：

| 设计稿 | 项目令牌 / 工具类 |
|---|---|
| `--gradient-hero`（欢迎横幅底） | `bg-gradient-brand-soft`（浅色）+ `dark:bg-gradient-brand-soft-dark`（暗色，新增 token，值取自设计稿 `colors_and_type.css` 的 `--gradient-hero` 深色值 `#06363B→#062847→#050340`） |
| 小索头像盘渐变 `135deg,#1EEDC4,#1E9EED,#090380` | `bg-gradient-brand`（三段品牌渐变，完全一致） |
| 按钮渐变 | `bg-gradient-brand`（沿用项目现有品牌 CTA 风格，如「新建案件」） |
| `--card / --border / --primary / --foreground / --muted-foreground / --muted` | 同名 shadcn 令牌，直接用 `bg-card` `border-border` `text-primary` 等 |
| 文件类型图标配色 | 复用 `~/utils/file` 的 `getFileIconColor` |
| 「小索」渐变文字 | 复用 `general/GradientText.vue` |

## 区块设计

### 1. 欢迎横幅（`caseAnalysis/welcome.vue`）

现状：`bg-gradient-custom` 圆角块 + `IconXiaosuoIcon`（size-14，漂浮）+ 标题/副标题。

改造：
- 容器：品牌柔光渐变背景 + 半透明品牌色描边 + 圆角 14px；右上角加一团品牌色径向光晕（装饰，`aria-hidden`、`pointer-events-none`）
- 小索头像：64px 圆形头像盘，`bg-gradient-brand` 作渐变圆环（3px 内边距），内嵌白色圆 + `IconXiaosuoIcon`；头像盘带柔和品牌投影
- 动效：头像盘保留漂浮（约 3.2s 循环），新增鼠标悬停轻微摆动 + 放大 1.08（scoped 关键帧）
- 标题：标题文本中的「小索」二字用 `GradientText` 渲染为品牌渐变字（按 "小索" 切分；标题不含「小索」时无副作用，兼容全部 9 个使用方）
- 排版：标题约 19px/700、副标题约 13.5px、`text-muted-foreground`

### 2. AI 案情输入框（`ai/AiPromptInput.vue`）

现状：输入卡 `shadow-none border-primary rounded-md`；提交按钮 `PromptInputSubmit`。

改造：
- 输入卡（`data-[slot=input-group]`）：描边改半透明品牌色（`border-primary/35`，约 1.5px）、圆角加大（`rounded-xl`）、加一道品牌色淡投影
- 「提取信息」提交按钮：`bg-gradient-brand` 品牌渐变 + 白字 + 品牌色投影
- 「上传材料」按钮：维持左侧次要（ghost）样式
- 功能不变：文件列表、识别状态、深度思考、停止/队列按钮等全部保留
- 影响范围：全站 AI 输入框统一变此样式（已确认）

### 3. 案例卡 + 标题（`caseAnalysis/example.vue`）

现状：`Card shadow-none rounded-md`；悬停 `hover:ring-1 hover:ring-primary hover:bg-primary/2`。

改造：
- 区块标题字号微调（约 15px/600）
- 案例卡：静息态加極轻投影（`shadow-sm`，设计稿自带，亦与项目阴影规范一致）
- 悬停：**保留描边高亮**（主色描边 + 极淡底色，即现状的 hover），不改为上浮
- 圆角统一 `rounded-xl`
- 栅格不变：桌面 2 列 / 移动 1 列

### 4. 手动创建入口（`pages/dashboard/cases/create.vue`）

现状：右下角 `Button variant="link"` +「手动创建」+ 箭头。

改造：基本已符合设计稿（链接样式、悬停下划线由 shadcn link variant 提供）。仅核对字号/间距，无结构改动。

### 5. 材料选择弹窗（`caseAnalysis/materialSelector.vue`）

现状：shadcn `Dialog`；类型筛选用 `Button` 变体；搜索 `Input`；上传模式用 `GeneralFileUploader`；文件行用 `Checkbox`。

改造（保持全部功能：无限滚动、真实文件加载、加密、上传）：
- 弹窗：圆角加大、投影更精致
- 文件类型筛选「全部/文档/图片/音频」：选中项 `bg-gradient-brand` 高亮 + 投影，未选中保持描边按钮
- 「上传文件」「确认选择」按钮：`bg-gradient-brand` 品牌渐变（确认按钮禁用态保持灰）
- 文件行：文件类型图标配色块（`getFileIconColor`）、勾选态品牌渐变对勾、选中行品牌淡色底
- 空状态：圆形图标底 + 文案，按设计稿微调
- 上传模式：拖拽区按设计稿做品牌渐变圆形上传图标 + 文案；上传逻辑/组件沿用 `GeneralFileUploader`，仅对齐其容器外观

## 动效

- 小索头像盘：漂浮循环 + 悬停摆动/放大
- 案例卡：悬停描边高亮（过渡）
- 弹窗：沿用 shadcn Dialog 进出场动画
- 全部用 CSS transition / 关键帧，时长参考设计稿（漂浮约 3.2s、过渡约 0.15–0.2s）

## 响应式

按 `DESIGN-MANIFEST.json` 视口矩阵验证（360 / 390 / 430 / 820 / 1024 / 1366 / 1440 / 1920），
无横向溢出。
- 案例卡：`sm` 断点及以上 2 列、以下 1 列
- 材料弹窗：响应式 `min-w` + 移动端搜索框单独成行（保留现状逻辑）
- 输入框 / 欢迎横幅：流式宽度

## 暗色模式

全部通过项目主题令牌实现，深色模式自动适配，不写死颜色。

## 不改动 / 保留

- `step='confirm'` 确认填表视图、`ManualForm.vue`、底部「创建案件」操作栏
- 两步流程（`ai` / `confirm`）与所有业务逻辑、`useCaseCreation` 数据流
- 各组件功能行为（文件识别、无限滚动、加密上传、demo 案例加载等）
