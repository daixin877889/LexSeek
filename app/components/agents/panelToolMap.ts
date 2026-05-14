/**
 * 业务面板共享 toolMap：通用问答 / 小索 / 合同审查面板都把这套子代理工具结果卡
 * 注入给 AiChat 让 AiToolRenderer 命中后渲染对应卡片。
 *
 * 2026-05-05 重构后：draft_document 拆成 recommend_template / save_document_draft /
 * update_document_draft 三个无会话纯函数,三个工具卡均覆盖"历史会话刷新后兜底"
 * 场景(resolvedInterrupts 仅内存,刷新就清空,卡片落到 toolMap)。
 * - save_document_draft  → DraftDocumentCard(完成态显示文书名 + 在文书页继续编辑)
 * - recommend_template   → RecommendTemplateCard(完成态显示已选模板 + 字段数)
 * - update_document_draft → UpdateDocumentDraftCard(完成态显示更新字段名列表)
 */

import type { Component } from 'vue'
import AgentsDocumentDraftDocumentCard from '~/components/agents/document/tools/DraftDocumentCard.vue'
import AgentsDocumentRecommendTemplateCard from '~/components/agents/document/tools/RecommendTemplateCard.vue'
import AgentsDocumentUpdateDocumentDraftCard from '~/components/agents/document/tools/UpdateDocumentDraftCard.vue'
import AgentsContractReviewContractCard from '~/components/agents/contract/tools/ReviewContractCard.vue'
import AiToolsCalculatorResultCard from '~/components/ai/tools/CalculatorResultCard.vue'

export const PANEL_TOOL_MAP: Record<string, Component> = {
    recommend_template: AgentsDocumentRecommendTemplateCard,
    save_document_draft: AgentsDocumentDraftDocumentCard,
    update_document_draft: AgentsDocumentUpdateDocumentDraftCard,
    review_contract: AgentsContractReviewContractCard,
    calculate_compensation: AiToolsCalculatorResultCard,
    calculate_interest: AiToolsCalculatorResultCard,
    calculate_delay_interest: AiToolsCalculatorResultCard,
    calculate_court_fee: AiToolsCalculatorResultCard,
    calculate_lawyer_fee: AiToolsCalculatorResultCard,
    calculate_overtime_pay: AiToolsCalculatorResultCard,
    calculate_social_insurance_backpay: AiToolsCalculatorResultCard,
    calculate_divorce_property: AiToolsCalculatorResultCard,
    calculate_date: AiToolsCalculatorResultCard,
    query_bank_rate: AiToolsCalculatorResultCard,
}
