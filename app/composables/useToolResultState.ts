/**
 * 工具结果卡片共享状态机
 *
 * 统一处理 AiToolRenderer 注入的 toolMap 卡片的 4 种基础状态:
 * - running:LLM 还在 stream tool input(input-streaming / input-available)
 * - failed:工具执行失败(output-error / output-denied,或 success === false 且未取消)
 * - completed:工具执行完成且 success === true
 * - idle:其他兜底(还没开始)
 *
 * 工具结果原始 output 可能是 JSON 字符串(LangChain 默认) 或已经反序列化的对象,
 * 卡片层不关心具体格式,统一通过 `result` computed 拿到反序列化后的对象。
 *
 * "已取消"(cancelled)语义只对 interrupt 类工具有意义(如 recommend_template),
 * 由调用方在 result.value.cancelled 上自行判断,本 composable 不引入第五种状态。
 */
import { computed, type ComputedRef } from 'vue'
import type { ExtendedToolState } from '~/components/ai-elements/types'

interface ToolResultProps<TOutput> {
    output?: TOutput | string | null
    state: ExtendedToolState
}

interface ToolResultState<TOutput> {
    result: ComputedRef<TOutput | null>
    isRunning: ComputedRef<boolean>
    isFailed: ComputedRef<boolean>
    isCompleted: ComputedRef<boolean>
}

export function useToolResultState<TOutput extends { success?: boolean }>(
    props: ToolResultProps<TOutput>,
): ToolResultState<TOutput> {
    const result = computed<TOutput | null>(() => {
        const raw = props.output
        if (raw == null) return null
        if (typeof raw === 'string') {
            try { return JSON.parse(raw) as TOutput } catch { return null }
        }
        if (typeof raw === 'object') return raw as TOutput
        return null
    })

    const isRunning = computed(() =>
        props.state === 'input-streaming' || props.state === 'input-available',
    )

    const isFailed = computed(() => {
        if (props.state === 'output-error' || props.state === 'output-denied') return true
        if (result.value?.success === false) return true
        // 工具进入终态(output-available)但 result 为空 → 视为失败兜底
        // 例:stream 顶层错误让 toolPart 跳过工具体直接终结
        if (props.state === 'output-available' && !result.value) return true
        return false
    })

    const isCompleted = computed(() =>
        !isRunning.value && !isFailed.value && result.value?.success === true,
    )

    return { result, isRunning, isFailed, isCompleted }
}
