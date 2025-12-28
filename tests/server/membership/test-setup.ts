/**
 * 测试环境设置
 *
 * 模拟 Nuxt 自动导入的全局变量，使 DAO/Service 函数能在测试环境中运行
 */

import { getTestPrisma } from './test-db-helper'

// 创建一个简单的 logger 模拟
const mockLogger = {
    info: (...args: any[]) => console.log('[INFO]', ...args),
    warn: (...args: any[]) => console.warn('[WARN]', ...args),
    error: (...args: any[]) => console.error('[ERROR]', ...args),
    debug: (...args: any[]) => console.debug('[DEBUG]', ...args),
}

    // 设置全局变量
    ; (globalThis as any).logger = mockLogger
    ; (globalThis as any).prisma = getTestPrisma()

    // 导出状态常量（模拟 Nuxt 自动导入）
    ; (globalThis as any).MembershipStatus = {
        INACTIVE: 0,
        ACTIVE: 1,
    }

    ; (globalThis as any).MembershipLevelStatus = {
        DISABLED: 0,
        ENABLED: 1,
    }

    ; (globalThis as any).UserMembershipSourceType = {
        REDEMPTION_CODE: 1,
        DIRECT_PURCHASE: 2,
        ADMIN_GIFT: 3,
        ACTIVITY_AWARD: 4,
        TRIAL: 5,
        REGISTRATION_AWARD: 6,
        INVITATION_TO_REGISTER: 7,
        MEMBERSHIP_UPGRADE: 8,
        OTHER: 99,
    }

    ; (globalThis as any).RedemptionCodeStatus = {
        VALID: 1,
        USED: 2,
        EXPIRED: 3,
        INVALID: 4,
    }

    ; (globalThis as any).RedemptionCodeType = {
        MEMBERSHIP_ONLY: 1,
        POINTS_ONLY: 2,
        MEMBERSHIP_AND_POINTS: 3,
    }

    ; (globalThis as any).CampaignType = {
        REGISTER_GIFT: 1,
        INVITATION_REWARD: 2,
        ACTIVITY_REWARD: 3,
    }

    ; (globalThis as any).CampaignStatus = {
        DISABLED: 0,
        ENABLED: 1,
    }

    ; (globalThis as any).PointRecordStatus = {
        VALID: 1,
        MEMBERSHIP_UPGRADE_SETTLEMENT: 2,
        CANCELLED: 3,
    }

    ; (globalThis as any).PointRecordSourceType = {
        MEMBERSHIP_PURCHASE_GIFT: 1,
        DIRECT_PURCHASE: 2,
        EXCHANGE_CODE_GIFT: 3,
        ADMIN_GIFT: 4,
        ACTIVITY_AWARD: 5,
        REGISTER_GIFT: 6,
        INVITATION_TO_REGISTER: 7,
    }

    ; (globalThis as any).ProductType = {
        MEMBERSHIP: 1,
        POINTS: 2,
    }

    ; (globalThis as any).PointConsumptionItemStatus = {
        DISABLED: 0,
        ENABLED: 1,
    }

    ; (globalThis as any).PointConsumptionRecordStatus = {
        PENDING: 0,
        SETTLED: 1,
        CANCELLED: 2,
    }

export { mockLogger }
