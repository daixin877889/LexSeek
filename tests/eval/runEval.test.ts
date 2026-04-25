/**
 * Vitest 包装入口 —— 通过 @nuxt/test-utils 自动加载 Nuxt 自动导入魔法
 * （MembershipStatus / CaseStatus / prisma / logger / useRuntimeConfig 等）。
 *
 * 用法：
 *   DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?...' \
 *     EVAL_DEEPSEEK_KEY=sk-xxx \
 *     npx vitest run tests/eval/runEval.test.ts
 *
 * 不挂常规 vitest 全量套件（不在 tests/server 下），手动跑或通过 package.json 的 eval:context script。
 */
// 在 worker 进程显式加载 .env.testing（vitest 主进程加载不会传到 worker）
import { config as dotenvConfig } from 'dotenv'
import { resolve } from 'node:path'
dotenvConfig({ path: resolve(process.cwd(), '.env.testing') })

import { describe, it, expect, vi } from 'vitest'
import { runEvalMain } from './runEval'

// Vitest 4：在 describe 内 setConfig（it 不再接受第 3 参数 options，describe 第 3 参数也不再接受）
describe('Context Governance Eval（端到端）', () => {
  vi.setConfig({ testTimeout: 25 * 60 * 1000 })  // 25 分钟（真 LLM 调用预算）

  it('runEvalMain 完整跑批（fixture seed + 29 提问 + 3 段抽取 + 6 安全 + 4 稳定）', async () => {
    const result = await runEvalMain()
    expect(result.reportPath.md).toMatch(/\.md$/)
    expect(result.reportPath.json).toMatch(/\.json$/)
    // 不断言 criticalFailures.length === 0：首跑预期含已知业务缺陷（见 README）
  })
})
