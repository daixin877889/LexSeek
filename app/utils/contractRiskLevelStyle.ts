/**
 * 风险等级配色集中维护（UI-L1）。
 *
 * 之前 RiskListPanel 与 ContractDocxPreview 各自维护一份 high/medium/low 映射，
 * 一处用 bg-red-500（实色徽章）、另一处用 bg-red-50（浅底文档高亮）；同义但
 * 散落两处易漂移。统一收口到这里：
 *
 * - RISK_LEVEL_BADGE_CLASS：实色徽章（深底白字），用于风险卡片左侧标签
 * - RISK_LEVEL_DOCX_BG_CLASS：浅色底（带 dark mode），用于 docx 预览段落高亮
 *
 * 单测如果要锁配色，进一份这里的映射即可。
 */
import type { RiskLevel } from '#shared/types/contract'
import { ClientRedlineDecision, ClientRedlineDecisionText } from '#shared/types/contract'
import { CheckCircle2Icon, XCircleIcon, CircleDashedIcon, HelpCircleIcon } from 'lucide-vue-next'

export const RISK_LEVEL_BADGE_CLASS: Record<RiskLevel, string> = {
    high: 'bg-red-500 text-white',
    medium: 'bg-orange-500 text-white',
    low: 'bg-slate-400 text-white',
}

/**
 * 客户修订处置徽章配置（图标 + 主题语义色，深色模式自适应）。
 *
 * RiskCard 与 RiskListPanel 原本各维护一份完全相同的映射，散落两处易漂移；
 * 统一收口到这里，两个组件直接 import 复用。
 */
export const CLIENT_REDLINE_BADGE: Record<ClientRedlineDecision, { label: string; icon: unknown; class: string }> = {
    [ClientRedlineDecision.ACCEPTED]: {
        label: ClientRedlineDecisionText[ClientRedlineDecision.ACCEPTED],
        icon: CheckCircle2Icon,
        class: 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400',
    },
    [ClientRedlineDecision.REJECTED]: {
        label: ClientRedlineDecisionText[ClientRedlineDecision.REJECTED],
        icon: XCircleIcon,
        class: 'bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-400',
    },
    [ClientRedlineDecision.UNTOUCHED]: {
        label: ClientRedlineDecisionText[ClientRedlineDecision.UNTOUCHED],
        icon: CircleDashedIcon,
        class: 'bg-muted text-muted-foreground',
    },
    [ClientRedlineDecision.AMBIGUOUS]: {
        label: ClientRedlineDecisionText[ClientRedlineDecision.AMBIGUOUS],
        icon: HelpCircleIcon,
        class: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-400',
    },
}

/**
 * docx 段落风险高亮配色（保留多 class 形式，部分调用方走 classList.add(...) 接口）。
 *
 * 设计（重新设计版）：色彩收敛为「红 / 琥珀 / 蓝」三色相——高=红、中=琥珀、低=蓝，
 * 低风险用冷色与高/中的暖色拉开对比，三档一眼分清。段落基线只铺极淡晕染底
 * （~4.5%，整页近白纸）+ 等级色左竖线 + pl-3 间距。选中/悬停态见下方 FOCUS / HOVER。
 */
export const RISK_LEVEL_DOCX_BG_CLASS: Record<RiskLevel, string[]> = {
    high: ['bg-red-600/[0.045]', 'border-l-4', 'border-red-600', 'pl-3'],
    medium: ['bg-amber-600/[0.05]', 'border-l-4', 'border-amber-600', 'pl-3'],
    low: ['bg-sky-600/[0.045]', 'border-l-4', 'border-sky-600', 'pl-3'],
}

/**
 * 选中（focused）/ 钉住（pinned）态：等级色底色加深 + 一圈内描边强调（不再用亮黄）。
 * bg 带 ! important——段落基线已有 bg-*-600/[0.045]，同为 background-color 需强制覆盖。
 */
export const RISK_LEVEL_DOCX_FOCUS_CLASS: Record<RiskLevel, string[]> = {
    high: ['bg-red-600/[0.1]!', 'ring-1', 'ring-inset', 'ring-red-600/40'],
    medium: ['bg-amber-600/[0.1]!', 'ring-1', 'ring-inset', 'ring-amber-600/40'],
    low: ['bg-sky-600/[0.1]!', 'ring-1', 'ring-inset', 'ring-sky-600/40'],
}

/** 悬停（hovered）态：等级色底色轻微加深，无描边（bg 同样需 ! 覆盖基线） */
export const RISK_LEVEL_DOCX_HOVER_BG: Record<RiskLevel, string> = {
    high: 'bg-red-600/[0.08]!',
    medium: 'bg-amber-600/[0.08]!',
    low: 'bg-sky-600/[0.08]!',
}
