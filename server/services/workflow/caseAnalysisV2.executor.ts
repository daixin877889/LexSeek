/**
 * caseAnalysisV2 工作流执行器
 *
 * 封装 getCaseAnalysisWorkflow() 调用，返回 SSE ReadableStream
 * 与 initAnalysis.executor 的 startInitAnalysis 接口兼容
 */

import { getCaseAnalysisWorkflow } from './caseAnalysisV2.workflow'

export interface CaseAnalysisV2Params {
    caseId: number
    sessionId: string
    userId: number
    selectedModules: string[]
    command?: unknown
}

export async function startCaseAnalysisV2(params: CaseAnalysisV2Params): Promise<ReadableStream> {
    const workflow = await getCaseAnalysisWorkflow()

    const streamConfig = {
        configurable: { thread_id: params.sessionId },
        streamMode: ['values', 'messages', 'updates'] as const,
        version: 'v2' as const,
        subgraphs: true,
        encoding: 'text/event-stream' as const,
    }

    if (params.command) {
        const { Command } = await import('@langchain/langgraph')
        return workflow.stream(
            new Command({ resume: params.command }),
            streamConfig,
        )
    }

    return workflow.stream(
        {
            userId: params.userId,
            caseId: params.caseId,
            sessionId: params.sessionId,
            selectedModules: params.selectedModules,
        },
        streamConfig,
    )
}
