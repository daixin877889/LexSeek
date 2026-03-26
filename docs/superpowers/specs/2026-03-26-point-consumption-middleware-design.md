# 积分扣减中间件设计文档

## 概述

在案件分析 Agent（`caseAnalysis.ts`）中增加积分扣减中间件，每次模型调用后根据 token 使用量实时扣减积分。积分与 token 的兑换比例通过后台「积分消耗项目」配置，不同 Agent 可使用不同的消耗规则。

当积分不足时，通过 LangGraph interrupt 机制创建断点，前端根据用户会员状态渲染购买卡片（非会员→会员购买卡片，会员→积分购买卡片），用户充值后通过 resume 继续对话。

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
│    ├─ getCurrentMembershipService(userId) 检查会员状态         │
│    ├─ checkPointsService(userId, itemKey, 1) 检查最小单元     │
│    └─ 不满足 → runtime.interrupt(INSUFFICIENT_POINTS)         │
│                                                               │
│  afterModel:                                                  │
│    ├─ 从 AIMessage.usage_metadata 获取 total_tokens           │
│    ├─ 无 usage_metadata → 保底估算（content+thinking+tools）  │
│    ├─ quantity = ceil(total_tokens / 1000)                     │
│    ├─ consumePointsService(userId, itemKey, quantity) 扣减    │
│    ├─ 扣减失败（积分不足）→ runtime.interrupt(...)            │
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
}
```

### 中间件自定义 State

```typescript
stateSchema: z.object({
    /** 累计消耗 token 数 */
    _totalTokensConsumed: z.number().default(0),
    /** 累计扣减积分数 */
    _totalPointsConsumed: z.number().default(0),
})
```

## 中间件实现

### 文件位置

`server/services/workflow/middleware/pointConsumption.middleware.ts`

### 函数签名

```typescript
export const pointConsumptionMiddleware = (
    userId: number,
    itemKey: string   // 消耗项目标识符，不同 Agent 传不同 key
) => createMiddleware({ ... })
```

### beforeAgent Hook

在 Agent 启动前检查两个条件：
1. 用户是否为有效会员（`getCurrentMembershipService`）
2. 积分是否足够扣减最小单元（`checkPointsService(userId, itemKey, 1)`，即 1000 tokens 对应的积分数）

任一条件不满足，调用 `runtime.interrupt()` 创建断点。

### afterModel Hook

每次模型调用完成后：
1. 从最后一条 AIMessage 的 `usage_metadata.total_tokens` 获取 token 用量
2. 若 `usage_metadata` 缺失，使用保底估算规则
3. 计算计费单位：`quantity = Math.ceil(totalTokens / 1000)`
4. 调用 `consumePointsService(userId, itemKey, quantity)` 扣减积分
5. 扣减失败（积分不足）时，重新检查会员状态后调用 `runtime.interrupt()`
6. 扣减成功时，更新 state 中的累计消耗数据

### 保底 Token 估算规则

当 `AIMessage.usage_metadata` 不可用时，基于消息内容估算：

```typescript
const getTokenCount = (message: AIMessage): number => {
    // 1. 优先使用 usage_metadata
    if (message.usage_metadata?.total_tokens) {
        return message.usage_metadata.total_tokens
    }

    let estimated = 0

    // 2. 主内容（约 4 字符 = 1 token）
    const content = typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content)
    estimated += Math.ceil(content.length / 4)

    // 3. Thinking tokens（extended thinking 模型）
    if (message.additional_kwargs?.thinking) {
        const thinking = message.additional_kwargs.thinking
        const text = Array.isArray(thinking)
            ? thinking.map(t => t.thinking || '').join('')
            : String(thinking)
        estimated += Math.ceil(text.length / 4)
    }

    // 4. Tool calls tokens
    if (message.tool_calls?.length) {
        estimated += Math.ceil(JSON.stringify(message.tool_calls).length / 4)
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
- 根据 `interrupt.data.isMember` 判断显示内容
- **非会员**：展示会员购买界面（复用 `MembershipPackageList` 组件），引导用户购买会员（购买会员会赠送积分）
- **会员但积分不足**：展示积分购买界面（复用 `PointPurchaseDialog` 的内容部分），引导用户购买积分
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
2. 请求体：`{ interruptType: 'insufficient_points', resumeValue: { type: 'points_recharged' } }`
3. Agent 从 checkpoint 恢复，beforeAgent 或 afterModel 中的 `runtime.interrupt()` 返回 resume 值
4. 中间件检查积分是否已充足，充足则继续执行，不足则再次 interrupt

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| `consumePointsService` 抛出"积分不足" | `runtime.interrupt()` 创建断点 |
| `consumePointsService` 抛出其他错误 | 记录错误日志，不中断 Agent（容错） |
| `usage_metadata` 缺失 | 使用保底估算规则 |
| `getCurrentMembershipService` 异常 | 记录错误日志，视为非会员，interrupt |
| `checkPointsService` 异常 | 记录错误日志，interrupt（安全优先） |
| resume 后积分仍不足 | 再次 interrupt |

## 测试策略

### 单元测试

1. **中间件创建**：验证中间件正确返回 createMiddleware 实例
2. **beforeAgent 预检**：
   - 非会员 → interrupt
   - 会员 + 积分不足 → interrupt
   - 会员 + 积分充足 → 正常通过
3. **afterModel 扣减**：
   - 有 usage_metadata → 正确计算 quantity 并扣减
   - 无 usage_metadata → 使用保底估算
   - 扣减成功 → state 正确更新
   - 扣减失败 → interrupt
4. **保底估算函数**：
   - 纯文本消息
   - 含 thinking 消息
   - 含 tool_calls 消息
   - 最低 100 tokens 保底

### 集成测试

1. 完整的 Agent 执行流程（积分充足时正常完成）
2. 积分不足中断 → 充值 → resume → 继续执行
3. 非会员中断 → 购买会员 → resume → 继续执行

## 涉及文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `server/services/workflow/middleware/pointConsumption.middleware.ts` | 积分扣减中间件 |
| `app/components/case/InsufficientPointsHandler.vue` | 积分不足中断处理组件 |

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `shared/types/case.ts` | `InterruptType` 新增 `INSUFFICIENT_POINTS` |
| `server/services/agent/caseAnalysis.ts` | middleware 数组中添加 `pointConsumptionMiddleware` |
| `server/services/workflow/middleware/index.ts` | 导出新中间件（如有 barrel export） |
| `app/components/case/InterruptConfirmation.vue` | 新增 INSUFFICIENT_POINTS 类型分支 |
| `app/composables/useCaseAnalysis.ts` | 扩展中断映射和处理函数 |
| `server/services/sse/adapter.ts` | 扩展中断类型处理映射 |
| `server/api/v1/case/resume/[sessionId].post.ts` | 支持新的中断类型恢复 |
