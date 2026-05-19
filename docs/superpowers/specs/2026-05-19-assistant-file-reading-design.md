# 通用问答「读文件」能力设计

> 日期：2026-05-19
> 范围：让「通用问答」（legal-assistant / `assistantMain`）支持读取用户上传的图片、文档、音频等材料。

## 1. 背景与问题

用户在「通用问答」对话框上传图片后针对图片提问，助手完全读不到图片内容，且工具报错：

```json
{ "error": "材料处理失败", "message": "process_materials 工具需要 caseId 或 draftId，当前上下文均缺失" }
```

「通用问答」是一个轻量法律咨询入口：律师接到咨询后先在这里做初步分析，未来还要支持「聊到一定程度直接创建案件」，届时这次对话里上传的文件需要作为案件材料挂接到新案件上。但目前它连"读文件"这一步都不成立。

## 2. 根因

材料子系统（识别 → 嵌入 → 上下文）整套都围绕 `case_materials` 表构建，每条材料记录必须挂在一个**案件**（`caseId`）或一个**文书草稿**（`draftId`）下：

- `process_materials` 工具：`caseId == null && draftId == null` 时直接抛错。
- `search_case_materials` 工具：同样的判断、同样抛错。
- 通用问答 vertical（`SessionScope.ASSISTANT`）走通用 `createAgent` 运行时，`caseId` 恒为 `null`，也从不设置 `draftId`——两个工具在此 scope 下永远不可用。

这不是回归 bug，而是**功能缺口**。设计文档 `2026-05-05-agent-context-sync-unification-design.md` 明确写过："不改通用问答……后续单独立项做'读文件'能力"。但 `2026-05-05-document-agent-tool-refactor-design.md` 在工具清单统一时把 `process_materials` / `search_case_materials` 加进了 `assistantMain` 节点的工具列表、提示词里也写了"识别并嵌入用户本轮新提供的材料"——**工具和提示词对外宣传了能力，后台支撑一直没做**。本设计即正式补齐这块缺口。

## 3. 目标 / 非目标

### 目标

1. 通用问答里上传的图片/文档/音频，经 OCR/ASR 识别后内容能被助手读到。
2. 上传的文件在**整个对话内**持续可用——后续轮次追问无需重传。
3. `process_materials`、`search_case_materials` 两个工具在通用问答 scope 下正常工作。
4. 数据结构为未来「从对话创建案件」预留：把这批材料整体迁移到新案件应是一句 `UPDATE`，识别/向量结果零重算。

### 非目标

- 不实现「从对话创建案件」本身——仅保证数据模型兼容。
- 不改动案件分析（case）/ 文书生成（draft）scope 的现有行为。
- 不引入多模态视觉理解——沿用现有 OCR/ASR 识别流水线（与全站一致）。
- 不改云盘材料选择器（`materialSelector.vue`）的交互。

## 4. 设计概览

核心思路：给材料一个新的归属维度——**会话**。`case_materials` 表已有 `caseId` / `draftId` 两个可空归属列，再加第三个 `sessionId`（对话标识）。通用问答里上传的文件按需建成材料记录，归属填当前对话的 `sessionId`。

```
用户上传文件 → 助手对话
        │
        ▼
[通用问答材料预处理中间件]  beforeAgent 阶段
   解析消息里的 __ATTACHMENTS__ 附件清单 → ossFileId 列表
   按 (sessionId, ossFileId) 建/复用 case_materials 记录
   跑识别 + 摘要 + 嵌入流水线
   推送「材料处理中」进度卡片（SSE）
        │
        ▼
[助手 Agent 运行]
   process_materials  ← 会话分支：按 sessionId 取本对话全部材料内容
   search_case_materials ← 会话分支：在本对话材料里语义检索
```

处理动作放在 `beforeAgent` 中间件里**确定性执行**（解析附件清单是服务端逻辑，不依赖大模型自己记得传文件 ID），与案件分析里的 `caseProcessMaterialMiddleware` 同构。工具则负责把内容"拉"进模型上下文。

## 5. 数据模型变更

### 5.1 `case_materials` 新增 `sessionId` 列

`prisma/models/case.prisma` 的 `caseMaterials` 模型新增：

```prisma
/// 关联的对话会话标识（通用问答场景使用，对应 caseSessions.sessionId / LangGraph thread_id）
sessionId String? @map("session_id") @db.VarChar(100)
```

并新增索引 `@@index([sessionId], map: "idx_case_materials_session_id")`。

- 三个归属列 `caseId` / `draftId` / `sessionId` 语义为**可叠加**（非互斥）：同一 `ossFile` 全局只建一条材料记录，多个归属列按需补齐（沿用 `ensureMaterialsReadyForDraftService` 已有的"补齐缺失字段"逻辑）。
- 同步修正模型里 `caseId` / `draftId` 注释中"与 caseId 互斥"等过时描述。
- 迁移通过 `bun run prisma:migrate --name add_session_id_to_case_materials` 生成；新增可空列 + 索引，无数据回填，是安全迁移。

### 5.2 会话标识的选型

直接存字符串 `sessionId`（即 LangGraph `thread_id`，等于 `caseSessions.sessionId`），不建外键：

- Agent 运行时的 `ToolContext` 与中间件 `ctx` 本来就持有 `sessionId` 字符串，零额外查询。
- `caseSessions.sessionId` 本身是 `@unique` 列，会话存在性在 `chat.post.ts` 入口已由 `getAssistantSessionService` 校验，材料层无需再做引用完整性兜底。
- 未来「从对话创建案件」：`UPDATE case_materials SET case_id = :newCaseId WHERE session_id = :sid` 一句完成归属迁移。

## 6. 材料服务层新增

`server/services/material/` 下镜像现有的 caseId / draftId 两套实现，补一套 sessionId 入口。

### 6.1 DAO（`material.dao.ts`）

- `findMaterialsBySessionIdDao(sessionId: string)` —— 镜像 `findMaterialsByCaseIdDao`，按 `sessionId` + `deletedAt IS NULL` 查询。
- `findActiveMaterialByOssFileIdDao` 已是全局按 `ossFileId` 查活跃记录，无需改动（天然支持"同文件跨 scope 复用一条记录"）。

### 6.2 Service（`material.service.ts`）

- `getMaterialsBySessionIdService(sessionId: string): Promise<MaterialWithFile[]>` —— 镜像 `getMaterialsByCaseIdService`。

### 6.3 Pipeline（`materialPipeline.service.ts`）

- `ensureMaterialsReadyForSessionService(ossFileId, sessionId, userId)` —— 镜像 `ensureMaterialsReadyForDraftService`：按 `ossFileId` 查/建 `case_materials` 记录，补齐 `sessionId` 归属，触发完整识别+嵌入+轮询。
- `ensureMaterialsReadyBySessionService(sessionId, userId, { fileIds? })` —— 镜像 `ensureMaterialsReadyByDraftService`：
  - 传 `fileIds` → 先对每个文件走单文件 pipeline 建记录，再按会话全量材料补齐识别/嵌入。
  - 不传 `fileIds` → 直接扫 `getMaterialsBySessionIdService(sessionId)` 全量。
- `searchMaterialsByCaseOrDraftService` 扩展签名，归属参数从 `{ caseId, draftId }` 扩为 `{ caseId, draftId, sessionId }`；`getMaterialsByCaseOrDraftIdService` 同步支持按 `sessionId` 取材料集。三个归属维度做 OR 合并 + 去重（与现有 caseId/draftId OR 合并同款）。

识别记录（`imageRecognitionRecords` / `docRecognitionRecords` / `asrRecords`）与向量均按 `ossFileId` 存储，跨 scope 天然共享——同一文件无论在会话、案件还是草稿里出现，识别/嵌入只算一次。

## 7. 工具修复

### 7.1 `process_materials.tool.ts`

工具从 `context` 解构出 `sessionId`（`ToolContext` 已含此字段）。归属判定改为三选一：

```
caseId 优先 → draftId 次之 → sessionId 兜底
caseId/draftId/sessionId 全缺 → 抛错（通用问答恒有 sessionId，实际不会触发）
```

新增 sessionId 分支：`ensureMaterialsReadyBySessionService(sessionId, userId, { fileIds })`。其余逻辑（token 评估、`enforceTokenCap` 封顶、返回结构）完全复用。`materials.length === 0` 的空态提示新增会话场景文案："本对话还没有上传任何文件，请先在输入框上传。"

### 7.2 `searchCaseMaterials.tool.ts`

同样解构 `sessionId`，归属判定改为三选一，调用扩展后的 `searchMaterialsByCaseOrDraftService({ caseId, draftId, sessionId })`。

## 8. 通用问答材料预处理中间件

新增 `server/agents/legal-assistant/assistantProcessMaterial.middleware.ts`，与 `caseProcessMaterialMiddleware` 同构：

- `beforeAgent` 钩子：
  1. 取最新的 HumanMessage，解析其中的 `__ATTACHMENTS__` 附件清单 → `ossFileId[]`。
  2. 无附件 → 直接返回（后续轮次纯文本追问零开销）。
  3. 有附件 → `ensureMaterialsReadyBySessionService(sessionId, userId, { fileIds })`。
  4. 全程通过 `PREPARE_MATERIALS` SSE 事件推进度（start / progress / end），前端 `useStreamChat` 已有的逻辑会据此合成「材料处理」工具卡片——无需改前端。
- 异常不阻断：识别失败仅 `logger.error` + 继续启动 Agent（与 `caseProcessMaterialMiddleware` 一致）。

附件清单的 `__ATTACHMENTS__` sentinel 解析：前端在 `chatQueueActions.ts` 与 `useMessageParser.ts` 各存了一份 `ATTACH_SENTINEL` 常量（注释明令"禁止漂移"）。本次把 **sentinel 常量 + 解析函数下沉到 `shared/utils/`**，前端两处与新中间件统一引用同一份，消除三份漂移风险。

`caseProcessMaterialMiddleware` 里"进度快照 → `PREPARE_MATERIALS` 事件"那段 emit 逻辑（start/progress/end + 全 ready 抑制）抽成 `_shared` 下的共享辅助，两个中间件共用，保证进度卡片行为一致。

## 9. Agent 配置与提示词

### 9.1 `legal-assistant/agent.config.ts`

`defineDomainAgent` 增加 `customMiddlewares`，挂载新中间件：

```ts
customMiddlewares: async (ctx) => [
  {
    middleware: assistantProcessMaterialMiddleware(ctx.userId, ctx.sessionId, ctx.runId),
    priority: MIDDLEWARE_PRIORITY.PROCESS_MATERIAL,
    name: MIDDLEWARE_NAMES.PROCESS_MATERIAL,
  },
]
```

### 9.2 提示词（`assistantMain_system`，prompts id 49）

材料处理由中间件确定性完成，提示词只需让模型知道"用户上传的材料已自动识别，用 `process_materials` 读取内容、`search_case_materials` 检索"。属数据级变更：直接改 dev 库 + 同步 `prisma/seeds/seedData.sql` 对应 INSERT 行，不写 migration / 不写 UPDATE。

## 10. 与「从对话创建案件」的衔接（前瞻）

本次不实现该功能，但数据结构已为它铺好路：

- 通用问答材料以 `sessionId` 归属。未来创建案件时执行 `UPDATE case_materials SET case_id = :newCaseId WHERE session_id = :sid`（`sessionId` 可保留作来源审计），材料即整体成为案件材料。
- 识别结果与向量按 `ossFileId` 存储，迁移后零重算，案件分析直接可用。

## 11. 错误处理

| 场景 | 行为 |
|---|---|
| 某文件 OCR/ASR 识别失败 | 不阻断对话；材料卡片标红显示该文件失败；助手照常回答其余内容 |
| 用户未传文件却问"看我的图片" | `process_materials` 返回友好空态文案，不报错 |
| 附件清单解析失败 | 中间件 `logger.error` + 继续启动 Agent，不阻断 |
| 同一文件在会话/案件中重复出现 | `findActiveMaterialByOssFileIdDao` 全局去重，复用同一条记录、补齐归属列 |

## 12. 改动清单

| 文件 | 改动 |
|---|---|
| `prisma/models/case.prisma` | `caseMaterials` 加 `sessionId` 列 + 索引；修订过时注释 |
| `prisma/migrations/**` | `prisma migrate dev` 自动生成（不手改） |
| `server/services/material/material.dao.ts` | 新增 `findMaterialsBySessionIdDao` |
| `server/services/material/material.service.ts` | 新增 `getMaterialsBySessionIdService` |
| `server/services/material/materialPipeline.service.ts` | 新增 `ensureMaterialsReadyForSessionService` / `ensureMaterialsReadyBySessionService`；扩展 `searchMaterialsByCaseOrDraftService` / `getMaterialsByCaseOrDraftIdService` 支持 sessionId |
| `server/services/agent-platform/tools/processMaterials.tool.ts` | 增加 sessionId 归属分支 |
| `server/services/agent-platform/tools/searchCaseMaterials.tool.ts` | 增加 sessionId 归属分支 |
| `server/agents/legal-assistant/assistantProcessMaterial.middleware.ts` | 新增——通用问答材料预处理中间件 |
| `server/agents/legal-assistant/agent.config.ts` | 挂载 `customMiddlewares` |
| `server/agents/_shared/case-context/caseProcessMaterial.middleware.ts` | 抽出共享的进度 emit 辅助（行为不变） |
| `server/services/assistant/assistantSession.{service,dao}.ts` | 删除会话时按 `sessionId` 级联软删 `case_materials` |
| `shared/utils/**` | 下沉 `ATTACH_SENTINEL` 常量 + 附件解析函数 |
| `app/composables/chatQueueActions.ts`、`app/components/ai/composables/useMessageParser.ts` | 改引用下沉后的共享常量/解析函数 |
| `prisma/seeds/seedData.sql` | `assistantMain_system` 提示词微调（数据级变更） |

## 13. 测试策略

- DAO / Service / Pipeline：`findMaterialsBySessionIdDao`、`getMaterialsBySessionIdService`、`ensureMaterialsReadyForSessionService`、`ensureMaterialsReadyBySessionService`、扩展后的检索服务——补单元/集成测试（worker 级 DB 隔离）。
- 工具：`process_materials` / `search_case_materials` 的 sessionId 分支补测试，覆盖有/无 `fileIds`、空态、识别失败。
- 中间件：`assistantProcessMaterialMiddleware` 的附件解析、`ensureMaterialsReadyBySessionService` 调用、`PREPARE_MATERIALS` SSE 推送、无附件零开销路径。
- 共享 sentinel 解析函数：单元测试覆盖正常/无附件/畸形 JSON。
- `agent-platform/tools/**` 有 ≥95% 覆盖率阈值，新增分支需补足。

## 14. 风险与权衡

- **游离材料数据**：通用问答材料挂在会话上，会话删除时需级联软删 `case_materials`（在 `assistantSession` 删除路径补一句按 `sessionId` 软删）。已纳入改动考虑。
- **`sessionId` 非外键**：选择字符串而非外键是为了贴合工具运行时上下文、避免热路径多查一次；`caseSessions.sessionId` 唯一且会话存在性已在入口校验，实务上完整性无虞。
- **大模型仍可不调工具**：处理动作已由中间件确定性完成，但"把内容拉进上下文"仍依赖模型调用 `process_materials`。这与案件/文书 scope 现状一致（同样依赖模型调工具读材料），属可接受的既有范式。
