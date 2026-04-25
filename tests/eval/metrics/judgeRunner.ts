// tests/eval/metrics/judgeRunner.ts
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { buildJudgePrompt, type JudgeScore } from './judgePrompt'

export interface JudgeOpts {
  apiKey: string
  baseUrl?: string
  modelName: string
  repeat: number
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c?.type === 'text')
      .map((c: any) => c.text)
      .join('')
  }
  return String(content ?? '')
}

export async function runJudge(
  input: { question: string; mustHave: string[]; answer: string },
  opts: JudgeOpts,
): Promise<JudgeScore & { repeats: number; stdev: number; unstable: boolean }> {
  const prompt = buildJudgePrompt({
    question: input.question,
    mustHaveJson: JSON.stringify(input.mustHave),
    answer: input.answer,
  })
  const model = createChatModel({
    sdkType: 'deepseek',
    modelName: opts.modelName,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    streaming: false,
    temperature: 0,
  } as any)

  const samples: JudgeScore[] = []
  for (let i = 0; i < opts.repeat; i++) {
    const resp = await model.invoke(prompt)
    const txt = extractText(resp.content)
    const parsed = parseJudgeJson(txt)
    if (parsed) samples.push(parsed)
  }

  if (samples.length === 0) {
    return {
      score_facts: 0,
      score_citation: 0,
      score_no_hallucination: 0,
      score_relevance: 0,
      overall: 0,
      reasoning: 'judge 三次全部解析失败',
      repeats: 0,
      stdev: 0,
      unstable: true,
    }
  }

  const avg = (k: keyof JudgeScore) =>
    samples.reduce((s, x) => s + (x[k] as number), 0) / samples.length
  const overalls = samples.map(s => s.overall)
  const meanOverall = overalls.reduce((a, b) => a + b, 0) / overalls.length
  const variance = overalls.reduce((s, x) => s + (x - meanOverall) ** 2, 0) / overalls.length
  const stdev = Math.sqrt(variance)

  return {
    score_facts: avg('score_facts'),
    score_citation: avg('score_citation'),
    score_no_hallucination: avg('score_no_hallucination'),
    score_relevance: avg('score_relevance'),
    overall: meanOverall,
    reasoning: samples.map(s => s.reasoning).join(' | '),
    repeats: samples.length,
    stdev,
    unstable: stdev > 1.0,
  }
}

function parseJudgeJson(txt: string): JudgeScore | null {
  // 找第一个 { 和最后一个 } 之间的 JSON 块
  const start = txt.indexOf('{')
  const end = txt.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(txt.slice(start, end + 1))
    return {
      score_facts: Number(obj.score_facts ?? 0),
      score_citation: Number(obj.score_citation ?? 0),
      score_no_hallucination: Number(obj.score_no_hallucination ?? 0),
      score_relevance: Number(obj.score_relevance ?? 0),
      overall: Number(obj.overall ?? 0),
      reasoning: String(obj.reasoning ?? ''),
    }
  } catch {
    return null
  }
}
