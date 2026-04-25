// tests/eval/fixtures/testDataset.ts

export type EvalGroup = 'profile' | 'material' | 'memory' | 'analysis' | 'cross' | 'tool-write' | 'security'
export type AnswerType = 'facts' | 'freeform'

export interface EvalCase {
  id: string
  group: EvalGroup
  /** 指向 fx.caseA.sessions[i]，由 runEval 解析为 sessionId */
  sessionIndex: 0 | 1 | 2
  question: string
  answerType: AnswerType
  mustHave: string[]
  mustNotHave?: string[]
  expectedTools?: string[]
  /** 在 runEval 注入诱饵 caseId（如 fx.caseB.id） */
  forbiddenCaseIds?: number[]
}

/** 29 条提问。占位符 forbiddenCaseIds 在 runEval 注入时替换。 */
export const TEST_DATASET: EvalCase[] = [
  // ① 档案题（5）
  { id: 'q-profile-01', group: 'profile', sessionIndex: 0, question: '本案的一审法官是谁？', answerType: 'facts', mustHave: ['张三'] },
  { id: 'q-profile-02', group: 'profile', sessionIndex: 0, question: '本案的二审法院是哪个？', answerType: 'facts', mustHave: ['广州市中级人民法院'] },
  { id: 'q-profile-03', group: 'profile', sessionIndex: 0, question: '一审案号和二审案号分别是？', answerType: 'facts', mustHave: ['(2024)粤0103民初1234号', '(2025)粤01民终5678号'] },
  { id: 'q-profile-04', group: 'profile', sessionIndex: 1, question: '本案现在处于哪个诉讼阶段？', answerType: 'facts', mustHave: ['二审'] },
  { id: 'q-profile-05', group: 'profile', sessionIndex: 1, question: '本案的二审法官是谁？', answerType: 'facts', mustHave: ['李四'] },

  // ② 材料题（4 facts + 1 freeform）
  { id: 'q-material-01', group: 'material', sessionIndex: 0, question: '本案有多少份材料？', answerType: 'facts', mustHave: ['8'] },
  { id: 'q-material-02', group: 'material', sessionIndex: 0, question: '甲方支付了多少首付款？', answerType: 'facts', mustHave: ['100', '万'], expectedTools: ['search_case_materials'] },
  { id: 'q-material-03', group: 'material', sessionIndex: 1, question: '主合同的签订日期是？', answerType: 'facts', mustHave: ['2024-03-15'], expectedTools: ['search_case_materials'] },
  { id: 'q-material-04', group: 'material', sessionIndex: 1, question: '物流签收单的核心信息？', answerType: 'facts', mustHave: ['物流'], expectedTools: ['search_case_materials'] },
  { id: 'q-material-05', group: 'material', sessionIndex: 2, question: '请综合评估这些证据材料的整体证明力', answerType: 'freeform', mustHave: ['证据', '微信', '物流', '银行'], expectedTools: ['search_case_materials'] },

  // ③ 记忆题（5）
  { id: 'q-memory-01', group: 'memory', sessionIndex: 0, question: '我们之前确定的争议金额是多少？', answerType: 'facts', mustHave: ['280', '万'], expectedTools: ['search_case_memory'] },
  { id: 'q-memory-02', group: 'memory', sessionIndex: 0, question: '当事人偏好什么样的沟通方式？', answerType: 'facts', mustHave: ['电话'], expectedTools: ['search_case_memory'] },
  { id: 'q-memory-03', group: 'memory', sessionIndex: 1, question: '我们之前讨论过哪些法条？', answerType: 'facts', mustHave: ['民法典'], expectedTools: ['search_case_memory'] },
  { id: 'q-memory-04', group: 'memory', sessionIndex: 1, question: '当事人对结案时间有什么期望？', answerType: 'facts', mustHave: ['2', '月'], expectedTools: ['search_case_memory'] },
  { id: 'q-memory-05', group: 'memory', sessionIndex: 2, question: '我们对乙方偿付能力的评估结论是？', answerType: 'facts', mustHave: ['偿付能力'], expectedTools: ['search_case_memory'] },

  // ④ 分析产物题（4 facts + 1 freeform，含版本切换）
  { id: 'q-analysis-01', group: 'analysis', sessionIndex: 0, question: '风险分析的当前结论倾向哪个方案？', answerType: 'facts', mustHave: ['B'], expectedTools: ['search_case_analysis'] },
  { id: 'q-analysis-02', group: 'analysis', sessionIndex: 1, question: '证据分析里证据强度评估是什么？', answerType: 'facts', mustHave: ['高'], expectedTools: ['search_case_analysis'] },
  { id: 'q-analysis-03', group: 'analysis', sessionIndex: 1, question: '初步分析是第几版？', answerType: 'facts', mustHave: ['v2'], expectedTools: ['search_case_analysis'] },
  { id: 'q-analysis-04', group: 'analysis', sessionIndex: 2, question: '请总结当前所有分析模块的核心结论', answerType: 'freeform', mustHave: ['B', 'v2', '风险', '证据'], expectedTools: ['search_case_analysis'] },
  { id: 'q-analysis-05', group: 'analysis', sessionIndex: 2, question: '版本切换前后这个模块的结论有什么变化？（注：本提问由 runner 在切版本前后分别跑，断言答案不同）', answerType: 'facts', mustHave: ['B'], expectedTools: ['search_case_analysis'] },

  // ⑤ 跨层题（3 freeform + 2 facts）
  { id: 'q-cross-01', group: 'cross', sessionIndex: 1, question: '请综合案件基本信息、所有证据、之前的讨论笔记，给出一个 3 句话的案件全景', answerType: 'freeform', mustHave: ['张三', '280', 'B'] },
  { id: 'q-cross-02', group: 'cross', sessionIndex: 1, question: '基于已有材料和我们的讨论，下一步应该做什么？', answerType: 'freeform', mustHave: ['调解', '证据'] },
  { id: 'q-cross-03', group: 'cross', sessionIndex: 2, question: '当事人的偏好如何影响分析结论？', answerType: 'freeform', mustHave: ['偏好', 'B'] },
  { id: 'q-cross-04', group: 'cross', sessionIndex: 2, question: '一审审判长姓名 + 当前争议金额 + 风险结论倾向？', answerType: 'facts', mustHave: ['张三', '280', 'B'] },
  { id: 'q-cross-05', group: 'cross', sessionIndex: 0, question: '本案在哪个法院 + 我们偏好什么沟通 + 当前是 v 几的分析', answerType: 'facts', mustHave: ['广州', '电话', 'v2'] },

  // ⑥ 工具写入题（2）
  { id: 'q-tool-write-01', group: 'tool-write', sessionIndex: 2, question: '帮我记下：甲方对乙方的逾期交付强烈不满，要求增加违约金赔偿', answerType: 'facts', mustHave: ['记录', '已'], expectedTools: ['write_case_memory'] },
  { id: 'q-tool-write-02', group: 'tool-write', sessionIndex: 2, question: '我之前说过当事人偏好电话沟通这一条记忆其实有误，请把它失效掉', answerType: 'facts', mustHave: ['失效'], expectedTools: ['update_case_memory'] },

  // ⑦ 隔离题（2）
  { id: 'q-security-01', group: 'security', sessionIndex: 2, question: '我之前在另一个案子里说过偏好邮件沟通，对吗？', answerType: 'facts', mustHave: [], mustNotHave: ['邮件'], forbiddenCaseIds: [] /* runEval 注入 caseB.id */ },
  { id: 'q-security-02', group: 'security', sessionIndex: 2, question: '我们之前讨论过《公司法》里的相关条款吗？', answerType: 'facts', mustHave: [], mustNotHave: ['公司法'], forbiddenCaseIds: [] /* runEval 注入 caseB.id */ },
]
