/**
 * 双重取消公共函数：SSE stop + 查询 runId + 调用 cancel API。
 */
export async function stopActiveRun(sessionId: string): Promise<void> {
    try {
        const runData = await useApiFetch<{ run: { id: string } | null }>(
            `/api/v1/case/analysis/runs/current/${sessionId}`,
        )
        if (runData?.run?.id) {
            await useApiFetch(
                `/api/v1/case/analysis/runs/cancel/${runData.run.id}`,
                { method: 'POST' },
            )
        }
    }
    catch (error) {
        console.error('[stopActiveRun] 取消失败:', error)
    }
}
