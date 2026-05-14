# Agent 安全防护基础设施设计

**日期**：2026-04-21
**状态**：Draft（待评审）
**作者**：LexSeek 团队
**涉及模块**：`server/services/workflow/**`、`server/api/v1/admin/**`、`app/pages/admin/**`、`prisma/models/**`

---

## 1. 背景

LexSeek 所有对用户开放的对话型 Agent（小索、案件分析、合同审查、文书草稿）通过 LangGraph + LangChain 调度一组服务端工具（`server/services/workflow/tools/*`）。当前工具层各自带有零散防护（路径白名单、扩展名白名单、execFile 非 shell 等），但**没有横切安全层**，存在以下风险：

- **Prompt injection**：攻击者在材料、合同、外部文本中嵌入指令，劫持 Agent 调用工具做越权操作。
- **合法账号越权试探**：持有正常账号的使用者用自然语言诱导 Agent 读取他人数据、执行恶意脚本、外泄信息。
- **审计缺失**：工具调用无集中审计记录，事后无法追溯"谁在什么时候让 Agent 做了什么敏感操作"。

本 spec 设计一套**零用户交互、无人值守、不依赖 LLM 判官**的通用防御基础设施。

## 2. 目标与非目标

### 2.1 目标（对齐威胁模型）

- **防 Prompt injection（B）**：即使 Agent 被不可信材料诱导，工具调用也无法越出当前会话边界，且物理隔离外网使敏感数据无法外泄。
- **防账号越权（C）**：即使持有合法账号，工具参数绑定 `userId/caseId/sessionId`，越界在代码层硬拒绝。
- **合规审计（E）**：所有工具调用（含拒绝事件）持久化记录，管理端可查询、按日期清理。

### 2.2 非目标

- **不做**用户误操作防护（A）——由现有业务校验覆盖。
- **不做**资源滥用/DoS 防护（D）——本次仅做基础频次熔断，完整 DoS 防护属于基础设施层。
- **不做**输入/输出 PII 脱敏——与法律业务直接冲突（文书必须包含当事人真实身份信息）；审计日志也**不脱敏**（见 §4.4 设计决策）。
- **不做**内容扫描 / LLM 判官 / Dual LLM 改造——成本高、假阳性率高、且 Guard LLM 同样会被 prompt injection 绕过。本方案**纯代码规则**，不依赖任何 LLM 做安全判断。
- **不做**运行时人工确认——违反"无感 + 无人值守"硬约束。

### 2.3 硬约束

- **用户无感**：全流程不打断、不弹窗、不需要点击授权。
- **无人值守**：长时间案件分析任务可后台完成，中途不需要人工介入。
- **不引入额外 LLM 调用**：以避免延迟和成本双重开销。
- **复杂分析不误伤**：工具调用次数限制分层配置，常规分析（>20 次检索 + 多次读写）不触发熔断。

## 3. 方案总览

五层横切防御，全部基于 LangChain 官方中间件能力 + Linux network namespace：

```
┌──────────────────────────────────────────────────────────────┐
│  LangGraph Agent (caseMainAgent / contractReviewMainAgent /  │
│                    documentMainAgent / assistantAgent)        │
└───────────────────┬──────────────────────────────────────────┘
                    │
    ┌───────────────▼────────────────────────────────────┐
    │ 中间件链（按顺序）                                  │
    │                                                     │
    │  1. scopeGuardMiddleware  ← 参数 scope 强校验       │
    │  2. toolCallLimitMiddleware (LangChain 原生)        │
    │       ← 分层次数熔断                                │
    │  3. auditMiddleware       ← 所有调用入 PG 审计表    │
    └───────────────┬────────────────────────────────────┘
                    │
                    ▼
            ┌─────────────────┐
            │  工具执行层      │
            │                 │
            │  run_skill_script 子进程 ← unshare -rn      │
            │                            网络命名空间隔离 │
            └─────────────────┘

    ┌────────────────────────────────────────┐
    │ 管理端审计查询 / 清理                   │
    │  /admin/audit  ← Tab 「Agent 工具审计」 │
    │  GET  /api/v1/admin/agent-audit-logs   │
    │  GET  /api/v1/admin/agent-audit-logs/stats │
    │  DEL  /api/v1/admin/agent-audit-logs   │
    └────────────────────────────────────────┘
```

| # | 组件 | 类型 | 防御点 |
|---|---|---|---|
| 1 | `scopeGuardMiddleware` | 自定义 `wrapToolCall` 中间件 | **B + C**：参数 scope 硬校验 |
| 2 | `toolCallLimitMiddleware` | LangChain 原生 | **C**：分层次数熔断账号越权试探，优雅降级 |
| 3 | `auditMiddleware` | 自定义 `wrapToolCall` 中间件 | **E**：审计归档（不脱敏，完整原文入库） |
| 4 | `run_skill_script` 网络隔离 | 子进程 `unshare -rn` 包装 | **B**：物理切断外泄路径 |
| 5 | 管理端审计查询 / 清理 | API + Vue 页面 | **E**：可视化追溯 + 数据生命周期 |

## 4. 组件详细设计

### 4.1 scopeGuardMiddleware（核心防御层）

**目标**：利用 LangChain `createMiddleware` 的 `wrapToolCall` 钩子，在工具执行前做代码规则强校验，不依赖 LLM 判断。

**位置**：`server/services/workflow/middleware/scopeGuard.middleware.ts`

**校验规则表**（按工具分派）：

| 工具 | 校验规则 |
|---|---|
| `read_skill_file` | `path` 不含 `..` / NULL 字节 / 绝对路径；扩展名在白名单；若含 `_workspace/` 前缀，校验路径 resolve 后在当前 `sessionId` 的 workspace 内 |
| `write_skill_file` | 同上路径校验；记录"本 session 已写入的相对路径集合"到中间件 state（为 `upload_workspace_file` 强约束提供依据） |
| `upload_workspace_file` | **强约束**：`filePath` 必须已在 `write_skill_file` 的 state 记录里（即必须是 Agent 本次会话内主动写入的文件），不允许上传任意 workspace 内文件；这样即便攻击者让 Agent `cp /etc/passwd workspace/` 也上传不了 |
| `run_skill_script` | 白名单字符校验（已在工具层实现，保留原逻辑）；额外校验 `skillName` 若非 `_workspace` 必须在已注册 skill 列表内 |
| `search_case_materials` / `search_law` / `process_materials` | 参数中若出现 `caseId`，必须等于 context.caseId；若出现 `userId`，必须等于 context.userId |
| `save_analysis_result` / `parseAndAskStance` | 若工具参数里带 `runId` / `reviewId` / `draftId`，必须与 context 对应字段一致（不一致视为越权） |
| 所有工具 | 参数值中不得包含"**模仿 AI 模板分隔符**"类典型污染标记（详见下方清单，本期实施；仅作为纵深防御的兜底层） |

**关于 context 字段缺失的处理**：LangChain 的 `ToolContext` 里 `caseId/runId/draftId/reviewId` 均为可选字段（见 `server/services/workflow/tools/types.ts`）。scopeGuard 的原则是：
- context 字段缺失等同于"当前会话无权限使用该字段"，工具参数不得伪造（例如 context 里没 caseId 但参数里硬塞一个 caseId，视为越权，直接拒绝）。
- 上述 `save_analysis_result / parseAndAskStance` 工具本身需要这些字段才能工作，其 context 是否应该存在属于 workflow 主流程编排责任，**本 scope 不做额外校验**，只确保"参数 与 context 不一致时立即拒绝"。

**污染标记黑名单清单**（本期实施，只扫工具参数的 string 值，不扫参数名/返回值/原始材料）：

| 类别 | 拦截内容 | 拦截理由 |
|---|---|---|
| **模仿 AI 模板分隔符** | `<\|`（通用模板边界前缀）、`<\|im_start\|>` / `<\|im_end\|>`（ChatML）、`<\|begin_of_text\|>` / `<\|eot_id\|>`（Llama 3）、`[INST]` / `[/INST]`（Llama 2、Mistral）、`<s>` / `</s>`（BOS/EOS）、`### Instruction:` / `### Response:`（Alpaca/Vicuna） | 模型训练时的内部格式符号，正常法律文本不会出现；攻击者用这些试图让 AI 以为进入新对话轮次。**注**：`<s>` / `</s>` 在 HTML 片段/删除线标签里理论可能误伤，但法律业务文本中几乎不会以裸 token 形式出现，误报可接受 |

**不拦截的（产品决策，避免误伤合法业务）**：
- 自然语言的"忽略以上 / ignore previous / disregard above / 忽略前款"等——这些在合同、判决书、法规条款里**合法高频出现**（例："不受前款约定影响"），拦截会大量误伤合同审查流程
- 中/英文 `system:` / `role: system` 及其 JSON 变体——英文合同/技术协议/系统日志引用段落里可能合法出现（例："System: Microsoft Windows 11"、`"role":"system"` 出现在 API 文档引用段落），改由结构化模板符号兜底

**命中后的行为**：直接返回 `ToolMessage("Error: 参数包含可疑内容")`；**不做清洗重写**（清洗会给攻击者反复试探的空间）。

**实现要点**：
- 规则配置为**工具名 → 校验函数**的纯函数 map，无 LLM 调用。
- 校验失败时 `wrapToolCall` 不调用 `handler(request)`，直接返回 `ToolMessage({ content: "Error: <deny reason>", ... })`，Agent 收到后自然回退，不 crash。
- 拒绝事件同时推送给 `auditMiddleware`（通过 state 或直接写库）。
- **文件拆分**（遵循 `.claude/rules/common/coding-style.md` 200-400 行约束）：
    - `server/services/workflow/middleware/scopeGuard.middleware.ts`：主入口 + `wrapToolCall` 钩子
    - `server/services/workflow/middleware/scopeGuard.rules.ts`：工具名 → 校验函数的规则 map
    - `server/services/workflow/middleware/scopeGuard.blacklist.ts`：模板分隔符黑名单常量 + 扫描函数

**对 Prompt Injection 的防护机理**：
- 攻击者即便让 LLM 生成越界参数（如 `path: "../../etc/passwd"`、`caseId: 9999`），**scopeGuard 是确定性代码规则**，不会被自然语言迷惑。
- 强约束让 `upload_workspace_file` 必须基于本 session 主动 write 的产物，切断 "读敏感文件→写入 workspace→上传泄露" 这条经典攻击链。

### 4.2 `run_skill_script` 子进程网络隔离

**位置**：修改 `server/services/workflow/tools/runSkillScript.tool.ts`

**Linux 生产环境**：

```ts
const useNetNs = process.platform === 'linux' && await hasUnshare()
const binary = useNetNs ? 'unshare' : runtimeBin
const prependedArgs = useNetNs ? ['-rn', runtimeBin] : []

execFile(binary, [...prependedArgs, ...execArgs], { ... }, callback)
```

- `unshare -rn`：`-r` 启用 user namespace（以免需要 CAP_SYS_ADMIN），`-n` 创建独立 network namespace。子进程继承后看不到任何网卡，**无法进行任何网络连接**（DNS、TCP、UDP 一并切断）。
- 配合 `hasUnshare()` 启动时做一次性能力探测并缓存结果，若容器禁用 user namespace 则**启动失败 + 明确报错**，不静默降级。

**macOS 开发环境**：

- `process.platform === 'darwin'` 时走裸 `execFile`，**启动时 `logger.warn` 一次**提醒"开发环境未启用 skill 子进程外网隔离"。
- 开发机攻击面小，可接受；生产部署严格。

**部署前置检查**：
- 在 Docker 镜像构建阶段验证 `unshare` 可用（`docker run <image> unshare -rn echo ok`）。
- k8s 部署文档中列出 PSP/PSA 兼容性要求（允许 user namespace）。
- 此检查在本 spec 配套的 `guides/deployment.md` 中补充说明。

**对其他工具的影响**：
- `upload_workspace_file`：**零影响**。上传走 Node.js 主进程的 OSS SDK，不经过 skill 子进程。
- `read_skill_file` / `write_skill_file`：**零影响**。直接在主进程 `fs/promises` 读写 workspace 目录。
- 主进程调 LLM、数据库、OSS、外部 API：**零影响**。

### 4.3 toolCallLimitMiddleware（分层熔断）

**位置**：`server/services/workflow/middleware/toolCallLimit.middleware.ts`

**策略**：使用 LangChain 原生 `toolCallLimitMiddleware`，按工具名分层配置。超限时返回字符串 ToolMessage 让 Agent 感知，**不抛异常**。

**默认配置表**（per-session）：

| 工具类型 | 工具示例 | 上限 | 触发行为 |
|---|---|---|---|
| 检索类（高频正常） | `search_case_materials`, `search_law` | **不设上限** | — |
| 读取类（高频正常） | `read_skill_file` | **30** | 返回 `"Error: 已达到读取次数上限，请基于当前信息做出判断"` |
| 处理类（低频） | `process_materials` | **5** | 同上文案 |
| 写入类（中频） | `write_skill_file` | **20** | 同上文案 |
| 执行类（**高危**） | `run_skill_script` | **10** | 同上文案 |
| 上传类（低频） | `upload_workspace_file` | **10** | 同上文案 |
| 结果类 | `save_analysis_result`, `parseAndAskStance` | **不设上限** | — |

**关键设计**：
- **优雅降级**：超限不 crash，工具返回 Error 字符串消息，Agent 的模型自行决定"换路径"或"收束分析"。
- **不限总次数**：避免复杂案件分析因为总次数超限而失败。
- **per-session 隔离**：每个 session 独立计数，防止跨会话污染。

**参数可调**：配置以常量形式内联在 `toolCallLimit.middleware.ts` 顶部（对齐项目现有 middleware 风格，参考 `pointConsumption.middleware.ts` 的 `CHARS_PER_TOKEN`），后续可按实际运行数据调整。

### 4.4 auditMiddleware（审计归档）

**位置**：`server/services/workflow/middleware/audit.middleware.ts`

**职责**：所有工具调用（含被 scopeGuard 拒绝、被 toolCallLimit 熔断）全部写入 `agent_tool_audit_logs` 表。

**记录字段**（参见 4.5 表结构）：
- 调用元数据：`userId`、`sessionId`、`caseId`、`runId`、`draftId`、`reviewId`、`toolName`、`verdict`（`allowed` / `denied` / `error`）、`denyReason`、`latencyMs`、`createdAt`
- **完整参数原文**（`argsDigest`，jsonb）：保留工具调用的完整参数结构和字段名，**不做 PII 脱敏**
    - 字符串值长度 > 2000 字符时一刀切截断到 2000 字符（此为**存储成本规避**，非安全脱敏；防止单条记录膨胀）
    - `write_skill_file` 的 `content` 单独摘要化——存储成本规避（单条几百 KB × 数千次调用 = 数 GB），**非安全脱敏**；只记录内容的 SHA-256 摘要 + 长度 + 文件路径；完整内容可在 workspace 文件本身获取（24h TTL）

**审计不脱敏的设计决策**：
- 法律业务的排查场景必须基于真实原文，脱敏会让"为什么被拒"无法复盘
- 审计表访问严格限定 super_admin（`server/middleware/03.permission.ts` 兜底），作为组织级 RBAC 的信任边界
- 审计表一旦泄露即意味着组织内部已失陷，此时脱敏与否差异微小
- **强烈建议**审计表的数据库访问权限与主库分离（独立 PG role 或独立 schema 权限控制），上线前与运维确认——此为"不脱敏"决策的关键兜底，未做则风险等级升高

**TS 类型约束**：`argsDigest` 在 TypeScript 侧类型为 `Record<string, unknown>`（**禁止 `any`**，遵循 `.claude/rules/types.md`）；前端展示时用 `JSON.stringify(value, null, 2)`。

**实现要点**：
- `wrapToolCall` 钩子在 handler 执行前记录起始时间，执行后（或拒绝后）生成记录异步入库（不阻塞工具返回）。
- **异步写库失败不影响业务流程**：`.catch(err => logger.error(...))`（`logger` 自动导入，无需额外封装）。
- 写库走 `prisma.agentToolAuditLogs.create`（`prisma` 自动导入）。

### 4.5 数据模型

**新增表**：`agent_tool_audit_logs`（放在 `prisma/models/apiPermission.prisma` 或新建 `prisma/models/audit.prisma`；建议合并到 `apiPermission.prisma`，与现有 `permissionAuditLogs` 同族集中管理）

**命名对齐**：表名、模型名、索引命名均对齐项目现有 `permissionAuditLogs`（`permission_audit_logs`）惯例——表名复数 + `_logs` 后缀、索引用 `idx_xxx_yyy` 命名。

```prisma
model agentToolAuditLogs {
    id           String   @id @db.Uuid                 // UUIDv7（应用层生成，按时间单调递增）
    userId       Int      @map("user_id")
    sessionId    String   @map("session_id") @db.VarChar(128)
    caseId       Int?     @map("case_id")
    runId        String?  @map("run_id") @db.VarChar(64)
    toolName     String   @map("tool_name") @db.VarChar(64)
    verdict      String   @db.VarChar(16)              // allowed / denied / error
    denyReason   String?  @map("deny_reason") @db.VarChar(256)
    argsDigest   Json     @map("args_digest")           // 完整参数原文（不脱敏），JSON 内含 draftId/reviewId 等辅助字段
    latencyMs    Int      @map("latency_ms")
    createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

    @@index([userId, createdAt], map: "idx_agent_tool_audit_logs_user_id_created_at")
    @@index([verdict, createdAt], map: "idx_agent_tool_audit_logs_verdict_created_at")
    @@index([createdAt], map: "idx_agent_tool_audit_logs_created_at")
    @@map("agent_tool_audit_logs")
}
```

- **UUIDv7 主键**（PG 原生 `uuid` 类型 16 字节存储）：
    - **复用项目现有依赖** `uuid@^13`（见 `package.json`），`import { v7 as uuidv7 } from 'uuid'`，**无需新增包**
    - UUIDv7 前 48 位是 Unix 时间戳（ms），天然按创建时间单调递增，避免 UUIDv4 随机分布带来的 B-tree 索引碎片问题
    - 选型说明：项目现有 `uuid()` 默认生成 v4（如 `agentRun.prisma`），本表是审计场景的小幅演进——审计表量级更大且自带时间属性，v7 是刚性优势；未来可评估是否推广到其他高写入表
- **审计不可变**：**不设 `updatedAt / deletedAt`**（审计记录一旦写入不得修改；清理走硬删，见 §4.6）
- **字段精简**：
    - 不单独列 `draftId` / `reviewId` 列（无 API 筛选路径、无索引覆盖）；调用发生时完整参数已在 `argsDigest` JSON 中，排查需要时 JSON 字段查询即可
    - 保留 `caseId`（列表筛选用）与 `runId`（会话追溯链路排查用，未来可能扩展索引）
- **三个索引**：
    - `idx_agent_tool_audit_logs_user_id_created_at`：按用户时间查询（管理端主筛选路径）
    - `idx_agent_tool_audit_logs_verdict_created_at`：按判决时间范围查询（stats 接口 count by verdict 的主查询路径；前导列为 verdict 以匹配 stats 查询）
    - `idx_agent_tool_audit_logs_created_at`：按日期清理的批量删除
    - 不设 `sessionId` 单列索引：按 session 追踪属二级排查路径，走 `userId + sessionId` 过滤即可
- **分区**：初版不做。数据量达 5000 万条前 PG 单表性能足够；达到后再按月 partition
- **`argsDigest` 用 Json（jsonb）**：便于 PG jsonb GIN 索引和后续复杂条件查询
- **不含 `resultDigest` 字段**：工具返回值摘要初版不记录（存储成本高、查询价值低；错误信息直接写入 `denyReason` 即可；需要看返回值时看业务日志 `logger.info`）

**前端类型定义**：新建 `shared/types/agentAudit.ts`（命名风格对齐现有 `shared/types/agentRun.ts` 的 camelCase 文件名），导出：

```typescript
export enum AgentAuditVerdict {
    ALLOWED = 'allowed',
    DENIED = 'denied',
    ERROR = 'error',
}

export const AgentAuditVerdictText: Record<AgentAuditVerdict, string> = {
    [AgentAuditVerdict.ALLOWED]: '允许',
    [AgentAuditVerdict.DENIED]: '拒绝',
    [AgentAuditVerdict.ERROR]: '错误',
}

export interface AgentAuditRecord {
    id: string
    userId: number
    sessionId: string
    caseId: number | null
    runId: string | null
    toolName: string
    verdict: AgentAuditVerdict
    denyReason: string | null
    argsDigest: Record<string, unknown>  // 禁止 any
    latencyMs: number
    createdAt: string  // ISO 8601
}
```

管理端 API 的返回体、前端页面从此处 `import type`（参考 `.claude/rules/types.md`）。**类型名加 `Agent` 前缀**以避免与未来可能的权限审计类型（`AuditRecord` 等）冲突。

### 4.6 管理端 API

严格遵循项目 `/admin/` 隔离规则（`server/middleware/03.permission.ts` 会拦截非 super_admin）。

**路径命名与风格对齐**：
- 路径前缀 `/api/v1/admin/agent-audit-logs`（复数 + `-logs` 后缀，对齐现有 `admin/audit` 与表名 `agent_tool_audit_logs` 命名惯例）
- 分页参数 `page` + `pageSize`（对齐 `/api/v1/admin/audit`）
- 返回字段用 `items`（对齐 `/api/v1/admin/contract-reviews`）
- 所有 handler 响应通过 `resSuccess(event, '...', data)` / `resError(event, code, msg)` 包装（HTTP 永远 200）
- 所有 query / body 用 zod schema 校验；失败走 `resError(event, 400, result.error.issues[0].message)`（对齐 `.claude/rules/api.md`）

**路由文件结构**（Nitro 约定：**API 路径段**中动态参数位于末尾；文件命名 `[id].get.ts`）：
```
server/api/v1/admin/agent-audit-logs/
    index.get.ts       # 列表查询
    stats.get.ts       # 统计指标（静态路径段优先于 [id]，不会被吃掉）
    [id].get.ts        # 详情（动态路径段位于末尾，对齐 api.md 规范）
    index.delete.ts    # 按日期清理
```

**`GET /api/v1/admin/agent-audit-logs`** - 列表查询

Query schema（zod）：
```ts
const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    userId: z.coerce.number().int().optional(),
    toolName: z.string().max(64).optional(),
    verdict: z.enum(['allowed', 'denied', 'error']).optional(),
    caseId: z.coerce.number().int().optional(),
    sessionId: z.string().max(128).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),  // YYYY-MM-DD
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
```

- 返回：`resSuccess(event, '查询成功', { items: AgentAuditRecord[], total, page, pageSize })`
- 排序：`createdAt desc`

**`GET /api/v1/admin/agent-audit-logs/:id`** - 详情
- `:id` 为 UUIDv7 字符串，用 `z.string().uuid()` 校验
- 返回单条完整记录（`argsDigest` 完整 JSON）
- 便于排查某次拒绝/异常的全量上下文

**`DELETE /api/v1/admin/agent-audit-logs`** - 按日期清理（**单步**）

Body schema（zod）：
```ts
const bodySchema = z.object({
    beforeDate: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需为 YYYY-MM-DD')
        .refine(v => !Number.isNaN(new Date(v).getTime()), '无效日期'),
})
```

- 返回：`resSuccess(event, '清理完成', { deleted: N })`
- 硬删（审计表软删无意义）
- 分批 Prisma 调用（每批最多 10_000 条，循环到返回 count=0）：
  ```ts
  let deleted = 0
  while (true) {
      const result = await prisma.agentToolAuditLogs.deleteMany({
          where: { createdAt: { lt: new Date(beforeDate) } },
          // Prisma deleteMany 无 take 参数，用 LIMIT 子查询或保持单次全删
          // 若表量大（>10万），建议改用 raw SQL: DELETE ... WHERE ... LIMIT 10000
      })
      deleted += result.count
      if (result.count === 0) break
  }
  ```
- 预估条数前端本地通过一次列表接口（`pageSize=1`）拿 `total` 展示，无需单独预检接口

**`GET /api/v1/admin/agent-audit-logs/stats`** - 概览指标（**初版实施**）
- 返回：`resSuccess(event, '查询成功', { today: { allowed, denied, error }, last7d: { allowed, denied, error } })`
- 用途：管理端列表页顶部统计卡片，一眼看出当日拒绝/错误量是否异常
- 实现：两组 `groupBy(['verdict'])` + `count` 聚合查询，WHERE 走 `idx_agent_tool_audit_logs_verdict_created_at`，毫秒级

### 4.7 管理端页面

**合并到现有 `/admin/audit` 页面，以 Tab 切换**（产品决议：跟权限审计页语义同族，不新开独立页）：

- 改造 `app/pages/admin/audit/index.vue`，把原有内容包进 Tab 1「权限审计」；新增 Tab 2「Agent 工具审计」承载本期新内容
- 两个 Tab 共用 admin layout 顶部导航，各自维护独立的筛选/分页状态
- Tab 切换用 shadcn-vue `Tabs` 组件
- 页面元信息：`definePageMeta({ layout: 'admin-layout', title: '审计日志', icon: 'ShieldCheck' })`（对齐 `.claude/rules/ui.md` 三件套要求，layout 名称对齐项目既有 `admin-layout`）

**Tab 2「Agent 工具审计」内容**：

- **顶部统计卡片区**（3 张并排，仅本 Tab 显示）：
    - 卡片标题："今日允许" / "今日拒绝" / "今日错误"（绿色/红色/橙色 Badge 着色）
    - 副标题小字显示"近 7 天"的对应数字，便于对比
    - **纯展示，不做点击回填筛选器**（避免 UI 联动复杂度；管理员直接用主筛选器即可）
    - 数据来源：`GET /api/v1/admin/agent-audit-logs/stats`
- **筛选栏**（4 个主筛选器）：用户（`Input`）、工具（`Select`，枚举来自 `getAllToolNamesService()`）、判决（`Select`：全部/允许/拒绝/错误）、日期范围（**两个独立 `GeneralDatePicker`**，分别对应 `from` / `to`，与 `/admin/mineru-tasks`、`/admin/asr-tasks` 等现有 admin 页面一致）
- **表格列**：时间、用户、工具、判决（`Badge` 着色）、案件 ID（可空）、拒绝原因（截断显示 + `Tooltip` 全文）、耗时 ms、操作（详情）
- **分页**：复用现有 `GeneralPagination` 组件（`app/components/general/pagination.vue`，参考现有 `/admin/audit` 页面的使用方式）
- **详情**：点击行或"详情"按钮 → 抽屉（`Sheet`）显示完整 `argsDigest` 的 JSON（`<pre>` + `JSON.stringify(value, null, 2)`，不引入语法高亮库）
    - **与 Tab 1 用 `Dialog` 展示详情不一致的权衡说明**：`argsDigest` 可能含数千字符的工具参数（如合同原文），`Sheet` 抽屉更适合长内容滚动浏览；Tab 1 权限审计日志内容短，用 `Dialog` 合适。两 Tab 详情组件**有意不同**，不强行统一。
- **清理按钮**（Tab 右上角）→ 弹出**本地 `AlertDialog` + `GeneralDatePicker`** 组件（参考 `app/components/cases/CasesDeleteDialog.vue` 模式）：
    - **为何用本地 AlertDialog 而非全局 `useAlertDialogStore.showErrorDialog`**：后者的 `message` 仅支持 string，无法内嵌 `GeneralDatePicker` 让管理员选日期；按 `.claude/rules/ui.md` 最后一段"需要组件内持有独立状态（删除前额外输入、带表单校验）"的场景规定，使用本地 shadcn `AlertDialog`
    - 组件标题"确认清理审计日志"；描述里显示"当前总记录数 N 条，将删除指定日期之前"
    - 日期选择用 `GeneralDatePicker` 单日期；未选时"确认删除"按钮 disabled
    - 确认按钮红色主按钮样式（`bg-destructive`）
    - 若详情 Sheet 已打开（Sheet 默认 `z-[70]`），本地 `AlertDialog` 的 overlay 默认 `z-50` 会被压住——**需显式设置对话框 z-index > 70**（如 `class="z-[9999]"`）
    - 点确认后调用：
      ```ts
      const resp = await useApiFetch<{ deleted: number }>(
          '/api/v1/admin/agent-audit-logs',
          { method: 'DELETE', body: { beforeDate } },
      )
      // 注意：useApiFetch 自动提取 data，直接访问 resp?.deleted，勿写 resp?.data?.deleted
      if (resp) {
          toast.success(`已清理 ${resp.deleted} 条记录`)
          emit('cleaned')  // 父组件接收后 refresh 列表
      }
      ```

**数据请求分工**（按 `.claude/rules/fetch.md`）：
- 列表（setup 阶段且需 SSR）→ `useApi<{ items: AgentAuditRecord[], total: number, page: number, pageSize: number }>(...)`
- 详情（点击时触发）→ `useApiFetch<AgentAuditRecord>(...)`
- 统计（setup 阶段）→ `useApi<StatsPayload>(...)`
- 清理（按钮点击）→ `useApiFetch<{ deleted: number }>(...)`

**注**：所有 `useApiFetch` / `useApi` 调用的泛型直接定义数据本身，**不包** `{ code, data }` 外层——`useApiFetch` 会自动提取 `data` 字段。

**权限**：页面仍位于 `/admin/audit`，由 `server/middleware/03.permission.ts` 统一拦截非 `super_admin`。

**禁止事项**：
- 不使用浏览器原生 `confirm()/alert()/prompt()`
- 不修改 `app/components/ui/` 下的 shadcn-vue 组件

## 5. 中间件装配顺序

在每个 Agent 构造器里（`server/services/workflow/agents/*.ts`）添加中间件，顺序敏感：

```
createAgent({
  model,
  tools,
  middleware: [
    scopeGuardMiddleware,       // 1. 先拦越权参数（成本低）
    toolCallLimitMiddleware,    // 2. 再判熔断
    auditMiddleware,            // 3. 最后审计（记录前两者的结果）
    ...existingMiddlewares,     // 已有：pointConsumption、safetyTrim 等
  ],
})
```

- **scopeGuard 在最前**：拒绝的请求不占频次额度，不浪费 DB 写入。
- **audit 在最后**：能同时捕获"被 scopeGuard 拒"、"被 limit 熔断"、"正常执行"、"工具抛异常"四种情况。

需要统一装配到以下文件（实施时逐个 PR 或一次性批量）：

| Agent | 文件路径 |
|---|---|
| 案件分析主 Agent | `server/services/workflow/agents/caseMainAgent.ts` |
| 合同审查主 Agent | `server/services/workflow/agents/contractReviewMainAgent.ts` |
| 文书草稿主 Agent | `server/services/workflow/agents/documentMainAgent.ts` |
| 通用问答 Agent | `server/services/workflow/agents/assistantAgent.ts` |
| 模块对话 Agent | `server/services/workflow/agents/moduleAgent.ts` |
| Sub-agent 工厂 | `server/services/workflow/agents/subAgentToolFactory.ts` |

## 6. 错误处理

| 场景 | 行为 |
|---|---|
| scopeGuard 拒绝 | 返回 `ToolMessage("Error: 参数不满足安全约束 - <具体原因>")`，Agent 收到后可自行调整 |
| toolCallLimit 熔断 | 返回 `ToolMessage("Error: 工具 X 已达调用次数上限")`，Agent 可选择结束或换工具 |
| audit 写库失败 | 记 logger.error，**不影响业务流程**；审计丢失 1 条可接受（非关键路径） |
| unshare 命令缺失（Linux 生产） | 启动时抛错并阻止服务启动——"期望的安全层缺失"不能静默降级 |
| macOS 开发裸跑 | 启动时 `logger.warn` 一次，运行中不再提示 |
| skill 子进程外网访问被拒 | 子进程自身收到 `ENETUNREACH`，工具返回值里自然带错误；已是子进程视角的正常行为 |

## 7. 测试策略

**TDD 工作顺序**（项目规范 `.claude/rules/common/testing.md`）：
- P0 核心每个中间件都先写测试（红灯）→ 再写实现（绿灯）→ 重构
- 工期表（§10）的"scopeGuard 中间件 / audit 中间件"子项隐含此顺序：先编写对应的 `*.test.ts`，再实现 `*.middleware.ts`

**测试命令**：`npx vitest run <路径>`（项目规范，见 `.claude/rules/commands.md`；**不使用** `bun test`）。

### 7.1 单元测试

| 文件 | 覆盖范围 |
|---|---|
| `tests/server/workflow/middleware/scopeGuard.test.ts` | 每种工具的合法/非法参数组合；路径穿越；caseId/userId 篡改；`upload_workspace_file` 的"必须先 write"强约束；state 持久化 |
| `tests/server/workflow/middleware/audit.test.ts` | 正常调用记录、拒绝记录、异常记录；完整原文入库（不脱敏）；大 content 摘要为 SHA + 长度；写库失败不影响流程 |
| `tests/server/workflow/middleware/toolCallLimit.test.ts` | 分层配置正确；per-session 隔离；超限返回 Error 字符串而非异常 |
| `tests/server/workflow/tools/runSkillScript.test.ts`（扩展已有文件） | 增加 netns 断言用例：Linux 路径 mock `execFile` 断言 `unshare -rn` 被调用；macOS 路径不调 unshare；`hasUnshare` 启动探测（合并到既有测试文件，不新建独立 netns 测试文件） |

### 7.2 集成测试

| 文件 | 场景 |
|---|---|
| `tests/server/api/admin/agentAuditLogs.test.ts` | 列表筛选（含对齐 `page/pageSize` 分页）/ 详情 / 按日期清理 / 非 super_admin 403 / stats 返回结构 |

（**不做** "模拟 prompt injection 的 workflow 集成测试"：构造的攻击向量局限于开发者想象，真实攻击样本应从上线后审计表复盘，工作量放到迭代 2。scopeGuard 的单元测试已覆盖所有拒绝路径。）

### 7.3 手工验证清单（集成环境）

- [ ] 在 Linux 容器内调 `run_skill_script` 执行 `curl attacker.com` 的脚本，应因网络不可达失败（同时验证 `unshare -rn` 生效）
- [ ] 管理端 `/admin/audit` 页面切到「Agent 工具审计」Tab，能看到最近一次分析的全部工具调用、顶部 3 个统计卡片数字合理、清理按钮工作

## 8. 数据迁移与上线

### 8.1 数据库迁移

```bash
bun run prisma:generate
bunx prisma migrate dev --name add_agent_tool_audit_logs
```

- 项目 `package.json` 的 `prisma:migrate` 脚本不透传 `--name`，按 `.claude/rules/commands.md` 惯例直接走 `bunx prisma migrate dev`
- 新表无历史数据，迁移零风险

### 8.2 部署检查清单

- [ ] Docker 镜像包含 `util-linux`（Debian/Ubuntu/Alpine 默认都有，确认 Dockerfile 无自定义精简）
- [ ] k8s/云厂商容器编排策略允许 user namespace
- [ ] 启动日志中能看到"skill 子进程外网隔离已启用"（Linux）或"开发环境未启用"（macOS）
- [ ] **与运维确认**：`agent_tool_audit_logs` 表的数据库访问权限与主库分离（独立 PG role 或独立 schema 权限控制）；审计表因不脱敏存储完整参数原文，此权限分离是"不脱敏"决策的关键兜底

### 8.3 观测

- 上线一周内每天检查 `agent_tool_audit_logs` 表：
    - `verdict=denied` 数量 vs 总调用量（基线应 < 1%，过高说明合法场景被误伤）
    - `latencyMs` P99（中间件开销应 < 5ms）
    - 每工具的 toolCallLimit 触达次数（用于首周判断分层阈值是否合理；阈值过紧可调整 `toolCallLimit.middleware.ts` 顶部常量）
- 若 denied 率高，针对性放宽 scopeGuard 规则（记 spec 补充说明）

## 9. 风险与局限

### 9.1 已知局限

| 局限 | 缓解 |
|---|---|
| scopeGuard 的"模板分隔符黑名单"是兜底，不能替代结构防御 | 主防御是 scope 强校验 + 外网切断；黑名单仅作为三线防御，误报少量时可容忍 |
| macOS 开发环境无 unshare，开发机是潜在攻击面 | 开发机可信；且所有审计仍生效；真实攻击在生产触发 |
| Node.js 主进程仍可访问任何外网（正常业务需要） | 攻击者要外泄必须走 skill 子进程或诱导主进程中已有工具，后者由 scopeGuard 拦截 |
| 无法防"Agent 被诱导生成错误但合规的分析结果" | 本方案不防"语义正确性"，该问题属于模型对齐领域，不在 scope 内 |
| 审计表完整存储工具调用原文（不脱敏），一旦数据库访问权失陷即大量敏感信息泄露 | 访问严格限定 super_admin（`03.permission.ts` 兜底）；**强烈建议**审计表权限与主库分离（见 §8.2 部署清单）；若运维未做分离，此风险等级升高 |

### 9.2 未来演进方向（不在本 spec 范围）

- **Dual LLM 改造**：处理不可信材料的路径路由到 quarantined agent，只返回结构化符号摘要给主 agent
- **CaMeL-style 数据流污点跟踪**：主 agent 输出受限 DSL 代码，runtime 做完整 taint propagation
- **审计数据分区 / 冷热分离**：审计表 > 5000 万条后按月 partition，历史数据归档到 ClickHouse
- **基于审计数据的异常检测与自动封禁**：实时分析同一用户的异常模式（如短时间内大量 denied）自动告警或暂停其 Agent 调用额度
- **审计数据导出**：为对接外部审计/监管提供 CSV / JSONL 导出接口

## 10. 工期预估

| 阶段 | 工作 | 预计 |
|---|---|---|
| P0 核心 | scopeGuard + audit 中间件 + `agent_tool_audit_logs` 表 + unshare 网络隔离 + 装配到 5 个 agent + `shared/types/agentAudit.ts` | 3-4 天 |
| P0 管理端 | 合并 Tab 改造现有 `/admin/audit` 页面 + 4 个 API（list/detail/stats/delete）+ 顶部统计卡片 + 清理（单步）弹窗 + 测试 | 2 天 |
| P1 熔断 | toolCallLimit 装配 + 分层配置 + 测试 | 0.5-1 天 |
| 集成验证 | 手工验证 2 条 | 0.5 天 |
| **合计** | — | **6-7.5 天** |

## 11. 评审决议记录

经首轮评审 + 4 维度并行审查（需求对齐 / 基建复用 / 规范合规 / 过度设计）两轮循环迭代，关键决议：

- **安全层设计**：LangChain 官方中间件 + Linux network namespace，**纯代码规则**（无 LLM 判官，无运行时人工确认，满足无感 + 无人值守硬约束）
- **主键**：UUIDv7（时间有序减少 B-tree 碎片；复用项目 `uuid@^13` 依赖）
- **黑名单范围**：只拦结构化 AI 模板分隔符，**不拦**自然语言"忽略以上"、`system:` 等（法律/英文文本合法出现）
- **审计**：完整原文不脱敏（法律场景排查刚需），配合 super_admin 访问限制 + **数据库权限分离**（见 §8.2）
- **熔断**：与主防御同批上线，分层配置优雅降级
- **管理端**：合并到现有 `/admin/audit` 用 Tab 切换，不新开独立页
- **命名 / API / 前端组件**全面对齐项目现有 `permissionAuditLogs`、`admin/audit`、`GeneralPagination`、`GeneralDatePicker`、`useAlertDialogStore` 等既有基建
- **字段精简**：砍 `resultDigest` / `draftId` / `reviewId` 独立列（并入 `argsDigest` JSON）；索引从 4 个精简到 3 个
- **2026-04-21 plan 两轮审查后修订**：
    - 清理弹窗从 `useAlertDialogStore.showErrorDialog` 改为**本地 `AlertDialog` + `GeneralDatePicker`**。原因：`showErrorDialog` 的 `message` 仅支持 string，不能内嵌日期选择器；按 `.claude/rules/ui.md` "组件内持有独立状态"场景的规定应用本地 AlertDialog（详见 §4.7）
    - scopeGuard 对 `process_materials` / `search_law` / `save_analysis_result` / `parse_and_ask_stance` 的规则**仅保留黑名单扫描，不做身份字段绑定**（这些工具的 schema 经查证无 `caseId`/`userId`/`runId`/`reviewId` 字段，caseId 等由 context 注入）
    - `toolCallLimitMiddleware` 按 LangChain 1.3.x 原生 API **按工具名分别创建实例并返回数组**（原生 `threadLimit` 是 `number` 不是 `Record`，一次只能限一个工具）
    - `run_skill_script` scopeGuard 不再做 `skillName` 注册表校验（工具层已有白名单字符校验，避免重复）
    - UUIDv7 生成**复用项目已有** `shared/utils/uuid.ts` 的 `uuidv7()` 函数（避免两处 `import { v7 as uuidv7 } from 'uuid'` 造成命名漂移）

## 12. 提交约定

- Commit scope：`.claude/rules/git.md` 的 scope 白名单**没有 `security`**。本模块提交使用现有最贴近的 scope：
    - 工作流中间件改动：`feat(workflow): 新增 scopeGuard 中间件`
    - 管理端 API/页面改动：`feat(api): 新增 agent 审计接口`、`feat(ui): 新增 agent 审计页面 Tab`
    - Prisma 模型改动：`feat(db): 新增 agent_tool_audit_logs 表`
- 如团队希望未来统一到 `security` scope，由架构负责人另起 PR 更新 `.claude/rules/git.md`
- 提交信息用中文（对齐项目现有提交风格）
