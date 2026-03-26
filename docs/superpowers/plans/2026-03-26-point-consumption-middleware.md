# 积分扣减中间件实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现积分扣减中间件，在案件分析 Agent 的每次模型调用后根据 token 使用量实时扣减积分，积分不足时通过 interrupt 暂停并引导用户充值。

**Architecture:** 新建 `pointConsumption.middleware.ts` 中间件，使用 `createMiddleware` 的 `beforeAgent`（预检会员+积分）和 `afterModel`（实时扣减）两个 hook。积分不足时调用 `interrupt()` 暂停图执行，前端新增 `InsufficientPointsHandler` 组件根据会员状态引导购买，购买后通过现有 resume API 继续对话。

**Tech Stack:** LangGraph `interrupt()` + `createMiddleware`、积分服务层 `consumePointsService`/`checkPointsService`、Vue 3 组件、TypeScript

**Spec:** `docs/superpowers/specs/2026-03-26-point-consumption-middleware-design.md`

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `server/services/workflow/middleware/pointConsumption.middleware.ts` | 积分扣减中间件（核心逻辑） |
| `tests/server/workflow/middleware/pointConsumption.middleware.test.ts` | 中间件单元测试 |
| `app/components/case/interrupt/InsufficientPointsHandler.vue` | 积分不足中断处理组件 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `shared/types/case.ts` | 新增 `INSUFFICIENT_POINTS` 枚举值 + `InsufficientPointsInterruptData` 类型 |
| `server/services/workflow/middleware/index.ts` | 新增导出 |
| `server/services/agent/caseAnalysis.ts` | middleware 数组中添加 `pointConsumptionMiddleware` |
| `app/components/case/InterruptConfirmation.vue` | 新增 INSUFFICIENT_POINTS 分支 |
| `app/composables/useCaseAnalysis.ts` | 扩展中断映射和判断函数 |
| `server/services/sse/adapter.ts` | 扩展 `getInterruptHandlerName`、`validateResumeData`、`formatResumeData` |

**无需修改的文件说明:**
- `server/api/v1/case/resume/[sessionId].post.ts`：使用 `z.nativeEnum(InterruptType)` 验证，新增枚举值后自动兼容，无需修改。

---

## Task 1: 类型定义扩展

**Files:**
- Modify: `shared/types/case.ts:139-146`（InterruptType 枚举）
- Modify: `shared/types/case.ts:252-259`（InterruptData 附近，新增类型）

- [ ] **Step 1: 在 `InterruptType` 枚举中新增 `INSUFFICIENT_POINTS`**

```typescript
// shared/types/case.ts:139-146
// 在 MODULE_SELECT = 'module_select' 后面添加：
/** 中断点4：积分不足 */
INSUFFICIENT_POINTS = 'insufficient_points',
```

- [ ] **Step 2: 新增 `InsufficientPointsInterruptData` 接口**

在 `ModuleSelectInterruptData` 定义之后添加：

```typescript
/** 积分不足中断数据接口（中断点4） */
export interface InsufficientPointsInterruptData extends InterruptData {
    type: InterruptType.INSUFFICIENT_POINTS
    data: {
        /** 用户是否为有效会员 */
        isMember: boolean
        /** 当前可用积分 */
        availablePoints: number
        /** 本次需要的积分数 */
        requiredPoints: number
        /** 已累计扣减积分 */
        totalPointsConsumed: number
        /** 已累计使用 token 数 */
        totalTokensConsumed: number
        /** 中断原因类型 */
        reason: 'no_membership' | 'insufficient_points' | 'service_error'
    }
}
```

- [ ] **Step 3: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 会出现 `INTERRUPT_PHASE_MAP`、`INTERRUPT_TASK_ID_MAP` 等 Record 不完整的类型错误，这是预期的（新增了枚举值但使用处尚未更新），将在 Task 5/6 中修复。确认 `case.ts` 本身无语法错误即可。

- [ ] **Step 4: Commit**

```bash
git add shared/types/case.ts
git commit -m "feat(analysis): 新增积分不足中断类型定义"
```

---

## Task 2: 积分扣减中间件 — 保底估算函数 + 单元测试

**Files:**
- Create: `server/services/workflow/middleware/pointConsumption.middleware.ts`
- Create: `tests/server/workflow/middleware/pointConsumption.middleware.test.ts`

- [ ] **Step 1: 编写 `getTokenCount` 的测试用例**

```typescript
// tests/server/workflow/middleware/pointConsumption.middleware.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logger（Nuxt 自动导入的全局变量）
vi.stubGlobal('logger', { warn: vi.fn(), info: vi.fn(), error: vi.fn() })

import { getTokenCount } from '~/server/services/workflow/middleware/pointConsumption.middleware'

describe('getTokenCount', () => {
    it('优先使用 usage_metadata.total_tokens', () => {
        const msg = {
            usage_metadata: { total_tokens: 5000, input_tokens: 3000, output_tokens: 2000 },
            content: '短文本',
        }
        expect(getTokenCount(msg as any)).toBe(5000)
    })

    it('usage_metadata 缺失时基于中文内容估算（2字符/token）', () => {
        const content = '这是一段中文法律文本内容用于测试保底估算规则' // 22 个字符
        const msg = { content, usage_metadata: undefined }
        // ceil(22 / 2) = 11
        expect(getTokenCount(msg as any)).toBe(Math.ceil(content.length / 2))
    })

    it('包含 thinking 内容时计入估算', () => {
        const content = '回复内容' // 4 字符 → 2 tokens
        const thinking = '思考过程内容较长一些' // 10 字符 → 5 tokens
        const msg = {
            content,
            usage_metadata: undefined,
            additional_kwargs: { thinking: [{ thinking }] },
        }
        expect(getTokenCount(msg as any)).toBe(Math.ceil(4 / 2) + Math.ceil(10 / 2))
    })

    it('包含 tool_calls 时计入估算', () => {
        const content = '内容' // 2 字符 → 1 token
        const toolCalls = [{ id: 'tc1', name: 'search', args: { query: 'test' } }]
        const toolCallsStr = JSON.stringify(toolCalls)
        const msg = {
            content,
            usage_metadata: undefined,
            tool_calls: toolCalls,
        }
        expect(getTokenCount(msg as any)).toBe(
            Math.ceil(2 / 2) + Math.ceil(toolCallsStr.length / 2)
        )
    })

    it('最低返回 100 tokens', () => {
        const msg = { content: '', usage_metadata: undefined }
        expect(getTokenCount(msg as any)).toBe(100)
    })

    it('usage_metadata.total_tokens 为 0 时使用保底估算', () => {
        const msg = {
            content: '一些内容', // 4 字符
            usage_metadata: { total_tokens: 0 },
        }
        // total_tokens 为 0（falsy），走保底
        expect(getTokenCount(msg as any)).toBe(100)
    })
})
```

- [ ] **Step 2: 运行测试确认失败（RED）**

Run: `npx vitest run tests/server/workflow/middleware/pointConsumption.middleware.test.ts --reporter=verbose`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 `getTokenCount` 函数**

```typescript
import { createMiddleware } from 'langchain'
import { interrupt } from '@langchain/langgraph'
import { z } from 'zod'
import { InterruptType } from '#shared/types/case'
import { getCurrentMembershipService } from '../../membership/userMembership.service'
import { checkPointsService, consumePointsService } from '../../point/pointConsumption.service'

/** 中文文本 token 估算比率（2 字符 ≈ 1 token） */
const CHARS_PER_TOKEN = 2

/**
 * 从 AIMessage 中获取 token 用量
 *
 * 优先使用 usage_metadata，缺失时基于内容保底估算
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getTokenCount = (message: any): number => {
    // 1. 优先使用 usage_metadata
    if (message.usage_metadata?.total_tokens) {
        return message.usage_metadata.total_tokens
    }

    let estimated = 0

    // 2. 主内容
    const content = typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content)
    estimated += Math.ceil(content.length / CHARS_PER_TOKEN)

    // 3. Thinking tokens（extended thinking 模型）
    if (message.additional_kwargs?.thinking) {
        const thinking = message.additional_kwargs.thinking
        const text = Array.isArray(thinking)
            ? thinking.map((t: any) => t.thinking || '').join('')
            : String(thinking)
        estimated += Math.ceil(text.length / CHARS_PER_TOKEN)
    }

    // 4. Tool calls tokens
    if (message.tool_calls?.length) {
        estimated += Math.ceil(JSON.stringify(message.tool_calls).length / CHARS_PER_TOKEN)
    }

    logger.warn('usage_metadata 缺失，使用保底估算', {
        contentLength: content.length,
        estimated,
    })

    // 最低 100 tokens 保底
    return Math.max(estimated, 100)
}
```

- [ ] **Step 4: 运行测试确认通过（GREEN）**

Run: `npx vitest run tests/server/workflow/middleware/pointConsumption.middleware.test.ts --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/workflow/middleware/pointConsumption.middleware.ts tests/server/workflow/middleware/pointConsumption.middleware.test.ts
git commit -m "feat(analysis): 实现保底 token 估算函数及测试"
```

---

## Task 3: 积分扣减中间件 — beforeAgent + afterModel 核心逻辑

**Files:**
- Modify: `server/services/workflow/middleware/pointConsumption.middleware.ts`
- Modify: `tests/server/workflow/middleware/pointConsumption.middleware.test.ts`

- [ ] **Step 1: 编写 beforeAgent 测试用例**

在测试文件中追加：

```typescript
import { vi } from 'vitest'

// Mock 服务层函数
vi.mock('~/server/services/membership/userMembership.service', () => ({
    getCurrentMembershipService: vi.fn(),
}))
vi.mock('~/server/services/point/pointConsumption.service', () => ({
    checkPointsService: vi.fn(),
    consumePointsService: vi.fn(),
}))

// 注意：interrupt 是从 @langchain/langgraph 导入的，需要 mock
vi.mock('@langchain/langgraph', () => ({
    interrupt: vi.fn(),
}))
vi.mock('langchain', () => ({
    createMiddleware: vi.fn((config) => config),
}))

import { getCurrentMembershipService } from '~/server/services/membership/userMembership.service'
import { checkPointsService, consumePointsService } from '~/server/services/point/pointConsumption.service'
import { interrupt } from '@langchain/langgraph'
import { pointConsumptionMiddleware } from '~/server/services/workflow/middleware/pointConsumption.middleware'

describe('pointConsumptionMiddleware beforeAgent', () => {
    const userId = 1
    const itemKey = 'case_analysis_token'

    beforeEach(() => {
        vi.clearAllMocks()
    })

    function getBeforeAgentHook() {
        const config = pointConsumptionMiddleware(userId, itemKey)
        return config.beforeAgent.hook
    }

    it('会员 + 积分充足 → 正常通过', async () => {
        vi.mocked(getCurrentMembershipService).mockResolvedValue({ levelName: 'Pro' } as any)
        vi.mocked(checkPointsService).mockResolvedValue({
            sufficient: true, available: 100, required: 1, itemId: 1, itemName: 'test', itemUnit: '千tokens',
        })

        const hook = getBeforeAgentHook()
        const state = { _resumingFromAfterModel: false, _totalPointsConsumed: 0, _totalTokensConsumed: 0, messages: [] }
        await hook(state as any)

        expect(interrupt).not.toHaveBeenCalled()
    })

    it('非会员 → interrupt with reason: no_membership', async () => {
        vi.mocked(getCurrentMembershipService).mockResolvedValue(null)

        const hook = getBeforeAgentHook()
        const state = { _resumingFromAfterModel: false, _totalPointsConsumed: 0, _totalTokensConsumed: 0, messages: [] }
        await hook(state as any)

        expect(interrupt).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'insufficient_points',
                data: expect.objectContaining({ reason: 'no_membership', isMember: false }),
            })
        )
    })

    it('会员 + 积分不足 → interrupt with reason: insufficient_points', async () => {
        vi.mocked(getCurrentMembershipService).mockResolvedValue({ levelName: 'Pro' } as any)
        vi.mocked(checkPointsService).mockResolvedValue({
            sufficient: false, available: 0, required: 5, itemId: 1, itemName: 'test', itemUnit: '千tokens',
        })

        const hook = getBeforeAgentHook()
        const state = { _resumingFromAfterModel: false, _totalPointsConsumed: 0, _totalTokensConsumed: 0, messages: [] }
        await hook(state as any)

        expect(interrupt).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ reason: 'insufficient_points', isMember: true }),
            })
        )
    })

    it('_resumingFromAfterModel = true → 跳过预检', async () => {
        const hook = getBeforeAgentHook()
        const state = { _resumingFromAfterModel: true, _totalPointsConsumed: 0, _totalTokensConsumed: 0, messages: [] }
        const result = await hook(state as any)

        expect(getCurrentMembershipService).not.toHaveBeenCalled()
        expect(result).toEqual({ _resumingFromAfterModel: false })
    })

    it('会员查询异常 → interrupt with reason: service_error', async () => {
        vi.mocked(getCurrentMembershipService).mockRejectedValue(new Error('DB error'))

        const hook = getBeforeAgentHook()
        const state = { _resumingFromAfterModel: false, _totalPointsConsumed: 0, _totalTokensConsumed: 0, messages: [] }
        await hook(state as any)

        expect(interrupt).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ reason: 'service_error' }),
            })
        )
    })
})
```

- [ ] **Step 2: 运行测试确认失败（RED）**

Run: `npx vitest run tests/server/workflow/middleware/pointConsumption.middleware.test.ts --reporter=verbose`
Expected: FAIL — `pointConsumptionMiddleware` 未导出或未实现 beforeAgent

- [ ] **Step 3: 实现 `pointConsumptionMiddleware` 的 beforeAgent hook**

在 `pointConsumption.middleware.ts` 中追加中间件主函数：

```typescript
/**
 * 积分扣减中间件
 *
 * beforeAgent: 检查会员状态和积分余额
 * afterModel: 每次模型调用后根据 token 用量实时扣减积分
 *
 * @param userId 用户 ID
 * @param itemKey 消耗项目标识符（不同 Agent 传不同 key）
 */
export const pointConsumptionMiddleware = (userId: number, itemKey: string) => {
    return createMiddleware({
        name: 'PointConsumptionMiddleware',
        stateSchema: z.object({
            _totalTokensConsumed: z.number().default(0),
            _totalPointsConsumed: z.number().default(0),
            _pendingDeductQuantity: z.number().default(0),
            _resumingFromAfterModel: z.boolean().default(false),
        }),

        beforeAgent: {
            hook: async (state: any) => {
                // 1. 如果是从 afterModel interrupt 恢复，跳过预检
                if (state._resumingFromAfterModel) {
                    return { _resumingFromAfterModel: false }
                }

                // 2. 检查会员状态
                let isMember = false
                try {
                    const membership = await getCurrentMembershipService(userId)
                    isMember = !!membership
                } catch (error) {
                    logger.error('会员状态查询异常', { userId, error })
                    interrupt({
                        type: InterruptType.INSUFFICIENT_POINTS,
                        message: '系统繁忙，请稍后重试',
                        data: {
                            isMember: false,
                            availablePoints: 0,
                            requiredPoints: 0,
                            totalPointsConsumed: state._totalPointsConsumed ?? 0,
                            totalTokensConsumed: state._totalTokensConsumed ?? 0,
                            reason: 'service_error' as const,
                        },
                    })
                    return
                }

                if (!isMember) {
                    interrupt({
                        type: InterruptType.INSUFFICIENT_POINTS,
                        message: '请先开通会员',
                        data: {
                            isMember: false,
                            availablePoints: 0,
                            requiredPoints: 0,
                            totalPointsConsumed: state._totalPointsConsumed ?? 0,
                            totalTokensConsumed: state._totalTokensConsumed ?? 0,
                            reason: 'no_membership' as const,
                        },
                    })
                    // resume 后代码继续执行，重新检查会员状态
                    const refreshedMembership = await getCurrentMembershipService(userId)
                    if (!refreshedMembership) {
                        // 仍然不是会员，再次 interrupt
                        interrupt({
                            type: InterruptType.INSUFFICIENT_POINTS,
                            message: '请先开通会员',
                            data: {
                                isMember: false,
                                availablePoints: 0,
                                requiredPoints: 0,
                                totalPointsConsumed: state._totalPointsConsumed ?? 0,
                                totalTokensConsumed: state._totalTokensConsumed ?? 0,
                                reason: 'no_membership' as const,
                            },
                        })
                    }
                }

                // 3. 检查积分最小单元
                const check = await checkPointsService(userId, itemKey, 1)
                if (!check.sufficient) {
                    interrupt({
                        type: InterruptType.INSUFFICIENT_POINTS,
                        message: '积分不足，请充值后继续',
                        data: {
                            isMember: true,
                            availablePoints: check.available,
                            requiredPoints: check.required,
                            totalPointsConsumed: state._totalPointsConsumed ?? 0,
                            totalTokensConsumed: state._totalTokensConsumed ?? 0,
                            reason: 'insufficient_points' as const,
                        },
                    })
                }

                logger.info('积分预检通过', { userId, available: check.available })
            },
        },

        afterModel: {
            hook: async (state: any) => {
                // 占位，下一步实现
            },
        },
    })
}
```

- [ ] **Step 4: 运行测试确认通过（GREEN）**

Run: `npx vitest run tests/server/workflow/middleware/pointConsumption.middleware.test.ts --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 5: 编写 afterModel 测试用例**

在测试文件中追加：

```typescript
describe('pointConsumptionMiddleware afterModel', () => {
    const userId = 1
    const itemKey = 'case_analysis_token'

    beforeEach(() => {
        vi.clearAllMocks()
    })

    function getAfterModelHook() {
        const config = pointConsumptionMiddleware(userId, itemKey)
        return config.afterModel.hook
    }

    it('有 usage_metadata → 正确计算 quantity 并扣减', async () => {
        vi.mocked(consumePointsService).mockResolvedValue({
            consumedAmount: 3,
            consumptionRecords: [],
        })

        const hook = getAfterModelHook()
        const state = {
            messages: [{ usage_metadata: { total_tokens: 2500 }, content: 'test' }],
            _totalTokensConsumed: 0,
            _totalPointsConsumed: 0,
            _pendingDeductQuantity: 0,
        }

        const result = await hook(state as any)

        // ceil(2500 / 1000) = 3
        expect(consumePointsService).toHaveBeenCalledWith(userId, itemKey, 3)
        expect(result).toEqual({
            _totalTokensConsumed: 2500,
            _totalPointsConsumed: 3,
            _pendingDeductQuantity: 0,
            _resumingFromAfterModel: false,
        })
    })

    it('积分不足 → 记录 _pendingDeductQuantity + interrupt', async () => {
        vi.mocked(consumePointsService).mockRejectedValue(new Error('积分不足，需要 3，可用 0'))
        vi.mocked(checkPointsService).mockResolvedValue({
            sufficient: false, available: 0, required: 3, itemId: 1, itemName: 'test', itemUnit: '千tokens',
        })
        vi.mocked(getCurrentMembershipService).mockResolvedValue({ levelName: 'Pro' } as any)

        const hook = getAfterModelHook()
        const state = {
            messages: [{ usage_metadata: { total_tokens: 2500 }, content: 'test' }],
            _totalTokensConsumed: 1000,
            _totalPointsConsumed: 5,
            _pendingDeductQuantity: 0,
        }

        const result = await hook(state as any)

        expect(interrupt).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'insufficient_points',
                data: expect.objectContaining({ reason: 'insufficient_points' }),
            })
        )
        expect(result).toEqual({
            _totalTokensConsumed: 3500,
            _pendingDeductQuantity: 3,
            _resumingFromAfterModel: true,
        })
    })

    it('有待补扣 → 先补扣再处理新消息', async () => {
        vi.mocked(consumePointsService).mockResolvedValue({
            consumedAmount: 2,
            consumptionRecords: [],
        })

        const hook = getAfterModelHook()
        const state = {
            messages: [{ usage_metadata: { total_tokens: 1500 }, content: 'test' }],
            _totalTokensConsumed: 2000,
            _totalPointsConsumed: 5,
            _pendingDeductQuantity: 3,  // 上次失败的待补扣
        }

        const result = await hook(state as any)

        // 第一次调用补扣 3，第二次调用扣减 2（ceil(1500/1000)）
        expect(consumePointsService).toHaveBeenCalledTimes(2)
        expect(consumePointsService).toHaveBeenNthCalledWith(1, userId, itemKey, 3)
        expect(consumePointsService).toHaveBeenNthCalledWith(2, userId, itemKey, 2)
    })

    it('无消息时不扣减', async () => {
        const hook = getAfterModelHook()
        const state = {
            messages: [],
            _totalTokensConsumed: 0,
            _totalPointsConsumed: 0,
            _pendingDeductQuantity: 0,
        }

        const result = await hook(state as any)

        expect(consumePointsService).not.toHaveBeenCalled()
        expect(result).toEqual({ _pendingDeductQuantity: 0 })
    })

    it('非积分不足错误 → 记录日志 + 记入待补扣', async () => {
        vi.mocked(consumePointsService).mockRejectedValue(new Error('数据库连接超时'))

        const hook = getAfterModelHook()
        const state = {
            messages: [{ usage_metadata: { total_tokens: 2000 }, content: 'test' }],
            _totalTokensConsumed: 0,
            _totalPointsConsumed: 0,
            _pendingDeductQuantity: 0,
        }

        const result = await hook(state as any)

        expect(interrupt).not.toHaveBeenCalled()
        expect(result).toEqual({
            _totalTokensConsumed: 2000,
            _pendingDeductQuantity: 2,
        })
    })
})
```

- [ ] **Step 6: 运行测试确认失败（RED）**

Run: `npx vitest run tests/server/workflow/middleware/pointConsumption.middleware.test.ts --reporter=verbose`
Expected: FAIL — afterModel hook 未实现

- [ ] **Step 7: 实现 afterModel hook**

替换 `pointConsumption.middleware.ts` 中的 afterModel 占位为完整实现：

```typescript
        afterModel: {
            hook: async (state: any) => {
                // 1. 检查并处理上次失败的待补扣
                const pendingQuantity = state._pendingDeductQuantity ?? 0
                if (pendingQuantity > 0) {
                    try {
                        await consumePointsService(userId, itemKey, pendingQuantity)
                        logger.info('补扣成功', { userId, quantity: pendingQuantity })
                    } catch {
                        // 补扣仍然失败，interrupt
                        const check = await checkPointsService(userId, itemKey, 1)
                        const membership = await getCurrentMembershipService(userId)
                        interrupt({
                            type: InterruptType.INSUFFICIENT_POINTS,
                            message: '积分不足，请充值后继续',
                            data: {
                                isMember: !!membership,
                                availablePoints: check.available,
                                requiredPoints: pendingQuantity,
                                totalPointsConsumed: state._totalPointsConsumed ?? 0,
                                totalTokensConsumed: state._totalTokensConsumed ?? 0,
                                reason: membership ? 'insufficient_points' as const : 'no_membership' as const,
                            },
                        })
                        // resume 后回到这里重试（循环直到成功）
                    }
                }

                // 2. 获取本次模型调用的 token 用量
                const lastMsg = state.messages[state.messages.length - 1]
                if (!lastMsg) return { _pendingDeductQuantity: 0 }

                const totalTokens = getTokenCount(lastMsg)
                const quantity = Math.ceil(totalTokens / 1000)

                if (quantity <= 0) return { _pendingDeductQuantity: 0 }

                // 3. 扣减积分
                try {
                    const result = await consumePointsService(userId, itemKey, quantity)

                    return {
                        _totalTokensConsumed: (state._totalTokensConsumed ?? 0) + totalTokens,
                        _totalPointsConsumed: (state._totalPointsConsumed ?? 0) + result.consumedAmount,
                        _pendingDeductQuantity: 0,
                        _resumingFromAfterModel: false,
                    }
                } catch (error) {
                    // 区分"积分不足"和其他错误
                    const isInsufficientPoints = error instanceof Error
                        && error.message.includes('积分不足')

                    if (isInsufficientPoints) {
                        const check = await checkPointsService(userId, itemKey, 1)
                        const membership = await getCurrentMembershipService(userId)

                        interrupt({
                            type: InterruptType.INSUFFICIENT_POINTS,
                            message: '积分不足，请充值后继续分析',
                            data: {
                                isMember: !!membership,
                                availablePoints: check.available,
                                requiredPoints: quantity,
                                totalPointsConsumed: state._totalPointsConsumed ?? 0,
                                totalTokensConsumed: (state._totalTokensConsumed ?? 0) + totalTokens,
                                reason: membership ? 'insufficient_points' as const : 'no_membership' as const,
                            },
                        })

                        // resume 后继续：标记状态，下次 beforeAgent 跳过预检
                        return {
                            _totalTokensConsumed: (state._totalTokensConsumed ?? 0) + totalTokens,
                            _pendingDeductQuantity: quantity,
                            _resumingFromAfterModel: true,
                        }
                    }

                    // 非积分不足的错误：记录日志，记入待补扣
                    logger.error('积分扣减异常（非积分不足）', { userId, error })

                    return {
                        _totalTokensConsumed: (state._totalTokensConsumed ?? 0) + totalTokens,
                        _pendingDeductQuantity: quantity,
                    }
                }
            },
        },
```

- [ ] **Step 8: 运行测试确认通过（GREEN）**

Run: `npx vitest run tests/server/workflow/middleware/pointConsumption.middleware.test.ts --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 9: Commit**

```bash
git add server/services/workflow/middleware/pointConsumption.middleware.ts tests/server/workflow/middleware/pointConsumption.middleware.test.ts
git commit -m "feat(analysis): 实现积分扣减中间件核心逻辑及测试"
```

---

## Task 4: 中间件导出与 Agent 集成

**Files:**
- Modify: `server/services/workflow/middleware/index.ts`
- Modify: `server/services/agent/caseAnalysis.ts:1,4,68-78`

- [ ] **Step 1: 在 middleware/index.ts 中导出新中间件**

```typescript
// server/services/workflow/middleware/index.ts
// 在现有导出后追加：
export * from './pointConsumption.middleware'
```

- [ ] **Step 2: 在 caseAnalysis.ts 中添加中间件**

在 import 处添加 `pointConsumptionMiddleware`：
```typescript
import { caseMaterialContextMiddleware, caseProcessMaterialMiddleware, pointConsumptionMiddleware } from '../workflow/middleware'
```

在 middleware 数组最前面添加：
```typescript
middleware: [
    pointConsumptionMiddleware(userId!, 'case_analysis_token'),  // 积分扣减（最先执行）
    caseProcessMaterialMiddleware(userId!, caseId!),
    caseMaterialContextMiddleware(userId!, caseId!),
    todoListMiddleware(),
    summarizationMiddleware({
        model,
        trigger: [
            { tokens: 100000 },
        ]
    }),
],
```

- [ ] **Step 3: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 无新类型错误

- [ ] **Step 4: Commit**

```bash
git add server/services/workflow/middleware/index.ts server/services/agent/caseAnalysis.ts
git commit -m "feat(analysis): 集成积分扣减中间件到案件分析 Agent"
```

---

## Task 5: SSE 适配器扩展

**Files:**
- Modify: `server/services/sse/adapter.ts:408-415`（getInterruptHandlerName）
- Modify: `server/services/sse/adapter.ts:524-571`（validateResumeData）
- Modify: `server/services/sse/adapter.ts:584-612`（formatResumeData）

- [ ] **Step 1: 扩展 `getInterruptHandlerName`**

在 `handlerMap` 中新增：
```typescript
[InterruptType.INSUFFICIENT_POINTS]: 'InsufficientPointsHandler',
```

- [ ] **Step 2: 扩展 `validateResumeData`**

在 switch 中 `default` 之前新增 case：
```typescript
case InterruptType.INSUFFICIENT_POINTS:
    // 积分不足恢复：期望包含 type 字段的对象
    if (typeof userInput === 'object' && userInput !== null) {
        const data = userInput as Record<string, unknown>
        if (data.type === 'points_recharged') {
            return { valid: true }
        }
    }
    return { valid: false, error: '恢复数据格式无效' }
```

- [ ] **Step 3: 扩展 `formatResumeData`**

在 switch 中 `default` 之前新增 case：
```typescript
case InterruptType.INSUFFICIENT_POINTS:
    // 积分不足恢复：直接透传
    return userInput
```

- [ ] **Step 4: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 无新类型错误

- [ ] **Step 5: Commit**

```bash
git add server/services/sse/adapter.ts
git commit -m "feat(analysis): 扩展 SSE 适配器支持积分不足中断类型"
```

---

## Task 6: 前端 — useCaseAnalysis composable 扩展

**Files:**
- Modify: `app/composables/useCaseAnalysis.ts:30-46`（映射常量）
- Modify: `app/composables/useCaseAnalysis.ts:690-714`（判断和格式化函数）

- [ ] **Step 1: 扩展中断映射常量**

在 `INTERRUPT_PHASE_MAP` 中新增：
```typescript
[InterruptType.INSUFFICIENT_POINTS]: WorkflowPhase.ANALYSIS_TASK,
```

在 `INTERRUPT_TASK_ID_MAP` 中新增：
```typescript
[InterruptType.INSUFFICIENT_POINTS]: 'insufficient-points',
```

在 `INTERRUPT_TASK_TITLE_MAP` 中新增：
```typescript
'insufficient-points': '积分充值',
```

- [ ] **Step 2: 新增类型守卫函数**

在现有的 `isModuleSelectInterrupt` 之后添加：

```typescript
/**
 * 类型守卫：检查是否为积分不足中断
 */
export function isInsufficientPointsInterrupt(
    interrupt: InterruptData | null
): interrupt is InsufficientPointsInterruptData {
    return interrupt?.type === InterruptType.INSUFFICIENT_POINTS
}
```

注意：需要在文件顶部 import 处添加 `InsufficientPointsInterruptData`。

- [ ] **Step 3: 扩展 `getInterruptHandlerName` 和 `formatInterruptMessage`**

在各自的 map 中新增：
```typescript
// getInterruptHandlerName
[InterruptType.INSUFFICIENT_POINTS]: 'InsufficientPointsHandler',

// formatInterruptMessage
[InterruptType.INSUFFICIENT_POINTS]: '积分不足，请充值后继续',
```

- [ ] **Step 4: 扩展 `updatePhaseFromInterrupt`、`updateTaskStatusFromInterrupt`、`updateTaskStatusOnResume` 中的 `taskIdMap`/`interruptType` 处理**

在每个函数的 map/switch 中新增 `InterruptType.INSUFFICIENT_POINTS` 对应的分支。具体代码参考现有 `MODULE_SELECT` 分支的模式。

- [ ] **Step 5: Commit**

```bash
git add app/composables/useCaseAnalysis.ts
git commit -m "feat(ui): 扩展 useCaseAnalysis 支持积分不足中断"
```

---

## Task 7: 前端 — InsufficientPointsHandler 组件

**Files:**
- Create: `app/components/case/interrupt/InsufficientPointsHandler.vue`
- Modify: `app/components/case/InterruptConfirmation.vue`

- [ ] **Step 1: 创建 InsufficientPointsHandler 组件**

```vue
<template>
    <div class="insufficient-points-handler space-y-4">
        <!-- 服务异常 -->
        <Alert v-if="reason === 'service_error'" variant="destructive">
            <AlertDescription>
                系统繁忙，请稍后重试
            </AlertDescription>
            <Button class="mt-3" @click="handleRetry">
                重试
            </Button>
        </Alert>

        <!-- 非会员 -->
        <template v-else-if="reason === 'no_membership'">
            <Alert>
                <AlertDescription>
                    您尚未开通会员，请先购买会员后继续使用案件分析功能。
                </AlertDescription>
            </Alert>
            <MembershipPackageList @select="handleMembershipSelect" />
        </template>

        <!-- 会员但积分不足 -->
        <template v-else>
            <Alert>
                <AlertDescription>
                    <p>积分不足，无法继续分析。</p>
                    <p class="mt-1 text-sm text-muted-foreground">
                        当前可用积分：{{ interrupt.data.availablePoints }}，
                        本次需要：{{ interrupt.data.requiredPoints }}
                    </p>
                    <p v-if="interrupt.data.totalPointsConsumed > 0" class="text-sm text-muted-foreground">
                        本次分析已消耗：{{ interrupt.data.totalPointsConsumed }} 积分
                        （{{ interrupt.data.totalTokensConsumed }} tokens）
                    </p>
                </AlertDescription>
            </Alert>
            <Button @click="openPointPurchase">
                购买积分
            </Button>
        </template>

        <!-- 充值完成后的继续按钮 -->
        <Button
            v-if="reason !== 'service_error'"
            variant="default"
            :disabled="isSubmitting"
            @click="handleContinue"
        >
            {{ isSubmitting ? '恢复中...' : '已充值，继续分析' }}
        </Button>
    </div>
</template>

<script setup lang="ts">
import type { InsufficientPointsInterruptData } from '#shared/types/case'

interface Props {
    interrupt: InsufficientPointsInterruptData
    isSubmitting?: boolean
}

const emit = defineEmits<{
    (e: 'submit', data: unknown): void
    (e: 'cancel'): void
}>()

const props = withDefaults(defineProps<Props>(), {
    isSubmitting: false,
})

const reason = computed(() => props.interrupt.data.reason)

const handleRetry = () => {
    emit('submit', { type: 'points_recharged' })
}

const handleContinue = () => {
    emit('submit', { type: 'points_recharged' })
}

const handleMembershipSelect = () => {
    // 跳转到会员购买页面或打开购买弹框
    navigateTo('/membership')
}

const openPointPurchase = () => {
    // 跳转到积分购买页面或打开购买弹框
    navigateTo('/points')
}
</script>
```

注意：`MembershipPackageList` 的 import 和实际跳转逻辑需要根据项目现有的购买流程调整。此处提供的是基础框架，具体 UI 细节（购买弹框 vs 页面跳转）需要与现有购买流程集成。

- [ ] **Step 2: 在 InterruptConfirmation.vue 中添加新分支**

在模板中 `ModuleSelectHandler` 和 `Alert v-else` 之间插入：

```vue
<!-- 积分不足中断（中断点4） -->
<InsufficientPointsHandler v-else-if="isInsufficientPoints"
    :interrupt="interrupt as InsufficientPointsInterruptData"
    :is-submitting="isSubmitting" @submit="handlePointsSubmit" @cancel="handleCancel" />
```

在 `<script setup>` 中：
1. import 新类型和函数：
```typescript
import type { InsufficientPointsInterruptData } from '#shared/types/case'
import { isInsufficientPointsInterrupt } from '@/composables/useCaseAnalysis'
import InsufficientPointsHandler from './interrupt/InsufficientPointsHandler.vue'
```

2. 新增计算属性：
```typescript
const isInsufficientPoints = computed(() => isInsufficientPointsInterrupt(props.interrupt))
```

3. 新增事件处理：
```typescript
const handlePointsSubmit = (data: unknown) => {
    emit('submit', data)
}
```

- [ ] **Step 3: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 无新类型错误

- [ ] **Step 4: Commit**

```bash
git add app/components/case/interrupt/InsufficientPointsHandler.vue app/components/case/InterruptConfirmation.vue
git commit -m "feat(ui): 新增积分不足中断处理组件"
```

---

## Task 8: 最终验证与类型检查

**Files:** 所有已修改文件

- [ ] **Step 1: 运行全部中间件测试**

Run: `npx vitest run tests/server/workflow/middleware/ --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 2: 运行全局类型检查**

Run: `npx nuxi typecheck`
Expected: 无新错误

- [ ] **Step 3: 运行全量测试（确认无回归）**

Run: `npx vitest run --reporter=verbose`
Expected: 无新失败的测试

- [ ] **Step 4: 最终 Commit（如有修复）**

如果上述步骤发现问题并修复，创建修复提交：
```bash
git add -A
git commit -m "fix(analysis): 修复积分扣减中间件集成问题"
```
