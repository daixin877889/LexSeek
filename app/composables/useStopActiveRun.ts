import { useApiFetch } from '~/composables/useApiFetch'
/**
 * 双重取消公共函数：SSE stop + 查询 runId + 调用 cancel API。
 *
 * 走通用 vertical 无关接口 /api/v1/agent/runs/*,归属只看 user.id,
 * 不再要求 session 挂在案件下。法律助手 / 独立合同 / 独立文书等
 * caseId=null 的会话都能正确停止。
 *
 * 返回 `{ ok, error? }`：
 * - ok=true：没有活跃 run 或 cancel API 成功（幂等：terminal run 也算成功）
 * - ok=false：任一 API 失败；error 含原因
 *
 * spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §7.1
 */
export async function stopActiveRun(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const runData = await useApiFetch<{ run: { id: string } | null }>(
            `/api/v1/agent/runs/current/${sessionId}`,
            { showError: false },
        )
        // 没有活跃 run 视为成功（无需取消）
        if (!runData?.run?.id) {
            return { ok: true }
        }
        await useApiFetch(
            `/api/v1/agent/runs/cancel/${runData.run.id}`,
            { method: 'POST', showError: false },
        )
        return { ok: true }
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '取消失败'
        console.error('[stopActiveRun] 取消失败:', error)
        return { ok: false, error: msg }
    }
}
