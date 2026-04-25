/**
 * Eval runner（独立工具脚本，非 server runtime production code）。
 * 允许使用 console 输出进度（已豁免 no-console rule）。
 */
import { execSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
dayjs.extend(utc)
dayjs.extend(timezone)

import { assertEvalRuntime, teardownEvalRuntime } from './utils/runtimeGuards'
import { installOssMock } from './utils/ossMock'
import { buildFixture } from './fixtures/buildFixture'
import { LLMUsageCallbackHandler } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'
import { runOneChat } from './runner/datasetRunner'
import { aggregateCostMetrics } from './metrics/costMetrics'
import { writeJsonReport } from './report/jsonReporter'
import { writeMarkdownReport } from './report/markdownReporter'
import type { EvalReport } from './report/reportTypes'

const OWNER_USER_ID = parseInt(process.env.EVAL_OWNER_USER_ID ?? '1', 10)
const OUT_DIR = 'docs/eval-reports'

async function main() {
  await assertEvalRuntime()
  installOssMock()

  const startedAt = Date.now()
  const handler = new LLMUsageCallbackHandler({ tag: 'main', isWarmup: true })

  // Part 0: seed fixture
  const fx = await buildFixture({ cleanFirst: true, deterministicSeed: 42, ownerUserId: OWNER_USER_ID })

  // Part 0.5: warmup（跑 1 次空问题预热 cache）
  try {
    await runOneChat({
      caseId: fx.caseA.id,
      userId: OWNER_USER_ID,
      sessionId: fx.caseA.sessions[0]!,
      question: '本案当前进入哪个阶段？',
      isWarmup: true,
    }, handler)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[eval] warmup failed', e)
  }
  handler.setWarmup(false)

  // Part 1: cost-only smoke run（10 占位提问，Task 16 替换为 TEST_DATASET 时整段删除）
  const placeholders = [
    '本案一审法官姓名？', '当前案件状态？', '甲方诉讼请求？',
    '主合同签订时间？', '存在哪些证据？', '乙方主要抗辩理由？',
    '调解过程？', '诉讼标的金额？', '本案二审法院？', '当前模块要点？',
  ]
  const promptTokensSamples: number[] = []
  for (let i = 0; i < fx.caseA.sessions.length; i++) {
    const sessionId = fx.caseA.sessions[i]!
    for (const q of placeholders) {
      try {
        const out = await runOneChat({
          caseId: fx.caseA.id, userId: OWNER_USER_ID,
          sessionId, question: q,
        }, handler)
        promptTokensSamples.push(out.promptTokens)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[eval] case run failed', q, e)
      }
    }
  }

  // Aggregate cost metrics
  const cost = aggregateCostMetrics({
    usageRecords: handler.getRecords(),
    systemPromptTokensSamples: [],     // Task 20 stab-prompt-hash 接入后填充
    totalPromptTokensSamples: promptTokensSamples,
    memoryRecallLatencies: [],
    analysisSummaryLatencies: [],
    anthropicProtocolSecondCacheRead: 0,
    openaiProtocolSecondCachedTokens: 0,
  })

  const criticalFailures = cost.filter(m => m.severity === 'CRITICAL' && m.result === 'fail').map(m => m.name)
  const crits = cost.filter(m => m.severity === 'CRITICAL')
  const warns = cost.filter(m => m.severity === 'WARN')

  const report: EvalReport = {
    version: '1.0',
    runAt: dayjs().tz('Asia/Shanghai').format(),
    commit: gitCommit(),
    durationMs: Date.now() - startedAt,
    summary: {
      totalCritical: crits.length,
      passedCritical: crits.filter(m => m.result === 'pass').length,
      totalWarn: warns.length,
      passedWarn: warns.filter(m => m.result === 'pass').length,
      criticalFailures,
      overallPass: criticalFailures.length === 0,
    },
    metrics: { cost, quality: [], task: [], extraction: [], security: [], stability: [] },
    cases: [], extractions: [], securityAssertions: [], errored: [],
  }

  await mkdir(OUT_DIR, { recursive: true })
  const md = await writeMarkdownReport(report, OUT_DIR, { excerptAnswers: true, excerptLength: 200 })
  const json = await writeJsonReport(report, OUT_DIR)
  // eslint-disable-next-line no-console
  console.log(`[eval] reports: ${md}, ${json}`)
  // eslint-disable-next-line no-console
  console.log(`[eval] criticalFailures=${criticalFailures.length}; overallPass=${report.summary.overallPass}`)
  await teardownEvalRuntime()
  process.exit(criticalFailures.length > 0 ? 1 : 0)
}

function gitCommit(): string {
  try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'unknown' }
}

main().catch(async err => {
  // eslint-disable-next-line no-console
  console.error('[eval] runner crashed before producing report', err)
  await teardownEvalRuntime().catch(() => {})
  process.exit(2)
})
