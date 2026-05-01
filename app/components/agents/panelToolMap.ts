/**
 * 业务面板共享 toolMap：法律助手 / 小索 / 合同审查面板都把这套子代理工具结果卡
 * 注入给 AiChat 让 AiToolRenderer 命中后渲染对应卡片。
 */

import type { Component } from 'vue'
import AgentsDocumentDraftDocumentCard from '~/components/agents/document/tools/DraftDocumentCard.vue'
import AgentsContractReviewContractCard from '~/components/agents/contract/tools/ReviewContractCard.vue'

export const PANEL_TOOL_MAP: Record<string, Component> = {
    draft_document: AgentsDocumentDraftDocumentCard,
    review_contract: AgentsContractReviewContractCard,
}
