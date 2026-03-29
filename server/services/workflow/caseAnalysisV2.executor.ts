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

    if (params.command) {
        const { Command } = await import('@langchain/langgraph')
        return workflow.stream(
            new Command({ resume: params.command }),
            {
                configurable: { thread_id: params.sessionId },
                streamMode: ['values', 'messages', 'updates'],
                subgraphs: true,
            } as any,
        )
    }

    return workflow.stream(
        {
            sessionId: params.sessionId,
            userId: params.userId,
            caseId: params.caseId,
            selectedModules: params.selectedModules,
        },
        {
            configurable: { thread_id: params.sessionId },
            streamMode: ['values', 'messages', 'updates'],
            subgraphs: true,
        } as any,
    )
}
