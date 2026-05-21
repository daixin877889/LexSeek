# 案件管理模块

案件生命周期管理的核心模块，覆盖案件创建、材料关联、信息提取、初始分析、深度分析和结果版本管理。

## 文件清单

```
server/services/case/
├── case.service.ts          # 案件 CRUD 服务层
├── case.dao.ts              # 案件数据访问层
├── analysis.service.ts      # 分析结果服务层（版本管理、激活切换）
├── analysis.dao.ts          # 分析结果数据访问层
├── caseType.service.ts      # 案件类型管理
├── caseType.dao.ts          # 案件类型数据访问层
├── caseSession.service.ts   # 会话查询（简单封装）
├── session.dao.ts           # Session CRUD 通用 DAO（列表/创建/删除/重命名）
├── caseMaterial.service.ts  # 案件材料关联服务
├── caseMaterial.dao.ts      # 案件材料数据访问层
├── initAnalysis.service.ts  # 初始分析状态查询/模块验证
├── caseExtraction.service.ts # 案件信息提取存储（三层存储）
├── demoCase.service.ts      # 演示案件管理
└── demoCase.dao.ts          # 演示案件数据访问层

server/api/v1/cases/                    # （非完整清单）
├── create.post.ts                     # 创建案件
├── extract.post.ts                    # AI 信息提取
├── [caseId].get.ts                    # 获取案件详情
├── [caseId].put.ts                    # 更新案件
├── [caseId]/materials.get.ts          # 获取案件材料列表
├── init-analysis.post.ts              # 启动初始分析
├── init-analysis-status/[caseId].get.ts # 查询初始分析状态
├── materials/[caseId].post.ts         # 上传材料
├── materials/delete/[caseId].delete.ts # 删除材料
├── session/[sessionId].get.ts         # 获取会话详情
├── analysis/
│   ├── chat.post.ts                   # 对话式分析
│   ├── init-session.post.ts           # 创建初始分析会话
│   ├── module-session.post.ts         # 创建模块对话会话
│   ├── module-session/[sessionId].delete.ts
│   ├── module-sessions.get.ts         # 获取模块对话会话列表
│   ├── xiaosuo-session.post.ts        # 创建小索对话会话
│   ├── xiaosuo-session/[sessionId].delete.ts
│   ├── xiaosuo-sessions.get.ts
│   ├── session/rename/[sessionId].patch.ts # 重命名会话
│   ├── thread/[sessionId].get.ts      # 获取线程状态
│   ├── runs/[sessionId].get.ts        # 查询 run 列表
│   ├── runs/current/[sessionId].get.ts # 获取当前活跃 run
│   ├── runs/cancel/[runId].post.ts    # 取消 run
│   ├── versions/[caseId].get.ts       # 获取版本列表
│   └── versions/activate/[analysisId].post.ts # 激活指定版本
```

## 案件生命周期

```
创建案件 ──▶ 材料上传 ──▶ AI 信息提取 ──▶ 初始分析 ──▶ 模块对话（深度分析）──▶ 导出
                │                               │               │
                │                               ▼               ▼
                └─── 补充材料 ◀──── 查看结果 ◀── 切换版本 ◀── 更新结果
```

### 1. 创建案件

```
POST /api/v1/cases/create
```

`createCaseService` (`case.service.ts`) 在单个事务内完成：
1. 验证案件类型存在且启用（`caseType.service.ts`）
2. 生成 UUID v7 作为 sessionId（时间有序）
3. 如果提供了 `content`，转换为 `CASE_CONTENT` 类型材料（unshift 到材料列表头部）
4. 创建案件记录 → 创建会话记录（status=IN_PROGRESS）→ 批量创建材料记录
5. 如未提供标题，生成默认标题：`待分析的{案件类型名称}`

事务后异步执行（fire-and-forget）：
- 文本材料向量化嵌入（`ensureMaterialsEmbeddedService`，仅处理 CASE_CONTENT 类型）
- 保存 AI 提取结果到长期记忆（`saveCaseInfoService`）

**陷阱**：案件内容（content）不再存储到 cases 表的 content 字段，而是作为 CASE_CONTENT 类型材料。

### 2. 材料上传

```
POST /api/v1/cases/materials/[caseId]
```

`batchAddCaseMaterialsService` (`caseMaterial.service.ts`)：
- **文本材料**：逐条创建获取 materialId → 创建 `textContentRecords`
- **文件材料**：验证 OSS 文件归属 → 根据 `fileType` 自动纠正材料类型 → 批量创建
- 材料类型（`CaseMaterialType`）：CASE_CONTENT(文本), DOCUMENT(文档), IMAGE(图片), AUDIO(音频)

### 3. AI 信息提取

```
POST /api/v1/cases/extract
```

`saveCaseInfoService` (`caseExtraction.service.ts`) 三层存储：
1. **DB 固定字段**：title, plaintiff, defendant, summary
2. **DB JSONB**：`extractedInfo` 字段存储完整提取结果
3. **PostgresStore 长期记忆**：namespace `['cases', '<caseId>']`，key `basic_info`

长期记忆被 `moduleContextBuilder.ts` 用于分析时注入上下文。

### 4. 初始分析

```
POST /api/v1/cases/analysis/init-session  # 创建 type=2 会话
POST /api/v1/cases/init-analysis          # 提交初始分析任务并接收 SSE
GET  /api/v1/cases/init-analysis-status/[caseId]  # 查询状态
```

**流程**：
1. 前端选择分析模块 → 创建 type=2 会话（metadata 存储 selectedModules）
2. 通过 `init-analysis.post.ts` 提交到 `agentRun` 队列
3. Worker 路由到 `caseAnalysisV2.executor.ts` 执行 StateGraph
4. 前端通过 SSE 接收实时进度

`getInitAnalysisStatusService` (`initAnalysis.service.ts`)：
- 跨 session 全局聚合模块状态（isActive 优先）
- 防御性状态修正：所有选中模块到达终态时自动修复 session 状态为 completed
- 检查 INTERRUPTED 状态的 run（用于 interrupt 恢复 UI）

`validateAndSortModules`：验证模块名合法性，按 `INIT_ANALYSIS_MODULES` 固定顺序排列。

### 5. 模块对话（深度分析）

```
POST /api/v1/cases/analysis/module-session   # 创建 type=3 会话
POST /api/v1/cases/analysis/chat             # 提交对话任务
```

创建 type=3 会话（metadata 包含 moduleName 和 nodeId），Worker 路由到 `moduleAgent.ts`。

### 6. 版本管理

见下方"分析结果版本管理"章节。

## 案件类型管理 (caseType)

`server/services/case/caseType.service.ts` + `caseType.dao.ts`

- CRUD 操作：创建/查询/更新/软删除
- 名称唯一性校验
- 删除前检查是否被案件引用（`checkCaseTypeInUseDao`）
- `getEnabledCaseTypesService`：前台展示用，返回 status=1 的类型
- `getFirstEnabledCaseTypeService`：未指定类型时的默认值

## 会话管理 (caseSession)

### 会话类型

| type | 说明 | 对应 Agent |
|------|------|-----------|
| 1 | 小索对话（通用） | caseMainAgent |
| 2 | 初始分析 | caseAnalysisV2 |
| 3 | 模块对话 | moduleAgent |

### 会话状态

| status | 枚举 | 说明 |
|--------|------|------|
| 1 | IN_PROGRESS | 进行中 |
| 2 | COMPLETED | 已完成 |
| 3 | FAILED | 失败 |
| 4 | INTERRUPTED | 已中断 |

### case.service.ts 中的会话管理方法

| 方法 | 说明 |
|------|------|
| `createNewSessionService(caseId)` | 为案件创建新会话（UUID v7） |
| `getLatestSessionService(caseId)` | 获取案件的最新会话 |
| `updateSessionStatusService(sessionId, status)` | 更新会话状态 |
| `completeCaseAnalysisService(caseId, sessionId)` | 事务内同时更新案件和会话为 COMPLETED |
| `markSessionInterruptedService(sessionId)` | 标记会话为中断状态 |
| `markSessionFailedService(sessionId)` | 标记会话为失败状态 |
| `resumeSessionService(sessionId)` | 恢复中断/失败的会话为进行中（校验状态合法性） |

### caseSession.service.ts

`findCaseBySessionIdService(sessionId)`：通过会话 ID 查询案件详情（简单封装 `findCaseBySessionIdDao`）。

### session.dao.ts -- 通用 Session DAO

从多个 API 路由提取的公共逻辑，提供：
- `listSessionsWithActiveRunDAO`：查询 session 列表 + 附带 activeRun 状态
- `createSessionDAO`：创建 session，支持 Redis 防并发重复
- `softDeleteSessionDAO`：软删除，自动取消活跃 run
- `renameSessionDAO`：通过 `jsonb_set` 原子更新 `metadata.title`
- `validateCaseOwnershipDAO`：验证案件归属

**陷阱**：`createSessionDAO` 使用 Redis 分布式锁防重（key `session_dedupe:{dedupeKey}`，TTL 3s），Redis 不可用时降级直接创建。

## 材料关联 (caseMaterial)

### caseMaterial.dao.ts

- `batchAddCaseMaterialsDAO`：批量创建（使用 `createMany`）
- `createSingleCaseMaterialDAO`：单条创建返回完整记录（含 ID）
- `findByCaseIdDAO`：按案件查询，排除已删除
- `findMaterialByIdDAO`：按 ID 查询
- `findMaterialsByOssFileIdDAO`：按 OSS 文件 ID 查询

### caseMaterial.service.ts

`batchAddCaseMaterialsService` 处理两类材料：
- **CASE_CONTENT**：逐条创建 caseMaterials → 创建 textContentRecords（存储文本内容）
- **文件材料**：验证 OSS 文件存在且归属用户 → `getMaterialTypeFromMime` 纠正类型 → 批量创建

## 初始分析 (initAnalysis)

`server/services/case/initAnalysis.service.ts`

### 模块定义

模块列表定义在 `shared/types/initAnalysis.ts`：
- `INIT_ANALYSIS_MODULES`：完整模块列表（含 name、title）
- `VALID_MODULE_NAMES`：合法模块名集合

### 状态聚合逻辑

`getInitAnalysisStatusService` 返回 `InitAnalysisStatusResponse`：

```typescript
{
    status: 'not_started' | 'in_progress' | 'completed' | 'failed',
    sessionId?: string,       // primarySession 的 ID
    selectedModules?: string[], // 从 session.metadata 恢复
    modules: Array<{           // 各模块状态（跨 session 聚合）
        name: string,
        status: 'idle' | 'in_progress' | 'complete' | 'failed',
        result?: string,
        version?: number,
        analyzedAt?: string,
    }>,
    result?: Record<string, string>,  // 已完成模块结果 map
    hasPendingInterrupt?: boolean,    // 是否有待恢复的 interrupt
}
```

**关键规则**：
- 模块状态使用 `isActive` 版本优先，fallback 到最新版本（按 version DESC）
- `hasPendingInterrupt` 通过查询 `agentRuns` 表的 INTERRUPTED 状态判断
- 指定 sessionId 时精确匹配 type=2 session；不指定时使用最新 type=2 session
- 若 sessionId 不匹配任何 type=2 session，返回 `status: 'not_started'`（仍返回全局 modules/result）
- 若 primarySession 从未有过 run，返回 `status: 'not_started'`（让前端展示模块选择器）

**防御性状态修正**：
- 条件：session.status=1（进行中）+ 无活跃 run + 无 interrupt + 所有 selectedModules 到达终态（complete/failed）
- 动作：自动修复 session 状态为 completed（更新数据库）
- 目的：修复因进程崩溃等原因导致的 session 状态不一致

### loadCompletedResultsService

加载案件已完成的分析结果（被 `moduleContextBuilder.ts` 调用）：
- 优先使用 `isActive=true` 的记录
- fallback：按 version DESC + createdAt DESC 去重取最新

## 案件信息提取 (caseExtraction)

`server/services/case/caseExtraction.service.ts`

`saveCaseInfoService(caseId, confirmedData, caseTypes)`：
1. 匹配 caseType → 更新 `caseTypeId`
2. 更新 DB 固定字段（title, plaintiff, defendant, summary）
3. 写入 `extractedInfo` JSONB
4. 写入 PostgresStore 长期记忆（`['cases', caseId] / 'basic_info'`）

`formatCaseInfo`：将提取结果格式化为 LLM 友好的纯文本。

## 演示案件 (demoCase)

`server/services/case/demoCase.service.ts` + `demoCase.dao.ts`

- 独立的 `demoCases` 表（非 cases 表的 isDemo 标记）
- 标准 CRUD + 启用/禁用状态管理
- `getEnabledDemoCasesService(caseTypeId?)`：支持按案件类型筛选
- 标题唯一性校验

## 案件服务层核心方法

`server/services/case/case.service.ts` 提供以下关键方法：

| 方法 | 说明 |
|------|------|
| `createCaseService(data)` | 创建案件（事务：案件+会话+材料） |
| `getCaseByIdService(caseId)` | 获取案件详情（含 caseType + sessions） |
| `getCaseBySessionIdService(sessionId)` | 通过会话 ID 查案件 |
| `getUserCasesService(userId, options)` | 用户案件列表（分页） |
| `updateCaseService(caseId, data)` | 更新案件基本信息 |
| `updateCaseStatusService(caseId, status)` | 更新案件状态 |
| `deleteCaseService(caseId)` | 软删除（同时删除关联会话） |
| `checkCaseOwnershipService(caseId, userId)` | 检查用户所有权 |
| `validateCaseAccessService(caseId, userId)` | 验证访问权限（无权则抛错） |

## 分析结果版本管理

`server/services/case/analysis.service.ts` + `analysis.dao.ts`

### 数据模型

```typescript
caseAnalyses = {
    id: number,
    caseId: number,
    sessionId: string,        // 产生该版本的会话
    nodeId: number,           // 对应 nodes 表的分析模块
    analysisType: string,     // 节点名称（如 summary, defense）
    analysisResult: string | null,  // Markdown 格式分析结果
    version: number,          // 版本号（同 caseId+nodeId 递增）
    status: AnalysisStatus,   // 1=IN_PROGRESS, 2=COMPLETED, 3=FAILED
    isActive: boolean,        // 是否为当前激活版本
    pointDeducted: boolean,   // 积分是否已扣减
    tokenCount: number | null, // 千 token 数（积分单位）
    tokens: number | null,    // 实际 token 总数
}
```

### 版本生命周期

```
创建 IN_PROGRESS ──▶ 更新为 COMPLETED ──▶ 激活（isActive=true）
       │                                        │
       │                                        ▼
       ├──▶ 标记为 FAILED              旧版本 deactivate
       │
       └──▶ 超时清理（2h 兜底）
```

### 关键操作

| 方法 | 文件 | 说明 |
|------|------|------|
| `saveAndActivateAnalysisService` | `analysis.service.ts` | 事务内创建+激活（模块对话 save_analysis_result 工具用） |
| `switchActiveVersionService` | `analysis.service.ts` | 切换激活版本（只能激活 COMPLETED 状态） |
| `regenerateAnalysisService` | `analysis.service.ts` | 创建新版本 IN_PROGRESS 记录 |
| `deleteAnalysisService` | `analysis.service.ts` | 软删除，若删除的是激活版本则自动转移到次新版本 |
| `cleanupStaleAnalysesService` | `analysis.service.ts` | 清理 2h 超时的 IN_PROGRESS 记录（兜底机制） |
| `activateVersionDao` | `analysis.dao.ts` | 事务内 deactivate 同节点所有版本 + activate 指定版本 |
| `getNextVersionDao` | `analysis.dao.ts` | 获取递增版本号 |

**陷阱**：
- `pointDeducted` 字段用于 caseAnalysisV2 两步持久化：先保存 `false`，扣费成功后改 `true`
- IN_PROGRESS 记录创建前先查找可复用的 FAILED/IN_PROGRESS 旧记录（避免版本号浪费）
- 版本号按 `(caseId, nodeId)` 维度递增
- 删除激活版本时自动转移到次新 COMPLETED 版本（`version DESC`）
- `cleanupStaleAnalysesService` 使用 `updatedAt`（非 `createdAt`）判断超时，只捕获真正僵死的记录

## 案件数据访问层 (case.dao.ts)

### 查询列表

`findManyCasesDao(options)` 支持的筛选条件：
- `userId`：按用户筛选
- `caseTypeId`：按案件类型筛选
- `status`：按状态筛选
- `isDemo`：是否为演示案件
- `keyword`：标题和内容模糊搜索（大小写不敏感）
- 排序：默认 `createdAt DESC`
- 分页：默认 pageSize=20

### 软删除

`softDeleteCaseDao(id)` 同时软删除案件和所有关联会话（并行执行）。

## 与其他模块的协作

| 协作模块 | 交互方式 | 说明 |
|----------|----------|------|
| workflow | 调用 analysis.dao 持久化结果 | V2 工作流直接操作 DAO；模块对话通过 save_analysis_result 工具 |
| material | 创建案件时关联材料 | `caseMaterial.service.ts` 调用 material 模块的 OSS/文本处理 |
| retrieval | 分析时检索材料内容 | workflow 工具调用 `materialPipeline.service.ts` |
| node | 加载分析模块配置 | `node.service.ts` 提供模型、提示词、工具配置 |
| point | 积分扣减 | workflow middleware 和工具调用 `pointConsumption.service.ts` |
| agent | 任务队列和执行 | `agentRun.service.ts` 管理 run，Worker 路由到对应 Agent |

## 相关文档

- [LangGraph AI 编排](./workflow.md) -- 工作流执行机制、Agent 架构、中间件体系
- `shared/types/case.ts` -- CaseStatus, SessionStatus, InterruptType 等枚举
- `shared/types/initAnalysis.ts` -- INIT_ANALYSIS_MODULES 模块定义
- `server/services/material/` -- 材料处理管线
- `server/services/node/` -- 节点配置管理
