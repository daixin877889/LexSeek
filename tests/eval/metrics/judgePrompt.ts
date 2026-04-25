// tests/eval/metrics/judgePrompt.ts

export interface JudgeInput {
  question: string
  mustHaveJson: string // JSON.stringify(mustHave 数组)
  answer: string
  /** 已知案件真数据摘要（供 judge 判断幻觉用，不在此清单的具体数字/姓名才算捏造） */
  caseContext?: string
}

export function buildJudgePrompt(input: JudgeInput): string {
  const contextBlock = input.caseContext
    ? `\n【已知案件真数据】（这些是 fixture 真实数据，AI 提到这些**不算幻觉**）\n${input.caseContext}\n`
    : ''
  return `你是一个严格的评测员。请根据以下信息对 AI 的回答打分。

【用户提问】
${input.question}

【参考事实清单】（**期望被回答覆盖**的关键要点；用于评估事实覆盖度，**不是判定幻觉的依据**）
${input.mustHaveJson}
${contextBlock}
【AI 的回答】
${input.answer}

请按以下 4 个独立维度打分（每项 1-5 分，1 差 5 优），然后给出综合分。

1. **score_facts**：事实覆盖度——AI 的回答覆盖了参考事实清单中多少个要点？全部命中=5，完全没覆盖=1。
2. **score_citation**：引用正确性——AI 是否正确引用了案件材料/记忆/分析模块的来源（如"根据材料 X"/"根据 risk_analysis"等）？
3. **score_no_hallucination**：**仅评估"是否捏造了不存在的事实/数字/姓名"**——AI 答案中具体数字/人名/机构名/日期/案号若都来自【已知案件真数据】或【参考事实清单】 → 5 分；存在【已知案件真数据】之外的具体编造 → 给 1-3 分；**"未覆盖参考清单"≠"幻觉"**。
4. **score_relevance**：切题——回答是否针对用户提问，没有偏题。

严格输出以下 JSON（不要任何其他文本）：
{
  "score_facts": <1-5>,
  "score_citation": <1-5>,
  "score_no_hallucination": <1-5>,
  "score_relevance": <1-5>,
  "overall": <1-5>,
  "reasoning": "<不超过 100 字的简要说明>"
}`
}

export interface JudgeScore {
  score_facts: number
  score_citation: number
  score_no_hallucination: number
  score_relevance: number
  overall: number
  reasoning: string
}
