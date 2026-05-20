/**
 * 当前时间注入中间件
 *
 * 每轮 LLM 调用前，把"当前北京时间"作为一条隐藏 HumanMessage 注入到 messages 末尾的
 * 最新 HumanMessage 之前——不写回 state.messages / 不进 checkpoint，下一轮重新注入。
 *
 * 设计动机：
 * - 模型没有"今天是几月几号"的概念。案件分析涉及诉讼时效（3 年 / 20 年）、大事记
 *   时间锚定、合同到期日、新法生效对比等场景必须明确知道当前时间，否则会按训练
 *   截止时间或瞎猜。
 * - 不放 system prompt 头部：时间字符串变化让 Anthropic prompt cache 永远 miss，
 *   每轮多花一倍 input token。改放 user message 侧。
 * - 不走工具调用：多一次 round trip 且模型未必主动调，对"主动意识到时间"的场景不可靠。
 *
 * 设计要点：
 * - 注入位置与 userInjectionMiddleware 对齐（最末一条 HumanMessage 之前）
 * - 仅修改 wrapModelCall 内的 request 副本，不动 state
 * - 注入消息使用**日级粒度**（YYYY-MM-DD 周X，北京时间）：同一天内 user 侧 cache 仍可命中；
 *   秒级时间会让每轮注入文本都变，把 user 段 cache 切断
 *
 * @see server/services/agent-platform/middleware/userInjection.middleware.ts 同款模式
 */

import { createMiddleware } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * 返回北京时区的今天，例：`2026-05-21`
 *
 * 日级粒度选择：放进 system prompt 仍命中 prompt cache（同一天内值不变）；
 * 中间件注入文本同样使用日级粒度，保证 user 侧 cache 在一天内可命中。
 *
 * 测试锚定：用 `vi.useFakeTimers()` + `vi.setSystemTime(...)`，无需在签名上加 fixedNow 入参。
 */
export function formatCurrentDate(tz: string = DEFAULT_TIMEZONE): string {
    return dayjs().tz(tz).format('YYYY-MM-DD')
}

/**
 * 返回带星期的北京时区今天，例：`2026-05-21 周三`
 *
 * 与 formatCurrentDate 一致是日级粒度——星期不会让 cache miss（一天内不变）。
 * 若未来确实需要秒级，请慎重评估对 prompt cache 的影响。
 */
export function formatCurrentDateWithWeekday(tz: string = DEFAULT_TIMEZONE): string {
    const now = dayjs().tz(tz)
    return `${now.format('YYYY-MM-DD')} ${WEEKDAY_CN[now.day()]}`
}

export interface DateContextMiddlewareOptions {
    /** 注入时区，默认 Asia/Shanghai */
    timezone?: string
}

export function dateContextMiddleware(options: DateContextMiddlewareOptions = {}) {
    const tz = options.timezone ?? DEFAULT_TIMEZONE

    return createMiddleware({
        name: 'dateContextMiddleware',
        wrapModelCall: async (request, handler) => {
            const content = `当前北京时间：${formatCurrentDateWithWeekday(tz)}`

            const enhanced: BaseMessage[] = request.messages.slice()
            const injectionMsg = new HumanMessage(content)

            const lastHumanIdx = enhanced.findLastIndex((m) => m.getType() === 'human')
            if (lastHumanIdx >= 0) {
                enhanced.splice(lastHumanIdx, 0, injectionMsg)
            } else {
                enhanced.push(injectionMsg)
            }

            return handler({ ...request, messages: enhanced })
        },
    })
}
