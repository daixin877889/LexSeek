import { caseAnalysisAgent } from '~~/server/services/agent/caseAnalysis'

export default defineEventHandler(async (event) => {
  // 1. 验证用户登录
  const user = event.context.auth?.user
  if (!user) {
    return resError(event, 401, '请先登录')
  }
  // 解析请求体
  const { sessionId, message, command } = await readBody(event)

  if (!sessionId) {
    return resError(event, 400, 'thread_id 不能为空')
  }

  const prompt = `原告2021年5月份在宝马官方二手车网站上看到了被告售卖的宝马3系长轴距版 330Li xDrive车辆，车辆状态为未上牌，总价37万。到店看完车之后，于 2021年5月22日缴纳1万元定金，2021年5月29日到店支付首付款共18.3万元并签订了合同，约定2021年6月5日提车。
  2021年6月3日被告告知因为售价过低，无法开票，需要走集团流程申请。经过和被告沟通，将提车日期改到2021年6月8日。2021年6月7日再次被被告告知合格证已被使用，无法开具发票，需要跟厂家沟通。随后反馈是税务系统升级导致无法开具发票，需要跟税务局沟通，无具体解决时间。
  2021年6月11日到店沟通，被告依旧无法给出解决的方案与时间。最终协商暂时退还18.8万元，保留5000定金，继续履行合同。
  2021年7月10日，原告到店跟被告咨询处理方案，仍无法给出具体提车时间，也无法说明开不出发票的具体原因。原告提出2021年7月16日前提车，如无法提车则中止合同，并按民法典第五百八十七条规定返还双倍定金，同时赔偿2021年6月5日至2021年7月16日共41天的用车损失诉求。被告回复只能退车，不接受赔偿。
  2021年7月24日，原告受被告邀请到店协商赔偿事宜，被告拒绝按民法典五百八十七条的条款返回合同双倍定金，拒绝赔偿用车损失，只愿意支付5000-8000元的赔偿费用。`

  const options = {
    thinking: true,
    userId: user.id,
    caseId: 1,
  }

  const stream = await caseAnalysisAgent(sessionId, prompt, options)

  // 6. 设置 SSE 响应头
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })


  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
})
