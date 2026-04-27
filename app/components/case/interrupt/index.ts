/**
 * 中断处理器组件导出与全局注册
 *
 * 包含五个中断类型的处理器组件：
 * - CaseInfoCheckHandler: 案情信息检查（中断点1）
 * - BasicInfoConfirmHandler: 基本信息确认（中断点2）
 * - ModuleSelectHandler: 模块选择（中断点3）
 * - InsufficientPointsCard: 积分不足（中断点4）
 * - TemplateSelectCard: 文书模板选择（工具卡）
 * - StanceSelectCard: 合同审查立场选择（工具卡）
 */

import { globalInterruptRegistry } from '~/composables/agent-platform/interruptRegistry'

// ── 本地中断处理器 ──
import CaseInfoCheckHandler from './CaseInfoCheckHandler.vue'
import BasicInfoConfirmHandler from './BasicInfoConfirmHandler.vue'
import ModuleSelectHandler from './ModuleSelectHandler.vue'

export { default as CaseInfoCheckHandler } from './CaseInfoCheckHandler.vue'
export { default as BasicInfoConfirmHandler } from './BasicInfoConfirmHandler.vue'
export { default as ModuleSelectHandler } from './ModuleSelectHandler.vue'

// ── 其他中断卡 ──
import InsufficientPointsCard from '~/components/ai/tools/InsufficientPointsCard.vue'

// ── 工具卡（来自专项模块）──
import TemplateSelectCard from '~/components/agents/document/interrupts/TemplateSelectCard.vue'
import StanceSelectCard from '~/components/agents/contract/interrupts/StanceSelectCard.vue'

// ── 自动注册到全局注册表 ──
globalInterruptRegistry.register('case_info_check', CaseInfoCheckHandler)
globalInterruptRegistry.register('basic_info_confirm', BasicInfoConfirmHandler)
globalInterruptRegistry.register('module_select', ModuleSelectHandler)
globalInterruptRegistry.register('insufficient_points', InsufficientPointsCard)
globalInterruptRegistry.register('template_select', TemplateSelectCard, { isToolCard: true })
globalInterruptRegistry.register('stance_select', StanceSelectCard, { isToolCard: true })
