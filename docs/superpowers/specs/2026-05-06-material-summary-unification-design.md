# 材料摘要语义统一 + 中间件保底设计

**日期**：2026-05-06
**作者**：戴鑫
**状态**：待审核

---

## 1. 背景

当前案件材料的"200 字简介"机制存在多个问题，导致用户体验和数据架构都不健康：

### 1.1 用户体验痛点

- 用户在文件输入框选完文件后，系统只触发"识别"（OCR/MinerU/ASR），不触发简介生成
- 简介生成发生在"用户提交分析"之后的 Agent 启动路径上，每份材料 5–15 秒，**导致案件初分启动时材料系统提示词里大量出现"待识别"或"摘要生成中"占位符**
- 用户截图实证：m4a 显示"待识别"、PDF/PNG 显示"已识别 — 摘要生成中"，分析模型在材料未就绪时已开始工作，结果质量受影响

### 1.2 数据架构混乱

- **案件材料表的 `summary` 字段** 与 **三种识别记录表（文档/图片/音频）的 `summary` 字段** 同时存在，但只有案件材料表的字段在写入和读取
- 文件被多个案件/草稿引用时，每个案件材料行各存一份简介——**重复存储 + 重复 LLM 调用**
- 音频识别记录的 `summary` 字段名义是"摘要"，**实际存储的是格式化后的完整转录文本**（带说话人和时间戳），与字段命名严重不符
- 文字材料记录（`textContentRecords`）没有 summary 字段，无处可存

### 1.3 现有保底机制覆盖不全

- 已有"材料处理中间件"（`caseProcessMaterialMiddleware`）挂在小索 / 模块对话 / 文书生成上，启动 Agent 前确保材料识别 + 嵌入
- **案件初分（V2 工作流）从未挂这个中间件**——分析启动时材料就绪状况完全靠运气
- 中间件即使被触发，也只等"识别"和"嵌入"，**不等"简介"**——前两者好了简介可能仍未生成
- 中间件等待期间没有任何前端反馈，用户看到 Agent 长时间无响应

### 1.4 触发点重复且非并行

- 当前 7+ 处代码可能触发简介生成（fire-and-forget），相互之间无去重，可能并发对同一材料调多次 LLM
- 多份材料的简介生成虽然 fire-and-forget 是异步的，但触发逻辑用 `for` 循环串行启动，浪费时间

---

## 2. 目标

1. **简介生成提前**：用户在选文件后到提交分析之间这段时间内，简介就已经准备好；分析启动时绝大多数情况无需等待
2. **数据按"文件"存**：简介存储在文件级（识别记录表），同一文件被多个案件引用时天然复用
3. **字段语义统一**：四种材料类型（文字/文档/图片/音频）的"200 字简介"在同一逻辑字段中表达
4. **保底机制收口在中间件**：所有跟材料相关的 Agent（含案件初分 V2）启动前都过同一个中间件，确保识别 + 简介双就绪
5. **保底等待时给用户反馈**：复用现有"材料处理"卡片（`MaterialProcessTool.vue`）+ 升级状态指示，每条材料展示当前处理阶段
6. **杜绝重复调 LLM**：已有简介的不再重做、并发触发去重
7. **并行启动多份材料的处理**

---

## 3. 设计概览

```
┌─────────────────────────────────────────────────────────────┐
│ 主路径（99% 情况，看不到任何等待）                           │
│                                                             │
│ 选文件 → 后端识别（已有）→ 并行触发 200 字简介生成（新）   │
│   │                                                         │
│   ├─ 简介存进识别记录的 summary 字段（按文件，天然复用）   │
│   └─ 状态接口"已就绪"= 识别成功 + 简介非空                  │
│                                                             │
│ AiPromptInput 等到状态接口返回 ready → 解锁发送按钮         │
│                                                             │
│ 用户提交分析 → 创建案件材料行（不再写 summary）             │
│                                                             │
│ Agent 启动前过中间件 → 检查所有材料"识别 + 简介"是否就绪    │
│   ├─ 全部就绪 → 立即放行 Agent                              │
│   └─ 未就绪 → 等待 + 发送 SSE 进度卡片到前端                │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 数据存储

| 材料类型     | 简介存储位置                           |
| ------------ | -------------------------------------- |
| 文字材料     | `textContentRecords.summary`（新增字段） |
| 文档（PDF/Word） | `docRecognitionRecords.summary`（已有字段，启用） |
| 图片         | `imageRecognitionRecords.summary`（已有字段，启用） |
| 音频         | `asrRecords.summary`（语义切换为 200 字简介） |

- **删除** `caseMaterials.summary` 字段
- **删除** ASR 记录中"格式化转录文本缓存"——读音频内容时改为从 `result` JSON 现拼（已有提取函数）

### 3.2 中间件升级

`caseProcessMaterialMiddleware` 是已有中间件，本次升级：

1. 给案件初分 V2 工作流挂上这个中间件（之前未挂，临时通过 V2 入口 `await ensureMaterialsReadyService` 兜底——本次撤掉临时方案，统一走中间件）
2. 中间件内部"就绪判定"从"识别 + 嵌入"升级为"识别 + 嵌入 + 简介"
3. 等待期间通过 SSE 自定义事件向前端发送"准备材料"进度卡片

### 3.3 简介生成函数

新增按"文件 + 类型"维度的简介生成函数，替代当前按"案件材料 ID"维度的函数：

- 入参：`ossFileId` + 材料类型
- 防重判定：从识别记录表读 summary，已非空直接返回
- 并发去重：进程内 inflight Map，同一 ossFileId 第二次调用拿同一个 Promise
- 写入：识别记录表的 summary 字段

---

## 4. 详细设计

### 4.1 字段语义统一

#### 4.1.1 删除字段
- `caseMaterials.summary`：所有读取改为按 ossFileId / materialId 关联识别记录表
- `asrRecords.summary` 的"完整转录文本缓存"语义被废弃；字段不删，**语义切换**为 200 字简介

#### 4.1.2 新增字段
- `textContentRecords.summary`：与其他识别记录表对齐

#### 4.1.3 字段语义对齐表

| 表                          | summary 字段语义（统一后） |
| --------------------------- | -------------------------- |
| `textContentRecords`        | 200 字简介                 |
| `docRecognitionRecords`     | 200 字简介                 |
| `imageRecognitionRecords`   | 200 字简介                 |
| `asrRecords`                | 200 字简介                 |
| `caseMaterials`             | 字段不存在（已删）         |

### 4.2 简介生成函数

#### 4.2.1 新函数：`generateOssFileSummaryService(ossFileId, type)`

**业务流程**：

1. 根据材料类型选择对应识别记录表 / 文字材料表
2. 查询该文件对应的活跃识别记录
3. 若 summary 已非空 → 直接 return（防重）
4. 检查 inflight Map，若存在 Promise → return 同一个 Promise（并发去重）
5. 否则启动 LLM 调用：
   - 读识别记录的内容字段（markdownContent / result JSON 提取的转录文本 / textContentRecords.content）
   - 截取前 N 字（按类型设定）作为输入
   - 调用 LLM 生成 200 字简介
   - 写回识别记录的 summary 字段
6. inflight Map 清理

**返回**：`Promise<void>`，失败不阻塞主流程，仅日志告警

#### 4.2.2 旧函数处理

- `generateMaterialSummaryService(materialId)` 字面接口废弃
- 内部改为：先查 caseMaterials 找到 ossFileId + type，转调 `generateOssFileSummaryService`
- 保留是为了兼容尚未迁移到新函数的调用点；迁移完成后可移除

### 4.3 触发时机

#### 4.3.1 主路径触发：识别完成时

修改三个识别完成回调：

- **文档（MinerU）异步完成回调**：识别记录写入后 fire-and-forget 触发简介生成
- **音频（ASR）异步完成回调**：识别记录写入后 fire-and-forget 触发简介生成
- **图片（OCR）/ 文字 / docx / md/txt 同步完成路径**：识别完成后 fire-and-forget 触发简介生成

所有触发点统一调用 `generateOssFileSummaryService`，函数内部去重保证不重复执行。

#### 4.3.2 保底路径触发：中间件检查未就绪时

中间件等待轮询期间，对识别已完成但 summary 仍 null 的材料强制 await 一次同步生成（防止简介 LLM 偶发失败导致永远 null）。

### 4.4 状态判定 / 前端等待

#### 4.4.1 状态接口语义升级

`/api/v1/recognition/status/:ossFileId` 接口的 `recognized` 字段判定：

- **现在**：识别记录 status === SUCCESS
- **改后**：识别记录 status === SUCCESS **且** summary 非 null

#### 4.4.2 前端 AiPromptInput

零改动。前端轮询的状态判定自动跟随后端接口逻辑。

### 4.5 中间件保底

#### 4.5.1 现状

`caseProcessMaterialMiddleware`（`server/agents/_shared/case-context/caseProcessMaterial.middleware.ts`）：

- 挂在：小索 / 模块对话 / 文书生成
- 内部调用 `ensureMaterialsReadyService(caseId, userId)`
- 当前行为：识别 + 嵌入并行启动，不等异步任务终态、不等简介

#### 4.5.2 改造

1. **挂载范围扩展**：把这个中间件挂到案件初分 V2 工作流的所有 7 个分析子代理上
2. **就绪判定升级**：在 `ensureMaterialsReadyService` 内部加"终态轮询"，等到所有材料满足以下任一条件：
   - 识别 status === FAILED（识别失败也算终态，让 system prompt 渲染失败状态）
   - 识别 status === SUCCESS **且** 简介已生成
3. **等待期间发 SSE 卡片**：见 4.7
4. **超时兜底**：3 分钟超时后，对仍未就绪的材料 await 一次同步简介生成；之后无论结果如何放行 Agent

#### 4.5.3 幂等性

- 99% 主路径下中间件秒过（材料已就绪）
- 1% 异常路径走等待 + 卡片
- 第二次进入中间件（如多模块串行执行）—— 已就绪材料不会重复触发任何处理

### 4.6 防重 + 并行

#### 4.6.1 触发点防重

所有简介生成触发点（识别回调 + 中间件兜底）统一通过 `generateOssFileSummaryService`，函数内部：

1. select summary 防重
2. inflight Map 并发去重

调用点本身不需要再做 select 检查。

#### 4.6.2 并行启动

中间件检查到多份材料未就绪时：
- 用 `Promise.allSettled` 并行启动所有简介生成任务
- 不再使用 `for` 循环串行触发

### 4.7 UI 进度卡片：复用并增强现有"材料处理"卡片

#### 4.7.1 设计原则

项目里已有 `MaterialProcessTool.vue`（工具卡片，渲染 `process_materials` 工具的 output——一个材料列表，每条左侧绿/灰圆点表示是否已嵌入）。

**本次方案复用这个卡片**——既给 LLM 主动调起 `process_materials` 工具用，也给中间件保底等待时用。前端只有这一个组件，新旧路径渲染逻辑一致。

#### 4.7.2 卡片信息升级

每条材料行从"二态圆点"升级为"五态状态指示 + 进度文字"：

| 状态        | 状态指示          | 行尾文字          |
| ----------- | ----------------- | ----------------- |
| 待处理      | 灰色实心圆        | 待识别            |
| 识别中      | 蓝色脉动圆 + 进度 | 识别中…           |
| 生成简介中  | 蓝色脉动圆 + 进度 | 生成简介中…       |
| 已就绪      | 绿色实心圆        | 已就绪            |
| 处理失败    | 红色叉            | 识别失败          |

整体卡片头部显示"X/Y 已就绪"汇总。

#### 4.7.3 事件契约（中间件保底路径）

新增 SSE 事件类型 `PREPARE_MATERIALS`：

```typescript
PREPARE_MATERIALS = 'prepare_materials'

type MaterialItemStatus = 'pending' | 'recognizing' | 'summarizing' | 'ready' | 'failed'

interface MaterialItem {
  id: number
  name: string
  type: number          // CaseMaterialType
  status: MaterialItemStatus
}

type PrepareMaterialsPayload =
  | { phase: 'start';    toolCallId: string; materials: MaterialItem[] }
  | { phase: 'progress'; toolCallId: string; materials: MaterialItem[] }  // 每次轮询全量推送当前快照
  | { phase: 'end';      toolCallId: string; materials: MaterialItem[]; failedCount: number }
```

中间件每秒轮询一次 → 推送一次全量快照（事件量小，简化前端 diff 逻辑）。

#### 4.7.4 前端拦截与渲染

`useStreamChat` 拦截 `prepare_materials` 事件：

1. **phase=start**：合成一个 toolCall 项，`name='process_materials'`、`toolCallId='prepare-${runId}'`、`state='input-available'`、`args={ materials }`
2. **phase=progress**：找到同 toolCallId 的项，更新 `args={ materials }`
3. **phase=end**：更新 `state='output-available'`、`result={ materials }`

`AiToolRenderer.vue` 已按 toolName 路由到 `MaterialProcessTool.vue`——零路由改动。

#### 4.7.5 MaterialProcessTool.vue 改造

- 数据来源升级：从仅读 `output.materials.embedded` 改为读 `materials.status`（同时支持 input 和 output 两种来源——保底路径数据在 input/args 中）
- 渲染按 4.7.2 表格的五态显示（用 lucide 图标，禁 emoji；进度态用 Tailwind 脉动动画 `animate-pulse`）
- 卡片头部新增 "X/Y 已就绪" 汇总文字

LLM 主动调 `process_materials` 工具的路径同样受益于这次升级——工具 output 的 materials 字段也同步加 `status` 字段，渲染统一。

#### 4.7.6 卡片归属

合成工具卡片用 sentinel toolCallId `prepare-${runId}` 标识，挂在当前会话最新一条 AIMessage 之前作为"前置"步骤，或独立显示。等中间件结束后真正的 LLM 输出接入 AIMessage 流，卡片不再变化。

### 4.8 数据迁移

#### 4.8.1 Prisma migration 内容

- `ALTER TABLE case_materials DROP COLUMN summary`
- `ALTER TABLE text_content_records ADD COLUMN summary TEXT`
- `asr_records.summary` 字段不动（语义切换通过代码改写实现）

#### 4.8.2 历史数据影响

历史数据**不需要任何回填操作**：
- 系统跑起来后，用户访问任何旧案件时，保底中间件会检测到简介缺失，自动并行生成并写入识别记录表
- 用户感知：第一次访问旧案件时看到一次"材料处理"卡片走完进度，后续访问立即放行
- 不写一次性回填脚本

### 4.9 读取改造

所有当前读 `caseMaterials.summary` 的代码点（约 8+ 处）改为通过 ossFileId / materialId 关联识别记录读：

- 系统提示词构建（`moduleContextBuilder`）
- 材料列表 API（用户端 + 管理端）
- `process_materials` 工具
- 案件分析摘要拼接路径
- 文书草稿相关材料
- 检索类工具

提供一个统一 helper：`getMaterialSummariesByMaterials(materials)` —— 输入一批材料对象（含 type + ossFileId / id），返回 Map<materialId, summary>。内部按 type 分组并行查询四张表。

---

## 5. 错误处理

| 失败场景                            | 处理策略                                       |
| ----------------------------------- | ---------------------------------------------- |
| 简介 LLM 调用失败                   | 日志告警，summary 保持 null。下次触发会重试   |
| 识别成功但内容字段为空              | 简介函数返回，summary 保持 null               |
| 中间件等待 3 分钟仍未就绪           | 强制 await 一次同步生成；之后放行 Agent        |
| 同一文件并发多次触发简介生成        | inflight Map 复用同一 Promise                  |
| SSE 事件发送失败（Redis 不可用等）  | 日志告警，不阻塞主流程                         |
| 旧代码仍按 caseMaterials.summary 读 | 编译期类型错误（字段已删）→ 必须修复          |

---

## 6. 测试策略

### 6.1 单元测试

- `generateOssFileSummaryService`：四种类型分支、防重判定、inflight Map 去重
- 状态接口 `recognized` 判定：识别 SUCCESS + summary null/非 null 两种情况
- 中间件就绪判定：所有材料就绪、部分未就绪、超时兜底
- 读取 helper：四种类型的 join 正确性、空文件 / 软删除过滤

### 6.2 集成测试

- 选文件 → 识别完成 → 简介自动生成的完整链路
- 案件初分 V2 启动前材料就绪：材料已 ready 立即放行；材料未 ready 等待 + 发卡片
- 多个 Agent 共用同一案件、并发启动时简介只生成一次

### 6.3 E2E（chrome-devtools）

- 用户选文件 → 等待按钮解锁 → 提交 → 分析正常进入
- 异常路径：手动构造材料未就绪场景，验证 UI 卡片展示

### 6.4 回归测试

- 全量测试套件（约 11000 测试）
- 重点：所有 material / pipeline / context-builder 相关测试

---

## 7. 影响范围

### 7.1 数据库

- `case_materials` DROP `summary` 字段
- `text_content_records` ADD `summary` 字段

### 7.2 服务端代码

| 模块                           | 改动类型           |
| ------------------------------ | ------------------ |
| 材料服务（material.service）   | 新增/修改 简介生成 |
| 材料 pipeline                  | 中间件就绪判定升级 |
| 案件材料处理中间件             | 行为升级 + V2 挂载 |
| 三种识别完成回调               | 加触发简介生成     |
| 状态接口                       | 判定逻辑升级       |
| 系统提示词构建器               | 改读取来源         |
| `process_materials` 工具       | 改读取来源         |
| 案件初分 V2 入口               | 撤回临时 await，改挂中间件 |
| 共享类型 `agentEvent`          | 新增 PREPARE_MATERIALS |

### 7.3 前端代码

| 模块                            | 改动类型                                      |
| ------------------------------- | --------------------------------------------- |
| `useStreamChat`                 | 新增拦截 `prepare_materials` → 合成 toolCall  |
| `MaterialProcessTool.vue`       | 渲染升级（五态状态指示 + 进度脉动 + 头部汇总） |
| `AiPromptInput`                 | 零改动                                         |

### 7.4 测试代码

- 凡涉及 `caseMaterials.summary` 字段或 ASR 读 summary 的测试都要改造
- 新增本设计涉及功能的单测 / 集成测试

---

## 8. 关键决策（已拍板）

1. **简介长度统一 200 字**——所有类型同一 prompt 模板，实施简单
2. **不写历史数据回填脚本**——保底中间件首次访问自动覆盖
3. **UI 复用现有"材料处理"卡片**（`MaterialProcessTool.vue`）—— 同一组件支持工具调用和保底两种数据来源
4. **保底卡片用 sentinel toolCallId `prepare-${runId}`** —— 零侵入挂入会话流

---

## 9. 不在本次范围

- **历史卡住数据的批量回填脚本**——可作为单独优化任务后续做
- **简介展示 UI（材料列表显示 200 字简介给用户看）**——本次仅保证 LLM 系统提示词里有简介；用户可见 UI 是单独需求
- **简介质量评估 / A/B 测试 prompt**——后续优化

---

## 10. 验收标准

1. 用户从选文件到点击发送的总耗时与现状基本一致（识别完成即可发送）
2. 案件初分启动后，材料系统提示词中**不再出现"待识别"或"摘要生成中"占位符**
3. 同一份文件在 N 个案件中复用时，简介只生成 1 次
4. 异常入口（demo 案件等）触发保底时，前端能看到"准备材料中"卡片
5. 全量回归测试通过
6. 数据库无 `caseMaterials.summary` 字段、`textContentRecords` 有 `summary` 字段
