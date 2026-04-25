/**
 * Eval runner（独立工具脚本，非 server runtime production code）。
 * 允许使用 console 输出进度（已豁免 no-console rule）。
 */
import { assertEvalRuntime, teardownEvalRuntime } from './utils/runtimeGuards'

async function main() {
    try {
        await assertEvalRuntime()
        // eslint-disable-next-line no-console
        console.log('[eval] runtime guards passed: DB + Redis db=15 + EVAL_DEEPSEEK_KEY OK')
        await teardownEvalRuntime()
        process.exit(0)
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[eval] runner crashed before producing report', err)
        await teardownEvalRuntime().catch(() => {})
        process.exit(2)
    }
}

main()
