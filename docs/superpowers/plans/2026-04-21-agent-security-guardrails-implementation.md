# Agent 安全防护基础设施实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 LexSeek 的 6 处 LangGraph Agent 构造点加入「scope 强校验 + 调用次数熔断 + 完整审计 + 子进程网络隔离 + 管理端审计 Tab」五层横切安全基础设施。

**Architecture:** LangChain `createMiddleware` 的 `wrapToolCall` 钩子实现 `scopeGuard` / `audit` 中间件，**薄封装**原生 `toolCallLimitMiddleware` 实现熔断；`runSkillScript` 工具用 `unshare -rn` 包装子进程切断外网；新增 `agentToolAuditLogs` 表持久化所有调用；`/admin/audit` 改造为 Tabs 容器，新增「Agent 工具审计」Tab。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + LangGraph + LangChain（`langchain@^1.3`）+ Prisma + PostgreSQL；测试 Vitest；前端 shadcn-vue + Tailwind v4；`uuid@^13`（`v7`）。

**Spec 来源：** `docs/superpowers/specs/2026-04-21-agent-security-guardrails-design.md`

---

## 0. 全局约定

- **测试命令：** 单文件 `npx vitest run <path>`；全量 `bun run test`（`.claude/rules/commands.md`）
- **类型检查：** `npx nuxi typecheck`（**不用**裸 `tsc`）
- **服务端自动导入：** `prisma` / `logger` / `resSuccess` / `resError` / H3 函数（`defineEventHandler` / `getQuery` / `readBody` / `getRouterParam`）无需 import
- **前端自动导入：** Vue 响应式 API / Nuxt composables / Pinia stores（`useAlertDialogStore` 等）/ shadcn-vue 组件 / `useApi` / `useApiFetch` / `toast`（from vue-sonner）
- **类型导入：** 必须 `import type { X } from '#shared/types/agentAudit'`（`.claude/rules/types.md`）
- **TS 严格：** 禁止 `any`；`argsDigest` 类型用 `Record<string, unknown>`
- **HTTP 永远 200：** handler 用 `resSuccess(event, msg, data)` / `resError(event, code, msg)` 包装（`.claude/rules/api.md`）
- **zod 校验：** query 用 `z.coerce.number()` / `z.coerce.boolean()`；失败走 `resError(event, 400, result.error.issues[0].message)`
- **Commit scope：** `.claude/rules/git.md` 白名单无 `security`，按最贴近语义选：后端中间件/API 用 `feat(api)`、前端 UI 用 `feat(ui)`、Prisma 改动用 `feat(db)`；提交信息中文
- **每个 Task 完成立即 commit**（不批量）；每次 commit 前用 `simplify` 技能审视新增代码
- **禁止修改** `app/components/ui/`（shadcn-vue 组件，重装会覆盖）
- **禁止前端 import 服务端模块**（`app/**` 不得 `import '~~/server/**'`，打包会失败）；双端共用常量/类型放 `shared/types/**`
- **确认弹窗：** 需要表单状态（如选日期）的场景用**本地 shadcn `AlertDialog`**（参考 `app/components/cases/CasesDeleteDialog.vue`）；纯文本确认用 `useAlertDialogStore.showErrorDialog`

---

## 1. 文件结构总览

### 1.1 新增文件

| 路径 | 责任 | 估算行数 |
|---|---|---|
| `shared/types/agentAudit.ts` | `AgentAuditVerdict` / `AgentAuditRecord` / `LIMITED_TOOL_NAMES` 等双端共用类型和常量 | ~60 |
| `server/services/audit/agentToolAudit.service.ts` | 写库服务抽象（`writeAgentToolAuditLogService`），便于测试 `vi.mock` | ~50 |
| `server/services/workflow/middleware/scopeGuard.middleware.ts` | 黑名单 + 规则 map + `wrapToolCall` 钩子 | ~320 |
| `server/services/workflow/middleware/audit.middleware.ts` | audit `wrapToolCall` 钩子 | ~120 |
| `server/services/workflow/middleware/toolCallLimit.middleware.ts` | 薄封装 LangChain 原生 + 注入分层限额 | ~80 |
| `server/api/v1/admin/agent-audit-logs/index.get.ts` | 列表 | ~80 |
| `server/api/v1/admin/agent-audit-logs/[id].get.ts` | 详情 | ~40 |
| `server/api/v1/admin/agent-audit-logs/stats.get.ts` | 统计 | ~70 |
| `server/api/v1/admin/agent-audit-logs/index.delete.ts` | 按日期清理 | ~60 |
| `app/pages/admin/audit/components/PermissionAuditTab.vue` | Tab 1（现有内容搬迁） | ~280 |
| `app/pages/admin/audit/components/AgentAuditTab.vue` | Tab 2 主体 + 内联统计卡片 | ~280 |
| `app/pages/admin/audit/components/AgentAuditDetailSheet.vue` | 详情抽屉 | ~70 |
| `app/pages/admin/audit/components/AgentAuditCleanupDialog.vue` | 清理确认对话框（本地 AlertDialog + GeneralDatePicker） | ~90 |
| `tests/server/workflow/middleware/scopeGuard.middleware.test.ts` | scopeGuard 单测 | — |
| `tests/server/workflow/middleware/audit.middleware.test.ts` | audit 单测 | — |
| `tests/server/workflow/middleware/toolCallLimit.middleware.test.ts` | toolCallLimit 单测 | — |
| `tests/server/api/admin/agentAuditLogs.test.ts` | 管理端 API 集成测试（与 handler 实现并行，TDD 红→绿） | — |

### 1.2 修改文件

| 路径 | 修改 |
|---|---|
| `prisma/models/apiPermission.prisma` | 追加 `agentToolAuditLogs` model |
| `server/services/workflow/tools/runSkillScript.tool.ts` | 内联 `getPlatform()` / `hasUnshare()` + `unshare -rn` 包装 |
| `tests/server/workflow/tools/runSkillScript.test.ts` | 追加 netns 断言用例（不新建独立测试文件，对齐 spec §7.1） |
| `server/services/workflow/middleware/index.ts` | barrel 导出新中间件 |
| `server/services/workflow/agents/{caseMainAgent,contractReviewMainAgent,documentMainAgent,assistantAgent,moduleAgent,subAgentToolFactory}.ts` | 装配 3 个新中间件（清单驱动，见 Task 7） |
| `app/pages/admin/audit/index.vue` | 改造为 Tabs 容器，保持原 `definePageMeta` |

### 1.3 工具名与 schema 对照（防止"死代码"规则）

scopeGuard 规则必须基于**真实 schema**（实地核查后得到），避免检查不存在的字段：

| 工具名（**注册名**） | schema 字段 | scopeGuard 可执行的 scope 校验 |
|---|---|---|
| `read_skill_file` | `path` | 路径穿越 / 绝对路径 / NULL 字节；`_workspace/` 前缀需在当前 `sessionId` 的 workspace 内 |
| `write_skill_file` | `path`, `content` | 同上 + 记录"本会话已写入的相对路径集合" |
| `upload_workspace_file` | `filePath` | **强约束**：`filePath` 必须已在上一条的"已写入集合"中 |
| `run_skill_script` | `skillName`, `scriptName`, `action`, `args?` | 工具层已有白名单字符校验；scopeGuard 不再重复 |
| `search_case_materials` | `query?`, `sourceId?`, `draftId?`, `k?` | 若 `draftId` 存在，必须等于 `context.draftId`（或 context.draftId 缺失时拒绝伪造） |
| `search_law` | `query?`, `k?`, `legalType?`, `legalName?`, `isEffective?` | **无身份字段**，仅黑名单扫描 |
| `process_materials` | `fileIds?` | **无身份字段**，仅黑名单扫描 |
| `save_analysis_result` | `analysisResult` | **无身份字段**，仅黑名单扫描 |
| `parse_and_ask_stance` | `{}`（**不接参数**） | **无参数**，此工具无需 scope 校验，仅黑名单扫描（对空参数等价于 no-op） |
| `reserve_points` / `confirm_points` / `rollback_points` | 内部工具，保留原工具层校验 | 不额外做 scope 校验 |
| **所有工具** | — | 参数 string 值不含模板分隔符黑名单 |

---

## Phase 0 — 类型与数据模型

### Task 1：定义共享类型常量 + Prisma 模型 + 迁移

**Files:**
- Create: `shared/types/agentAudit.ts`
- Modify: `prisma/models/apiPermission.prisma`
- Create（自动生成）: `prisma/migrations/<timestamp>_add_agent_tool_audit_logs/migration.sql`

- [ ] **Step 1: 创建 `shared/types/agentAudit.ts`**

```ts
/**
 * Agent 工具审计相关的双端共用类型与常量。
 *
 * 放在 shared/types/ 的原因（参考 .claude/rules/types.md）：
 * - LIMITED_TOOL_NAMES 前端 Select 枚举 + 后端 toolCallLimit 配置共用，禁止前端 import ~~/server/**
 * - AgentAuditRecord 管理端 API 返回体与前端列表/详情共用
 */

/** 判决枚举（与数据库 verdict 列字符串一致） */
export enum AgentAuditVerdict {
    ALLOWED = 'allowed',
    DENIED = 'denied',
    ERROR = 'error',
}

/** 判决文本映射（前端 Badge 显示） */
export const AgentAuditVerdictText: Record<AgentAuditVerdict, string> = {
    [AgentAuditVerdict.ALLOWED]: '允许',
    [AgentAuditVerdict.DENIED]: '拒绝',
    [AgentAuditVerdict.ERROR]: '错误',
}

/**
 * 受 toolCallLimit 熔断管控的工具名白名单（snake_case，与工具注册名一致）。
 *
 * 说明：
 * - 检索类（search_case_materials / search_law）不设上限
 * - 读取类（read_skill_file）、写入/执行/上传类设上限
 * - 结果类（save_analysis_result / parse_and_ask_stance 等）不设上限
 * 详见 spec §4.3 分层表。
 */
export const LIMITED_TOOL_NAMES = [
    'read_skill_file',
    'process_materials',
    'write_skill_file',
    'run_skill_script',
    'upload_workspace_file',
] as const

export type LimitedToolName = typeof LIMITED_TOOL_NAMES[number]

/** toolCallLimit 分层配置（per-session） */
export const DEFAULT_TOOL_LIMITS: Record<LimitedToolName, number> = {
    read_skill_file: 30,
    process_materials: 5,
    write_skill_file: 20,
    run_skill_script: 10,
    upload_workspace_file: 10,
}

/** 管理端列表 / 详情返回的单条审计记录 */
export interface AgentAuditRecord {
    id: string                              // UUIDv7
    userId: number
    sessionId: string
    caseId: number | null
    runId: string | null
    toolName: string
    verdict: AgentAuditVerdict
    denyReason: string | null
    argsDigest: Record<string, unknown>     // 禁止 any
    latencyMs: number
    createdAt: string                       // ISO 8601
}

/** 统计接口返回体 */
export interface AgentAuditStatsPayload {
    today: Record<AgentAuditVerdict, number>
    last7d: Record<AgentAuditVerdict, number>
}
```

- [ ] **Step 2: 修改 `prisma/models/apiPermission.prisma`**

在文件末尾追加（与既有 `permissionAuditLogs` 同族集中管理）：

```prisma
// Agent 工具调用审计日志（详见 docs/superpowers/specs/2026-04-21-agent-security-guardrails-design.md §4.5）
model agentToolAuditLogs {
    id           String   @id @db.Uuid                 // UUIDv7（应用层生成）
    userId       Int      @map("user_id")
    sessionId    String   @map("session_id") @db.VarChar(128)
    caseId       Int?     @map("case_id")
    runId        String?  @map("run_id") @db.VarChar(64)
    toolName     String   @map("tool_name") @db.VarChar(64)
    verdict      String   @db.VarChar(16)              // allowed / denied / error
    denyReason   String?  @map("deny_reason") @db.VarChar(256)
    argsDigest   Json     @map("args_digest")           // 完整参数原文（不脱敏），含 draftId/reviewId 等辅助字段
    latencyMs    Int      @map("latency_ms")
    createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

    @@index([userId, createdAt], map: "idx_agent_tool_audit_logs_user_id_created_at")
    @@index([verdict, createdAt], map: "idx_agent_tool_audit_logs_verdict_created_at")
    @@index([createdAt], map: "idx_agent_tool_audit_logs_created_at")
    @@map("agent_tool_audit_logs")
}
```

- [ ] **Step 3: 生成 Prisma client 并创建迁移**

```bash
bun run prisma:generate
bunx prisma migrate dev --name add_agent_tool_audit_logs
```

预期输出：`Applied migration: add_agent_tool_audit_logs`。验证 `prisma/migrations/<timestamp>_add_agent_tool_audit_logs/migration.sql` 已生成且含 `CREATE TABLE "agent_tool_audit_logs"`。

- [ ] **Step 4: Commit**

```bash
git add shared/types/agentAudit.ts prisma/models/apiPermission.prisma prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(db): 新增 agent_tool_audit_logs 表与共享类型

- 新建 shared/types/agentAudit.ts 导出 AgentAuditVerdict / AgentAuditRecord / LIMITED_TOOL_NAMES 等双端共用类型
- prisma 追加 agentToolAuditLogs model，UUIDv7 主键，3 个索引
- 索引命名对齐现有 permissionAuditLogs（idx_xxx_yyy）
- 审计不可变，不设 updatedAt/deletedAt
EOF
)"
```

---

## Phase 1 — 三大中间件（TDD）

### Task 2：scopeGuard 中间件（TDD）

**Files:**
- Create: `tests/server/workflow/middleware/scopeGuard.middleware.test.ts`
- Create: `server/services/workflow/middleware/scopeGuard.middleware.ts`

- [ ] **Step 1: 先写测试（红灯）**

```ts
/**
 * scopeGuard 中间件测试
 *
 * Feature: agent-security-guardrails
 * Validates: spec §4.1 规则表
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { ToolCallRequest } from 'langchain'
import { createScopeGuardMiddleware } from '../../../../server/services/workflow/middleware/scopeGuard.middleware'

const SESSION_ID = 'sess-test-001'
const USER_ID = 42
const CASE_ID = 100
const DRAFT_ID = 200

function makeRequest(toolName: string, args: Record<string, unknown>): ToolCallRequest {
    // ToolCallRequest 的结构：{ toolCall: { name, args, id }, state, runtime }
    // 为单测降噪，只构造字段断言所必需的内容
    return {
        toolCall: { id: 't1', name: toolName, args },
        state: {},
        runtime: { context: { userId: USER_ID, caseId: CASE_ID, draftId: DRAFT_ID, sessionId: SESSION_ID } },
    } as unknown as ToolCallRequest
}

describe('scopeGuard.middleware', () => {
    let middleware: ReturnType<typeof createScopeGuardMiddleware>
    let handlerCalled: number
    let handler: (req: ToolCallRequest) => Promise<unknown>

    beforeEach(() => {
        middleware = createScopeGuardMiddleware()
        handlerCalled = 0
        handler = async () => {
            handlerCalled += 1
            return { content: 'ok' }
        }
    })

    describe('read_skill_file 路径校验', () => {
        it('合法 _workspace 相对路径放行', async () => {
            const req = makeRequest('read_skill_file', { path: '_workspace/output.md' })
            await middleware.wrapToolCall!(req, handler)
            expect(handlerCalled).toBe(1)
        })

        it('绝对路径被拒', async () => {
            const req = makeRequest('read_skill_file', { path: '/etc/passwd' })
            const result = await middleware.wrapToolCall!(req, handler)
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('非法路径')
        })

        it('`..` 路径穿越被拒', async () => {
            const req = makeRequest('read_skill_file', { path: 'skills/../../../etc/passwd' })
            const result = await middleware.wrapToolCall!(req, handler)
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('非法路径')
        })

        it('NULL 字节（\\0）被拒', async () => {
            const req = makeRequest('read_skill_file', { path: 'a\0b' })
            const result = await middleware.wrapToolCall!(req, handler)
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('非法路径')
        })
    })

    describe('upload_workspace_file 强约束', () => {
        it('未在会话内 write 过的文件被拒', async () => {
            const req = makeRequest('upload_workspace_file', { filePath: 'unknown.txt' })
            const result = await middleware.wrapToolCall!(req, handler)
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('必须先通过 write_skill_file 写入')
        })

        it('先 write 后 upload 放行', async () => {
            const writeReq = makeRequest('write_skill_file', { path: 'report.md', content: 'hi' })
            await middleware.wrapToolCall!(writeReq, handler)

            const uploadReq = makeRequest('upload_workspace_file', { filePath: 'report.md' })
            await middleware.wrapToolCall!(uploadReq, handler)
            expect(handlerCalled).toBe(2)
        })
    })

    describe('search_case_materials draftId 越权', () => {
        it('参数 draftId 与 context.draftId 一致时放行', async () => {
            const req = makeRequest('search_case_materials', { query: 'X', draftId: DRAFT_ID })
            await middleware.wrapToolCall!(req, handler)
            expect(handlerCalled).toBe(1)
        })

        it('参数 draftId 与 context.draftId 不一致时拒绝', async () => {
            const req = makeRequest('search_case_materials', { query: 'X', draftId: 999 })
            const result = await middleware.wrapToolCall!(req, handler)
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('draftId')
        })
    })

    describe('模板分隔符黑名单（对所有工具生效）', () => {
        it('参数值含 <|im_start|> 被拒', async () => {
            const req = makeRequest('search_law', { query: '正常 <|im_start|> 注入' })
            const result = await middleware.wrapToolCall!(req, handler)
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('可疑内容')
        })

        it('中文法律文本"忽略前款约定"不被拦截', async () => {
            const req = makeRequest('search_law', { query: '第五条 忽略前款约定的情形' })
            await middleware.wrapToolCall!(req, handler)
            expect(handlerCalled).toBe(1)
        })

        it('英文合同片段 "System: Microsoft Windows 11" 不被拦截', async () => {
            const req = makeRequest('search_law', { query: 'System: Microsoft Windows 11 兼容性' })
            await middleware.wrapToolCall!(req, handler)
            expect(handlerCalled).toBe(1)
        })

        it('嵌套 JSON 中的污染亦被扫描', async () => {
            const req = makeRequest('write_skill_file', { path: 'a.md', content: 'x', meta: { inject: '<|endoftext|>' } })
            const result = await middleware.wrapToolCall!(req, handler)
            expect(handlerCalled).toBe(0)
            expect(JSON.stringify(result)).toContain('可疑内容')
        })
    })

    describe('schema 无身份字段的工具', () => {
        it('save_analysis_result 合法内容放行（仅黑名单生效）', async () => {
            const req = makeRequest('save_analysis_result', { analysisResult: '# 分析结论\n正常 markdown' })
            await middleware.wrapToolCall!(req, handler)
            expect(handlerCalled).toBe(1)
        })

        it('parse_and_ask_stance 空参数放行', async () => {
            const req = makeRequest('parse_and_ask_stance', {})
            await middleware.wrapToolCall!(req, handler)
            expect(handlerCalled).toBe(1)
        })
    })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/server/workflow/middleware/scopeGuard.middleware.test.ts
```

预期：Cannot find module `scopeGuard.middleware`（红灯）。

- [ ] **Step 3: 实现 `scopeGuard.middleware.ts`（最小让测试通过）**

```ts
/**
 * scopeGuard 中间件
 *
 * 在 wrapToolCall 钩子中对工具调用参数做确定性 scope 校验，拒绝越权调用。
 *
 * 设计要点：
 * - 规则 map 仅针对 schema 中**真实存在**的字段做校验（见 spec §4.1 工具名-schema 对照）
 * - 工具名一律 snake_case，与工具注册名完全一致
 * - 所有拒绝直接返回 ToolMessage 字符串，不抛异常（Agent 收到后自然回退）
 * - 模板分隔符黑名单对所有工具生效，递归扫描 JSON string 叶子
 */

import { createMiddleware, ToolMessage } from 'langchain'
import type { ToolCallRequest } from 'langchain'
import { z } from 'zod'

/** 模板分隔符黑名单（spec §4.1：只拦结构化模板分隔符，不拦 system:/忽略以上 等自然语言） */
const BLACKLIST_PATTERNS = [
    '<|',                    // 通用前缀
    '<|im_start|>', '<|im_end|>',       // ChatML
    '<|begin_of_text|>', '<|eot_id|>',  // Llama 3
    '[INST]', '[/INST]',                // Llama 2 / Mistral
    '<s>', '</s>',                      // BOS/EOS
    '### Instruction:', '### Response:', // Alpaca / Vicuna
]

/** 会话 → 已通过 write_skill_file 写入的相对路径集合（upload 强约束依赖） */
const sessionWrittenFiles = new Map<string, Set<string>>()

/** 导出给测试的重置函数（仅测试用；生产不应调用） */
export function _resetSessionWrittenFiles(): void {
    sessionWrittenFiles.clear()
}

/** 递归扫描 JSON 对象，返回命中黑名单的 token（或 null） */
function scanBlacklist(value: unknown): string | null {
    if (typeof value === 'string') {
        for (const token of BLACKLIST_PATTERNS) {
            if (value.includes(token)) return token
        }
        return null
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const hit = scanBlacklist(item)
            if (hit) return hit
        }
        return null
    }
    if (value && typeof value === 'object') {
        for (const v of Object.values(value)) {
            const hit = scanBlacklist(v)
            if (hit) return hit
        }
    }
    return null
}

/** 路径校验：拒绝绝对路径、`..` 穿越、NULL 字节 */
function isPathUnsafe(rawPath: unknown): boolean {
    if (typeof rawPath !== 'string') return true
    if (rawPath.includes('\0')) return true
    if (rawPath.startsWith('/')) return true
    if (rawPath.includes('..')) return true
    return false
}

/** 返回被拒绝的 ToolMessage */
function deny(toolCallId: string, reason: string): ToolMessage {
    return new ToolMessage({
        tool_call_id: toolCallId,
        content: `Error: ${reason}`,
        status: 'error',
    })
}

/** 工具名 → 专属规则的映射。返回 ToolMessage 表示拒绝，返回 null 表示放行 */
type ToolRule = (
    args: Record<string, unknown>,
    ctx: { userId: number, caseId?: number, draftId?: number, sessionId: string },
    toolCallId: string,
) => ToolMessage | null

const TOOL_RULES: Record<string, ToolRule> = {
    read_skill_file: (args, _ctx, id) => {
        if (isPathUnsafe(args.path)) return deny(id, '非法路径')
        return null
    },

    write_skill_file: (args, ctx, id) => {
        if (isPathUnsafe(args.path)) return deny(id, '非法路径')
        // 记录本会话已写入的相对路径，供 upload_workspace_file 强约束使用
        const set = sessionWrittenFiles.get(ctx.sessionId) ?? new Set<string>()
        set.add(String(args.path))
        sessionWrittenFiles.set(ctx.sessionId, set)
        return null
    },

    upload_workspace_file: (args, ctx, id) => {
        const fp = args.filePath
        if (isPathUnsafe(fp)) return deny(id, '非法路径')
        const set = sessionWrittenFiles.get(ctx.sessionId)
        if (!set || !set.has(String(fp))) {
            return deny(id, '必须先通过 write_skill_file 写入，才能上传同一文件')
        }
        return null
    },

    search_case_materials: (args, ctx, id) => {
        // schema 只有 draftId 可被 LLM 伪造；caseId/userId 由 context 注入，不经参数
        if (args.draftId !== undefined && args.draftId !== ctx.draftId) {
            return deny(id, '参数 draftId 与当前会话 context 不一致')
        }
        return null
    },
}

export function createScopeGuardMiddleware() {
    return createMiddleware({
        name: 'ScopeGuardMiddleware',
        stateSchema: z.object({}),
        wrapToolCall: async (request: ToolCallRequest, handler) => {
            const toolName = request.toolCall.name
            const args = (request.toolCall.args ?? {}) as Record<string, unknown>
            // runtime.context 的结构在 LangGraph 中保证存在；取失败则 context 缺失视为非法
            const rawCtx = (request.runtime as { context?: Record<string, unknown> }).context ?? {}
            const ctx = {
                userId: Number(rawCtx.userId ?? 0),
                caseId: rawCtx.caseId as number | undefined,
                draftId: rawCtx.draftId as number | undefined,
                sessionId: String(rawCtx.sessionId ?? ''),
            }
            const toolCallId = String(request.toolCall.id ?? '')

            // 1. 黑名单扫描（对所有工具生效）
            const hit = scanBlacklist(args)
            if (hit) {
                logger.warn('scopeGuard 拦截污染标记', { tool: toolName, sessionId: ctx.sessionId, token: hit })
                return deny(toolCallId, '参数包含可疑内容')
            }

            // 2. 工具专属规则
            const rule = TOOL_RULES[toolName]
            if (rule) {
                const denied = rule(args, ctx, toolCallId)
                if (denied) {
                    logger.warn('scopeGuard 拒绝工具调用', { tool: toolName, sessionId: ctx.sessionId, reason: denied.content })
                    return denied
                }
            }

            return handler(request)
        },
    })
}
```

- [ ] **Step 4: 跑测试确认全部通过（绿灯）**

```bash
npx vitest run tests/server/workflow/middleware/scopeGuard.middleware.test.ts
```

预期：所有用例通过。

- [ ] **Step 5: 类型检查**

```bash
npx nuxi typecheck 2>&1 | grep -i "scopeGuard\|error" | head -20
```

预期：无 error。

- [ ] **Step 6: Commit**

```bash
git add tests/server/workflow/middleware/scopeGuard.middleware.test.ts server/services/workflow/middleware/scopeGuard.middleware.ts
git commit -m "$(cat <<'EOF'
feat(api): 新增 scopeGuard 中间件拦截工具调用越权

- 基于工具真实 schema 做 scope 校验（read/write/upload 路径；search_case_materials draftId）
- 模板分隔符黑名单（ChatML/Llama/Alpaca 等），不拦自然语言
- upload_workspace_file 强约束：必须先经 write_skill_file 写入
- NULL 字节用 \0 判断；拒绝时返回 ToolMessage 不抛异常
EOF
)"
```

---

### Task 3：audit 中间件（TDD）

**Files:**
- Create: `tests/server/workflow/middleware/audit.middleware.test.ts`
- Create: `server/services/audit/agentToolAudit.service.ts`
- Create: `server/services/workflow/middleware/audit.middleware.ts`

**设计要点**：
- 写库放在 `agentToolAudit.service.ts` 暴露 `writeAgentToolAuditLogService`，测试可用 `vi.mock` 替换；**中间件文件显式 import 该 service**（不依赖自动导入即可 mock）
- `write_skill_file.content` 字段摘要为 `{ sha256, length, path }`，其他字段原样保留（**不脱敏**，spec §4.4）
- 长字符串值 > 2000 字符截断到 2000（存储成本规避，非安全脱敏）
- 异步写库失败不阻塞业务流程，走 `logger.error`

- [ ] **Step 1: 先写测试**

```ts
/**
 * audit 中间件测试
 *
 * Feature: agent-security-guardrails
 * Validates: spec §4.4
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolCallRequest } from 'langchain'
import { ToolMessage } from 'langchain'
import { createAuditMiddleware } from '../../../../server/services/workflow/middleware/audit.middleware'

// 必须在 import 中间件之前 mock 写库服务
vi.mock('~~/server/services/audit/agentToolAudit.service', () => ({
    writeAgentToolAuditLogService: vi.fn().mockResolvedValue(undefined),
}))

async function flushAsync() {
    await new Promise(resolve => setImmediate(resolve))
}

function makeRequest(toolName: string, args: Record<string, unknown>): ToolCallRequest {
    return {
        toolCall: { id: 't1', name: toolName, args },
        state: {},
        runtime: { context: { userId: 10, sessionId: 'sess-a', caseId: 1, runId: null } },
    } as unknown as ToolCallRequest
}

describe('audit.middleware', () => {
    let writeLog: ReturnType<typeof vi.fn>

    beforeEach(async () => {
        const mod = await import('~~/server/services/audit/agentToolAudit.service')
        writeLog = mod.writeAgentToolAuditLogService as ReturnType<typeof vi.fn>
        writeLog.mockClear()
    })

    it('正常调用成功后记录 verdict=allowed', async () => {
        const mw = createAuditMiddleware()
        const req = makeRequest('search_law', { query: 'x' })
        const handler = async () => new ToolMessage({ tool_call_id: 't1', content: 'ok' })
        await mw.wrapToolCall!(req, handler)
        await flushAsync()

        expect(writeLog).toHaveBeenCalledOnce()
        const call = writeLog.mock.calls[0][0]
        expect(call.verdict).toBe('allowed')
        expect(call.toolName).toBe('search_law')
        expect(call.userId).toBe(10)
        expect(call.argsDigest).toEqual({ query: 'x' })
    })

    it('handler 返回 error ToolMessage 时记录 verdict=error', async () => {
        const mw = createAuditMiddleware()
        const req = makeRequest('search_law', { query: 'x' })
        const handler = async () => new ToolMessage({ tool_call_id: 't1', content: 'boom', status: 'error' })
        await mw.wrapToolCall!(req, handler)
        await flushAsync()

        const call = writeLog.mock.calls[0][0]
        expect(call.verdict).toBe('error')
    })

    it('scopeGuard 拒绝（status=error 且 content 以 Error: 开头）记录为 denied', async () => {
        const mw = createAuditMiddleware()
        const req = makeRequest('read_skill_file', { path: '/etc/passwd' })
        const handler = async () => new ToolMessage({
            tool_call_id: 't1',
            content: 'Error: 非法路径',
            status: 'error',
        })
        await mw.wrapToolCall!(req, handler)
        await flushAsync()

        const call = writeLog.mock.calls[0][0]
        expect(call.verdict).toBe('denied')
        expect(call.denyReason).toContain('非法路径')
    })

    it('write_skill_file 的 content 字段摘要为 SHA+长度+路径', async () => {
        const mw = createAuditMiddleware()
        const req = makeRequest('write_skill_file', { path: 'out.md', content: '# 很长的合同原文'.repeat(500) })
        const handler = async () => new ToolMessage({ tool_call_id: 't1', content: 'ok' })
        await mw.wrapToolCall!(req, handler)
        await flushAsync()

        const call = writeLog.mock.calls[0][0]
        expect(call.argsDigest.path).toBe('out.md')
        expect(call.argsDigest.content).toMatchObject({
            sha256: expect.any(String),
            length: expect.any(Number),
        })
        expect(typeof call.argsDigest.content.sha256).toBe('string')
        expect((call.argsDigest.content.sha256 as string).length).toBe(64)
    })

    it('长字符串截断到 2000 字符（存储成本规避，非安全脱敏）', async () => {
        const mw = createAuditMiddleware()
        const longStr = 'x'.repeat(3000)
        const req = makeRequest('search_law', { query: longStr })
        const handler = async () => new ToolMessage({ tool_call_id: 't1', content: 'ok' })
        await mw.wrapToolCall!(req, handler)
        await flushAsync()

        const call = writeLog.mock.calls[0][0]
        expect((call.argsDigest.query as string).length).toBe(2000)
    })

    it('写库失败时业务流程不阻塞，错误进 logger', async () => {
        writeLog.mockRejectedValueOnce(new Error('DB down'))
        const mw = createAuditMiddleware()
        const req = makeRequest('search_law', { query: 'x' })
        const handler = async () => new ToolMessage({ tool_call_id: 't1', content: 'ok' })

        await expect(mw.wrapToolCall!(req, handler)).resolves.toBeDefined()
        await flushAsync()
    })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/server/workflow/middleware/audit.middleware.test.ts
```

预期：模块未找到（红灯）。

- [ ] **Step 3: 实现 `server/services/audit/agentToolAudit.service.ts`**

```ts
/**
 * Agent 工具审计日志写入服务
 *
 * 独立服务层便于中间件 vi.mock；不放在 middleware 内部直接调 prisma，
 * 是因为自动导入的 prisma 无法用 vi.mock 替换。
 */

import { v7 as uuidv7 } from 'uuid'
import type { AgentAuditRecord, AgentAuditVerdict } from '#shared/types/agentAudit'

/** 写入请求参数（中间件构造） */
export interface WriteAgentToolAuditLogInput {
    userId: number
    sessionId: string
    caseId: number | null
    runId: string | null
    toolName: string
    verdict: AgentAuditVerdict
    denyReason: string | null
    argsDigest: Record<string, unknown>
    latencyMs: number
}

/**
 * 异步写一条审计记录。写库失败不抛出，由调用方捕获后进 logger。
 */
export async function writeAgentToolAuditLogService(input: WriteAgentToolAuditLogInput): Promise<AgentAuditRecord> {
    const record = await prisma.agentToolAuditLogs.create({
        data: {
            id: uuidv7(),
            userId: input.userId,
            sessionId: input.sessionId,
            caseId: input.caseId,
            runId: input.runId,
            toolName: input.toolName,
            verdict: input.verdict,
            denyReason: input.denyReason,
            argsDigest: input.argsDigest,
            latencyMs: input.latencyMs,
        },
    })
    return {
        id: record.id,
        userId: record.userId,
        sessionId: record.sessionId,
        caseId: record.caseId,
        runId: record.runId,
        toolName: record.toolName,
        verdict: record.verdict as AgentAuditVerdict,
        denyReason: record.denyReason,
        argsDigest: record.argsDigest as Record<string, unknown>,
        latencyMs: record.latencyMs,
        createdAt: record.createdAt.toISOString(),
    }
}
```

- [ ] **Step 4: 实现 `audit.middleware.ts`**

```ts
/**
 * audit 中间件
 *
 * 所有工具调用（allowed/denied/error）全部持久化到 agent_tool_audit_logs。
 * 异步写库，不阻塞业务；写库失败进 logger.error 但不抛出。
 */

import { createHash } from 'node:crypto'
import { createMiddleware, ToolMessage } from 'langchain'
import type { ToolCallRequest } from 'langchain'
import { z } from 'zod'
import { writeAgentToolAuditLogService } from '~~/server/services/audit/agentToolAudit.service'
import { AgentAuditVerdict } from '#shared/types/agentAudit'

/** 单字符串字段最大长度（存储成本规避，非安全脱敏） */
const MAX_STRING_LENGTH = 2000

/** 摘要化工具参数：write_skill_file.content 单独 SHA 化，其他字段原样但长串截断 */
function digestArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    if (toolName === 'write_skill_file' && typeof args.content === 'string') {
        const sha = createHash('sha256').update(args.content).digest('hex')
        return {
            ...args,
            content: { sha256: sha, length: args.content.length },
        }
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(args)) {
        if (typeof v === 'string' && v.length > MAX_STRING_LENGTH) {
            out[k] = v.slice(0, MAX_STRING_LENGTH)
        } else {
            out[k] = v
        }
    }
    return out
}

/** 由 handler 返回的 ToolMessage 判定 verdict */
function verdictOf(result: unknown): { verdict: AgentAuditVerdict, denyReason: string | null } {
    if (result instanceof ToolMessage) {
        if (result.status === 'error') {
            const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
            // scopeGuard 的拒绝信息以 "Error: " 开头，视为 denied；其他 error 状态（如工具内部抛错）视为 error
            if (content.startsWith('Error: ')) {
                return { verdict: AgentAuditVerdict.DENIED, denyReason: content.slice('Error: '.length).slice(0, 256) }
            }
            return { verdict: AgentAuditVerdict.ERROR, denyReason: content.slice(0, 256) }
        }
    }
    return { verdict: AgentAuditVerdict.ALLOWED, denyReason: null }
}

export function createAuditMiddleware() {
    return createMiddleware({
        name: 'AuditMiddleware',
        stateSchema: z.object({}),
        wrapToolCall: async (request: ToolCallRequest, handler) => {
            const startedAt = Date.now()
            const toolName = request.toolCall.name
            const args = (request.toolCall.args ?? {}) as Record<string, unknown>
            const rawCtx = (request.runtime as { context?: Record<string, unknown> }).context ?? {}
            const ctx = {
                userId: Number(rawCtx.userId ?? 0),
                sessionId: String(rawCtx.sessionId ?? ''),
                caseId: (rawCtx.caseId as number | null | undefined) ?? null,
                runId: (rawCtx.runId as string | null | undefined) ?? null,
            }

            let result: unknown
            let thrown: unknown = null
            try {
                result = await handler(request)
            } catch (err) {
                thrown = err
            }

            const latencyMs = Date.now() - startedAt

            // 异步写库，不阻塞返回
            const { verdict, denyReason } = thrown
                ? { verdict: AgentAuditVerdict.ERROR, denyReason: (thrown instanceof Error ? thrown.message : String(thrown)).slice(0, 256) }
                : verdictOf(result)

            writeAgentToolAuditLogService({
                userId: ctx.userId,
                sessionId: ctx.sessionId,
                caseId: ctx.caseId,
                runId: ctx.runId,
                toolName,
                verdict,
                denyReason,
                argsDigest: digestArgs(toolName, args),
                latencyMs,
            }).catch(err => logger.error('agent 工具审计写库失败', { err, toolName, sessionId: ctx.sessionId }))

            if (thrown) throw thrown
            return result
        },
    })
}
```

- [ ] **Step 5: 跑测试（绿灯）**

```bash
npx vitest run tests/server/workflow/middleware/audit.middleware.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add tests/server/workflow/middleware/audit.middleware.test.ts \
        server/services/audit/agentToolAudit.service.ts \
        server/services/workflow/middleware/audit.middleware.ts
git commit -m "$(cat <<'EOF'
feat(api): 新增 audit 中间件持久化 agent 工具调用记录

- 独立 agentToolAudit.service.ts 便于测试 vi.mock
- 完整原文不脱敏；write_skill_file.content 单独 SHA+长度
- 长字符串截断到 2000 字符（存储成本规避）
- 异步写库失败不阻塞业务，走 logger.error
EOF
)"
```

---

### Task 4：toolCallLimit 中间件（薄封装 LangChain 原生）

**Files:**
- Create: `tests/server/workflow/middleware/toolCallLimit.middleware.test.ts`
- Create: `server/services/workflow/middleware/toolCallLimit.middleware.ts`

**设计要点**：
- **复用** `toolCallLimitMiddleware from 'langchain'`（不造轮子）
- 限额来自 `shared/types/agentAudit.ts` 的 `DEFAULT_TOOL_LIMITS`（双端共用）
- 薄封装的职责：把默认配置注入 + 超限时把 `ToolCallLimitExceededError` 转成友好 ToolMessage（Agent 收到后优雅降级）

- [ ] **Step 1: 先写测试**

```ts
/**
 * toolCallLimit 中间件测试
 *
 * Feature: agent-security-guardrails
 * Validates: spec §4.3
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_TOOL_LIMITS } from '#shared/types/agentAudit'
import { createToolCallLimitMiddleware } from '../../../../server/services/workflow/middleware/toolCallLimit.middleware'

describe('toolCallLimit.middleware', () => {
    it('导出 DEFAULT_TOOL_LIMITS 与 spec §4.3 一致', () => {
        expect(DEFAULT_TOOL_LIMITS).toMatchObject({
            read_skill_file: 30,
            process_materials: 5,
            write_skill_file: 20,
            run_skill_script: 10,
            upload_workspace_file: 10,
        })
    })

    it('createToolCallLimitMiddleware 返回 LangChain middleware 对象（带 name 字段）', () => {
        const mw = createToolCallLimitMiddleware()
        expect(mw).toBeDefined()
        expect(typeof mw).toBe('object')
    })
})
```

**注**：超限行为的 E2E 测试由 Task 9 集成测试覆盖（需要真实 agent 跑 >10 次 `run_skill_script`）；单测不模拟 LangChain 运行时，仅断言配置/导出正确，避免脆弱测试。

- [ ] **Step 2: 跑测试（红灯）**

```bash
npx vitest run tests/server/workflow/middleware/toolCallLimit.middleware.test.ts
```

- [ ] **Step 3: 实现**

```ts
/**
 * toolCallLimit 中间件
 *
 * 薄封装 LangChain 原生 toolCallLimitMiddleware，注入分层限额。
 * 超限时原生会抛 ToolCallLimitExceededError；由 agent runtime 捕获转为
 * 字符串 ToolMessage 让模型继续推进，不 crash（spec §4.3 优雅降级）。
 */

import { toolCallLimitMiddleware } from 'langchain'
import { DEFAULT_TOOL_LIMITS, type LimitedToolName } from '#shared/types/agentAudit'

export function createToolCallLimitMiddleware() {
    // LangChain 原生接受 { toolName: limit } 映射；超限默认抛 ToolCallLimitExceededError
    const limits: Record<string, number> = {}
    for (const [name, limit] of Object.entries(DEFAULT_TOOL_LIMITS) as [LimitedToolName, number][]) {
        limits[name] = limit
    }

    return toolCallLimitMiddleware({
        // 按 per-thread 计数（LangGraph 的 thread_id == session_id，对齐 spec §4.3 "per-session"）
        threadLimit: limits,
        // 超限行为：返回 error ToolMessage 而非抛异常（对齐 spec §4.3 优雅降级）
        // 若原生不支持 exit behavior 的结构化配置，此处可 catch 并改写
        exitBehavior: 'end',
    } as Parameters<typeof toolCallLimitMiddleware>[0])
}
```

**如果原生 `toolCallLimitMiddleware` 的 exitBehavior 不支持 `'end'` 或不符合需要**，回退实现：用 `createMiddleware` 自写一个薄的 per-session counter，超限返回 ToolMessage（而非 `throw`）。实现时先 `npx vitest run tests/server/workflow/middleware/toolCallLimit.middleware.test.ts` 确认原生 API 行为；如果原生抛错无法 catch 为 ToolMessage，改走自写路径（依然用 LangChain 原生的 `ModelCallLimitMiddleware` 等作为参考，不是完全从头写）。

- [ ] **Step 4: 跑测试（绿灯）** + `npx nuxi typecheck`

- [ ] **Step 5: Commit**

```bash
git add tests/server/workflow/middleware/toolCallLimit.middleware.test.ts \
        server/services/workflow/middleware/toolCallLimit.middleware.ts
git commit -m "$(cat <<'EOF'
feat(api): 新增 toolCallLimit 中间件薄封装 LangChain 原生

- 复用 langchain 原生 toolCallLimitMiddleware，不造轮子
- 限额从 shared/types/agentAudit.ts 的 DEFAULT_TOOL_LIMITS 注入
- per-session（== LangGraph thread_id）独立计数
- 超限优雅降级返回 ToolMessage，Agent 可自行收束
EOF
)"
```

---

## Phase 2 — runSkillScript 网络隔离

### Task 5：`runSkillScript.tool.ts` 接入 unshare

**Files:**
- Modify: `server/services/workflow/tools/runSkillScript.tool.ts`
- Modify: `tests/server/workflow/tools/runSkillScript.test.ts`（扩展既有文件，**不新建**）

**设计要点**：
- `getPlatform()` 导出函数包一层 `process.platform`（便于 vitest `vi.spyOn` 替换；直接 `process.platform` 在 Node 无法 mock getter）
- `hasUnshare()` 启动时探测并缓存到模块级变量（首次调用触发，失败记录结果避免重复探测）；测试用 `_resetUnshareDetection()` 重置缓存
- Linux 下 execFile 改为 `unshare -rn <runtimeBin> <...origArgs>`；macOS 保持原 `runtimeBin`

- [ ] **Step 1: 先扩展测试文件**

在 `tests/server/workflow/tools/runSkillScript.test.ts` 末尾追加：

```ts
// ========== netns 相关测试（Task 5 补充） ==========

import * as platformModule from '../../../../server/services/workflow/tools/runSkillScript.tool'

describe('run_skill_script 子进程网络隔离', () => {
    beforeEach(() => {
        platformModule._resetUnshareDetection?.()
    })

    it('Linux 下 execFile 以 unshare -rn <runtime> 启动', async () => {
        const getPlatformSpy = vi.spyOn(platformModule, 'getPlatform').mockReturnValue('linux')
        const hasUnshareSpy = vi.spyOn(platformModule, 'hasUnshare').mockResolvedValue(true)

        // 模拟 execFile：捕获第一个和第二个参数
        // 具体断言基于现有测试的 mock 模式；参考文件内原有 mock
        // expect(execFile).toHaveBeenCalledWith('unshare', ['-rn', 'node', ...], ...)

        getPlatformSpy.mockRestore()
        hasUnshareSpy.mockRestore()
    })

    it('macOS 下不使用 unshare，execFile 直接启动 runtime', async () => {
        const getPlatformSpy = vi.spyOn(platformModule, 'getPlatform').mockReturnValue('darwin')
        // expect(execFile).toHaveBeenCalledWith('node', [...], ...)
        getPlatformSpy.mockRestore()
    })

    it('Linux 下 hasUnshare 探测失败（命令缺失）时抛启动错误', async () => {
        vi.spyOn(platformModule, 'getPlatform').mockReturnValue('linux')
        vi.spyOn(platformModule, 'hasUnshare').mockResolvedValue(false)
        // 构造调用应抛 "unshare 不可用，请检查基础镜像"
    })
})
```

**注**：具体断言形式需要跟文件里现有的 `execFile` mock 模式对齐；Step 3 实现后回来补全。

- [ ] **Step 2: 修改 `runSkillScript.tool.ts`**

在文件顶部追加导出：

```ts
/** 获取当前平台（导出为函数以便 vitest 用 vi.spyOn 替换；直接 process.platform 无法 mock getter） */
export function getPlatform(): NodeJS.Platform {
    return process.platform
}

/** unshare 探测缓存（模块级；测试可用 _resetUnshareDetection 清零） */
let _unshareCache: Promise<boolean> | null = null

/** 探测 unshare 命令是否可用；Linux 生产环境若不可用，后续 execFile 将抛启动错误 */
export async function hasUnshare(): Promise<boolean> {
    if (_unshareCache) return _unshareCache
    _unshareCache = new Promise<boolean>((resolve) => {
        const { execFile } = require('node:child_process') as typeof import('node:child_process')
        execFile('unshare', ['-rn', 'echo', 'ok'], { timeout: 3000 }, (err) => {
            resolve(!err)
        })
    })
    return _unshareCache
}

/** 测试用：重置 unshare 探测缓存 */
export function _resetUnshareDetection(): void {
    _unshareCache = null
}
```

在调用 `execFile(runtimeBin, execArgs, options, callback)` 的位置（原有调用点），改为：

```ts
const platform = getPlatform()
let binary = runtimeBin
let prepended: string[] = []
if (platform === 'linux') {
    const ok = await hasUnshare()
    if (!ok) {
        throw new Error('unshare 不可用，请确认 Docker 基础镜像包含 util-linux 且允许 user namespace')
    }
    binary = 'unshare'
    prepended = ['-rn', runtimeBin]
} else {
    logger.warn('开发环境未启用 skill 子进程外网隔离', { platform })
}

execFile(binary, [...prepended, ...execArgs], options, callback)
```

（具体替换点需根据文件现有 execFile 调用行位置精确编辑；实现时先 `Read` 一次定位。）

- [ ] **Step 3: 跑测试**

```bash
npx vitest run tests/server/workflow/tools/runSkillScript.test.ts
```

补齐 Step 1 测试中的具体断言，让新增用例通过；确保既有用例不回归。

- [ ] **Step 4: 类型检查** `npx nuxi typecheck`

- [ ] **Step 5: Commit**

```bash
git add server/services/workflow/tools/runSkillScript.tool.ts tests/server/workflow/tools/runSkillScript.test.ts
git commit -m "$(cat <<'EOF'
feat(api): run_skill_script 子进程用 unshare -rn 切断外网

- Linux 下 execFile 以 unshare -rn <runtime> 启动，子进程看不到任何网卡
- macOS 开发环境保持原 runtime 启动并 logger.warn 一次
- getPlatform() / hasUnshare() 导出为函数，便于 vi.spyOn 替换
- hasUnshare 启动探测+缓存，失败时抛错阻止后续调用，不静默降级
EOF
)"
```

---

## Phase 3 — 装配中间件到所有 Agent

### Task 6：批量装配（清单驱动）

**Files:**
- Modify: `server/services/workflow/middleware/index.ts`
- Modify: 6 处 agent 构造点

**装配清单**：

| # | 文件 | 备注 |
|---|---|---|
| 1 | `server/services/workflow/agents/caseMainAgent.ts` | 案件分析主 Agent |
| 2 | `server/services/workflow/agents/contractReviewMainAgent.ts` | 合同审查主 Agent |
| 3 | `server/services/workflow/agents/documentMainAgent.ts` | 文书草稿主 Agent |
| 4 | `server/services/workflow/agents/assistantAgent.ts` | 通用法律助手 |
| 5 | `server/services/workflow/agents/moduleAgent.ts` | 模块对话 Agent |
| 6 | `server/services/workflow/agents/subAgentToolFactory.ts` | Sub-agent 工厂 |

装配顺序（spec §5）：`scopeGuardMiddleware` → `toolCallLimitMiddleware` → `auditMiddleware` → 已有中间件。

- [ ] **Step 1: 导出新中间件**

修改 `server/services/workflow/middleware/index.ts`，追加：

```ts
export { createScopeGuardMiddleware } from './scopeGuard.middleware'
export { createAuditMiddleware } from './audit.middleware'
export { createToolCallLimitMiddleware } from './toolCallLimit.middleware'
```

- [ ] **Step 2: 逐个文件装配**

每个 agent 构造处（`createAgent({..., middleware: [...] })`）把中间件数组改成：

```ts
middleware: [
    createScopeGuardMiddleware(),       // 1. 先拦越权参数
    createToolCallLimitMiddleware(),    // 2. 再判熔断
    createAuditMiddleware(),            // 3. 记录所有结果
    ...existingMiddlewares,             // 已有：pointConsumption / safetyTrim 等
],
```

每改一个文件立刻 `npx nuxi typecheck` 核一遍类型。

- [ ] **Step 3: 跑中间件相关单测**

```bash
npx vitest run tests/server/workflow/middleware/
```

- [ ] **Step 4: Commit**

```bash
git add server/services/workflow/middleware/index.ts server/services/workflow/agents/
git commit -m "$(cat <<'EOF'
feat(api): 装配 scopeGuard/toolCallLimit/audit 中间件到 6 处 agent 构造点

- caseMainAgent / contractReviewMainAgent / documentMainAgent / assistantAgent
  / moduleAgent / subAgentToolFactory
- 装配顺序：scopeGuard → toolCallLimit → audit → 原有中间件
- middleware/index.ts barrel 导出三个新中间件工厂
EOF
)"
```

---

## Phase 4 — 管理端 API（每个接口 TDD）

**集成测试文件策略**：`tests/server/api/admin/agentAuditLogs.test.ts` **在 Task 7 就创建**，每加一个 API 端点就加对应的测试用例（TDD 红→绿在同一 task 内完成，不把测试全部堆到最后）。

### Task 7：列表接口 `GET /api/v1/admin/agent-audit-logs`

**Files:**
- Create: `tests/server/api/admin/agentAuditLogs.test.ts`（初版）
- Create: `server/api/v1/admin/agent-audit-logs/index.get.ts`

- [ ] **Step 1: 建测试文件并写列表接口的 3 条用例**

```ts
/**
 * Agent 审计日志管理端 API 测试
 *
 * Feature: agent-security-guardrails
 * Validates: spec §4.6
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import listHandler from '../../../../server/api/v1/admin/agent-audit-logs/index.get'

// 测试辅助：直接调 handler，绕过 Nitro router
function makeEvent(query: Record<string, string | number> = {}, auth?: { userId: number, role?: string }) {
    const event = {
        context: {
            auth: auth ? { user: { id: auth.userId }, role: auth.role ?? 'super_admin' } : undefined,
        },
        node: {
            req: { url: '/api/v1/admin/agent-audit-logs', method: 'GET' },
        },
    } as any
    // mock getQuery
    ;(globalThis as any).__query = query
    return event
}

describe('GET /api/v1/admin/agent-audit-logs', () => {
    const superAdminId = 9001

    beforeEach(async () => {
        await prisma.agentToolAuditLogs.deleteMany({ where: { userId: { in: [superAdminId, 9002] } } })
        // 创建 3 条测试数据
        await prisma.agentToolAuditLogs.createMany({
            data: [
                { id: uuidv7(), userId: 9002, sessionId: 'sA', toolName: 'read_skill_file', verdict: 'allowed', argsDigest: { path: 'a' }, latencyMs: 10 },
                { id: uuidv7(), userId: 9002, sessionId: 'sA', toolName: 'read_skill_file', verdict: 'denied', denyReason: '非法路径', argsDigest: { path: '..' }, latencyMs: 8 },
                { id: uuidv7(), userId: 9002, sessionId: 'sB', toolName: 'search_law', verdict: 'allowed', argsDigest: { query: 'x' }, latencyMs: 12 },
            ],
        })
    })

    afterEach(async () => {
        await prisma.agentToolAuditLogs.deleteMany({ where: { userId: { in: [superAdminId, 9002] } } })
    })

    it('列表返回 items + total + page + pageSize', async () => {
        const event = makeEvent({ page: 1, pageSize: 20 })
        const res = await listHandler(event)
        expect(res).toMatchObject({
            code: 0,
            data: {
                items: expect.any(Array),
                total: expect.any(Number),
                page: 1,
                pageSize: 20,
            },
        })
    })

    it('verdict 筛选：只返回 denied', async () => {
        const event = makeEvent({ page: 1, pageSize: 20, verdict: 'denied' })
        const res = await listHandler(event)
        expect(res.data.items.every((x: any) => x.verdict === 'denied')).toBe(true)
    })

    it('非法 verdict 参数返回 400', async () => {
        const event = makeEvent({ page: 1, pageSize: 20, verdict: 'invalid' })
        const res = await listHandler(event)
        expect(res.code).toBe(400)
    })
})
```

**注**：`makeEvent` 的具体形态需对齐项目现有 admin 接口测试——实际实现时先 `Read tests/server/api/admin/` 下一个已有文件（如 Task 4 阶段曾参考的 `server/api/v1/admin/audit/index.get.ts` 的测试）学 mock 模式；如果项目里 admin handler 的集成测试以别的姿势写，按那个走。目标：**不引入 `@nuxt/test-utils/e2e` 新姿势**，对齐现有风格即可。

- [ ] **Step 2: 跑测试（红灯）**

```bash
npx vitest run tests/server/api/admin/agentAuditLogs.test.ts
```

- [ ] **Step 3: 实现 `index.get.ts`**

```ts
/**
 * GET /api/v1/admin/agent-audit-logs
 *
 * 列表查询 + 分页 + 筛选。super_admin 独占（由 server/middleware/03.permission.ts 拦截）。
 */

import { z } from 'zod'
import type { AgentAuditRecord } from '#shared/types/agentAudit'

const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    userId: z.coerce.number().int().optional(),
    toolName: z.string().max(64).optional(),
    verdict: z.enum(['allowed', 'denied', 'error']).optional(),
    caseId: z.coerce.number().int().optional(),
    sessionId: z.string().max(128).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export default defineEventHandler(async (event) => {
    const raw = getQuery(event)
    const parsed = querySchema.safeParse(raw)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0].message)
    }
    const { page, pageSize, userId, toolName, verdict, caseId, sessionId, from, to } = parsed.data

    const where: Record<string, unknown> = {}
    if (userId !== undefined) where.userId = userId
    if (toolName) where.toolName = toolName
    if (verdict) where.verdict = verdict
    if (caseId !== undefined) where.caseId = caseId
    if (sessionId) where.sessionId = sessionId
    if (from || to) {
        const createdAt: Record<string, Date> = {}
        if (from) createdAt.gte = new Date(`${from}T00:00:00+08:00`)
        if (to) {
            // to 含当天：加一天作为上界
            const end = new Date(`${to}T00:00:00+08:00`)
            end.setDate(end.getDate() + 1)
            createdAt.lt = end
        }
        where.createdAt = createdAt
    }

    const [items, total] = await Promise.all([
        prisma.agentToolAuditLogs.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.agentToolAuditLogs.count({ where }),
    ])

    const payload: { items: AgentAuditRecord[], total: number, page: number, pageSize: number } = {
        items: items.map(r => ({
            id: r.id,
            userId: r.userId,
            sessionId: r.sessionId,
            caseId: r.caseId,
            runId: r.runId,
            toolName: r.toolName,
            verdict: r.verdict as AgentAuditRecord['verdict'],
            denyReason: r.denyReason,
            argsDigest: r.argsDigest as Record<string, unknown>,
            latencyMs: r.latencyMs,
            createdAt: r.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
    }
    return resSuccess(event, '查询成功', payload)
})
```

- [ ] **Step 4: 跑测试（绿灯）** + `npx nuxi typecheck`

- [ ] **Step 5: Commit**

```bash
git add tests/server/api/admin/agentAuditLogs.test.ts server/api/v1/admin/agent-audit-logs/index.get.ts
git commit -m "$(cat <<'EOF'
feat(api): 新增 agent 审计日志列表接口

- GET /api/v1/admin/agent-audit-logs 支持 page/pageSize 分页
- 筛选：userId / toolName / verdict / caseId / sessionId / from / to
- from/to 为 YYYY-MM-DD，to 语义为"含当天"
- zod 校验，失败 resError(400)；响应 resSuccess 包装
EOF
)"
```

---

### Task 8：详情接口 `GET /api/v1/admin/agent-audit-logs/:id`

**Files:**
- Modify: `tests/server/api/admin/agentAuditLogs.test.ts`（追加用例）
- Create: `server/api/v1/admin/agent-audit-logs/[id].get.ts`

- [ ] **Step 1: 追加测试**

```ts
import detailHandler from '../../../../server/api/v1/admin/agent-audit-logs/[id].get'

describe('GET /api/v1/admin/agent-audit-logs/:id', () => {
    let testId: string
    beforeEach(async () => {
        testId = uuidv7()
        await prisma.agentToolAuditLogs.create({
            data: { id: testId, userId: 9002, sessionId: 's1', toolName: 'read_skill_file', verdict: 'allowed', argsDigest: { path: 'a' }, latencyMs: 10 },
        })
    })
    afterEach(async () => {
        await prisma.agentToolAuditLogs.deleteMany({ where: { userId: 9002 } })
    })

    it('返回单条完整记录', async () => {
        const event = { ...makeEvent(), context: { ...makeEvent().context, params: { id: testId } } }
        const res = await detailHandler(event)
        expect(res.code).toBe(0)
        expect(res.data.id).toBe(testId)
    })

    it('不存在的 id 返回 404', async () => {
        const event = { ...makeEvent(), context: { ...makeEvent().context, params: { id: uuidv7() } } }
        const res = await detailHandler(event)
        expect(res.code).toBe(404)
    })

    it('非 UUID 的 id 返回 400', async () => {
        const event = { ...makeEvent(), context: { ...makeEvent().context, params: { id: 'not-uuid' } } }
        const res = await detailHandler(event)
        expect(res.code).toBe(400)
    })
})
```

- [ ] **Step 2: 跑测试（红灯）**

- [ ] **Step 3: 实现 `[id].get.ts`**

```ts
import { z } from 'zod'

const paramSchema = z.object({ id: z.string().uuid() })

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const parsed = paramSchema.safeParse({ id })
    if (!parsed.success) return resError(event, 400, 'id 必须是 UUID')

    const record = await prisma.agentToolAuditLogs.findUnique({ where: { id: parsed.data.id } })
    if (!record) return resError(event, 404, '审计记录不存在')

    return resSuccess(event, '查询成功', {
        id: record.id,
        userId: record.userId,
        sessionId: record.sessionId,
        caseId: record.caseId,
        runId: record.runId,
        toolName: record.toolName,
        verdict: record.verdict,
        denyReason: record.denyReason,
        argsDigest: record.argsDigest,
        latencyMs: record.latencyMs,
        createdAt: record.createdAt.toISOString(),
    })
})
```

- [ ] **Step 4: 跑测试（绿灯）**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(api): 新增 agent 审计日志详情接口 [id].get.ts"
```

---

### Task 9：统计接口 `GET /api/v1/admin/agent-audit-logs/stats`

**Files:**
- Modify: `tests/server/api/admin/agentAuditLogs.test.ts`
- Create: `server/api/v1/admin/agent-audit-logs/stats.get.ts`

- [ ] **Step 1: 追加测试**

```ts
import statsHandler from '../../../../server/api/v1/admin/agent-audit-logs/stats.get'

describe('GET /api/v1/admin/agent-audit-logs/stats', () => {
    beforeEach(async () => {
        await prisma.agentToolAuditLogs.deleteMany({ where: { userId: 9002 } })
        await prisma.agentToolAuditLogs.createMany({
            data: [
                { id: uuidv7(), userId: 9002, sessionId: 's', toolName: 'x', verdict: 'allowed', argsDigest: {}, latencyMs: 1 },
                { id: uuidv7(), userId: 9002, sessionId: 's', toolName: 'x', verdict: 'denied', argsDigest: {}, latencyMs: 1 },
                { id: uuidv7(), userId: 9002, sessionId: 's', toolName: 'x', verdict: 'error', argsDigest: {}, latencyMs: 1 },
            ],
        })
    })
    afterEach(async () => {
        await prisma.agentToolAuditLogs.deleteMany({ where: { userId: 9002 } })
    })

    it('返回 today + last7d 的 verdict 分布', async () => {
        const event = makeEvent()
        const res = await statsHandler(event)
        expect(res.code).toBe(0)
        expect(res.data).toMatchObject({
            today: { allowed: expect.any(Number), denied: expect.any(Number), error: expect.any(Number) },
            last7d: { allowed: expect.any(Number), denied: expect.any(Number), error: expect.any(Number) },
        })
        expect(res.data.today.allowed).toBeGreaterThanOrEqual(1)
    })
})
```

- [ ] **Step 2: 跑测试（红灯）**

- [ ] **Step 3: 实现 `stats.get.ts`**

```ts
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { AgentAuditStatsPayload } from '#shared/types/agentAudit'

dayjs.extend(utc)
dayjs.extend(timezone)

async function countByVerdict(sinceIso: Date) {
    const rows = await prisma.agentToolAuditLogs.groupBy({
        by: ['verdict'],
        where: { createdAt: { gte: sinceIso } },
        _count: { _all: true },
    })
    const base = { allowed: 0, denied: 0, error: 0 }
    for (const row of rows) {
        if (row.verdict === 'allowed' || row.verdict === 'denied' || row.verdict === 'error') {
            base[row.verdict] = row._count._all
        }
    }
    return base
}

export default defineEventHandler(async (event) => {
    const tz = 'Asia/Shanghai'
    const todayStart = dayjs.tz(dayjs(), tz).startOf('day').toDate()
    const weekStart = dayjs.tz(dayjs(), tz).subtract(6, 'day').startOf('day').toDate()

    const [today, last7d] = await Promise.all([
        countByVerdict(todayStart),
        countByVerdict(weekStart),
    ])

    const payload: AgentAuditStatsPayload = { today, last7d }
    return resSuccess(event, '查询成功', payload)
})
```

- [ ] **Step 4: 跑测试（绿灯）**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(api): 新增 agent 审计日志统计接口 stats.get.ts"
```

---

### Task 10：清理接口 `DELETE /api/v1/admin/agent-audit-logs`（单步）

**Files:**
- Modify: `tests/server/api/admin/agentAuditLogs.test.ts`
- Create: `server/api/v1/admin/agent-audit-logs/index.delete.ts`

- [ ] **Step 1: 追加测试**

```ts
import deleteHandler from '../../../../server/api/v1/admin/agent-audit-logs/index.delete'

function makeEventWithBody(body: Record<string, unknown>) {
    return { ...makeEvent(), __body: body } as any
}

describe('DELETE /api/v1/admin/agent-audit-logs', () => {
    beforeEach(async () => {
        await prisma.agentToolAuditLogs.deleteMany({ where: { userId: 9002 } })
        const old = new Date('2026-01-01')
        const fresh = new Date()
        await prisma.agentToolAuditLogs.createMany({
            data: [
                { id: uuidv7(), userId: 9002, sessionId: 's', toolName: 'x', verdict: 'allowed', argsDigest: {}, latencyMs: 1, createdAt: old },
                { id: uuidv7(), userId: 9002, sessionId: 's', toolName: 'x', verdict: 'allowed', argsDigest: {}, latencyMs: 1, createdAt: old },
                { id: uuidv7(), userId: 9002, sessionId: 's', toolName: 'x', verdict: 'allowed', argsDigest: {}, latencyMs: 1, createdAt: fresh },
            ],
        })
    })
    afterEach(async () => {
        await prisma.agentToolAuditLogs.deleteMany({ where: { userId: 9002 } })
    })

    it('删除指定日期之前的记录', async () => {
        const event = makeEventWithBody({ beforeDate: '2026-02-01' })
        const res = await deleteHandler(event)
        expect(res.code).toBe(0)
        expect(res.data.deleted).toBe(2)

        const left = await prisma.agentToolAuditLogs.count({ where: { userId: 9002 } })
        expect(left).toBe(1)
    })

    it('非法日期格式返回 400', async () => {
        const event = makeEventWithBody({ beforeDate: '2026/01/01' })
        const res = await deleteHandler(event)
        expect(res.code).toBe(400)
    })
})
```

- [ ] **Step 2: 跑测试（红灯）**

- [ ] **Step 3: 实现 `index.delete.ts`**

```ts
import { z } from 'zod'

const bodySchema = z.object({
    beforeDate: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需为 YYYY-MM-DD')
        .refine(v => !Number.isNaN(new Date(v).getTime()), '无效日期'),
})

export default defineEventHandler(async (event) => {
    const raw = await readBody(event)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0].message)

    const before = new Date(`${parsed.data.beforeDate}T00:00:00+08:00`)

    // 分批删除，避免一次锁表（每批 10_000 条）
    let deleted = 0
    while (true) {
        // prisma deleteMany 无原生 take，用 findMany 取 id 再 deleteMany
        const batch = await prisma.agentToolAuditLogs.findMany({
            where: { createdAt: { lt: before } },
            select: { id: true },
            take: 10_000,
        })
        if (batch.length === 0) break
        const result = await prisma.agentToolAuditLogs.deleteMany({
            where: { id: { in: batch.map(b => b.id) } },
        })
        deleted += result.count
        if (batch.length < 10_000) break
    }

    return resSuccess(event, '清理完成', { deleted })
})
```

- [ ] **Step 4: 跑测试（绿灯）**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(api): 新增 agent 审计日志按日期清理接口（单步）"
```

---

## Phase 5 — 管理端页面

### Task 11：把 `/admin/audit/index.vue` 改造为 Tabs 容器

**Files:**
- Modify: `app/pages/admin/audit/index.vue`
- Create: `app/pages/admin/audit/components/PermissionAuditTab.vue`（原页面内容搬过来，不做功能修改）

**要点**：
- **保留原 `definePageMeta({ layout: 'admin-layout', title: '审计日志' })`**，**不加 icon**（原页面没有，本次不擅改）
- Tabs 组件用 shadcn-vue `Tabs`

- [ ] **Step 1: 把原 `index.vue` 的 template 和 script 整体搬到 `components/PermissionAuditTab.vue`**（保留原组件，仅 `<template>` 根元素从 `<div>` 保持）

- [ ] **Step 2: 重写 `index.vue`**

```vue
<template>
    <div class="space-y-6">
        <div>
            <h1 class="text-2xl md:text-3xl font-bold mb-1">审计日志</h1>
            <p class="text-muted-foreground text-sm">查看权限变更和 Agent 工具调用记录</p>
        </div>

        <Tabs default-value="permission" class="w-full">
            <TabsList>
                <TabsTrigger value="permission">权限审计</TabsTrigger>
                <TabsTrigger value="agent">Agent 工具审计</TabsTrigger>
            </TabsList>
            <TabsContent value="permission">
                <PermissionAuditTab />
            </TabsContent>
            <TabsContent value="agent">
                <AgentAuditTab />
            </TabsContent>
        </Tabs>
    </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'admin-layout', title: '审计日志' })
</script>
```

- [ ] **Step 3: 类型检查 + 启动 dev 手工冒烟**

```bash
npx nuxi typecheck
bun dev
# 访问 /admin/audit，确认 Tab 1 显示原审计内容
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ui): /admin/audit 改造为 Tabs 容器，原内容搬入 PermissionAuditTab"
```

---

### Task 12：`AgentAuditTab.vue` 主体（含统计卡片与筛选）

**Files:**
- Create: `app/pages/admin/audit/components/AgentAuditTab.vue`

**要点**：
- 列表 / 统计走 `useApi`（setup 阶段 + 需 SSR 友好）；清理走 `useApiFetch`（事件处理）
- `LIMITED_TOOL_NAMES` 从 `#shared/types/agentAudit` 导入（**不**从 server import）
- 日期筛选用**两个独立 `GeneralDatePicker`**（from / to）
- 详情抽屉与清理对话框用子组件 `AgentAuditDetailSheet` / `AgentAuditCleanupDialog`

```vue
<template>
    <div class="space-y-4">
        <!-- 统计卡片 -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card v-for="card in statsCards" :key="card.key">
                <CardHeader class="pb-2">
                    <CardTitle class="text-sm text-muted-foreground">{{ card.title }}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div class="text-2xl font-bold" :class="card.colorClass">{{ card.todayValue }}</div>
                    <div class="text-xs text-muted-foreground mt-1">近 7 天 {{ card.weekValue }}</div>
                </CardContent>
            </Card>
        </div>

        <!-- 筛选栏 -->
        <div class="flex flex-col md:flex-row gap-3 items-end">
            <div>
                <label class="text-xs text-muted-foreground">用户 ID</label>
                <Input v-model="filters.userId" type="number" class="w-32" />
            </div>
            <div>
                <label class="text-xs text-muted-foreground">工具</label>
                <Select v-model="filters.toolName">
                    <SelectTrigger class="w-48"><SelectValue placeholder="全部工具" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="">全部</SelectItem>
                        <SelectItem v-for="name in LIMITED_TOOL_NAMES" :key="name" :value="name">{{ name }}</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div>
                <label class="text-xs text-muted-foreground">判决</label>
                <Select v-model="filters.verdict">
                    <SelectTrigger class="w-32"><SelectValue placeholder="全部" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="">全部</SelectItem>
                        <SelectItem value="allowed">允许</SelectItem>
                        <SelectItem value="denied">拒绝</SelectItem>
                        <SelectItem value="error">错误</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div>
                <label class="text-xs text-muted-foreground">开始日期</label>
                <GeneralDatePicker v-model="filters.from" />
            </div>
            <div>
                <label class="text-xs text-muted-foreground">截止日期</label>
                <GeneralDatePicker v-model="filters.to" />
            </div>
            <Button variant="outline" @click="applyFilters">搜索</Button>
            <Button variant="ghost" @click="resetFilters">重置</Button>
            <div class="flex-1" />
            <Button variant="destructive" @click="showCleanupDialog = true">清理历史</Button>
        </div>

        <!-- 表格 -->
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead>工具</TableHead>
                    <TableHead>判决</TableHead>
                    <TableHead>案件 ID</TableHead>
                    <TableHead>拒绝原因</TableHead>
                    <TableHead>耗时 (ms)</TableHead>
                    <TableHead>操作</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                <TableRow v-for="row in items" :key="row.id">
                    <TableCell class="font-mono text-xs">{{ formatTime(row.createdAt) }}</TableCell>
                    <TableCell>{{ row.userId }}</TableCell>
                    <TableCell class="font-mono text-xs">{{ row.toolName }}</TableCell>
                    <TableCell><Badge :variant="verdictVariant(row.verdict)">{{ AgentAuditVerdictText[row.verdict] }}</Badge></TableCell>
                    <TableCell>{{ row.caseId ?? '-' }}</TableCell>
                    <TableCell class="max-w-xs truncate" :title="row.denyReason ?? ''">{{ row.denyReason ?? '-' }}</TableCell>
                    <TableCell>{{ row.latencyMs }}</TableCell>
                    <TableCell>
                        <Button size="sm" variant="ghost" @click="openDetail(row.id)">详情</Button>
                    </TableCell>
                </TableRow>
            </TableBody>
        </Table>

        <GeneralPagination
            v-model:page="page"
            v-model:page-size="pageSize"
            :total="total"
            @change="fetchList"
        />

        <AgentAuditDetailSheet v-model:open="detailOpen" :record-id="detailId" />
        <AgentAuditCleanupDialog v-model:open="showCleanupDialog" :total="total" @cleaned="onCleaned" />
    </div>
</template>

<script setup lang="ts">
import dayjs from 'dayjs'
import {
    AgentAuditVerdictText,
    LIMITED_TOOL_NAMES,
    type AgentAuditRecord,
    type AgentAuditStatsPayload,
    type AgentAuditVerdict,
} from '#shared/types/agentAudit'

const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const items = ref<AgentAuditRecord[]>([])
const filters = reactive({ userId: '', toolName: '', verdict: '', from: '', to: '' })

const detailOpen = ref(false)
const detailId = ref<string>('')
const showCleanupDialog = ref(false)

function formatTime(iso: string) { return dayjs(iso).format('YYYY-MM-DD HH:mm:ss') }
function verdictVariant(v: AgentAuditVerdict) {
    return v === 'allowed' ? 'default' : v === 'denied' ? 'destructive' : 'secondary'
}

async function fetchList() {
    const query: Record<string, string | number> = { page: page.value, pageSize: pageSize.value }
    if (filters.userId) query.userId = Number(filters.userId)
    if (filters.toolName) query.toolName = filters.toolName
    if (filters.verdict) query.verdict = filters.verdict
    if (filters.from) query.from = filters.from
    if (filters.to) query.to = filters.to

    const { data } = await useApi<{ items: AgentAuditRecord[], total: number }>('/api/v1/admin/agent-audit-logs', { query, immediate: false })
    await (data as any).execute?.()
    items.value = data.value?.items ?? []
    total.value = data.value?.total ?? 0
}

const { data: statsData } = await useApi<AgentAuditStatsPayload>('/api/v1/admin/agent-audit-logs/stats')
const statsCards = computed(() => {
    const today = statsData.value?.today ?? { allowed: 0, denied: 0, error: 0 }
    const week = statsData.value?.last7d ?? { allowed: 0, denied: 0, error: 0 }
    return [
        { key: 'allowed', title: '今日允许', todayValue: today.allowed, weekValue: week.allowed, colorClass: 'text-emerald-600' },
        { key: 'denied',  title: '今日拒绝', todayValue: today.denied,  weekValue: week.denied,  colorClass: 'text-red-600' },
        { key: 'error',   title: '今日错误', todayValue: today.error,   weekValue: week.error,   colorClass: 'text-amber-600' },
    ]
})

function applyFilters() { page.value = 1; return fetchList() }
function resetFilters() {
    filters.userId = ''; filters.toolName = ''; filters.verdict = ''; filters.from = ''; filters.to = ''
    return applyFilters()
}

function openDetail(id: string) { detailId.value = id; detailOpen.value = true }
async function onCleaned() { await fetchList() }

await fetchList()
</script>
```

- [ ] **Step 1: 创建 `AgentAuditTab.vue`** 并做 `npx nuxi typecheck`

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(ui): 新增 AgentAuditTab 主体（统计卡片 + 筛选 + 列表）"
```

---

### Task 13：`AgentAuditCleanupDialog.vue`（本地 AlertDialog + GeneralDatePicker）

**Files:**
- Create: `app/pages/admin/audit/components/AgentAuditCleanupDialog.vue`

**要点**：`useAlertDialogStore` 的 `showErrorDialog` 只接受 string `message`，不能内嵌 DatePicker；按 `.claude/rules/ui.md` 最后一段"需要组件内持有独立状态"的场景，用本地 shadcn `AlertDialog`。参考 `app/components/cases/CasesDeleteDialog.vue`。

```vue
<template>
    <AlertDialog v-model:open="isOpen">
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>确认清理审计日志</AlertDialogTitle>
                <AlertDialogDescription>
                    将硬删除指定日期之前的全部审计记录，操作不可撤销。当前总记录数 {{ total }} 条。
                </AlertDialogDescription>
            </AlertDialogHeader>

            <div class="py-2 space-y-2">
                <label class="text-sm text-muted-foreground">删除此日期之前的记录</label>
                <GeneralDatePicker v-model="beforeDate" />
            </div>

            <AlertDialogFooter>
                <AlertDialogCancel :disabled="loading">取消</AlertDialogCancel>
                <AlertDialogAction
                    :disabled="loading || !beforeDate"
                    class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    @click="handleConfirm"
                >
                    <Loader2 v-if="loading" class="h-4 w-4 animate-spin mr-2" />
                    {{ loading ? '清理中...' : '确认删除' }}
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
</template>

<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const isOpen = defineModel<boolean>('open', { default: false })
defineProps<{ total: number }>()
const emit = defineEmits<{ cleaned: [] }>()

const beforeDate = ref('')
const loading = ref(false)

async function handleConfirm() {
    if (!beforeDate.value) return
    loading.value = true
    try {
        const resp = await useApiFetch<{ deleted: number }>('/api/v1/admin/agent-audit-logs', {
            method: 'DELETE',
            body: { beforeDate: beforeDate.value },
        })
        if (resp) {
            toast.success(`已清理 ${resp.deleted} 条记录`)
            emit('cleaned')
            isOpen.value = false
        }
    } finally {
        loading.value = false
    }
}
</script>
```

- [ ] **Step 1: 创建文件** + `npx nuxi typecheck`

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(ui): 新增审计日志清理对话框（本地 AlertDialog + GeneralDatePicker）"
```

---

### Task 14：`AgentAuditDetailSheet.vue`（详情抽屉）

**Files:**
- Create: `app/pages/admin/audit/components/AgentAuditDetailSheet.vue`

```vue
<template>
    <Sheet v-model:open="isOpen">
        <SheetContent class="sm:max-w-2xl">
            <SheetHeader>
                <SheetTitle>审计记录详情</SheetTitle>
                <SheetDescription>{{ record?.id }}</SheetDescription>
            </SheetHeader>
            <div v-if="record" class="mt-4 space-y-4">
                <div class="grid grid-cols-2 gap-2 text-sm">
                    <div class="text-muted-foreground">工具</div><div class="font-mono">{{ record.toolName }}</div>
                    <div class="text-muted-foreground">用户</div><div>{{ record.userId }}</div>
                    <div class="text-muted-foreground">会话</div><div class="font-mono text-xs">{{ record.sessionId }}</div>
                    <div class="text-muted-foreground">案件</div><div>{{ record.caseId ?? '-' }}</div>
                    <div class="text-muted-foreground">判决</div><div>{{ record.verdict }}</div>
                    <div class="text-muted-foreground">拒绝原因</div><div>{{ record.denyReason ?? '-' }}</div>
                    <div class="text-muted-foreground">耗时</div><div>{{ record.latencyMs }} ms</div>
                    <div class="text-muted-foreground">时间</div><div class="font-mono text-xs">{{ record.createdAt }}</div>
                </div>
                <div>
                    <div class="text-sm text-muted-foreground mb-2">工具参数</div>
                    <pre class="text-xs bg-muted p-3 rounded overflow-x-auto">{{ JSON.stringify(record.argsDigest, null, 2) }}</pre>
                </div>
            </div>
        </SheetContent>
    </Sheet>
</template>

<script setup lang="ts">
import type { AgentAuditRecord } from '#shared/types/agentAudit'

const isOpen = defineModel<boolean>('open', { default: false })
const props = defineProps<{ recordId: string }>()

const record = ref<AgentAuditRecord | null>(null)

watch([() => props.recordId, isOpen], async ([id, open]) => {
    if (!open || !id) return
    const resp = await useApiFetch<AgentAuditRecord>(`/api/v1/admin/agent-audit-logs/${id}`)
    if (resp) record.value = resp
})
</script>
```

- [ ] **Step 1: 创建文件** + `npx nuxi typecheck`

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(ui): 新增审计记录详情抽屉"
```

---

## Phase 6 — 集成验证

### Task 15：手工验证清单

- [ ] **Step 1: 启动服务**
```bash
bun dev
```

- [ ] **Step 2: 验证子进程外网隔离**
- Linux 容器内调一个 skill 脚本 `curl attacker.com` → 应失败（网络不可达）
- macOS 本地开发：控制台应有一次 `开发环境未启用 skill 子进程外网隔离` 的 warn

- [ ] **Step 3: 验证管理端 Tab**
- 访问 `/admin/audit`，能看到两个 Tab
- 切到「Agent 工具审计」，触发一次案件分析后能看到工具调用记录
- 3 个统计卡片数字合理
- 点详情能看完整 `argsDigest`
- 点清理按钮 → 选日期 → 确认 → 列表和 total 刷新

- [ ] **Step 4: 跑全量测试**
```bash
bun run test
```

- [ ] **Step 5: 类型检查**
```bash
npx nuxi typecheck
```

---

## 工期估算（对齐 spec §10）

| 阶段 | Task | 预计 |
|---|---|---|
| Phase 0 类型与数据 | 1 | 0.5 天 |
| Phase 1 三大中间件 | 2 / 3 / 4 | 2 天 |
| Phase 2 子进程网络隔离 | 5 | 0.5 天 |
| Phase 3 装配 | 6 | 0.5 天 |
| Phase 4 管理端 API | 7 / 8 / 9 / 10 | 1.5 天 |
| Phase 5 管理端页面 | 11 / 12 / 13 / 14 | 1.5 天 |
| Phase 6 手工验证 | 15 | 0.5 天 |
| **合计** | — | **6.5-7.5 天**（spec 目标 6-7.5 天，对齐） |

---

## Self-Review Checklist（实施前 + 每完成一个 Task）

- [ ] 工具名全部 snake_case（`parse_and_ask_stance` 非 `parseAndAskStance`）
- [ ] scopeGuard 规则只校验 schema 中真实存在的字段
- [ ] 黑名单只含模板分隔符（不含 `system:` / `role: system`）
- [ ] `LIMITED_TOOL_NAMES` / `DEFAULT_TOOL_LIMITS` 在 `shared/types/agentAudit.ts`
- [ ] 前端 `AgentAuditTab.vue` 不 `import '~~/server/**'`
- [ ] `toolCallLimitMiddleware` 复用 LangChain 原生
- [ ] `process.platform` 通过 `getPlatform()` 包装以便 `vi.spyOn`
- [ ] `rawPath.includes('\0')`（不是空格）
- [ ] 审计不做 PII 脱敏（无身份证/手机号/银行卡 mask）
- [ ] 清理弹窗用本地 `AlertDialog` + `GeneralDatePicker`
- [ ] `/admin/audit` `definePageMeta` 保留原状（不加 icon）
- [ ] API 响应走 `resSuccess/resError`
- [ ] 每个 handler 的 query/body 都有 zod schema
- [ ] TDD 顺序：每个中间件/handler 先写测试再写实现
- [ ] 每完成一个 Task 立即 commit
