/**
 * 法律法规检索 - 列表/卡片展示辅助
 * 供 LegalList / LegalListMobile / StatusBadge / 检索页共用，避免重复实现
 */
import type { LegalType } from '#shared/types/legal'
import type { LegalListItemWithValidity } from '~/composables/useLegalSearch'
import { formatDate } from '~/utils/formatDate'

/** 状态徽章色调 */
export type BadgeTone = 'info' | 'success' | 'warn' | 'muted'

/** 法律类型 → 徽章色调 */
const TYPE_TONE: Record<LegalType, BadgeTone> = {
    law: 'info',
    regulation: 'success',
    judicial_interp: 'warn',
    guideline: 'muted',
}

/** 获取法律类型徽章色调 */
export const getLegalTypeTone = (type: LegalType): BadgeTone => TYPE_TONE[type] || 'info'

/** 格式化日期（空值返回 '-'） */
export const formatLegalDate = (date: string | Date | null): string =>
    date ? formatDate(date, 'YYYY-MM-DD') : '-'

/** 生效状态三态 */
type ValidityState = 'valid' | 'pending' | 'invalid'

/** 计算生效状态 */
const computeValidityState = (item: LegalListItemWithValidity): ValidityState => {
    const now = new Date()
    const effectiveDate = item.effectiveDate ? new Date(item.effectiveDate) : null
    const invalidDate = item.invalidDate ? new Date(item.invalidDate) : null
    if (invalidDate && invalidDate <= now) return 'invalid'
    if (effectiveDate && effectiveDate > now) return 'pending'
    return 'valid'
}

/** 生效状态 → 标签 */
const VALIDITY_LABEL: Record<ValidityState, string> = {
    valid: '现行有效',
    pending: '尚未生效',
    invalid: '已失效',
}

/** 生效状态 → 徽章色调 */
const VALIDITY_TONE: Record<ValidityState, BadgeTone> = {
    valid: 'success',
    pending: 'info',
    invalid: 'muted',
}

/** 获取生效状态标签 */
export const getValidityLabel = (item: LegalListItemWithValidity): string =>
    VALIDITY_LABEL[computeValidityState(item)]

/** 获取生效状态徽章色调 */
export const getValidityTone = (item: LegalListItemWithValidity): BadgeTone =>
    VALIDITY_TONE[computeValidityState(item)]

/** 解析发文机关（支持全角和半角逗号分隔） */
const parseIssuingAuthorities = (authority: string): string[] =>
    authority.split(/[,，]/).map(s => s.trim()).filter(s => s.length > 0)

/** 格式化发文机关为顿号分隔的单行文本 */
export const formatIssuingAuthorities = (authority: string): string =>
    parseIssuingAuthorities(authority).join('、')
