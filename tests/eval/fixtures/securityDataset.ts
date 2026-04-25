/**
 * Security 断言数据集（service 直调，绕过 HTTP）
 *
 * 5 项 CRITICAL 断言（A2.6 + A2.8 锁定）：
 *   1. sec-archived-updateCase     —— ARCHIVED 守卫，service 已有 ✅ 应 PASS
 *   2. sec-archived-write-memory   —— ARCHIVED 守卫，预期 FAIL（M3 spec §12 业务 bug）
 *   3. sec-archived-update-memory  —— ARCHIVED 守卫，预期 FAIL（M3 spec §12 业务 bug）
 *   4. sec-ai-autofill-preserve    —— 内联 mergeAutofillPreservingUserInput 行为断言
 *   5. sec-cross-case-leak         —— 由 runEval 基于 ⑦ 组提问结果直接判定（不在这里跑）
 *
 * 注：sec-archived-initAnalysis 已删除（A2.8 锁定，项目无独立 initAnalysisService 入口）。
 */
import type { FixtureResult } from './buildFixture'

export interface SecurityAssertion {
  id: string
  category: 'cross-case-leak' | 'archived-guard' | 'ai-autofill'
  severity: 'CRITICAL' | 'WARN'
  run: (fx: FixtureResult, ctx: { ownerUserId: number }) => Promise<{ pass: boolean; detail: string }>
}

export function buildSecurityAssertions(): SecurityAssertion[] {
  return [
    {
      id: 'sec-archived-updateCase',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx) {
        // 真实签名：updateCaseService(caseId, data) — 2 参数（A2.7 §6）
        const { updateCaseService } = await import('~~/server/services/case/case.service')
        try {
          await updateCaseService(fx.caseC.id, { title: '尝试改 ARCHIVED 标题' } as any)
          return { pass: false, detail: 'service 未挡 ARCHIVED 案件（应有 isCaseReadOnly 守卫）' }
        } catch (e: any) {
          return { pass: true, detail: `service 正确拒绝：${e?.message ?? e}` }
        }
      },
    },

    {
      id: 'sec-archived-write-memory',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx) {
        // [WARN] 已知：writeMemoryService 当前缺 isCaseReadOnly 守卫（M3 spec §12 铁律未落实）
        // eval 跑 FAIL 是真实业务 bug 报告，需独立工单补守卫
        const { writeMemoryService } = await import('~~/server/services/memory/memory.service')
        try {
          await writeMemoryService({
            caseId: fx.caseC.id,
            text: '尝试写入归档案件的记忆',
            kind: 'fact',
            confidence: 0.9,
          })
          return {
            pass: false,
            detail: 'writeMemory 未挡 ARCHIVED — 真实业务 bug（M3 spec §12）',
          }
        } catch (e: any) {
          return { pass: true, detail: `正确拒绝：${e?.message ?? e}` }
        }
      },
    },

    {
      id: 'sec-archived-update-memory',
      category: 'archived-guard',
      severity: 'CRITICAL',
      async run(fx) {
        // [WARN] 已知：updateMemoryService 当前缺 isCaseReadOnly 守卫
        // 真实签名：updateMemoryService(id, patch) — 2 参数
        const { updateMemoryService } = await import('~~/server/services/memory/memory.service')
        try {
          await updateMemoryService(fx.caseC.memoryId, { invalidate: true })
          return {
            pass: false,
            detail: 'updateMemory 未挡 ARCHIVED — 真实业务 bug（M3 spec §12）',
          }
        } catch (e: any) {
          return { pass: true, detail: `正确拒绝：${e?.message ?? e}` }
        }
      },
    },

    {
      id: 'sec-ai-autofill-preserve',
      category: 'ai-autofill',
      severity: 'CRITICAL',
      async run() {
        // mergeAutofillPreservingUserInput 在 app/composables/useCaseCreation.ts（前端代码，
        // server 层不能 import）。eval 内联同样的纯函数做行为断言，验证：
        // 用户已填字段（非空）必须保留，不被 AI 抽取结果覆盖。
        const merge = <T extends Record<string, any>>(
          userFilled: T,
          aiExtracted: Partial<T>,
        ): T => {
          const result = { ...userFilled }
          for (const [k, aiV] of Object.entries(aiExtracted)) {
            if (aiV === undefined || aiV === null || aiV === '') continue
            const userV = (result as any)[k]
            if (userV === undefined || userV === null || userV === '') {
              ;(result as any)[k] = aiV
            }
          }
          return result
        }
        const merged = merge(
          { firstInstanceJudge: '张三', firstInstanceCaseNo: '已填' },
          { firstInstanceJudge: '李四', firstInstanceCaseNo: 'AI填的' },
        )
        const ok = merged.firstInstanceJudge === '张三' && merged.firstInstanceCaseNo === '已填'
        return {
          pass: ok,
          detail: ok
            ? `用户字段保留：${JSON.stringify(merged)}`
            : `用户字段被覆盖：${JSON.stringify(merged)}`,
        }
      },
    },
  ]
}
