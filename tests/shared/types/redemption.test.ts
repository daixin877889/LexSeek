/**
 * 兑换码辅助函数测试
 *
 * 测试兑换码类型和状态名称获取功能
 *
 * **Feature: redemption-types**
 * **Validates: 兑换码类型和状态辅助函数**
 */

import { describe, it, expect } from 'vitest'
import {
    RedemptionCodeType,
    RedemptionCodeStatus,
    getRedemptionCodeTypeName,
    getRedemptionCodeStatusName,
} from '../../../shared/types/redemption'

describe('getRedemptionCodeTypeName 兑换码类型名称', () => {
    it('应返回 MEMBERSHIP_ONLY 的正确名称', () => {
        expect(getRedemptionCodeTypeName(RedemptionCodeType.MEMBERSHIP_ONLY)).toBe('仅会员')
    })

    it('应返回 POINTS_ONLY 的正确名称', () => {
        expect(getRedemptionCodeTypeName(RedemptionCodeType.POINTS_ONLY)).toBe('仅积分')
    })

    it('应返回 MEMBERSHIP_AND_POINTS 的正确名称', () => {
        expect(getRedemptionCodeTypeName(RedemptionCodeType.MEMBERSHIP_AND_POINTS)).toBe('会员和积分')
    })

    it('未知类型应返回未知', () => {
        expect(getRedemptionCodeTypeName(0)).toBe('未知')
        expect(getRedemptionCodeTypeName(999 as any)).toBe('未知')
        expect(getRedemptionCodeTypeName(-1 as any)).toBe('未知')
    })
})

describe('getRedemptionCodeStatusName 兑换码状态名称', () => {
    it('应返回 ACTIVE 的正确名称', () => {
        expect(getRedemptionCodeStatusName(RedemptionCodeStatus.ACTIVE)).toBe('有效')
    })

    it('应返回 USED 的正确名称', () => {
        expect(getRedemptionCodeStatusName(RedemptionCodeStatus.USED)).toBe('已使用')
    })

    it('应返回 EXPIRED 的正确名称', () => {
        expect(getRedemptionCodeStatusName(RedemptionCodeStatus.EXPIRED)).toBe('已过期')
    })

    it('应返回 INVALID 的正确名称', () => {
        expect(getRedemptionCodeStatusName(RedemptionCodeStatus.INVALID)).toBe('已作废')
    })

    it('未知状态应返回未知', () => {
        expect(getRedemptionCodeStatusName(0)).toBe('未知')
        expect(getRedemptionCodeStatusName(999 as any)).toBe('未知')
        expect(getRedemptionCodeStatusName(-1 as any)).toBe('未知')
    })
})

describe('RedemptionCodeType 枚举值验证', () => {
    it('枚举值应为预期值', () => {
        expect(RedemptionCodeType.MEMBERSHIP_ONLY).toBe(1)
        expect(RedemptionCodeType.POINTS_ONLY).toBe(2)
        expect(RedemptionCodeType.MEMBERSHIP_AND_POINTS).toBe(3)
    })
})

describe('RedemptionCodeStatus 枚举值验证', () => {
    it('枚举值应为预期值', () => {
        expect(RedemptionCodeStatus.ACTIVE).toBe(1)
        expect(RedemptionCodeStatus.USED).toBe(2)
        expect(RedemptionCodeStatus.EXPIRED).toBe(3)
        expect(RedemptionCodeStatus.INVALID).toBe(4)
    })
})
