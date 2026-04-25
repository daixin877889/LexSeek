// tests/eval/metrics/judgePrompt.ts

export interface JudgeInput {
  question: string
  mustHaveJson: string // JSON.stringify(mustHave 数组)
  answer: string
}

export function buildJudgePrompt(input: JudgeInput): string {
  return `你是一个严格的评测员。请根据以下信息对 AI 的回答打分。

【用户提问】
${input.question}

【参考事实清单】（应该被覆盖的要点）
${input.mustHaveJson}

【AI 的回答】
${input.answer}

请按以下 4 个维度打分（每项 1-5 分，1 差 5 优），然后给出综合分。

1. score_facts：事实覆盖度（参考清单命中比例）
2. score_citation：引用正确性（有没有引对材料/记忆/分析）
3. score_no_hallucination：无幻觉（有没有捏造不存在的事实，5 分=完全无幻觉，1 分=严重幻觉）
4. score_relevance：切题（有没有答所问）

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
