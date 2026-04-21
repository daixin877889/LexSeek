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
- **不做**输入/输出 PII 脱敏——与法律业务直接冲突（文书必须包含当事人真实身份信息）；仅在审计日志侧 mask。
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

    ┌────────────────────────────────┐
    │ 管理端审计查询 / 清理           │
    │  /admin/agent-audit            │
    │  GET  /api/v1/admin/agent-audit│
    │  DEL  /api/v1/admin/agent-audit│
    └────────────────────────────────┘
```

| # | 组件 | 类型 | 防御点 |
|---|---|---|---|
| 1 | `scopeGuardMiddleware` | 自定义 `wrapToolCall` 中间件 | **B + C**：参数 scope 硬校验 |
| 2 | `toolCallLimitMiddleware` | LangChain 原生 | **C + D**：分层次数熔断，优雅降级 |
| 3 | `auditMiddleware` | 自定义 `wrapToolCall` 中间件 | **E**：审计归档 + 脱敏 |
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
| `save_analysis_result` / `parseAndAskStance` | 要求 context 必须提供对应的 `runId` / `reviewId` / `draftId`（context 里缺失时直接拒绝）；若工具参数里也带这些字段，必须与 context 一致 |
| 所有工具 | 参数中不得出现 `<|`、`system:`、`role: system`、prompt injection 典型 token（最小启发式黑名单，本期实施；仅作为纵深防御的一层兜底，不依赖它独立挡住攻击，**不做内容理解**） |

**关于 context 字段缺失的处理**：LangChain 的 `ToolContext` 里 `caseId/runId/draftId/reviewId` 均为可选字段（见 `server/services/workflow/tools/types.ts`）。scopeGuard 的原则是：
- 工具的参数里**必须**满足校验条件；
- context 字段缺失等同于"无权限使用该字段"，工具参数不得伪造（例如 context 里没 caseId 但参数里硬塞一个 caseId，视为越权，直接拒绝）。

**实现要点**：
- 规则配置为**工具名 → 校验函数**的纯函数 map，无 LLM 调用。
- 校验失败时 `wrapToolCall` 不调用 `handler(request)`，直接返回 `ToolMessage({ content: "Error: <deny reason>", ... })`，Agent 收到后自然回退，不 crash。
- 拒绝事件同时推送给 `auditMiddleware`（通过 state 或直接写库）。

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

**参数可调**：配置写入 `server/services/workflow/middleware/toolCallLimit.config.ts`，后续可按实际运行数据调整（例如观察到复杂合同审查真的需要 30 次 `write_skill_file`，可上调）。

### 4.4 auditMiddleware（审计归档）

**位置**：`server/services/workflow/middleware/audit.middleware.ts`

**职责**：所有工具调用（含被 scopeGuard 拒绝、被 toolCallLimit 熔断）全部写入 `agent_tool_audit` 表。

**记录字段**（参见 4.5 表结构）：
- 调用元数据：`userId`、`sessionId`、`caseId`、`runId`、`draftId`、`reviewId`、`toolName`、`verdict`（`allowed` / `denied` / `error`）、`denyReason`、`latencyMs`、`createdAt`
- **脱敏后的参数摘要**（`argsDigest`，JSON）：
    - 保留结构和字段名
    - 字符串值长度 > 200 字符截断为"前 100 + ... + 后 50"
    - **身份证/手机号/银行卡** 按正则匹配 mask（保留首 3 尾 4，中间 `*` 填充）——注意这里**只对审计日志 mask**，不影响 Agent 看到的原文
    - 不记录 `write_skill_file` 的 `content` 原文（避免审计表被拖时反而成为敏感信息集中地），只记录 SHA-256 摘要 + 长度 + 文件路径
- **工具返回值摘要**（`resultDigest`）：成功时记录长度；`verdict=denied` 时记录拒绝原因；错误时记录 error message 前 500 字符

**实现要点**：
- `wrapToolCall` 钩子在 handler 执行前记录起始时间，执行后（或拒绝后）生成记录异步入库（不阻塞工具返回）。
- **异步写库失败不影响业务流程**：`.catch(err => logger.error(...))`。
- 写库走 `prisma.agent_tool_audit.create`。

### 4.5 数据模型

**新增表**：`agent_tool_audit`（放在 `prisma/models/audit.prisma`）

```prisma
model agent_tool_audit {
    id           BigInt   @id @default(autoincrement())
    userId       Int      @map("user_id")
    sessionId    String   @map("session_id") @db.VarChar(128)
    caseId       Int?     @map("case_id")
    runId        String?  @map("run_id") @db.VarChar(64)
    draftId      Int?     @map("draft_id")
    reviewId     Int?     @map("review_id")
    toolName     String   @map("tool_name") @db.VarChar(64)
    verdict      String   @db.VarChar(16)              // allowed / denied / error
    denyReason   String?  @map("deny_reason") @db.VarChar(256)
    argsDigest   Json     @map("args_digest")           // 脱敏后的参数结构
    resultDigest Json?    @map("result_digest")         // 返回值摘要
    latencyMs    Int      @map("latency_ms")
    createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

    @@index([userId, createdAt])
    @@index([toolName, verdict, createdAt])
    @@index([sessionId])
    @@index([createdAt])
    @@map("agent_tool_audit")
}
```

- **`BigInt` 主键**：审计量大，`Int` 会在 2-3 年内爆掉。
- **四个索引**：覆盖"按用户查"、"按工具 + 结果查"、"按 session 追踪整条调用链"、"按日期清理"。
- **分区**：初版不做。数据量达 5000 万条前 PG 单表性能足够；达到后再按月 partition。
- **`argsDigest` 用 Json**：便于 PG 的 jsonb GIN 索引和后续复杂条件查询。

### 4.6 管理端 API

严格遵循项目 `/admin/` 隔离规则（`server/middleware/03.permission.ts` 会拦截非 super_admin）。

**`GET /api/v1/admin/agent-audit`** - 列表查询
- Query 参数：`page`、`limit`（默认 20，最大 100）、`userId?`、`toolName?`、`verdict?`、`caseId?`、`sessionId?`、`from?`（ISO 日期）、`to?`（ISO 日期）
- 返回：`{ list: AuditRecord[], total: number, page, limit }`
- 排序：`createdAt desc`

**`GET /api/v1/admin/agent-audit/:id`** - 详情
- 返回单条完整记录（`argsDigest` 完整 JSON）
- 便于排查某次拒绝/异常的全量上下文

**`DELETE /api/v1/admin/agent-audit`** - 按日期清理
- Body: `{ beforeDate: "2026-01-01", confirm: true }`
- `confirm=false`（预检）：返回 `{ count: N }` 告知将删除多少条，不真删
- `confirm=true`：真删，返回 `{ deleted: N }`
- 硬删（审计表软删无意义）
- 为避免一次删太多锁表，分批删除（每批 10_000 条，循环到无记录）

**`GET /api/v1/admin/agent-audit/stats`** - 概览指标（可选，初版可省）
- 返回 24h / 7d 内 `allowed/denied/error` 数量、Top 10 活跃 user、Top 10 被拒工具
- **初版不做**，留待二期

### 4.7 管理端页面

**`/admin/agent-audit`** - 列表页

按 LexSeek 现有管理页面范式（参考 `app/pages/admin/`）：

- 顶部筛选栏：用户（input）、工具（select 枚举）、verdict（select：全部/允许/拒绝/错误）、日期范围（DatePicker）、caseId/sessionId
- 表格列：时间、用户、工具、verdict（Badge 着色）、caseId、denyReason（截断显示 + tooltip 全文）、latencyMs、操作（详情）
- 分页：shadcn-vue Pagination 组件
- 点击行或"详情"按钮 → 抽屉（Sheet）显示 argsDigest / resultDigest 完整 JSON（`<pre>` + 语法高亮可选）
- 右上角"清理"按钮 → 弹出确认对话框（选日期 → 预检 → 确认 → 执行）

**UI 风格**：跟已有 `/admin/*` 页面完全一致，表格用 shadcn `Table`，筛选用已有的 `AdminTableToolbar` 或复用现有管理列表骨架。

**权限**：页面 `definePageMeta({ layout: 'admin' })`，admin layout 已经会跳非 super_admin 用户。

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

需要统一装配到：`caseMainAgent`、`contractReviewMainAgent`、`documentMainAgent`、`assistantAgent`、`moduleAgent`，以及 `subAgentToolFactory` 构造的 sub-agent。

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

### 7.1 单元测试

| 文件 | 覆盖范围 |
|---|---|
| `tests/server/workflow/middleware/scopeGuard.test.ts` | 每种工具的合法/非法参数组合；路径穿越；caseId/userId 篡改；`upload_workspace_file` 的"必须先 write"强约束；state 持久化 |
| `tests/server/workflow/middleware/audit.test.ts` | 正常调用记录、拒绝记录、异常记录；`argsDigest` 脱敏；写库失败不影响流程；大 content 摘要为 SHA + 长度 |
| `tests/server/workflow/middleware/toolCallLimit.test.ts` | 分层配置正确；per-session 隔离；超限返回 Error 字符串而非异常 |
| `tests/server/workflow/tools/runSkillScript.netns.test.ts` | Linux 路径：mock `execFile` 断言 `unshare -rn` 被调用；macOS 路径：不调 unshare；`hasUnshare` 启动探测 |

### 7.2 集成测试

| 文件 | 场景 |
|---|---|
| `tests/server/api/admin/agentAudit.test.ts` | 列表筛选 / 详情 / 按日期清理 / 非 super_admin 403 |
| `tests/server/workflow/agentSecurity.integration.test.ts` | 构造一个模拟 prompt injection 的 workflow：Agent 输入被诱导要求 `upload_workspace_file("/etc/passwd")`，断言 scopeGuard 拒绝；断言审计表有记录；断言工具最终返回 Error ToolMessage |

### 7.3 手工验证清单（集成环境）

- [ ] 在 Linux 容器内手动跑 `unshare -rn curl google.com`，应超时失败
- [ ] 调 `run_skill_script` 执行一个 `curl attacker.com` 的脚本，应因网络不可达失败
- [ ] 管理端访问 `/admin/agent-audit` 能看到最近一次分析的全部工具调用
- [ ] 管理员按"删除 2026-01-01 之前"触发清理，列表更新

## 8. 数据迁移与上线

### 8.1 数据库迁移

```bash
bun run prisma:generate
bun run prisma:migrate --name add_agent_tool_audit
```

- 新表无历史数据，迁移零风险。

### 8.2 部署检查清单

- [ ] Docker 镜像包含 `util-linux`（Debian/Ubuntu/Alpine 默认都有，确认 Dockerfile 无自定义精简）
- [ ] k8s/云厂商容器编排策略允许 user namespace
- [ ] 启动日志中能看到"skill 子进程外网隔离已启用"（Linux）或"开发环境未启用"（macOS）

### 8.3 观测

- 上线一周内每天检查 `agent_tool_audit` 表：
    - `verdict=denied` 数量 vs 总调用量（基线应 < 1%，过高说明合法场景被误伤）
    - `latencyMs` P99（中间件开销应 < 5ms）
- 若 denied 率高，针对性放宽 scopeGuard 规则（记 spec 补充说明）

## 9. 风险与局限

### 9.1 已知局限

| 局限 | 缓解 |
|---|---|
| scopeGuard 的"启发式黑名单"（prompt injection token）是兜底，不能替代结构防御 | 主防御是 scope 强校验 + 外网切断；黑名单仅作为三线防御，误报少量时可容忍 |
| macOS 开发环境无 unshare，开发机是潜在攻击面 | 开发机可信；且所有审计仍生效；真实攻击在生产触发 |
| Node.js 主进程仍可访问任何外网（正常业务需要） | 攻击者要外泄必须走 skill 子进程或诱导主进程中已有工具，后者由 scopeGuard 拦截 |
| 无法防"Agent 被诱导生成错误但合规的分析结果" | 本方案不防"语义正确性"，该问题属于模型对齐领域，不在 scope 内 |
| 审计表可能被拥有数据库访问权的内部人员查询 | 同 LexSeek 现有数据敏感性规则，靠组织层面 RBAC；审计表本身已对高风险字段脱敏 |

### 9.2 未来演进方向（不在本 spec 范围）

- **Dual LLM 改造**：处理不可信材料的路径路由到 quarantined agent，只返回结构化符号摘要给主 agent
- **CaMeL-style 数据流污点跟踪**：主 agent 输出受限 DSL 代码，runtime 做完整 taint propagation
- **审计数据分区 / 冷热分离**：审计表 > 5000 万条后按月 partition，历史数据归档到 ClickHouse
- **基于审计数据的异常检测与自动封禁**：实时分析同一用户的异常模式（如短时间内大量 denied）自动告警或暂停其 Agent 调用额度
- **审计数据导出**：为对接外部审计/监管提供 CSV / JSONL 导出接口

## 10. 工期预估

| 阶段 | 工作 | 预计 |
|---|---|---|
| P0 核心 | scopeGuard + audit 中间件 + `agent_tool_audit` 表 + unshare 网络隔离 + 装配到 5 个 agent | 3-4 天 |
| P0 管理端 | API + 列表页 + 清理弹窗 + 测试 | 2 天 |
| P1 熔断 | toolCallLimit 装配 + 分层配置 + 测试 | 0.5-1 天 |
| 集成验证 | 手工验证清单 + prompt injection 模拟测试 | 0.5-1 天 |
| **合计** | — | **6-8 天** |

## 11. 开放问题（评审请回答）

1. **scopeGuard 黑名单初始条目**：本期黑名单暂定 `<|`、`system:`、`role: system` 三条。是否有其他 token 需要追加？（该规则是纵深防御的第三层兜底，误拦风险低）
2. **工具调用次数限制的部署节奏**：`toolCallLimitMiddleware` 是否与 scopeGuard/audit 同批上线？还是先让前两者稳定运行 1-2 周，再加熔断？建议**同批上线**，默认值保守。
3. **管理端页面的观测指标**：除列表 + 清理外，是否需要在列表页顶部加一个"今日拒绝次数 / 错误次数"小卡片？（属于 4.6 stats 接口的轻量版本，工作量约 0.5 天）
