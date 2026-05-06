# 材料摘要语义统一 + 中间件保底设计

**日期**：2026-05-06
**作者**：戴鑫
**状态**：定稿（v2 — 经 5 维度审查 + 用户拍板修订）

---

## 1. 背景

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

### 1.4 简介触发分散且不防重

- 当前 7+ 处代码可能触发简介生成（fire-and-forget），相互之间无去重，可能并发对同一材料调多次 LLM
- 触发逻辑用 `for` 循环串行启动，不并行
- 简介生成 LLM 偶发失败时无重试机制

---

## 2. 目标

1. **简介生成提前**：用户在选文件后到提交分析之间这段时间内，简介就已经准备好；分析启动时绝大多数情况无需等待
2. **数据按"文件"存**：简介存储在文件级（识别记录表），同一文件被多个案件引用时天然复用
3. **字段语义统一**：四种材料类型（文字/文档/图片/音频）的"200 字简介"在同一逻辑字段中表达
4. **简介生成统一入口**：所有触发路径都进入 `ensureMaterialsReadyService`，不再分散触发
5. **`process_materials` 工具自动带简介能力**：工具职责升级为"识别 + 嵌入 + 简介"三阶段
6. **保底机制收口在已有中间件**：所有跟材料相关的 Agent（含案件初分 V2）启动前都过同一个中间件，确保识别 + 简介双就绪
7. **保底等待时给用户反馈**：复用现有 `MaterialProcessTool.vue` 卡片，前端展示"准备材料中"
8. **杜绝重复调 LLM**：防重 + 并发去重 + 自动重试 + 失败透明化
9. **并行启动多份材料的处理**

---

## 3. 设计概览

### 3.1 一图说清

```
                     ┌──────────────────────────────────────────┐
                     │  ensureMaterialsReadyService（唯一入口）  │
                     │  ──────────────────────────────────────  │
                     │  阶段 1：识别（已有，不变）                │
                     │  阶段 2：嵌入（已有，不变）                │
                     │  阶段 3：简介（新增 — 并行 + 重试 + 防重） │
                     │  阶段 4：等待终态：识别+简介双就绪         │
                     │  返回：含每条材料 status/summary 的快照    │
                     └────────────┬─────────────────────────────┘
                                  │
       ┌──────────────────────────┼──────────────────────────────┐
       │                          │                              │
       ▼                          ▼                              ▼
┌──────────────────┐    ┌─────────────────────┐    ┌──────────────────────┐
│ 选文件后端口     │    │ AI 主动调工具        │    │ Agent 启动前保底     │
│ recognition/    │    │ process_materials   │    │ caseProcessMaterial  │
│ start API       │    │ 工具（已有）         │    │ Middleware（已有）   │
└──────────────────┘    └─────────────────────┘    └──────────────────────┘
                                  │                              │
                                  ▼                              ▼
                        ┌──────────────────────────────────────────────┐
                        │ MaterialProcessTool.vue（唯一渲染组件）       │
                        │ 三种触发统一展示：状态指示 + 进度 + X/Y 汇总   │
                        └──────────────────────────────────────────────┘
```

### 3.2 数据存储

| 材料类型     | 简介存储位置                                |
| ------------ | ------------------------------------------- |
| 文字材料     | `textContentRecords.summary`（**新增字段**） |
| 文档（PDF/Word） | `docRecognitionRecords.summary`（已有字段，启用） |
| 图片         | `imageRecognitionRecords.summary`（已有字段，启用） |
| 音频         | `asrRecords.summary`（语义切换为 200 字简介） |

- **删除** `caseMaterials.summary` 字段
- **删除** ASR 记录中"格式化转录文本缓存"——读音频内容时改为通过 `extractTextFromAsrResult` 从 `result` JSON 现拼

### 3.3 关键复用

| 复用项                                  | 用途                          |
| --------------------------------------- | ----------------------------- |
| `caseProcessMaterialMiddleware`         | 项目原有，挂 caseMain/moduleAgent/documentMain；本次升级判定 + 补挂 V2 |
| `process_materials` 工具                 | 项目原有，AI 主动调；本次无业务变更，自动获得简介能力 |
| `ensureMaterialsReadyService`           | 项目原有"识别+嵌入"统一入口；本次升级为"识别+嵌入+简介"三阶段 |
| `generateMaterialSummaryService(materialId)` | 项目原有按 materialId 写 caseMaterials.summary；本次改造为按 type 分发到 4 张表 |
| `generateSummaryService(model, text, opts)` | 项目原有 LLM 简介生成；零改动 |
| `createCustomEventEmitter`              | 项目原有 SSE 推送工厂；本次中间件用它（避免裸 publishCustomEvent） |
| `MaterialProcessTool.vue`               | 项目原有材料处理卡片；本次仅渲染升级（五态指示 + 头部汇总） |
| `extractTextFromAsrResult` / `extractTextFromSimplifiedResult` | 两个职责互补的提取函数（一纯文本一带说话人时间戳），本次按场景复用 |
| `MIDDLEWARE_PRIORITY.PROCESS_MATERIAL=10` | 已就位 ✓ |

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

### 4.2 简介生成（改造老函数，不新建）

**核心决策**：不新建 `generateOssFileSummaryService`。把 `generateMaterialSummaryService(materialId)` 改造为：

- 接受 `materialId`，内部读取 `caseMaterials.{type, ossFileId}` 后按类型分发：
  - `CASE_CONTENT` → 写 `textContentRecords.summary`（按 materialId 关联）
  - `DOCUMENT` → 写 `docRecognitionRecords.summary`（按 ossFileId 关联）
  - `IMAGE` → 写 `imageRecognitionRecords.summary`（按 ossFileId 关联）
  - `AUDIO` → 写 `asrRecords.summary`（按 ossFileId 关联）
- 防重：先读对应表 summary，已非空直接早返
- 并发去重：进程内 inflight Map<materialId, Promise<void>>
- **自动重试 3 次**（5s / 15s / 45s 指数退避）
- 重试穷尽后**标记 caseMaterials.status=FAILED 并返回**——不抛错（让上层继续）

调用方只需提供 `materialId`，无须知道材料类型——心智模型干净。

#### 4.2.1 简介长度
所有类型统一 200 字（spec §8 拍板）。

### 4.3 触发时机

#### 4.3.1 主路径：选完文件 → 识别完成 → 自动触发简介

修改三个识别完成回调：
- 文档（MinerU）异步完成回调：识别记录写入后 fire-and-forget 触发简介
- 音频（ASR）异步完成回调：识别记录写入后 fire-and-forget 触发简介
- 图片（OCR）/ 文字 / docx / md/txt 同步完成路径：识别完成后 fire-and-forget 触发简介

但这些触发**仅在 caseMaterials 行存在时调用** `generateMaterialSummaryService(materialId)`；如果只有 OssFile（用户选完文件但还没创建案件），无 materialId 可调——这种场景下简介生成等到 caseMaterials 行被创建（用户提交分析时）由 ensureMaterialsReadyService 内部触发。

#### 4.3.2 工具/中间件路径：ensureMaterialsReadyService 内部并行触发

`ensureMaterialsReadyService` 升级后的"阶段 3"逻辑：

```
对每条 caseMaterials 并行执行：
  - 检查识别记录是否就绪（识别终态 SUCCESS/FAILED）
  - 已就绪但 summary 为空 → 触发 generateMaterialSummaryService（自动重试）
  - 未识别 → 等待识别终态后再触发简介
等待所有材料"识别+简介"达到终态。
```

### 4.4 状态判定 / 前端等待

#### 4.4.1 状态接口语义升级

`/api/v1/recognition/status/:ossFileId` 接口的 `recognized` 字段判定：

- **现在**：识别记录 status === SUCCESS
- **改后**：识别记录 status === SUCCESS **且** summary 非 null

`mineruTask` 命中（识别还没产生 docRecord）时强制 recognized=false，让前端继续轮询。

#### 4.4.2 前端 AiPromptInput

零改动。前端轮询的 `recognized` 字段判定自动跟随后端接口逻辑——发送按钮自动等到位。

### 4.5 中间件保底（项目原有，本次升级）

#### 4.5.1 现状

`caseProcessMaterialMiddleware`（`server/agents/_shared/case-context/caseProcessMaterial.middleware.ts`）：
- 项目**原本就有**，挂在 caseMain / moduleAgent / documentMain
- 内部调用 `ensureMaterialsReadyService(caseId, userId)`
- **V2 案件初分漏挂**

#### 4.5.2 升级范围

1. **挂载补漏**：V2 案件初分的 7 个分析子代理全部挂上中间件（撤回临时 await 方案）
2. **就绪判定升级**：`ensureMaterialsReadyService` 内部加"终态轮询"，等所有材料满足以下任一：
   - 识别 status === FAILED 或 简介标记 FAILED（识别失败也算终态，让 system prompt 渲染失败状态）
   - 识别 status === SUCCESS **且** 简介已生成
3. **等待期间发 SSE 进度卡片**：见 §4.7
4. **失败透明化**（**不设硬超时**）：等到所有材料终态——FAILED 标记的也算终态，不卡用户

#### 4.5.3 与 process_materials 工具职责对比

| 维度       | process_materials 工具         | caseProcessMaterial 中间件     |
| ---------- | ------------------------------ | ------------------------------ |
| 触发方式   | AI 主动决定调用                | Agent 启动前自动跑             |
| 调用时机   | AI 觉得需要时（不一定每次都调）| 每次 Agent 启动前都触发        |
| 能否带参数 | 可以指定 fileIds 范围          | 无差别全量                     |
| 用户感知   | 对话中工具卡片                 | 启动前进度卡片（独立显示）     |

两者**互补**：工具是 AI 按需精确处理，中间件是项目层面的硬性兜底。共享同一 `ensureMaterialsReadyService`。

### 4.6 防重 + 并行 + 自动重试

#### 4.6.1 多层防重
- **进程内并发去重**：`generateMaterialSummaryService` 内部 inflight Map<materialId, Promise<void>>，同 materialId 的并发触发复用同一个 Promise
- **跨进程防重**：开始 LLM 调用前先 select 对应表的 summary，已非空直接 return

#### 4.6.2 并行启动
所有简介生成触发用 `Promise.allSettled` 并行启动，不用 for 循环串行。

#### 4.6.3 自动重试 + 失败透明化（用户拍板 Q2）

`generateMaterialSummaryService` 内部：
- 简介 LLM 失败时自动重试 3 次，间隔 5s / 15s / 45s（指数退避）
- 3 次都失败：
  - 不抛错（不阻塞上层）
  - 把 `caseMaterials.status` 标记为 FAILED（让 system prompt 显示"识别失败"占位）
  - 中间件 SSE 进度卡片对应材料显示红叉 + 文案
- **不设硬超时**：让重试机制自然兜底；ensureMaterialsReadyService 等到所有材料 FAILED 或 SUCCESS+summary 才放行

### 4.7 UI 进度卡片

#### 4.7.1 复用 `MaterialProcessTool.vue`

项目里已有 `MaterialProcessTool.vue`（渲染 `process_materials` 工具的 output——一个材料列表，每条左侧绿/灰圆点）。**本次方案三种触发场景共用这一个组件**，不另造。

#### 4.7.2 卡片信息升级

每条材料行从"二态圆点"升级为"五态状态指示 + 进度文字"：

| 状态        | 状态指示             | 行尾文字       |
| ----------- | -------------------- | -------------- |
| 待处理      | 灰色实心圆           | 待识别         |
| 识别中      | 蓝色脉动 spinner     | 识别中…        |
| 提取摘要中  | 蓝色脉动 spinner     | 提取摘要中…    |
| 已完成      | 绿色实心对号         | 已完成         |
| 处理失败    | 红色叉               | 识别失败       |

> **文案确认**（用户 Q3 拍板）：用"提取摘要中"/"已完成"，不用"生成简介中"/"已就绪"。

整体卡片头部显示"X/Y 已完成"汇总。

#### 4.7.3 事件契约（中间件保底路径）

新增 SSE 事件类型 `PREPARE_MATERIALS`：

```typescript
PREPARE_MATERIALS = 'prepare_materials'

type MaterialItemStatus = 'pending' | 'recognizing' | 'summarizing' | 'ready' | 'failed'

interface MaterialItem {
  id: number
  name: string
  status: MaterialItemStatus
}

type PrepareMaterialsPayload =
  | { phase: 'start';    toolCallId: string; materials: MaterialItem[] }
  | { phase: 'progress'; toolCallId: string; materials: MaterialItem[] }
  | { phase: 'end';      toolCallId: string; materials: MaterialItem[]; failedCount: number }
```

> **`MaterialItem` 不带 type 字段**（前端渲染不需要——精简点 by 5check）。
>
> **轮询间隔 2 秒**（5check 优化点）。

#### 4.7.4 中间件用 `createCustomEventEmitter`（不裸调 publishCustomEvent）

```typescript
const emit = createCustomEventEmitter({ runId, sessionId })
await emit({ name: SSECustomEventType.PREPARE_MATERIALS, data: payload })
```

`runId / sessionId` 从 LangGraph runtime ALS 拿（runtime.ts:444 已暴露），不强制透传给中间件签名——挂载点不必改签名。

#### 4.7.5 phase=end 用 lastSnapshot

`onProgress` 回调内累积 lastSnapshot 引用；end 阶段直接用 lastSnapshot 构造事件——不重新查 DB（5check 优化点 + 修复"失败也强标 ready"bug）。

#### 4.7.6 前端必须扩展 `useMessageParser` 让前置卡片独立渲染（用户 Q4 拍板）

现状：`useMessageParser` 按 AIMessage 精确 id 挂合成 toolCall。中间件 beforeAgent 时**还没有 AIMessage**，sentinel parentId 永远没人匹配——按现状写法**用户根本看不到卡片**。

**必须改造**：useMessageParser 增加"orphan synthetic toolCalls"独立渲染分支——`syntheticToolCalls['__pre_agent__']` 这类 sentinel 单独渲染在消息流头部，不依赖任何 AIMessage。

约 30 行前端代码。完成后保底卡片立刻可见，无需等 AI 说话。

### 4.8 数据迁移

#### 4.8.1 Prisma migration 内容

由 `bun run prisma:migrate --name unify_material_summary` 自动生成（**禁止手写 SQL**）：
- `ALTER TABLE case_materials DROP COLUMN summary`
- `ALTER TABLE text_content_records ADD COLUMN summary TEXT`
- `asr_records.summary` 字段不动（语义切换通过代码改写实现）

> **数据丢失提示**：`prisma migrate dev` DROP COLUMN 时会触发交互确认，开发机回车确认；CI 用 `--accept-data-loss`。

#### 4.8.2 历史数据：不回填（用户拍板）

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
| 简介 LLM 单次失败                    | 自动重试（5s/15s/45s 指数退避）                |
| 简介 LLM 重试 3 次仍失败             | caseMaterials.status=FAILED；卡片显示红叉；放行 Agent |
| 识别成功但内容字段为空              | 简介函数返回，summary 保持 null               |
| 中间件等到所有材料终态               | 不设硬超时——FAILED 也算终态                   |
| 同一材料并发多次触发简介生成        | inflight Map 复用同一 Promise                  |
| SSE 事件发送失败（Redis 不可用等）  | 日志告警，不阻塞主流程                         |
| 旧代码仍按 caseMaterials.summary 读 | 编译期类型错误（字段已删）→ 必须修复          |

---

## 6. 测试策略

### 6.1 单元测试

- `generateMaterialSummaryService`：四种类型分支、防重判定、inflight Map 去重、3 次重试
- 状态接口 `recognized` 判定：识别 SUCCESS + summary null/非 null 两种情况
- 中间件就绪判定：所有材料就绪、部分未就绪、FAILED 视为终态
- 读取 helper：四种类型的 join 正确性、空文件 / 软删除过滤

### 6.2 集成测试

- 选文件 → 识别完成 → 简介自动生成的完整链路
- 案件初分 V2 启动前材料就绪：材料已 ready 立即放行；材料未 ready 等待 + 发卡片
- 多个 Agent 共用同一案件、并发启动时简介只生成一次
- 简介 LLM 故意失败：验证 3 次重试 + FAILED 标记 + 放行流程

### 6.3 E2E（chrome-devtools）

- 用户选文件 → 等待按钮解锁 → 提交 → 分析正常进入
- 异常路径：手动构造材料未就绪场景，验证 UI 卡片展示（包括 orphan 渲染分支）

### 6.4 回归测试

- 全量测试套件
- agent-platform 子目录覆盖率 ≥90%（铁律）
- 重点：所有 material / pipeline / context-builder 相关测试

---

## 7. 影响范围

### 7.1 数据库

- `case_materials` DROP `summary` 字段
- `text_content_records` ADD `summary` 字段
- `asr_records.summary` 字段语义切换（无 schema 改动）

### 7.2 服务端代码

| 模块                           | 改动类型           |
| ------------------------------ | ------------------ |
| 材料服务（`material.service`） | 改造 generateMaterialSummaryService（按 type 分发 + 重试 + inflight） |
| `materialPipeline.service`    | `runRecognitionAndEmbeddingPipeline` 加阶段 3 简介；终态轮询升级；onProgress 回调 |
| 案件材料处理中间件             | 加 SSE 进度推送（用 createCustomEventEmitter） |
| 三种识别完成回调               | 加触发简介生成（OssFile 级 fire-and-forget） |
| 状态接口                       | 判定逻辑升级       |
| 系统提示词构建器               | 改读取来源（用 helper） |
| `process_materials` 工具       | 改读取来源；output materials 加 status 字段 |
| 案件初分 V2 子代理             | 挂 caseProcessMaterialMiddleware；撤回 executor 临时 await |
| 共享类型 `agentEvent`          | 新增 PREPARE_MATERIALS |
| ASR 服务                       | 移除 summary 字段写入；5 处读取改 result 现拼 |

### 7.3 前端代码

| 模块                            | 改动类型                                       |
| ------------------------------- | ---------------------------------------------- |
| `useStreamChat`                 | 拦截 `prepare_materials` 合成 toolCall          |
| `useMessageParser`              | **必须扩展**支持 orphan synthetic 独立渲染      |
| `MaterialProcessTool.vue`       | 五态状态指示 + 头部 X/Y 汇总（用 `Circle as CircleIcon`） |
| `AiPromptInput`                 | 零改动                                          |

### 7.4 测试代码

- 凡涉及 `caseMaterials.summary` 字段或 ASR 读 summary 的测试都要改造
- 新增本设计涉及功能的单测 / 集成测试

---

## 8. 关键决策（已拍板）

1. **简介长度统一 200 字**——所有类型同一 prompt 模板
2. **不写历史数据回填脚本**——保底中间件首次访问自动覆盖
3. **UI 复用现有"材料处理"卡片**（`MaterialProcessTool.vue`）—— 同一组件支持工具调用和保底两种数据来源
4. **保底卡片用 sentinel toolCallId `prepare-${runId}`** —— 零侵入挂入会话流
5. **简介生成统一入口** `generateMaterialSummaryService(materialId)`（改造老函数，按 type 分发，**不新建** generateOssFileSummaryService）
6. **process_materials 工具自动获得简介能力**（service 层升级，工具本身零代码改动；output 加 status 字段供前端渲染）
7. **失败处理**：自动重试 3 次（5s/15s/45s）+ FAILED 标记 + 放行 + UI 红叉（不设硬超时）
8. **5 态前端全展示**（"识别中"和"提取摘要中"分开显示，让用户清楚卡在哪一步）
9. **必须扩展 useMessageParser** 让保底卡片独立渲染（不依赖 AIMessage）
10. **中间件用 `createCustomEventEmitter` 而非裸 publishCustomEvent**

---

## 9. 不在本次范围

- 历史卡住数据的批量回填脚本——保底中间件覆盖
- 简介展示 UI（材料列表显示给用户看）——本次仅保证 LLM 系统提示词有简介
- 简介质量评估 / A/B 测试 prompt——后续优化

---

## 10. 验收标准

1. 用户从选文件到点击发送的总耗时与现状基本一致（识别完成即可发送）
2. 案件初分启动后，材料系统提示词中**不再出现"待识别"或"提取摘要中"占位符**
3. 同一份文件在 N 个案件中复用时，简介只生成 1 次
4. 异常入口（demo 案件等）触发保底时，前端能看到"材料处理"卡片**立即显示**（不依赖 AI 先说话）
5. 简介 LLM 偶发失败时，自动重试 3 次后明确标记失败，UI 显示红叉
6. 全量回归测试通过；agent-platform 子目录覆盖率 ≥90%
7. 数据库无 `caseMaterials.summary` 字段、`textContentRecords` 有 `summary` 字段、`asr_records.summary` 不再存格式化转录文本
