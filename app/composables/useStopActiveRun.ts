/**
 * 双重取消公共函数：SSE stop + 查询 runId + 调用 cancel API。
 *
 * 返回 `{ ok, error? }`：
 * - ok=true：没有活跃 run 或 cancel API 成功（幂等：terminal run 也算成功）
 * - ok=false：任一 API 失败；error 含原因
 *
 * 调用方（handleStop / deleteSession）可按 ok 选择是否 toast 错误。
 */
export async function stopActiveRun(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const runData = await useApiFetch<{ run: { id: string } | null }>(
            `/api/v1/case/analysis/runs/current/${sessionId}`,
        )
        // 没有活跃 run 视为成功（无需取消）
        if (!runData?.run?.id) {
            return { ok: true }
        }
        await useApiFetch(
            `/api/v1/case/analysis/runs/cancel/${runData.run.id}`,
            { method: 'POST' },
        )
        return { ok: true }
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '取消失败'
        console.error('[stopActiveRun] 取消失败:', error)
        return { ok: false, error: msg }
    }
}
