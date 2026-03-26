# 积分扣减中间件设计文档

## 概述

在案件分析 Agent（`caseAnalysis.ts`）中增加积分扣减中间件，每次模型调用后根据 token 使用量实时扣减积分。积分与 token 的兑换比例通过后台「积分消耗项目」配置，不同 Agent 可使用不同的消耗规则。

当积分不足时，通过 LangGraph `interrupt()` 函数创建断点，前端根据用户会员状态渲染购买卡片（非会员→会员购买卡片，会员→积分购买卡片），用户充值后通过 resume 继续对话。

## 约束条件

- **必须同时满足**：有效会员 + 积分充足，才能继续分析
- 扣减策略：afterModel 实时扣减（非预扣模式）
- token 计费单位：每 1000 tokens（向上取整）为 1 个计费单位
- 不同 Agent 可通过 `itemKey` 参数指定不同的消耗项目

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│                  pointConsumptionMiddleware                    │
│                                                               │
│  beforeAgent:                                                 │
│    ├─ 检查 state._resumingFromAfterModel（跳过重复预检）      │
│    ├─ getCurrentMembershipService(userId) 检查会员状态         │
│    ├─ checkPointsService(userId, itemKey, 1) 检查最小单元     │
│    └─ 不满足 → interrupt(INSUFFICIENT_POINTS)                 │
│                                                               │
│  afterModel:                                                  │
│    ├─ 检查 state._pendingDeductQuantity（补扣上次失败）       │
│    ├─ 从 AIMessage.usage_metadata 获取 total_tokens           │
│    ├─ 无 usage_metadata → 保底估算（content+thinking+tools）  │
│    ├─ quantity = ceil(total_tokens / 1000)                     │
│    ├─ consumePointsService(userId, itemKey, quantity) 扣减    │
│    ├─ 扣减失败（积分不足）→ 记录待补扣 → interrupt(...)      │
│    └─ 更新累计消耗 state                                      │
└──────────────────────────────────────────────────────────────┘
                        ↓ interrupt
┌──────────────────────────────────────────────────────────────┐
│  前端 InterruptConfirmation 组件扩展：                         │
│  ├─ InsufficientPointsHandler                                 │
│  │   ├─ !isMember → MembershipPackageList（会员购买）         │
│  │   └─ isMember  → PointPurchaseDialog（积分购买）           │
│  └─ 购买成功后 → resume API → Agent 继续执行                  │
└──────────────────────────────────────────────────────────────┘
```

## interrupt 机制说明

使用从 `@langchain/langgraph` 导入的顶层 `interrupt()` 函数（非 `runtime.interrupt()`），与官方 `humanInTheLoopMiddleware` 的实现方式一致。

`interrupt()` 通过 AsyncLocalStorage 获取当前图的执行上下文，中间件 hook 在图节点执行栈中运行，因此 `interrupt()` 在 `beforeAgent`/`afterModel` hook 中可正常调用。

**重要**：不要在 `interrupt()` 调用周围使用 `try/catch`，或确保 `GraphInterrupt` 错误被重新抛出，避免意外捕获中断异常。

### Resume 工作流

1. `interrupt(value)` 抛出 `GraphInterrupt` 异常，图执行暂停，状态保存到 checkpoint
2. 前端收到中断信息，渲染购买卡片
3. 用户购买完成后，前端调用 `POST /api/v1/case/resume/[sessionId]`
4. 请求体：`{ interruptType: 'insufficient_points', userInput: { type: 'points_recharged' } }`
5. 后端通过 `Command({ resume: userInput })` 恢复图执行
6. `interrupt()` 函数检测到 resume 值，直接返回该值（不再抛异常）
7. 中间件代码继续执行 interrupt 之后的逻辑

## 类型定义

### InterruptType 扩展

```typescript
// shared/types/case.ts
export enum InterruptType {
    CASE_INFO_CHECK = 'case_info_check',
    BASIC_INFO_CONFIRM = 'basic_info_confirm',
    MODULE_SELECT = 'module_select',
    INSUFFICIENT_POINTS = 'insufficient_points',  // 新增
}
```

### Interrupt 携带数据

```typescript
// interrupt({ type, message, data }) 的 data 结构
interface InsufficientPointsInterruptData {
    /** 用户是否为有效会员 */
    isMember: boolean
    /** 当前可用积分 */
    availablePoints: number
    /** 本次需要的积分数（仅 afterModel 时有值，beforeAgent 时为最小单元） */
    requiredPoints: number
    /** 已累计扣减积分 */
    totalPointsConsumed: number
    /** 已累计使用 token 数 */
    totalTokensConsumed: number
    /** 中断原因类型 */
    reason: 'no_membership' | 'insufficient_points' | 'service_error'
}
```

### 中间件自定义 State

```typescript
stateSchema: z.object({
    /** 累计消耗 token 数 */
    _totalTokensConsumed: z.number().default(0),
    /** 累计扣减积分数 */
    _totalPointsConsumed: z.number().default(0),
    /** 待补扣的计费单位数（afterModel 扣减失败时记录） */
    _pendingDeductQuantity: z.number().default(0),
    /** 是否正在从 afterModel interrupt 恢复（跳过 beforeAgent 重复预检） */
    _resumingFromAfterModel: z.boolean().default(false),
})
```

**State 隔离说明**：多个中间件的 `stateSchema` 字段会合并到同一个 state 对象中。所有字段使用 `_` 前缀表示中间件内部状态，各中间件字段名不能冲突。现有中间件使用 `_injectedSourceIds`，本中间件使用 `_total*` 和 `_pending*` 前缀，无冲突。

## 中间件实现

### 文件位置

`server/services/workflow/middleware/pointConsumption.middleware.ts`

### 函数签名

```typescript
import { interrupt } from '@langchain/langgraph'

export const pointConsumptionMiddleware = (
    userId: number,
    itemKey: string   // 消耗项目标识符，不同 Agent 传不同 key
) => createMiddleware({ ... })
```

### beforeAgent Hook

```typescript
beforeAgent: {
    hook: async (state) => {
        // 1. 如果是从 afterModel interrupt 恢复，跳过预检
        //    （afterModel 中会自行补扣并验证）
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
            // 查询异常时 interrupt，区分于"确认无会员"
            interrupt({
                type: InterruptType.INSUFFICIENT_POINTS,
                message: '系统繁忙，请稍后重试',
                data: {
                    isMember: false,
                    availablePoints: 0,
                    requiredPoints: 0,
                    totalPointsConsumed: state._totalPointsConsumed ?? 0,
                    totalTokensConsumed: state._totalTokensConsumed ?? 0,
                    reason: 'service_error',
                },
            })
            return  // interrupt 返回后继续执行
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
                    reason: 'no_membership',
                },
            })
            // resume 后继续：重新检查（interrupt 返回 resume 值后代码继续）
            // 递归检查会员状态（用户可能购买了会员）
        }

        // 3. 检查积分最小单元（1 个计费单位 = 1000 tokens 对应的积分）
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
                    reason: 'insufficient_points',
                },
            })
        }

        logger.info('积分预检通过', { userId, available: check.available })
    }
}
```

### afterModel Hook

```typescript
afterModel: {
    hook: async (state) => {
        // 1. 检查并处理上次失败的待补扣
        const pendingQuantity = state._pendingDeductQuantity ?? 0
        if (pendingQuantity > 0) {
            try {
                await consumePointsService(userId, itemKey, pendingQuantity)
                logger.info('补扣成功', { userId, quantity: pendingQuantity })
            } catch {
                // 补扣仍然失败，继续 interrupt
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
                        reason: !!membership ? 'insufficient_points' : 'no_membership',
                    },
                })
                // resume 后回到这里，重试补扣（循环直到成功）
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
                // 记录待补扣，interrupt
                const check = await checkPointsService(userId, itemKey, 1)
                const membership = await getCurrentMembershipService(userId)

                // 先更新 state（记录待补扣），再 interrupt
                // 注意：interrupt 后 state 不会自动保存，需要在 resume 后处理
                interrupt({
                    type: InterruptType.INSUFFICIENT_POINTS,
                    message: '积分不足，请充值后继续分析',
                    data: {
                        isMember: !!membership,
                        availablePoints: check.available,
                        requiredPoints: quantity,
                        totalPointsConsumed: state._totalPointsConsumed ?? 0,
                        totalTokensConsumed: (state._totalTokensConsumed ?? 0) + totalTokens,
                        reason: !!membership ? 'insufficient_points' : 'no_membership',
                    },
                })

                // resume 后继续执行：标记状态，下次 beforeAgent 跳过预检
                return {
                    _totalTokensConsumed: (state._totalTokensConsumed ?? 0) + totalTokens,
                    _pendingDeductQuantity: quantity,
                    _resumingFromAfterModel: true,
                }
            }

            // 非积分不足的错误：记录日志，计入连续失败
            logger.error('积分扣减异常（非积分不足）', { userId, error })

            // 容错：记入累计但不中断，token 计入已消耗
            return {
                _totalTokensConsumed: (state._totalTokensConsumed ?? 0) + totalTokens,
                _pendingDeductQuantity: quantity,  // 记录待补扣，下次尝试
            }
        }
    }
}
```

### 保底 Token 估算规则

当 `AIMessage.usage_metadata` 不可用时，基于消息内容估算。由于本项目处理中文法律文本，中文 token 比率约 1.5-2 字符/token（远低于英文的 4 字符/token），因此使用 2 字符/token 的保守估计。

```typescript
/** 中文文本 token 估算比率（2 字符 ≈ 1 token） */
const CHARS_PER_TOKEN = 2

const getTokenCount = (message: AIMessage): number => {
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
            ? thinking.map(t => t.thinking || '').join('')
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

## Agent 集成

### caseAnalysis.ts 中的使用

```typescript
const agent = createAgent({
    model,
    systemPrompt,
    checkpointer,
    tools,
    store,
    middleware: [
        pointConsumptionMiddleware(userId!, 'case_analysis_token'),  // 新增：第一个执行
        caseProcessMaterialMiddleware(userId!, caseId!),
        caseMaterialContextMiddleware(userId!, caseId!),
        todoListMiddleware(),
        summarizationMiddleware({ model, trigger: [{ tokens: 100000 }] }),
    ],
})
```

**中间件顺序说明**：积分检查放在最前面，确保积分不足时不执行后续的材料处理等开销较大的操作。

### 后台消耗项目配置

需要在后台管理中创建对应的消耗项目：

| key | name | unit | pointAmount | 说明 |
|-----|------|------|-------------|------|
| `case_analysis_token` | 案件分析 Token 消耗 | 千 tokens | N（由运营配置） | 案件分析 Agent 使用 |

其中 `pointAmount` 表示每 1000 tokens 消耗的积分数量，由运营人员在后台根据模型成本和定价策略配置。

## 前端处理

### InterruptConfirmation 组件扩展

在 `app/components/case/InterruptConfirmation.vue` 中新增 `INSUFFICIENT_POINTS` 类型处理。

### 新增 InsufficientPointsHandler 组件

`app/components/case/InsufficientPointsHandler.vue`

**逻辑**：
- 根据 `interrupt.data.reason` 判断显示内容：
  - `no_membership` → 展示会员购买界面（复用 `MembershipPackageList` 组件），引导用户购买会员（购买会员会赠送积分）
  - `insufficient_points` → 展示积分购买界面（复用 `PointPurchaseDialog` 的内容部分），引导用户购买积分
  - `service_error` → 展示"系统繁忙，请稍后重试"提示和重试按钮
- 展示当前积分余额信息（`availablePoints`、`totalPointsConsumed`、`totalTokensConsumed`）

### useCaseAnalysis 扩展

在 `app/composables/useCaseAnalysis.ts` 中：
- `INTERRUPT_PHASE_MAP` 新增 `INSUFFICIENT_POINTS` 映射
- `INTERRUPT_TASK_ID_MAP` 新增映射
- 新增 `isInsufficientPointsInterrupt()` 判断函数
- `formatInterruptMessage()` 新增对应消息
- 中断处理和恢复逻辑中新增分支

### Resume 流程

用户购买完成后：
1. 前端调用 `POST /api/v1/case/resume/[sessionId]` 恢复 Agent
2. 请求体：`{ interruptType: 'insufficient_points', userInput: { type: 'points_recharged' } }`
   （使用 `userInput` 字段名，与现有 API 保持一致）
3. 后端通过 `Command({ resume: userInput })` 恢复图执行
4. `interrupt()` 函数返回 resume 值，中间件代码继续执行
5. 继续执行的代码会重新检查积分和会员状态，充足则继续，不足则再次 interrupt

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| `consumePointsService` 抛出"积分不足" | 记录 `_pendingDeductQuantity`，`interrupt()` 创建断点 |
| `consumePointsService` 抛出其他错误（如 DB 异常） | 记录日志 + 记入 `_pendingDeductQuantity`，下次 afterModel 时补扣 |
| `usage_metadata` 缺失 | 使用保底估算规则（2 字符/token，最低 100 tokens） |
| `getCurrentMembershipService` 查询异常 | interrupt 并标记 `reason: 'service_error'`，前端显示"系统繁忙" |
| `checkPointsService` 异常 | interrupt（安全优先），标记 `reason: 'service_error'` |
| resume 后积分仍不足 | 再次 interrupt（用户需继续充值） |

## 测试策略

### 单元测试

1. **中间件创建**：验证中间件正确返回 createMiddleware 实例
2. **beforeAgent 预检**：
   - 非会员 → interrupt（reason: no_membership）
   - 会员 + 积分不足 → interrupt（reason: insufficient_points）
   - 会员 + 积分充足 → 正常通过
   - `_resumingFromAfterModel = true` → 跳过预检
   - 会员查询异常 → interrupt（reason: service_error）
3. **afterModel 扣减**：
   - 有 usage_metadata → 正确计算 quantity 并扣减
   - 无 usage_metadata → 使用保底估算
   - 扣减成功 → state 正确更新
   - 积分不足 → 记录 _pendingDeductQuantity + interrupt
   - 非积分不足错误 → 记录日志 + 记入待补扣
4. **补扣逻辑**：
   - resume 后 `_pendingDeductQuantity > 0` → 先补扣再继续
   - 补扣失败 → 再次 interrupt
5. **保底估算函数**：
   - 纯文本消息（中文法律文本）
   - 含 thinking 消息
   - 含 tool_calls 消息
   - 最低 100 tokens 保底
6. **边界条件**：
   - 0 tokens 消息（不扣减）
   - 恰好 1000 tokens（quantity=1）
   - 极大 token 数
   - 消耗项目不存在或已禁用

### 集成测试

1. 完整的 Agent 执行流程（积分充足时正常完成）
2. 积分不足中断 → 充值 → resume → 补扣 → 继续执行
3. 非会员中断 → 购买会员 → resume → 继续执行
4. 会员在分析过程中过期的场景（afterModel 扣减后，下次 beforeAgent 检查时会员已过期）

## 涉及文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `server/services/workflow/middleware/pointConsumption.middleware.ts` | 积分扣减中间件 |
| `app/components/case/InsufficientPointsHandler.vue` | 积分不足中断处理组件 |

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `shared/types/case.ts` | `InterruptType` 新增 `INSUFFICIENT_POINTS`；新增 `InsufficientPointsInterruptData` 类型 |
| `server/services/agent/caseAnalysis.ts` | middleware 数组中添加 `pointConsumptionMiddleware` |
| `server/services/workflow/middleware/index.ts` | 导出新中间件（如有 barrel export） |
| `app/components/case/InterruptConfirmation.vue` | 新增 INSUFFICIENT_POINTS 类型分支 |
| `app/composables/useCaseAnalysis.ts` | 扩展中断映射（INTERRUPT_PHASE_MAP、INTERRUPT_TASK_ID_MAP）和处理函数 |
| `server/services/sse/adapter.ts` | 扩展中断类型处理映射（getInterruptHandlerName 等） |
| `server/api/v1/case/resume/[sessionId].post.ts` | 支持新的中断类型恢复 |
