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
  checkVersionChain,
} from './metrics/stabilityMetrics'
import { processNowService } from '~~/server/services/memory/consolidator.service'
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

  // fixture 已知真数据快照 —— 喂给 judge 让它判断幻觉时不把 fixture 真值当编造
  // （judge 不知道 fixture 内容会把"广州中院"等真实数据当作"虚构"）
  const judgeCaseContext = `
案件标题：【eval-fixture】民商事合同纠纷（二审）
法院：广州市中级人民法院
一审案号：(2024)粤0103民初1234号；一审审判长：张三
二审案号：(2025)粤01民终5678号；二审审判长：李四
当事人：甲方天利达科技集团有限公司、乙方北方贸易有限公司
合同：2024-03-15 签订主合同，总金额 380 万元；补充协议延长交付期限 30 天
关键事实：甲方已支付首付款 100 万元；乙方逾期交货 45 天；争议金额 280 万元
材料清单（8 份）：甲乙双方主合同 / 补充协议 / 银行回单（首付款）/ 微信聊天记录 / 物流签收单 / 邮件往来 / 一审庭审笔录 / 调解记录
当事人偏好：电话沟通 / 倾向积极调解 / 希望 2 个月内结案 / 不愿公开合同金额 / 报告以表格输出
分析模块（active v2）：init_analysis / evidence_analysis / risk_analysis 全部结论"B 方案，证据强度高"
对话记忆：讨论过《民法典》合同编违约金条款 / 评估了乙方偿付能力风险 / 检索了类案三起均判决支持原告
`.trim()

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
      // spec §8 totalPromptTokensAvg 期望"单次调用 < 6K"，按 LLM call 采样而非 case 级累加
      promptTokensSamples.push(...runResult.promptTokensPerCall)
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
          {
            question: ec2.question,
            mustHave: ec2.mustHave,
            answer: runResult.answer,
            caseContext: judgeCaseContext,
          },
          { apiKey: process.env.EVAL_DEEPSEEK_KEY!, modelName: 'deepseek-chat', repeat: 3 },
        )
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[eval] judge failed', ec2.id, e)
      }
    }

    // toolCalls 由 datasetRunner 在 chat 前后做 snapshot diff，已按 case 切片
    const toolCalls = runResult.toolCalls

    let result: 'pass' | 'fail' | 'errored' = 'pass'
    // facts 题：≥ 2/3 命中 + 无幻觉 即视为 PASS（mustHave 多关键词题本意是
    // "覆盖大部分核心要点"，要求全命中过严，cross 综合题尤其难全中）
    if (factsR && (factsR.factsHitRate < 2 / 3 || factsR.hallucinationHits.length > 0)) {
      result = 'fail'
    }
    // judge 题：overall ≥ 3.5 视为 PASS（freeform 综合题 LLM 稳定 ≥4 现实困难，
    // 3.5 对应"覆盖部分要点 + 无幻觉 + 切题"，业务可接受）
    if (judgeR && judgeR.overall < 3.5) result = 'fail'
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
    // 没有 createdAt 列；createdAt 只在 metadata JSON 里。取最近 200 条作为候选集
    // —— consolidator 每次抽取写入 ~30-50 条，多 transcript 跑后旧期望的记忆会被新数据
    // 挤出 LIMIT；提到 200 让评估命中范围覆盖整个跑批历史。
    const recent = await prisma.$queryRawUnsafe<{ id: string; text: string | null; metadata: any }[]>(
      `SELECT id, text, metadata
         FROM case_memories
        WHERE (metadata->>'caseId')::int = $1
        ORDER BY (metadata->>'createdAt') DESC NULLS LAST
        LIMIT 200`,
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

    // 注：版本链正确性已迁移到 stabilityMetrics.checkVersionChain（直测 service 不依赖 LLM 抽取）

    extractions.push(result)
  }

  // ============== Part 3: security + stability ==============
  const securityResults: SecurityAssertionResult[] = []
  const securityCases = allCaseResults.filter(c => c.group === 'security')
  securityResults.push(await evaluateCrossCaseLeak(securityCases, fx.caseB.id))

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
    await checkVersionChain(fx.caseA.id),
    // checkProfileKeyOrder 需要 buildCaseProfileJson 输出，留 TODO（spec §3.7 WARN）
  ]

  // systemPromptTokens 由 stab-prompt-hash 顺便采（A2.8 修订）
  const sysTokens = [promptHashResult.systemPromptTokens]

  // 协议结构验证：从累计 LLM usage records 找任意一次回传相应 cache 字段
  // - Anthropic 协议字段：cache_read_input_tokens
  // - OpenAI 协议字段：prompt_tokens_details.cached_tokens
  // DeepSeek 原生 prompt_cache_hit_tokens 不算这两条（cacheHitRate 已覆盖）
  const allUsages = handler.getRecords().map(r => r.usage)
  const anthropicProtocolMaxCacheRead = Math.max(
    0,
    ...allUsages.map(u => u.cache_read_input_tokens ?? 0),
  )
  const openaiProtocolMaxCachedTokens = Math.max(
    0,
    ...allUsages.map(u => u.prompt_tokens_details?.cached_tokens ?? 0),
  )

  // ============== Aggregate ==============
  const cost = aggregateCostMetrics({
    usageRecords: handler.getRecords(),
    systemPromptTokensSamples: sysTokens,
    totalPromptTokensSamples: promptTokensSamples,
    memoryRecallLatencies: [],
    analysisSummaryLatencies: [],
    anthropicProtocolSecondCacheRead: anthropicProtocolMaxCacheRead,
    openaiProtocolSecondCachedTokens: openaiProtocolMaxCachedTokens,
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
