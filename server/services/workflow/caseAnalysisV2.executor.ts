/**
 * caseAnalysisV2 工作流执行器
 *
 * 封装 getCaseAnalysisWorkflow() 调用，返回 SSE ReadableStream
 */

import { getCaseAnalysisWorkflow } from './caseAnalysisV2.workflow'

export interface CaseAnalysisV2Params {
    sessionId: string
    userId: number
    caseId: number
    selectedModules: string[]
    command?: unknown
}

export async function startCaseAnalysisV2(params: CaseAnalysisV2Params): Promise<ReadableStream> {
    const workflow = await getCaseAnalysisWorkflow()

    const baseConfig = {
        configurable: { thread_id: params.sessionId },
        streamMode: ['values', 'messages', 'updates'] as ['values', 'messages', 'updates'],
        encoding: 'text/event-stream' as const,
    }

    if (params.command) {
        const { Command } = await import('@langchain/langgraph')
        return workflow.stream(
            new Command({ resume: params.command }),
            baseConfig,
        )
    }

    return workflow.stream(
        {
            sessionId: params.sessionId,
            userId: params.userId,
            caseId: params.caseId,
            selectedModules: params.selectedModules,
        },
        baseConfig,
    )
}

/**
 * 获取工作流 thread state（用于检测 interrupt）
 *
 * LangGraph 的 values 流模式不包含 __interrupt__ 数据，
 * 需要在 stream 结束后通过 getState 读取 checkpoint 中的 interrupt 信息
 */
export async function getWorkflowThreadState(sessionId: string) {
    const workflow = await getCaseAnalysisWorkflow()
    return workflow.getState({ configurable: { thread_id: sessionId } })
}
