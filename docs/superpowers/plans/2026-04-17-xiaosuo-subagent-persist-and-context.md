# 小索子 Agent 分析持久化与上下文复用 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复小索 Agent 的两个 bug：① 子 Agent 分析结果自动保存为新版本；② 小索上下文注入已有模块分析结果。

**Architecture:** 复用现有 `moduleContextMiddleware`（签名扩展 `moduleName` 改可选）替换 `caseMainAgent` 中的 `caseMaterialContextMiddleware`；复用现有 `analysisResultPersistenceMiddleware` 挂载到 `subAgentToolFactory` 的子 Agent 中间件链。不新建任何文件。

**Tech Stack:** TypeScript, Vitest, LangGraph middleware (`createMiddleware`), Prisma

**Spec:** `docs/superpowers/specs/2026-04-17-xiaosuo-subagent-persist-and-context-design.md`

---

## 文件变更概览

| 操作 | 文件 | 改动说明 |
|------|------|----------|
| 修改 | `server/services/workflow/middleware/moduleContext.middleware.ts` | `moduleName` 改可选；section 3/4 条件逻辑；`injectedBy` fallback |
| 修改 | `server/services/workflow/agents/caseMainAgent.ts` | import 替换 + 中间件数组替换 |
| 修改 | `server/services/workflow/agents/subAgentToolFactory.ts` | import 追加 + 子 Agent 中间件链追加持久化 |
| 修改 | `tests/server/workflow/middleware/moduleContext.middleware.test.ts` | 新增 4 个"缺省 moduleName"场景 |
| 修改 | `tests/server/workflow/agents/caseMainAgent.test.ts` | mock 替换 + 新增中间件校验测试 |
| 修改 | `tests/server/workflow/agents/subAgentToolFactory.test.ts` | 新增持久化中间件挂载校验测试 |

---

### Task 1: moduleContextMiddleware 签名扩展（TDD）

**Files:**
- Test: `tests/server/workflow/middleware/moduleContext.middleware.test.ts`
- Modify: `server/services/workflow/middleware/moduleContext.middleware.ts:29,100-101,110-118,127`

**参考文档:**
- Spec 4.1 节（4 处微调的完整代码）
- 现有测试模式：`tests/server/workflow/middleware/moduleContext.middleware.test.ts`（mock langchain/createMiddleware、mock 依赖服务、构造 state 对象调用 hook）

- [ ] **Step 1: 编写 4 个失败测试**

在 `tests/server/workflow/middleware/moduleContext.middleware.test.ts` 的 `describe('beforeAgent hook')` 块末尾新增：

```typescript
describe('moduleName 可选（小索场景）', () => {
    it('缺省 moduleName 时应将所有已完成模块注入到 section 3', async () => {
        vi.mocked(loadCompletedResultsService).mockResolvedValue({
            summary: '案件概要分析结果',
            defense: '辩护策略分析结果',
        })

        const middleware = moduleContextMiddleware(1) // 不传 moduleName
        const humanMsg = {
            _getType: () => 'human',
            constructor: { name: 'HumanMessage' },
            content: '用户输入',
        }
        const state = {
            messages: [humanMsg],
            _injectedSourceIds: [],
            _lastMemoryHash: null,
            _injectedResultVersions: {},
            _currentModuleResultHash: null,
        }

        const result = await middleware.beforeAgent.hook(state)
        expect(result).toBeDefined()
        // 所有模块都应注入（而非过滤掉"当前模块"）
        expect(result?._injectedResultVersions).toHaveProperty('summary')
        expect(result?._injectedResultVersions).toHaveProperty('defense')
    })

    it('缺省 moduleName 时应跳过 section 4（当前模块基线）', async () => {
        vi.mocked(loadCompletedResultsService).mockResolvedValue({
            summary: '案件概要分析结果',
        })

        const middleware = moduleContextMiddleware(1) // 不传 moduleName
        const humanMsg = {
            _getType: () => 'human',
            constructor: { name: 'HumanMessage' },
            content: '用户输入',
        }
        const state = {
            messages: [humanMsg],
            _injectedSourceIds: [],
            _lastMemoryHash: null,
            _injectedResultVersions: {},
            _currentModuleResultHash: null,
        }

        const result = await middleware.beforeAgent.hook(state)
        expect(result).toBeDefined()
        // _currentModuleResultHash 应保持 null（未触发 section 4）
        expect(result?._currentModuleResultHash).toBeNull()
    })

    it('缺省 moduleName 时 injectedBy 应包含 global', async () => {
        vi.mocked(getCaseMemory).mockResolvedValue('记忆内容')

        const middleware = moduleContextMiddleware(1) // 不传 moduleName
        const humanMsg = {
            _getType: () => 'human',
            constructor: { name: 'HumanMessage' },
            content: '用户输入',
        }
        const state = {
            messages: [humanMsg],
            _injectedSourceIds: [],
            _lastMemoryHash: null,
            _injectedResultVersions: {},
            _currentModuleResultHash: null,
        }

        await middleware.beforeAgent.hook(state)
        // 注入的 HumanMessage 的 injectedBy 应以 'ModuleContextMiddleware:global' 结尾
        const injectedMsg = state.messages.find(
            (m: any) => m.response_metadata?.injectedBy?.includes('global')
        )
        expect(injectedMsg).toBeDefined()
    })

    it('有 moduleName 时行为不变（回归）', async () => {
        vi.mocked(loadCompletedResultsService).mockResolvedValue({
            test_module: '当前模块结果',
            other_module: '其他模块结果',
        })

        const middleware = moduleContextMiddleware(1, 'test_module')
        const humanMsg = {
            _getType: () => 'human',
            constructor: { name: 'HumanMessage' },
            content: '用户输入',
        }
        const state = {
            messages: [humanMsg],
            _injectedSourceIds: [],
            _lastMemoryHash: null,
            _injectedResultVersions: {},
            _currentModuleResultHash: null,
        }

        const result = await middleware.beforeAgent.hook(state)
        expect(result).toBeDefined()
        // other_module 应在 _injectedResultVersions（section 3）
        expect(result?._injectedResultVersions).toHaveProperty('other_module')
        // test_module 不应在 _injectedResultVersions（它走 section 4）
        expect(result?._injectedResultVersions).not.toHaveProperty('test_module')
        // _currentModuleResultHash 应被更新（section 4 触发）
        expect(result?._currentModuleResultHash).not.toBeNull()
    })
})
```

- [ ] **Step 2: 运行测试确认全部失败**

```bash
npx vitest run tests/server/workflow/middleware/moduleContext.middleware.test.ts --reporter=verbose
```

预期：4 个新测试 FAIL（`moduleContextMiddleware(1)` 只传 1 个参数，TypeScript 报错参数不足）。

- [ ] **Step 3: 实现 moduleContextMiddleware 签名扩展**

修改 `server/services/workflow/middleware/moduleContext.middleware.ts`，共 4 处：

**① 行 29 — 签名**：
```typescript
// 改前
export const moduleContextMiddleware = (caseId: number, moduleName: string) => {
// 改后
export const moduleContextMiddleware = (caseId: number, moduleName?: string) => {
```

**② 行 100-101 — section 3 过滤**：
```typescript
// 改前
const otherResults = Object.entries(completedResults)
    .filter(([key]) => key !== moduleName)
// 改后
const otherResults = moduleName != null
    ? Object.entries(completedResults).filter(([key]) => key !== moduleName)
    : Object.entries(completedResults)
```

**③ 行 110-118 — section 4 当前模块基线**：
```typescript
// 改前（6 行）
const currentModuleResult = completedResults[moduleName]
const currentModuleHash = currentModuleResult
    ? createHash('md5').update(currentModuleResult).digest('hex')
    : null
if (currentModuleHash && currentModuleHash !== newCurrentHash) {
    sections.push(`## 当前模块已有分析结果（基线）\n${currentModuleResult}`)
    newCurrentHash = currentModuleHash
}

// 改后（用 if 包裹）
if (moduleName != null) {
    const currentModuleResult = completedResults[moduleName]
    const currentModuleHash = currentModuleResult
        ? createHash('md5').update(currentModuleResult).digest('hex')
        : null
    if (currentModuleHash && currentModuleHash !== newCurrentHash) {
        sections.push(`## 当前模块已有分析结果（基线）\n${currentModuleResult}`)
        newCurrentHash = currentModuleHash
    }
}
```

**④ 行 127 — injectedBy 元数据**：
```typescript
// 改前
injectedBy: `ModuleContextMiddleware:${moduleName}`,
// 改后
injectedBy: `ModuleContextMiddleware:${moduleName ?? 'global'}`,
```

- [ ] **Step 4: 运行全部 moduleContext 测试确认通过**

```bash
npx vitest run tests/server/workflow/middleware/moduleContext.middleware.test.ts --reporter=verbose
```

预期：所有测试 PASS（含 4 个新测试 + 7 个原有测试）。

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/middleware/moduleContext.middleware.ts tests/server/workflow/middleware/moduleContext.middleware.test.ts
git commit -m "refactor(analysis): moduleContextMiddleware 支持可选 moduleName 参数

- moduleName 缺省时注入所有已完成模块结果（小索场景）
- 缺省时跳过 section 4（当前模块基线）
- injectedBy 使用 moduleName ?? 'global' 防止空值
- 使用 != null 替代 truthiness 防御空字符串"
```

---

### Task 2: caseMainAgent 中间件替换（TDD）

**Files:**
- Test: `tests/server/workflow/agents/caseMainAgent.test.ts`
- Modify: `server/services/workflow/agents/caseMainAgent.ts:19,149`

**参考文档:**
- Spec 4.2 节
- 现有测试 mock 模式：`tests/server/workflow/agents/caseMainAgent.test.ts`（vi.mock `'../../../../server/services/workflow/middleware'`）

- [ ] **Step 1: 编写失败测试**

在 `tests/server/workflow/agents/caseMainAgent.test.ts` 的 middleware mock 和测试用例中修改：

**① 更新 mock 定义**（约行 56-61），将 `caseMaterialContextMiddleware` 替换为 `moduleContextMiddleware`：

```typescript
vi.mock('../../../../server/services/workflow/middleware', () => ({
    pointConsumptionMiddleware: vi.fn(() => ({ __mock: 'pointConsumption' })),
    caseProcessMaterialMiddleware: vi.fn(() => ({ __mock: 'caseProcessMaterial' })),
    moduleContextMiddleware: vi.fn(() => ({ __mock: 'moduleContext' })),  // ← 替换
    safetyTrimMiddleware: vi.fn(() => ({ __mock: 'safetyTrim' })),
}))
```

**② 在 `describe('runCaseChat 主代理')` 块末尾新增测试**：

```typescript
it('应使用 moduleContextMiddleware 替代 caseMaterialContextMiddleware', async () => {
    const middleware = await import('../../../../server/services/workflow/middleware')

    const { runCaseChat } = await import(
        '../../../../server/services/workflow/agents/caseMainAgent'
    )

    await runCaseChat('session-ctx', '测试上下文', { userId: 1, caseId: 700 })

    // moduleContextMiddleware 应被调用（仅传 caseId，不传 moduleName）
    expect(middleware.moduleContextMiddleware).toHaveBeenCalledWith(700)
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/server/workflow/agents/caseMainAgent.test.ts --reporter=verbose
```

预期：新测试 FAIL（`caseMainAgent.ts` 仍 import `caseMaterialContextMiddleware`，而 mock 已删除该导出 → 运行时 `undefined is not a function` 或 `moduleContextMiddleware` 未被调用）。

- [ ] **Step 3: 修改 caseMainAgent.ts**

**① 行 19 — import 替换**：

```typescript
// 改前
import {
    pointConsumptionMiddleware,
    caseProcessMaterialMiddleware,
    caseMaterialContextMiddleware,
    safetyTrimMiddleware,
} from '../middleware'

// 改后
import {
    pointConsumptionMiddleware,
    caseProcessMaterialMiddleware,
    moduleContextMiddleware,
    safetyTrimMiddleware,
} from '../middleware'
```

**② 行 149 — 中间件数组**：

```typescript
// 改前
caseMaterialContextMiddleware(userId, caseId),
// 改后
moduleContextMiddleware(caseId),
```

- [ ] **Step 4: 运行全部 caseMainAgent 测试确认通过**

```bash
npx vitest run tests/server/workflow/agents/caseMainAgent.test.ts --reporter=verbose
```

预期：所有测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/agents/caseMainAgent.ts tests/server/workflow/agents/caseMainAgent.test.ts
git commit -m "fix(analysis): 小索上下文注入已有模块分析结果

将 caseMainAgent 的 caseMaterialContextMiddleware 替换为
moduleContextMiddleware(caseId)（不传 moduleName），使小索对话
上下文包含材料 + 长期记忆 + 所有已完成模块分析结果。"
```

---

### Task 3: subAgentToolFactory 持久化挂载（TDD）

**Files:**
- Test: `tests/server/workflow/agents/subAgentToolFactory.test.ts`
- Modify: `server/services/workflow/agents/subAgentToolFactory.ts:15,189-198`

**参考文档:**
- Spec 4.3 节（含 sessionId 选择说明）
- 现有测试：`tests/server/workflow/agents/subAgentToolFactory.test.ts`（mock `'../../../../server/services/workflow/middleware'`）
- `analysisResultPersistenceMiddleware` 接口：`{ agentName: string, caseId: number, sessionId: string }`

**关键注意**：`createSubAgentTools` 只创建工具定义；`createAgent` 和 `analysisResultPersistenceMiddleware` 在工具被**实际调用**（`.invoke()`）时才触发。因此测试必须**调用工具**来验证中间件挂载。

- [ ] **Step 1: 更新现有 mock 以支持工具调用**

在 `tests/server/workflow/agents/subAgentToolFactory.test.ts` 中更新以下 mock：

**① 更新 `langchain` mock**（约行 21-27），`createAgent` 需返回 `invoke` 而非 `stream`：

```typescript
vi.mock('langchain', () => ({
    createAgent: vi.fn(() => ({
        invoke: vi.fn().mockResolvedValue({
            messages: [{
                _getType: () => 'ai',
                type: 'ai',
                content: '分析结果文本',
            }],
        }),
    })),
}))
```

**② 更新 middleware mock**（约行 29-31），追加 `analysisResultPersistenceMiddleware`：

```typescript
vi.mock('../../../../server/services/workflow/middleware', () => ({
    pointConsumptionMiddleware: vi.fn(() => ({})),
    analysisResultPersistenceMiddleware: vi.fn(() => ({})),
}))
```

**③ 更新 checkpointer mock**（约行 33-36），`getCheckpointer` 返回的对象需包含 `getTuple`：

```typescript
vi.mock('../../../../server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn(async () => ({
        getTuple: vi.fn().mockResolvedValue(null),
    })),
    getStore: vi.fn(async () => ({})),
}))
```

**④ 追加 mock**（文件顶部 mock 区域）：

```typescript
// mock promptRenderer
vi.mock('../../../../server/services/workflow/utils/promptRenderer', () => ({
    renderSystemPrompt: vi.fn(() => '你是分析助手'),
}))

// mock @langchain/core/messages（工具调用时 buildBriefContext 构造 HumanMessage）
vi.mock('@langchain/core/messages', () => ({
    HumanMessage: class HumanMessage {
        content: string
        response_metadata: any
        constructor(opts: any) {
            if (typeof opts === 'string') { this.content = opts; return }
            this.content = opts.content
            this.response_metadata = opts.response_metadata
        }
        _getType() { return 'human' }
    },
}))

// mock prisma（buildBriefContext 内部调用）
vi.stubGlobal('prisma', {
    cases: {
        findUnique: vi.fn().mockResolvedValue({
            title: '测试案件', plaintiff: null, defendant: null, summary: null,
        }),
    },
    caseMaterials: {
        findMany: vi.fn().mockResolvedValue([]),
    },
})
```

- [ ] **Step 2: 编写失败测试**

在 `describe('createSubAgentTools 子代理工具创建')` 块末尾新增：

```typescript
describe('子 Agent 持久化中间件', () => {
    it('工具调用时应挂载 analysisResultPersistenceMiddleware', async () => {
        const { createAgent } = await import('langchain')
        const { analysisResultPersistenceMiddleware } = await import(
            '../../../../server/services/workflow/middleware'
        )

        const configs = [
            createMockNodeConfig({ name: 'summary', title: '案件概要' }),
        ]
        const tools = await createSubAgentTools(configs, baseContext)

        // 实际调用工具以触发内部 createAgent
        await tools[0].invoke({ question: '分析案件' })

        // 验证 analysisResultPersistenceMiddleware 被正确调用
        expect(analysisResultPersistenceMiddleware).toHaveBeenCalledWith({
            agentName: 'summary',
            caseId: baseContext.caseId,
            sessionId: baseContext.sessionId,
        })

        // 验证 createAgent 收到的 middleware 数组长度为 2
        expect(createAgent).toHaveBeenCalled()
        const agentConfig = vi.mocked(createAgent).mock.calls[0][0] as { middleware: unknown[] }
        expect(agentConfig.middleware).toHaveLength(2)
    })

    it('应使用主 sessionId（非 subThreadId）', async () => {
        const { analysisResultPersistenceMiddleware } = await import(
            '../../../../server/services/workflow/middleware'
        )

        const configs = [
            createMockNodeConfig({ name: 'defense', title: '辩护策略' }),
        ]
        const tools = await createSubAgentTools(configs, baseContext)

        // 调用工具触发内部 createAgent
        await tools[0].invoke({ question: '生成辩护策略' })

        // sessionId 应为主 session 的 ID
        expect(analysisResultPersistenceMiddleware).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: 'test-session-id',
            })
        )
    })
})
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npx vitest run tests/server/workflow/agents/subAgentToolFactory.test.ts --reporter=verbose
```

预期：2 个新测试 FAIL（`analysisResultPersistenceMiddleware` 在 mock 中存在但 `subAgentToolFactory.ts` 未导入/调用它 → 断言 `toHaveBeenCalledWith` 失败）。

- [ ] **Step 4: 修改 subAgentToolFactory.ts**

**① 行 15 — import 追加**：

```typescript
// 改前
import { pointConsumptionMiddleware } from '../middleware'

// 改后
import { pointConsumptionMiddleware, analysisResultPersistenceMiddleware } from '../middleware'
```

**② 行 189-198 — middleware 数组追加**：

```typescript
// 改前
middleware: [
    pointConsumptionMiddleware(context.userId, 'case_analysis_token', context.sessionId),
],

// 改后
middleware: [
    pointConsumptionMiddleware(context.userId, 'case_analysis_token', context.sessionId),
    analysisResultPersistenceMiddleware({
        agentName: config.name,
        caseId: context.caseId,
        sessionId: context.sessionId,
    }),
],
```

- [ ] **Step 5: 运行全部 subAgentToolFactory 测试确认通过**

```bash
npx vitest run tests/server/workflow/agents/subAgentToolFactory.test.ts --reporter=verbose
```

预期：所有测试 PASS（含 2 个新测试 + 原有测试）。注意 mock 更新可能导致原有测试需微调（如 `createAgent` mock 从 `stream` 改为 `invoke`），但原有测试不调用工具，不受影响。

- [ ] **Step 6: 提交**

```bash
git add server/services/workflow/agents/subAgentToolFactory.ts tests/server/workflow/agents/subAgentToolFactory.test.ts
git commit -m "fix(analysis): 小索子 Agent 分析结果自动保存为新版本

在 subAgentToolFactory 的子 Agent 中间件链追加
analysisResultPersistenceMiddleware，子 Agent 完成后自动：
- beforeAgent: 创建 IN_PROGRESS 版本记录
- afterAgent: 提取最后一条 AIMessage 写入并激活新版本
使用主 sessionId（非 subThreadId）保持版本归属正确。"
```

---

### Task 4: 回归验证

**Files:**
- 无新改动，验证改造不破坏现有功能

- [ ] **Step 1: 运行 moduleAgent 相关测试（回归）**

```bash
npx vitest run tests/server/workflow/middleware/moduleContext.middleware.test.ts tests/server/workflow/agents/caseMainAgent.test.ts tests/server/workflow/agents/subAgentToolFactory.test.ts --reporter=verbose
```

预期：所有测试 PASS。

- [ ] **Step 2: 运行 workflow 全套测试**

```bash
npx vitest run tests/server/workflow/ --reporter=verbose
```

预期：全部 PASS。如果有失败，检查是否因 mock 变更影响了其他测试文件中对 `caseMaterialContextMiddleware` 的引用。

- [ ] **Step 3: 运行类型检查**

```bash
npx nuxi typecheck
```

预期：无新增类型错误。重点关注 `moduleContextMiddleware` 签名变更是否导致 `moduleAgent.ts` 调用方类型不匹配（不应该，因为 `string` 兼容 `string | undefined`）。

- [ ] **Step 4: 提交回归通过确认（如果有修复）**

仅在 step 2/3 发现需要修复时提交。无修复则跳过。
