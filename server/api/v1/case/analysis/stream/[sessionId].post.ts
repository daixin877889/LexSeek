/**
 * SSE 流式分析
 *
 * POST /api/v1/case/analysis/stream/[sessionId]
 *
 * 启动案件分析工作流，通过 SSE 实时返回 AI 分析过程和结果
 *
 * Requirements: 1.3, 9.1, 9.3, 12.3, 12.4
 */

import { findCaseBySessionIdService } from '~~/server/services/case/caseSession.service'
import { mainAgent } from '~~/server/services/agent/main'


export default defineEventHandler(async (event) => {

    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取路由参数
    const sessionId = getRouterParam(event, 'sessionId')
    if (!sessionId) {
        return resError(event, 400, 'sessionId 不能为空')
    }

    // 先验证（非 SSE 阶段），确保走到这里才设置 SSE 头
    const caseInfo = await findCaseBySessionIdService(sessionId)
    if (!caseInfo) {
        return resError(event, 404, '案件不存在')
    }
    if (user.id !== caseInfo.userId) {
        return resError(event, 403, '您没有权限访问该案件')
    }

    // 设置 SSE 头
    setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    })

    const eventStream = createEventStream(event)

    // 注册断开回调
    eventStream.onClosed(async () => {
        logger.info('SSE 连接断开', { sessionId })
    })

    try {
        // 使用案件的 content 作为 prompt
        const prompt = `原告2021年5月份在宝马官方二手车网站上看到了被告售卖的宝马3系长轴距版 330Li xDrive车辆，车辆状态为未上牌，总价37万。到店看完车之后，于 2021年5月22日缴纳1万元定金，2021年5月29日到店支付首付款共18.3万元并签订了合同，约定2021年6月5日提车。\n2021年6月3日被告告知因为售价过低，无法开票，需要走集团流程申请。经过和被告沟通，将提车日期改到2021年6月8日。2021年6月7日再次被被告告知合格证已被使用，无法开具发票，需要跟厂家沟通。随后反馈是税务系统升级导致无法开具发票，需要跟税务局沟通，无具体解决时间。\n2021年6月11日到店沟通，被告依旧无法给出解决的方案与时间。最终协商暂时退还18.8万元，保留5000定金，继续履行合同。\n2021年7月10日，原告到店跟被告咨询处理方案，仍无法给出具体提车时间，也无法说明开不出发票的具体原因。原告提出2021年7月16日前提车，如无法提车则中止合同，并按民法典第五百八十七条规定返还双倍定金，同时赔偿2021年6月5日至2021年7月16日共41天的用车损失诉求。被告回复只能退车，不接受赔偿。\n2021年7月24日，原告受被告邀请到店协商赔偿事宜，被告拒绝按民法典五百八十七条的条款返回合同双倍定金，拒绝赔偿用车损失，只愿意支付5000-8000元的赔偿费用。`

            // 立即开始流式推送，不要等待 agent 完成
            // 边生成边推送，实现真正的 SSE 流式效果
            ; (async () => {
                try {
                    const main = await mainAgent(sessionId, prompt)

                    for await (const [namespace, mode, data] of main) {
                        logger.debug('SSE chunk', { namespace, mode, data })

                        await eventStream.push({
                            event: 'agent-text',
                            data: JSON.stringify({ namespace, mode, data }),
                        })
                    }

                    // 循环结束，发送完成信号
                    await eventStream.push({
                        event: 'done',
                        data: '分析完成',
                    })

                } catch (error: any) {
                    logger.error('SSE 流式处理出错', { sessionId, error: error.message })
                    await eventStream.push({
                        event: 'error',
                        data: error.message || '分析失败',
                    })
                } finally {
                    await eventStream.close()
                }
            })()
    } catch (error: any) {
        return resError(event, 500, error.message || '分析失败')
    }

    // 立即返回 eventStream.send() 启动 SSE，不要等待 agent 完成
    return eventStream.send()
})
