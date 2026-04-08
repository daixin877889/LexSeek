# chat.post.ts 分支逻辑修复计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `chat.post.ts` 中的 3 个分支逻辑问题：Branch 2 状态检查漏洞、Branch 1 command 白名单验证、Branch 1 幂等性保护

**Architecture:** 
1. 在 Branch 2 中增加 `activeRun.status === RUNNING` 检查，避免 PENDING 状态误杀
2. 在 Branch 1 中添加 `RESUME_COMMANDS` 白名单验证，防止非法 command
3. 在 Branch 1 中添加 `resumeCount` 检查，防止快速双击导致重复创建 run
4. 需要先添加 `metadata` 字段到 `agentRuns` 表以支持幂等性保护
5. **提取 Branch 逻辑为纯函数**，以便进行可验证的单元测试

**Tech Stack:** TypeScript, Nuxt Server, LangGraph, Vitest (测试), Prisma (数据库)

---

## 前置说明

**测试策略**：采用**方案 B - 提取纯函数测试**

将 Branch 决策逻辑提取为独立的纯函数，这样：
- 可以在不 mock SSE 流的情况下测试 Branch 逻辑
- 测试断言可以直接验证返回结果，而非 mock 调用
- 代码更清晰，职责分离

**需要提取的纯函数**：
```typescript
// server/api/v1/case/analysis/chat.post.ts (新增)

/** 判断是否应该拒绝消息（RUNNING 状态 + 有新消息） */
export function shouldRejectMessage(activeRunStatus: string, hasMessage: boolean): boolean {
  return activeRunStatus === AGENT_RUN_STATUS.RUNNING && hasMessage
}

/** 验证 resume 命令是否合法 */
export function isValidResumeCommand(command: string | undefined): boolean {
  if (!command) return false
  return RESUME_COMMANDS.includes(command as typeof RESUME_COMMANDS[number])
}

/** 判断是否应该拒绝 resume（超过次数上限） */
export function shouldRejectResume(resumeCount: number): boolean {
  return resumeCount >= MAX_RESUME_COUNT
}

/** 获取当前 resume 次数 */
export function getResumeCount(metadata: any): number {
  return (metadata?.resumeCount as number | undefined) ?? 0
}
```

**关键依赖 Mock**：
- `logger` - Nuxt 自动导入的全局变量
- `resError` / `resSuccess` - Nuxt Server 自动导入的响应函数
- `setResponseHeaders` - Nuxt Server 自动导入
- `getActiveRunService` / `getLatestRunService` - AgentRun 服务
- `findCaseBySessionIdService` - 案件会话服务
- `enqueueRunService` - 入队服务
- `updateRunStatusDAO` - DAO 层函数
- `readBody` - H3 框架函数

---

### Task 0: 添加 metadata 字段到 agentRuns 表

**Files:**
- Modify: `prisma/models/agentRun.prisma`
- Run: `bun run prisma:push`
- Run: `bun run prisma:migrate`

- [ ] **Step 1: 修改 Prisma schema 添加 metadata 字段**

```prisma
// prisma/models/agentRun.prisma
model agentRuns {
    /// 执行记录 ID，主键，UUID
    id          String    @id @default(uuid())
    /// 关联的会话 ID
    sessionId   String    @map("session_id")
    /// LangGraph thread_id
    threadId    String    @map("thread_id")
    /// 关联的用户 ID
    userId      Int       @map("user_id")
    /// 关联的案件 ID
    caseId      Int       @map("case_id")

    /// 输入参数（{ message: string, command?: any }）
    input       Json

    /// 执行状态：pending / running / completed / failed / cancelled
    status      String    @default("pending")

    /// 执行该任务的 Worker ID
    workerId    String?   @map("worker_id")
    /// 最后心跳时间
    heartbeatAt DateTime? @map("heartbeat_at") @db.Timestamptz(6)

    /// 开始执行时间
    startedAt   DateTime? @map("started_at") @db.Timestamptz(6)
    /// 完成时间
    completedAt DateTime? @map("completed_at") @db.Timestamptz(6)
    /// 错误信息
    error       String?

    /// 元数据（用于存储 resumeCount 等系统信息）- nullable，无默认值
    metadata    Json?     @map("metadata")

    /// 创建时间
    createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    /// 最后更新时间
    updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

    @@index([status, createdAt], map: "idx_agent_runs_status_created_at")
    @@index([sessionId, createdAt], map: "idx_agent_runs_session_id_created_at")
    @@index([userId], map: "idx_agent_runs_user_id")
    @@map("agent_runs")
}
```

- [ ] **Step 2: 推送 schema 到数据库**

Run: `bun run prisma:push`

Expected Output:
```
✔ Generated Prisma Client (v6.x.x) to ./generated/prisma
✔ Drifted schemas pushed to the database in Xms
```

- [ ] **Step 3: 创建并运行数据库迁移**

Run: `bun run prisma:migrate`

Expected Output:
```
✔ Migration xxxx created
✔ Migration xxxx applied
```

- [ ] **Step 4: 验证字段添加成功**

Run: `docker exec -i ls_new_db psql -U daixin -d ls_new -c "\d agent_runs"`

Expected: 看到 `metadata | jsonb` 字段

- [ ] **Step 5: 提交**

```bash
git add prisma/models/agentRun.prisma prisma/migrations/
git commit -m "feat(db): agent_runs 添加 metadata 字段用于存储系统元数据"
```

---

### Task 1: 提取 Branch 逻辑为纯函数并测试

**Files:**
- Modify: `server/api/v1/case/analysis/chat.post.ts`
- Create: `tests/server/agent/chat-branch-logic.test.ts`

- [ ] **Step 1: 在 chat.post.ts 中添加常量和纯函数**

```typescript
// server/api/v1/case/analysis/chat.post.ts (在 BLACKLIST_PATTERNS 之后添加)

/** Resume 命令白名单 */
const RESUME_COMMANDS = ['resume', 'continue', 'try_again'] as const

/** Resume 次数上限 */
const MAX_RESUME_COUNT = 3

// --- 在文件末尾添加纯函数 ---

/**
 * 判断是否应该拒绝消息（RUNNING 状态 + 有新消息）
 * @param activeRunStatus 当前 run 的状态
 * @param hasMessage 是否有新消息
 * @returns true 表示应该拒绝
 */
export function shouldRejectMessage(activeRunStatus: string, hasMessage: boolean): boolean {
  return activeRunStatus === AGENT_RUN_STATUS.RUNNING && hasMessage
}

/**
 * 验证 resume 命令是否合法
 * @param command 命令字符串
 * @returns true 表示命令合法
 */
export function isValidResumeCommand(command: string | undefined): boolean {
  if (!command) return false
  return RESUME_COMMANDS.includes(command as typeof RESUME_COMMANDS[number])
}

/**
 * 判断是否应该拒绝 resume（超过次数上限）
 * @param resumeCount 当前 resume 次数
 * @returns true 表示应该拒绝
 */
export function shouldRejectResume(resumeCount: number): boolean {
  return resumeCount >= MAX_RESUME_COUNT
}

/**
 * 获取当前 resume 次数
 * @param metadata run 的 metadata 对象
 * @returns resume 次数，默认为 0
 */
export function getResumeCount(metadata: any): number {
  return (metadata?.resumeCount as number | undefined) ?? 0
}
```

- [ ] **Step 2: 编写纯函数单元测试**

```typescript
/**
 * chat.post.ts 分支逻辑测试 - 纯函数测试
 *
 * **Feature: agent-background-queue**
 * **Validates: Requirements 3.1, 3.2**
 */

import { describe, it, expect, beforeEach } from 'vitest'
import './test-setup'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'
import {
  shouldRejectMessage,
  isValidResumeCommand,
  shouldRejectResume,
  getResumeCount,
} from '~~/server/api/v1/case/analysis/chat.post'

// Mock logger（Nuxt 自动导入的全局变量）
vi.stubGlobal('logger', { warn: vi.fn(), info: vi.fn(), error: vi.fn() })

describe('chat.post.ts - 纯函数测试', () => {
  describe('shouldRejectMessage', () => {
    it.each([
      [AGENT_RUN_STATUS.RUNNING, true, true],
      [AGENT_RUN_STATUS.RUNNING, false, false],
      [AGENT_RUN_STATUS.PENDING, true, false],
      [AGENT_RUN_STATUS.PENDING, false, false],
      [AGENT_RUN_STATUS.INTERRUPTED, true, false],
      [AGENT_RUN_STATUS.COMPLETED, true, false],
      [AGENT_RUN_STATUS.FAILED, true, false],
      [AGENT_RUN_STATUS.CANCELLED, true, false],
    ])('status=%s, hasMessage=%s → %s', (status, hasMessage, expected) => {
      expect(shouldRejectMessage(status, hasMessage)).toBe(expected)
    })
  })

  describe('isValidResumeCommand', () => {
    it.each([
      ['resume', true],
      ['continue', true],
      ['try_again', true],
      [undefined, false],
      ['', false],
      ['delete_case', false],
      ['RESET', false],
      ['resume ', false],
      ['Resume', false],
    ])('command=%s → %s', (cmd, expected) => {
      expect(isValidResumeCommand(cmd)).toBe(expected)
    })
  })

  describe('shouldRejectResume', () => {
    it.each([
      [0, false],
      [1, false],
      [2, false],
      [3, true],
      [4, true],
    ])('resumeCount=%s → %s', (count, expected) => {
      expect(shouldRejectResume(count)).toBe(expected)
    })
  })

  describe('getResumeCount', () => {
    it.each([
      [null, 0],
      [undefined, 0],
      [{}, 0],
      [{ resumeCount: 2 }, 2],
      [{ resumeCount: 0 }, 0],
      [{ resumeCount: -1 }, -1],
    ])('metadata=%s → %s', (metadata, expected) => {
      expect(getResumeCount(metadata)).toBe(expected)
    })
  })
})
```

- [ ] **Step 3: 运行测试验证通过**

Run: `npx vitest run tests/server/agent/chat-branch-logic.test.ts -v`

Expected: 所有测试通过（约 28-32 个测试用例，取决于 it.each 展开方式）

- [ ] **Step 4: 提交**

```bash
git add server/api/v1/case/analysis/chat.post.ts tests/server/agent/chat-branch-logic.test.ts
git commit -m "feat(utils): 提取 Branch 逻辑为可测试纯函数"
```

---

### Task 2: Branch 2 RUNNING 状态检查修复

**Files:**
- Modify: `server/api/v1/case/analysis/chat.post.ts`

- [ ] **Step 1: 修改 Branch 2 逻辑使用纯函数**

```typescript
// server/api/v1/case/analysis/chat.post.ts:135-141
else if (activeRun) {
  const hasMessage = !!message
  if (shouldRejectMessage(activeRun.status, hasMessage)) {
    // 已有活跃 run + 有新消息 + run 正在运行 → 返回错误
    return resError(event, 429, '请等待当前分析完成')
  }
  // 已有活跃 run + 无新消息 或 run 为 PENDING → 重连订阅模式
  runId = activeRun.id
}
```

- [ ] **Step 2: 运行测试确保无回归**

Run: `npx vitest run tests/server/agent/chat-branch-logic.test.ts -v`

Expected: 所有测试通过

- [ ] **Step 3: 提交**

```bash
git add server/api/v1/case/analysis/chat.post.ts
git commit -m "fix(analysis): Branch 2 使用 shouldRejectMessage 函数，增加 RUNNING 状态检查"
```

---

### Task 3: Branch 1 command 白名单验证

**Files:**
- Modify: `server/api/v1/case/analysis/chat.post.ts`

- [ ] **Step 1: 添加 command 白名单常量**

```typescript
// server/api/v1/case/analysis/chat.post.ts:71 (BLACKLIST_PATTERNS 之后)
/** Resume 命令白名单 */
const RESUME_COMMANDS = ['resume', 'continue', 'try_again'] as const
```

- [ ] **Step 2: 修改 Branch 1 逻辑使用纯函数**

```typescript
// server/api/v1/case/analysis/chat.post.ts:120-133
if (activeRun && command && activeRun.status === AGENT_RUN_STATUS.INTERRUPTED) {
  // 验证 command 白名单
  if (!isValidResumeCommand(command)) {
    return resError(event, 400, '无效的 resume 命令')
  }
  
  await updateRunStatusDAO(activeRun.id, AGENT_RUN_STATUS.COMPLETED, { completedAt: new Date() })
  const result = await enqueueRunService({
    sessionId,
    threadId: sessionId,
    userId: user.id,
    caseId: caseInfo.id,
    input: { message, command },
  })
  if ('error' in result) {
    return resError(event, 429, result.error)
  }
  runId = result.runId
}
```

- [ ] **Step 3: 运行测试确保无回归**

Run: `npx vitest run tests/server/agent/chat-branch-logic.test.ts -v`

Expected: 所有测试通过

- [ ] **Step 4: 提交**

```bash
git add server/api/v1/case/analysis/chat.post.ts
git commit -m "feat(analysis): Branch 1 添加 command 白名单验证 (RESUME_COMMANDS)"
```

---

### Task 4: updateRunStatusDAO 支持 metadata 更新

**Files:**
- Modify: `server/services/agent/agentRun.dao.ts`
- Modify: `tests/server/agent/agentRun.dao.test.ts`

- [ ] **Step 1: 修改 updateRunStatusDAO 函数签名**

```typescript
// server/services/agent/agentRun.dao.ts:107-125
export async function updateRunStatusDAO(
  id: string,
  status: AgentRunStatus,
  extra?: { 
    error?: string
    completedAt?: Date
    metadata?: any 
  }
): Promise<agentRuns> {
  return prisma.agentRuns.update({
    where: { id },
    data: {
      status,
      ...(extra?.error !== undefined && { error: extra.error }),
      ...(extra?.completedAt && { completedAt: extra.completedAt }),
      ...(extra?.metadata !== undefined && { metadata: extra.metadata }),
    },
  })
}
```

- [ ] **Step 2: 运行现有 DAO 测试确保无回归**

Run: `npx vitest run tests/server/agent/agentRun.dao.test.ts -v`

Expected: 所有现有测试通过

- [ ] **Step 3: 提交**

```bash
git add server/services/agent/agentRun.dao.ts
git commit -m "feat(dao): updateRunStatusDAO 支持 metadata 更新"
```

---

### Task 5: Branch 1 幂等性保护

**Files:**
- Modify: `server/api/v1/case/analysis/chat.post.ts`

- [ ] **Step 1: 定义 resume 次数上限常量**

```typescript
// server/api/v1/case/analysis/chat.post.ts:73 (RESUME_COMMANDS 之后)
/** Resume 次数上限 */
const MAX_RESUME_COUNT = 3
```

- [ ] **Step 2: 修改 Branch 1 逻辑添加幂等性检查**

```typescript
// server/api/v1/case/analysis/chat.post.ts:120-150
if (activeRun && command && activeRun.status === AGENT_RUN_STATUS.INTERRUPTED) {
  // 验证 command 白名单
  if (!isValidResumeCommand(command)) {
    return resError(event, 400, '无效的 resume 命令')
  }
  
  // 幂等性保护：检查 resume 次数
  const resumeCount = getResumeCount(activeRun.metadata)
  if (shouldRejectResume(resumeCount)) {
    return resError(event, 429, 'Resume 次数已达上限，请开启新会话')
  }
  
  await updateRunStatusDAO(activeRun.id, AGENT_RUN_STATUS.COMPLETED, { 
    completedAt: new Date(),
    metadata: { ...(activeRun.metadata as any || {}), resumeCount: resumeCount + 1 },
  })
  const result = await enqueueRunService({
    sessionId,
    threadId: sessionId,
    userId: user.id,
    caseId: caseInfo.id,
    input: { message, command },
  })
  if ('error' in result) {
    return resError(event, 429, result.error)
  }
  runId = result.runId
}
```

- [ ] **Step 3: 运行测试确保无回归**

Run: `npx vitest run tests/server/agent/chat-branch-logic.test.ts -v`

Expected: 所有测试通过

- [ ] **Step 4: 运行类型检查**

Run: `npx nuxi typecheck`

Expected: 无类型错误

- [ ] **Step 5: 提交**

```bash
git add server/api/v1/case/analysis/chat.post.ts
git commit -m "feat(analysis): Branch 1 添加幂等性保护，限制 resume 次数上限为 3"
```

---

### Task 6: 运行完整测试套件并清理

- [ ] **Step 1: 运行 chat-branch-logic 测试**

Run: `npx vitest run tests/server/agent/chat-branch-logic.test.ts --reporter=verbose`

Expected: 所有测试通过（约 28-32 个用例）

- [ ] **Step 2: 运行 agentRun.dao 测试确保无回归**

Run: `npx vitest run tests/server/agent/agentRun.dao.test.ts --reporter=verbose`

Expected: 所有测试通过

- [ ] **Step 3: 运行 agent 模块全部测试**

Run: `npx vitest run tests/server/agent/ --reporter=verbose`

Expected: 所有测试通过

- [ ] **Step 4: 类型检查**

Run: `npx nuxi typecheck`

Expected: 无类型错误

- [ ] **Step 5: 推送远程分支**

```bash
git push -u origin dev
```

---

## 验收标准

- [ ] `agent_runs` 表有 `metadata` 字段（JSON 类型，nullable）
- [ ] Branch 2 在 `activeRun.status = RUNNING` + 有消息时返回 429
- [ ] Branch 2 在 `activeRun.status = PENDING` 时不返回 429
- [ ] Branch 1 只接受 `resume`, `continue`, `try_again` 三种命令
- [ ] Branch 1 拒绝非法 command 并返回 400
- [ ] Branch 1 拒绝 `resumeCount >= 3` 的请求并返回 429
- [ ] `updateRunStatusDAO` 支持更新 `metadata` 字段
- [ ] 纯函数测试覆盖 `shouldRejectMessage`、`isValidResumeCommand`、`shouldRejectResume`、`getResumeCount`
- [ ] 所有测试通过
- [ ] 现有 agent 模块测试无回归
- [ ] `npx nuxi typecheck` 通过

---

## 依赖关系

```
Task 0 (metadata 字段) ──> Task 4 (DAO 支持) ──> Task 5 (幂等性保护)
Task 1 (纯函数提取) ──────> Task 2 (Branch 2 修复)
Task 1 (纯函数提取) ──────> Task 3 (白名单验证)
Task 3 (白名单验证) ───────> Task 5 (幂等性保护)

建议执行顺序：Task 0 → Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6
```

---

## 测试文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `tests/server/agent/chat-branch-logic.test.ts` | 新建 | 纯函数单元测试（约 28-32 个用例） |
| `tests/server/agent/agentRun.dao.test.ts` | 修改 | 可选：添加 metadata 支持测试 |

---

## 纯函数测试用例清单

### shouldRejectMessage (8 用例)
- [ ] RUNNING + 有消息 → true
- [ ] RUNNING + 无消息 → false
- [ ] PENDING + 有消息 → false
- [ ] PENDING + 无消息 → false
- [ ] INTERRUPTED + 有消息 → false
- [ ] COMPLETED + 有消息 → false
- [ ] FAILED + 有消息 → false
- [ ] CANCELLED + 有消息 → false

### isValidResumeCommand (9 用例)
- [ ] 'resume' → true
- [ ] 'continue' → true
- [ ] 'try_again' → true
- [ ] undefined → false
- [ ] null → false
- [ ] '' → false
- [ ] 'delete_case' → false
- [ ] 'RESET' → false
- [ ] 'resume ' → false (带空格)

### shouldRejectResume (5 用例)
- [ ] 0 → false
- [ ] 1 → false
- [ ] 2 → false
- [ ] 3 → true
- [ ] 4 → true

### getResumeCount (6 用例)
- [ ] null → 0
- [ ] undefined → 0
- [ ] {} → 0
- [ ] { resumeCount: 2 } → 2
- [ ] { resumeCount: 0 } → 0
- [ ] { resumeCount: -1 } → -1

**总计：约 28-32 个测试用例**（取决于 it.each 展开）

---

## 注意事项

1. **纯函数导出**：使用 `export` 关键字导出纯函数，便于测试导入
2. **不可变参数**：纯函数不接受对象引用，只接受基础类型或提取后的值
3. **测试覆盖率**：每个纯函数的所有分支都需要测试覆盖
4. **Prisma 默认值**：`Json` 类型不支持 `@default`，使用 nullable `Json?`
5. **类型安全**：`isValidResumeCommand` 使用 TypeScript 类型守卫确保类型收窄
