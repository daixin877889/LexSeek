/**
 * 业务面板共享 toolMap：法律助手 / 小索 / 合同审查面板都把这套子代理工具结果卡
 * 注入给 AiChat 让 AiToolRenderer 命中后渲染对应卡片。
 *
 * 2026-05-05 重构后：draft_document 拆成 recommend_template / save_document_draft /
 * update_document_draft 三个无会话纯函数。
 * - save_document_draft 复用 DraftDocumentCard(输出字段 title/summary/href 对齐)
 * - recommend_template 同时走 interrupt 卡片(active 期间)与 RecommendTemplateCard
 *   (历史会话回放兜底——resolvedInterrupts 仅内存,刷新就清空,卡片落到 toolMap)
 * - update_document_draft 暂不渲染专用卡(默认 AiToolRenderer 兜底)
 */

import type { Component } from 'vue'
import AgentsDocumentDraftDocumentCard from '~/components/agents/document/tools/DraftDocumentCard.vue'
import AgentsDocumentRecommendTemplateCard from '~/components/agents/document/tools/RecommendTemplateCard.vue'
import AgentsContractReviewContractCard from '~/components/agents/contract/tools/ReviewContractCard.vue'

export const PANEL_TOOL_MAP: Record<string, Component> = {
    recommend_template: AgentsDocumentRecommendTemplateCard,
    save_document_draft: AgentsDocumentDraftDocumentCard,
    review_contract: AgentsContractReviewContractCard,
}
