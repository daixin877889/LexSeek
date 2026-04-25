/**
 * Extraction 评测数据集
 *
 * 每条 transcript 是一段用户/AI 对话，附带"应当被抽取出的事实/偏好"
 * （expectedExtractions）和"绝对不该被抽取的项"（forbiddenExtractions）。
 *
 * runAfter 用来串联状态更新链：ex-02 必须在 ex-01 之后跑，
 * 用于验证 case_memories 的版本链（旧值 invalidate、新值生效）。
 */

export interface ExpectedExtraction {
  /** memory subjectKey（fact.* / preference.*） */
  subjectKey: string
  /** value 文本里必须包含的全部关键词 */
  valueKeywords: string[]
  /** 抽取置信度下限，低于此值不算命中 */
  minConfidence: number
  /** 选填项 — 缺失不计入 recall 分母 */
  optional?: boolean
}

export interface ExtractionTranscript {
  id: string
  /** 对应 fx.caseA.sessions[i] — runEval 会把这段对话放进对应 session 跑抽取 */
  sessionIndex: 0 | 1 | 2
  turns: { role: 'user' | 'assistant'; content: string }[]
  expectedExtractions: ExpectedExtraction[]
  /** 这些 subjectKey 一旦出现在抽取结果里，就视为幻觉 */
  forbiddenExtractions: string[]
  /** 依赖前一段 transcript 跑完后的状态（用于版本链测试） */
  runAfter?: string
}

export const EXTRACTION_DATASET: ExtractionTranscript[] = [
  {
    id: 'ex-01',
    sessionIndex: 0,
    turns: [
      { role: 'user', content: '我是这个案子的甲方代理律师' },
      { role: 'assistant', content: '好的，已了解。' },
      { role: 'user', content: '甲方公司全称是天利科技股份有限公司' },
      { role: 'assistant', content: '记下了。' },
      { role: 'user', content: '我希望尽量在三个月内结案' },
      { role: 'assistant', content: '明白您的诉求。' },
      { role: 'user', content: '我个人偏好用电话沟通，不太喜欢邮件' },
      { role: 'assistant', content: '收到。' },
      { role: 'user', content: '另外乙方上周三在电话里口头承认了逾期交货的事实' },
      { role: 'assistant', content: '这是重要事实，已记录。' },
    ],
    expectedExtractions: [
      { subjectKey: 'fact.party.plaintiff_name', valueKeywords: ['天利', '科技'], minConfidence: 0.7 },
      { subjectKey: 'preference.timeline.target', valueKeywords: ['三个月', '3'], minConfidence: 0.6 },
      { subjectKey: 'preference.contact.method', valueKeywords: ['电话'], minConfidence: 0.7 },
      { subjectKey: 'fact.delivery.acknowledgement', valueKeywords: ['逾期', '承认'], minConfidence: 0.7 },
    ],
    forbiddenExtractions: ['fact.contract.amount', 'fact.dispute.location'],
  },
  {
    id: 'ex-02',
    sessionIndex: 0,
    runAfter: 'ex-01',
    turns: [
      { role: 'user', content: '更正一下，刚才说的甲方公司名字错了，正确的是天利达科技集团有限公司' },
      { role: 'assistant', content: '已更正。' },
    ],
    expectedExtractions: [
      { subjectKey: 'fact.party.plaintiff_name', valueKeywords: ['天利达', '集团'], minConfidence: 0.7 },
    ],
    forbiddenExtractions: [],
  },
  {
    id: 'ex-03',
    sessionIndex: 0,
    turns: [
      { role: 'user', content: '假设乙方提出 200 万的赔偿，我们是否应该接受？' },
      { role: 'assistant', content: '这取决于多个因素…' },
      { role: 'user', content: '如果对方咄咄逼人怎么办？' },
      { role: 'assistant', content: '可以采取以下应对措施…' },
    ],
    expectedExtractions: [],
    forbiddenExtractions: ['fact.settlement.amount', 'fact.opponent.attitude'],
  },
]
