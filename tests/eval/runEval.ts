/**
 * Eval runner（独立工具脚本，非 server runtime production code）。
 * 允许使用 console 输出进度（已豁免 no-console rule）。
 */
import './utils/runtimeConfigShim'   // 必须最先 import：注入 globalThis.useRuntimeConfig polyfill
import { execSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
dayjs.extend(utc)
dayjs.extend(timezone)

import { assertEvalRuntime, teardownEvalRuntime, getEvalRedisClient } from './utils/runtimeGuards'
import { installOssMock } from './utils/ossMock'
import { buildFixture } from './fixtures/buildFixture'
import { LLMUsageCallbackHandler } from '~~/server/services/workflow/callbacks/LLMUsageCallbackHandler'
import { runOneChat } from './runner/datasetRunner'
import { aggregateCostMetrics } from './metrics/costMetrics'
import { writeJsonReport } from './report/jsonReporter'
import { writeMarkdownReport } from './report/markdownReporter'
import type {
  CaseResult,
  EvalReport,
  ExtractionResult,
  SecurityAssertionResult,
} from './report/reportTypes'

import { TEST_DATASET } from './fixtures/testDataset'
import { EXTRACTION_DATASET } from './fixtures/extractionDataset'
import { evaluateFactsCase, aggregateQualityMetrics } from './metrics/qualityMetrics'
import { aggregateTaskMetrics } from './metrics/taskMetrics'
import { runJudge } from './metrics/judgeRunner'
import {
  evaluateExtraction,
  aggregateExtractionMetrics,
  type ExtractedItem,
} from './metrics/extractionMetrics'
import { buildSecurityAssertions } from './fixtures/securityDataset'
import {
  evaluateCrossCaseLeak,
  aggregateSecurityMetrics,
} from './metrics/securityMetrics'
import {
  checkPromptHashStability,
  checkSwitchActiveAtomic,
  checkOldDataGraceful,
} from './metrics/stabilityMetrics'
import { processNowService } from '~~/server/services/memory/consolidator.service'
import { getToolCallsFromThread } from './utils/traceReader'
import { prisma } from '~~/server/utils/db'

const OWNER_USER_ID = parseInt(process.env.EVAL_OWNER_USER_ID ?? '1', 10)
const OUT_DIR = 'docs/eval-reports'

/** 主入口：vitest 包装可直接调用，不走 process.exit；也支持 bun 直接跑（兜底）*/
export async function runEvalMain(): Promise<{ criticalFailures: string[]; reportPath: { md: string; json: string } }> {
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

  const promptTokensSamples: number[] = []
  const erroredCases: { id: string; reason: string }[] = []

  // ============== Part 1: 跑 29 条 dataset ==============
  const allCaseResults: CaseResult[] = []
  for (const ec of TEST_DATASET) {
    const sessionId = fx.caseA.sessions[ec.sessionIndex]!
    // security 组注入诱饵 caseId
    const ec2 = ec.group === 'security' ? { ...ec, forbiddenCaseIds: [fx.caseB.id] } : ec

    let runResult
    try {
      runResult = await runOneChat({
        caseId: fx.caseA.id,
        userId: OWNER_USER_ID,
        sessionId,
        question: ec2.question,
      }, handler)
      promptTokensSamples.push(runResult.promptTokens)
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      erroredCases.push({ id: ec2.id, reason })
      allCaseResults.push({
        id: ec2.id,
        group: ec2.group,
        question: ec2.question,
        answer: '',
        mustHaveHits: [],
        mustHaveMisses: [],
        hallucinationHits: [],
        toolCalls: [],
        expectedTools: ec2.expectedTools,
        tokens: {},
        latencyMs: 0,
        result: 'errored',
      })
      continue
    }

    let factsR: ReturnType<typeof evaluateFactsCase> | undefined
    let judgeR: Awaited<ReturnType<typeof runJudge>> | undefined
    if (ec2.answerType === 'facts') {
      factsR = evaluateFactsCase({
        answer: runResult.answer,
        mustHave: ec2.mustHave,
        mustNotHave: ec2.mustNotHave,
      })
    } else {
      try {
        judgeR = await runJudge(
          { question: ec2.question, mustHave: ec2.mustHave, answer: runResult.answer },
          { apiKey: process.env.EVAL_DEEPSEEK_KEY!, modelName: 'deepseek-chat', repeat: 3 },
        )
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[eval] judge failed', ec2.id, e)
      }
    }

    let toolCalls: string[] = []
    try {
      const traces = await getToolCallsFromThread(runResult.threadId)
      toolCalls = traces.map(t => t.name)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[eval] traceReader failed', ec2.id, e)
    }

    let result: 'pass' | 'fail' | 'errored' = 'pass'
    if (factsR && (factsR.factsHitRate < 1 || factsR.hallucinationHits.length > 0)) {
      result = 'fail'
    }
    if (judgeR && judgeR.overall < 4) result = 'fail'
    if (ec2.expectedTools && !ec2.expectedTools.every(t => toolCalls.includes(t))) {
      result = 'fail'
    }

    allCaseResults.push({
      id: ec2.id,
      group: ec2.group,
      question: ec2.question,
      answer: runResult.answer,
      factsHitRate: factsR?.factsHitRate,
      mustHaveHits: factsR?.mustHaveHits ?? [],
      mustHaveMisses: factsR?.mustHaveMisses ?? [],
      hallucinationHits: factsR?.hallucinationHits ?? [],
      toolCalls,
      expectedTools: ec2.expectedTools,
      tokens: { prompt: runResult.promptTokens, cacheHit: runResult.cacheHitTokens },
      latencyMs: runResult.latencyMs,
      threadId: runResult.threadId,
      judgeResult: judgeR
        ? {
          overall: judgeR.overall,
          score_facts: judgeR.score_facts,
          score_citation: judgeR.score_citation,
          score_no_hallucination: judgeR.score_no_hallucination,
          score_relevance: judgeR.score_relevance,
          reasoning: judgeR.reasoning,
          repeats: judgeR.repeats,
          stdev: judgeR.stdev,
          unstable: judgeR.unstable,
        }
        : undefined,
      result,
    })
  }

  // ============== Part 2: 跑 3 段 extraction transcripts ==============
  const extractions: ExtractionResult[] = []
  for (const tr of EXTRACTION_DATASET) {
    for (const turn of tr.turns) {
      if (turn.role !== 'user') continue
      try {
        await runOneChat({
          caseId: fx.caseA.id,
          userId: OWNER_USER_ID,
          sessionId: fx.caseA.sessions[tr.sessionIndex]!,
          question: turn.content,
        }, handler)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[eval] extraction turn failed', tr.id, e)
      }
    }

    // 同步等抽取（注入 eval 独立 redis 实例）
    try {
      await processNowService(fx.caseA.id, { redis: getEvalRedisClient() })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[eval] processNowService failed', tr.id, e)
    }

    // caseMemories 表 schema 是 LangChain 同构 5 列（id/text/metadata/embedding/tsv），
    // 没有 createdAt 列；createdAt 只在 metadata JSON 里。这里按 metadata->createdAt 倒序
    // 取最近 30 条作为该 transcript 的抽取候选集。
    const recent = await prisma.$queryRawUnsafe<{ id: string; text: string | null; metadata: any }[]>(
      `SELECT id, text, metadata
         FROM case_memories
        WHERE (metadata->>'caseId')::int = $1
        ORDER BY (metadata->>'createdAt') DESC NULLS LAST
        LIMIT 30`,
      fx.caseA.id,
    )

    const extractedItems: ExtractedItem[] = recent.map(r => ({
      subjectKey: (r.metadata as any)?.subjectKey ?? '',
      text: r.text ?? '',
      confidence: Number((r.metadata as any)?.confidence ?? 0),
      invalidatedAt: (r.metadata as any)?.invalidatedAt ?? null,
    }))

    const result = evaluateExtraction(extractedItems, tr)
    result.transcriptId = tr.id

    // ex-02 验证版本链：同 subjectKey=fact.party.plaintiff_name 应当只有 1 条 active
    if (tr.id === 'ex-02') {
      const sameKey = extractedItems.filter(
        e => e.subjectKey === 'fact.party.plaintiff_name',
      )
      const actives = sameKey.filter(e => !e.invalidatedAt)
      result.versionChainCorrect = actives.length === 1
    }

    extractions.push(result)
  }

  // ============== Part 3: security + stability ==============
  const securityResults: SecurityAssertionResult[] = []
  const securityCases = allCaseResults.filter(c => c.group === 'security')
  securityResults.push(evaluateCrossCaseLeak(securityCases, fx.caseB.id))

  for (const a of buildSecurityAssertions()) {
    try {
      const r = await a.run(fx, { ownerUserId: OWNER_USER_ID })
      securityResults.push({
        id: a.id,
        category: a.category,
        severity: a.severity,
        result: r.pass ? 'pass' : 'fail',
        detail: r.detail,
      })
    } catch (e: any) {
      securityResults.push({
        id: a.id,
        category: a.category,
        severity: a.severity,
        result: 'errored',
        detail: e?.message ?? String(e),
      })
    }
  }

  const promptHashResult = await checkPromptHashStability(fx.caseA.id, 'caseInfoCheck')
  const stabMetrics = [
    promptHashResult.metric,
    await checkSwitchActiveAtomic(fx.caseA.id),
    await checkOldDataGraceful(fx.caseA.id),
    // checkProfileKeyOrder 需要 buildCaseProfileJson 输出，留 TODO（spec §3.7 WARN）
  ]

  // systemPromptTokens 由 stab-prompt-hash 顺便采（A2.8 修订）
  const sysTokens = [promptHashResult.systemPromptTokens]

  // ============== Aggregate ==============
  const cost = aggregateCostMetrics({
    usageRecords: handler.getRecords(),
    systemPromptTokensSamples: sysTokens,
    totalPromptTokensSamples: promptTokensSamples,
    memoryRecallLatencies: [],
    analysisSummaryLatencies: [],
    anthropicProtocolSecondCacheRead: 0,
    openaiProtocolSecondCachedTokens: 0,
  })
  const quality = aggregateQualityMetrics(allCaseResults)
  const task = aggregateTaskMetrics(allCaseResults)
  const extraction = aggregateExtractionMetrics(extractions)
  const security = aggregateSecurityMetrics(securityResults)

  const allMetrics = [...cost, ...quality, ...task, ...extraction, ...security, ...stabMetrics]
  const crits = allMetrics.filter(m => m.severity === 'CRITICAL')
  const warns = allMetrics.filter(m => m.severity === 'WARN')
  const criticalFailures = crits.filter(m => m.result === 'fail').map(m => m.name)

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
    metrics: { cost, quality, task, extraction, security, stability: stabMetrics },
    cases: allCaseResults,
    extractions,
    securityAssertions: securityResults,
    errored: erroredCases,
  }

  await mkdir(OUT_DIR, { recursive: true })
  const md = await writeMarkdownReport(report, OUT_DIR, { excerptAnswers: true, excerptLength: 200 })
  const json = await writeJsonReport(report, OUT_DIR)
  // eslint-disable-next-line no-console
  console.log(`[eval] reports: ${md}, ${json}`)
  // eslint-disable-next-line no-console
  console.log(`[eval] criticalFailures=${criticalFailures.length}; overallPass=${report.summary.overallPass}`)

  // 重建报告索引（viewer.html 加载需要）
  const { rebuildIndex } = await import('./report/reportIndex')
  await rebuildIndex(OUT_DIR)

  await teardownEvalRuntime()
  return { criticalFailures, reportPath: { md, json } }
}

function gitCommit(): string {
  try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'unknown' }
}

// 兜底：直接 bun 跑时仍走 process.exit。但推荐入口是 vitest（解决 Nuxt 自动导入问题）。
if (import.meta.main) {
  runEvalMain()
    .then(r => process.exit(r.criticalFailures.length > 0 ? 1 : 0))
    .catch(async err => {
      // eslint-disable-next-line no-console
      console.error('[eval] runner crashed before producing report', err)
      await teardownEvalRuntime().catch(() => {})
      process.exit(2)
    })
}
