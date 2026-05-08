/**
 * 案件主代理（小索）
 *
 * 阶段 8 改造后：runCaseChat 整段 + 模块级 skillsMiddleware 单例已删除。
 * 小索通过 server/agents/case-main/agent.config.ts vertical 走 runtime.ts 标准管道，
 * skillsMw 改由 buildSkillsMiddlewareForNode(nodeConfig.id) 按节点动态构造。
 *
 * 本文件仅保留 getChatThreadState：原 agentWorker 用它检测 interrupt，
 * 但 dummy createAgent 与真实 caseMain 拓扑不一致 → tasks.interrupts 永远空 →
 * run 错标 COMPLETED 引发"刷新页面后模板卡片永久 loading"线上 bug。
 * 现在 agentWorker 已改用 threadState.getPendingInterruptsService（直接读
 * pendingWrites，与 graph schema 解耦），本函数仅用于读 channel_values
 * （如 messages 历史 — channel 不依赖 tasks 拓扑），interrupt 检测不允许复用。
 */

import { createAgent } from 'langchain'
import { getCheckpointer } from '../checkpointer'
import { createChatModel } from '../../node/chatModelFactory'

/**
 * 获取对话式 agent 的 thread state（用于 interrupt 检测）
 *
 * 复用 LangGraph checkpointer，无需真实模型和工具——dummy model 仅用于
 * 满足 createAgent 类型签名，stateReader.getState 不会调用模型。
 */
export async function getChatThreadState(sessionId: string) {
    const checkpointer = await getCheckpointer()

    const dummyModel = createChatModel({
        sdkType: 'openai',
        modelName: 'gpt-4',
        apiKey: 'dummy',
        baseUrl: 'http://localhost',
    })

    const stateReader = createAgent({
        model: dummyModel,
        checkpointer,
    })

    return stateReader.getState({
        configurable: { thread_id: sessionId },
    })
}
