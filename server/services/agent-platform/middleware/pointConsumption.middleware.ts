import { createMiddleware } from 'langchain'
import { interrupt } from '@langchain/langgraph'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { InterruptType } from '#shared/types/case'
import { getCurrentMembershipService } from '~~/server/services/membership/userMembership.service'
import { billCheckService, billDirectService } from '~~/server/services/point/pointBilling.service'
import { updateSessionState } from '~~/server/services/workflow/state/storage'

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

/**
 * 积分扣减中间件
 *
 * beforeAgent: 检查会员状态和积分余额
 * afterModel: 每次模型调用后根据 token 用量实时扣减积分
 *
 * @param userId 用户 ID
 * @param itemKey 消耗项目标识符（不同 Agent 传不同 key）
 * @param sessionId 会话 ID（用于共享状态存储）
 */
export const pointConsumptionMiddleware = (
    userId: number,
    itemKey: string,
    sessionId?: string,
    operationId?: string,
    contextLabel?: string,
) => {
    return createMiddleware({
        name: 'PointConsumptionMiddleware',
        stateSchema: z.object({
            _totalTokensConsumed: z.number().default(0),
            _totalPointsConsumed: z.number().default(0),
            _pendingDeductQuantity: z.number().default(0),
            _resumingFromAfterModel: z.boolean().default(false),
            _billingOperationId: z.string().default(''),
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

                // 3. 检查积分（停用项直接放行）
                const check = await billCheckService(userId, itemKey, { tokens: 1000, units: 1 })
                if (!check.skipped && !check.sufficient) {
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

                // 操作关联标识：优先用外部传入（多 sub-agent 共享聚合），否则自生成
                const opId = state._billingOperationId || operationId || uuidv4()
                logger.info('积分预检通过', { userId, operationId: opId, available: check.available })
                return { _billingOperationId: opId }
            },
        },

        afterModel: {
            hook: async (state: any) => {
                // 1. 检查并处理上次失败的待补扣
                const pendingQuantity = state._pendingDeductQuantity ?? 0
                if (pendingQuantity > 0) {
                    try {
                        // 同时传 tokens 和 units=1，让管理后台可在 token/次 两种模式间自由切换
                        await billDirectService(userId, itemKey, { tokens: pendingQuantity * 1000, units: 1 }, {
                            operationId: state._billingOperationId || undefined,
                            contextLabel,
                        })
                        logger.info('补扣成功', { userId, quantity: pendingQuantity })
                    } catch {
                        // 补扣仍然失败，interrupt
                        const check = await billCheckService(userId, itemKey, { tokens: 1000, units: 1 })
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
                    // 同时传 tokens 和 units=1（每次模型调用记 1 次），让管理后台可在 token/次 两种模式间自由切换
                    const result = await billDirectService(userId, itemKey, { tokens: totalTokens, units: 1 }, {
                        operationId: state._billingOperationId || undefined,
                        contextLabel,
                    })

                    const newState = {
                        _totalTokensConsumed: (state._totalTokensConsumed ?? 0) + totalTokens,
                        _totalPointsConsumed: (state._totalPointsConsumed ?? 0) + result.consumedAmount,
                        _pendingDeductQuantity: 0,
                        _resumingFromAfterModel: false,
                    }

                    // 更新共享状态（如果 sessionId 已提供）
                    if (sessionId) {
                        await updateSessionState(sessionId, newState)
                    }

                    return newState
                } catch (error) {
                    // 区分"积分不足"和其他错误
                    const isInsufficientPoints = error instanceof Error
                        && error.message.includes('积分不足')

                    if (isInsufficientPoints) {
                        const check = await billCheckService(userId, itemKey, { tokens: 1000, units: 1 })
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
                        const newState = {
                            _totalTokensConsumed: (state._totalTokensConsumed ?? 0) + totalTokens,
                            _pendingDeductQuantity: quantity,
                            _resumingFromAfterModel: true,
                        }

                        // 更新共享状态（如果 sessionId 已提供）
                        if (sessionId) {
                            await updateSessionState(sessionId, newState)
                        }

                        return newState
                    }

                    // 非积分不足的错误：记录日志，记入待补扣
                    logger.error('积分扣减异常（非积分不足）', { userId, error })

                    const newState = {
                        _totalTokensConsumed: (state._totalTokensConsumed ?? 0) + totalTokens,
                        _pendingDeductQuantity: quantity,
                    }

                    // 更新共享状态（如果 sessionId 已提供）
                    if (sessionId) {
                        await updateSessionState(sessionId, newState)
                    }

                    return newState
                }
            },
        },
    })
}
