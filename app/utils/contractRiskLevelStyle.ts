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

export const RISK_LEVEL_BADGE_CLASS: Record<RiskLevel, string> = {
    high: 'bg-red-500 text-white',
    medium: 'bg-orange-500 text-white',
    low: 'bg-gray-400 text-white',
}

/**
 * docx 段落风险高亮（保留多 class 形式，部分调用方走 classList.add(...) 接口）。
 * 设计：白纸上用极淡的分级晕染底色（~3% 透明度，接近白、整页不喧宾夺主）+ 醒目
 * 左竖线标等级 + pl-3 让竖线与正文之间留出间距。
 */
export const RISK_LEVEL_DOCX_BG_CLASS: Record<RiskLevel, string[]> = {
    high: ['bg-red-500/[0.03]', 'border-l-4', 'border-red-500', 'pl-3'],
    medium: ['bg-orange-500/[0.03]', 'border-l-4', 'border-orange-500', 'pl-3'],
    low: ['bg-gray-500/[0.03]', 'border-l-4', 'border-gray-400', 'pl-3'],
}
