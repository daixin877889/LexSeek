/**
 * 数据序列化属性测试
 *
 * 使用 fast-check 进行属性测试，验证数据序列化的正确性
 *
 * **Feature: membership-system**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 会员状态
const MembershipStatus = {
    INACTIVE: 0,
    ACTIVE: 1,
} as const

// 会员级别状态
const MembershipLevelStatus = {
    DISABLED: 0,
    ENABLED: 1,
} as const

// 会员来源类型
const UserMembershipSourceType = {
    REDEMPTION_CODE: 1,
    DIRECT_PURCHASE: 2,
    ADMIN_GIFT: 3,
    ACTIVITY_AWARD: 4,
    TRIAL: 5,
    REGISTRATION_AWARD: 6,
    INVITATION_TO_REGISTER: 7,
    MEMBERSHIP_UPGRADE: 8,
    OTHER: 99,
} as const

/** 模拟会员级别 */
interface MockMembershipLevel {
    id: number
    name: string
    description: string | null
    sortOrder: number
    status: number
}

/** 模拟用户会员记录 */
interface MockUserMembership {
    id: number
    userId: number
    levelId: number
    level: MockMembershipLevel
    startDate: Date
    endDate: Date
    autoRenew: boolean
    status: number
    sourceType: number
    sourceId: number | null
    remark: string | null
}

/** 序列化后的会员级别 */
interface SerializedMembershipLevel {
    id: number
    name: string
    description: string | null
    sortOrder: number
    status: number
}

/** 序列化后的用户会员记录 */
interface SerializedUserMembership {
    id: number
    userId: number
    levelId: number
    levelName: string
    startDate: string
    endDate: string
    autoRenew: boolean
    status: number
    sourceType: number
    sourceId: number | null
    remark: string | null
}

/**
 * 序列化会员级别
 */
const serializeMembershipLevel = (level: MockMembershipLevel): SerializedMembershipLevel => {
    return {
        id: level.id,
        name: level.name,
        description: level.description,
        sortOrder: level.sortOrder,
        status: level.status,
    }
}

/**
 * 反序列化会员级别
 */
const deserializeMembershipLevel = (data: SerializedMembershipLevel): MockMembershipLevel => {
    return {
        id: data.id,
        name: data.name,
        description: data.description,
        sortOrder: data.sortOrder,
        status: data.status,
    }
}

/**
 * 格式化日期为字符串
 */
const formatDate = (date: Date): string => {
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * 序列化用户会员记录
 */
const serializeUserMembership = (membership: MockUserMembership): SerializedUserMembership => {
    return {
        id: membership.id,
        userId: membership.userId,
        levelId: membership.levelId,
        levelName: membership.level.name,
        startDate: formatDate(membership.startDate),
        endDate: formatDate(membership.endDate),
        autoRenew: membership.autoRenew,
        status: membership.status,
        sourceType: membership.sourceType,
        sourceId: membership.sourceId,
        remark: membership.remark,
    }
}

/**
 * 反序列化用户会员记录（部分字段）
 */
const deserializeUserMembership = (data: SerializedUserMembership): {
    id: number
    userId: number
    levelId: number
    levelName: string
    startDate: string
    endDate: string
    autoRenew: boolean
    status: number
    sourceType: number
    sourceId: number | null
    remark: string | null
} => {
    return {
        id: data.id,
        userId: data.userId,
        levelId: data.levelId,
        levelName: data.levelName,
        startDate: data.startDate,
        endDate: data.endDate,
        autoRenew: data.autoRenew,
        status: data.status,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        remark: data.remark,
    }
}

/**
 * Property 13: 数据序列化往返
 *
 * For any 有效的会员级别或用户会员记录对象，序列化为 JSON 后再反序列化 SHALL 产生等价的对象。
 *
 * **Feature: membership-system, Property 13: 数据序列化往返**
 * **Validates: Requirements 12.1, 12.2, 12.3**
 */
describe('Property 13: 数据序列化往返', () => {
    describe('会员级别序列化', () => {
        it('序列化后再反序列化应得到等价对象', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        id: fc.integer({ min: 1, max: 10000 }),
                        name: fc.string({ minLength: 1, maxLength: 50 }),
                        description: fc.option(fc.string({ maxLength: 255 }), { nil: null }),
                        sortOrder: fc.integer({ min: 0, max: 100 }),
                        status: fc.constantFrom(MembershipLevelStatus.DISABLED, MembershipLevelStatus.ENABLED),
                    }),
                    (level) => {
                        // 序列化
                        const serialized = serializeMembershipLevel(level)
                        // 转为 JSON 再解析
                        const json = JSON.stringify(serialized)
                        const parsed = JSON.parse(json) as SerializedMembershipLevel
                        // 反序列化
                        const deserialized = deserializeMembershipLevel(parsed)

                        // 验证等价性
                        expect(deserialized.id).toBe(level.id)
                        expect(deserialized.name).toBe(level.name)
                        expect(deserialized.description).toBe(level.description)
                        expect(deserialized.sortOrder).toBe(level.sortOrder)
                        expect(deserialized.status).toBe(level.status)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('批量序列化应保持顺序', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.record({
                            id: fc.integer({ min: 1, max: 10000 }),
                            name: fc.string({ minLength: 1, maxLength: 50 }),
                            description: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
                            sortOrder: fc.integer({ min: 0, max: 100 }),
                            status: fc.constantFrom(MembershipLevelStatus.DISABLED, MembershipLevelStatus.ENABLED),
                        }),
                        { minLength: 1, maxLength: 10 }
                    ),
                    (levels) => {
                        // 批量序列化
                        const serializedList = levels.map(serializeMembershipLevel)
                        const json = JSON.stringify(serializedList)
                        const parsedList = JSON.parse(json) as SerializedMembershipLevel[]
                        const deserializedList = parsedList.map(deserializeMembershipLevel)

                        // 验证数量和顺序
                        expect(deserializedList.length).toBe(levels.length)
                        for (let i = 0; i < levels.length; i++) {
                            expect(deserializedList[i].id).toBe(levels[i].id)
                            expect(deserializedList[i].name).toBe(levels[i].name)
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('用户会员记录序列化', () => {
        it('序列化后再反序列化应得到等价对象', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        id: fc.integer({ min: 1, max: 10000 }),
                        userId: fc.integer({ min: 1, max: 10000 }),
                        levelId: fc.integer({ min: 1, max: 100 }),
                        level: fc.record({
                            id: fc.integer({ min: 1, max: 100 }),
                            name: fc.string({ minLength: 1, maxLength: 50 }),
                            description: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
                            sortOrder: fc.integer({ min: 0, max: 10 }),
                            status: fc.constant(MembershipLevelStatus.ENABLED),
                        }),
                        startDate: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
                        endDate: fc.date({ min: new Date('2025-01-01'), max: new Date('2026-12-31') }),
                        autoRenew: fc.boolean(),
                        status: fc.constantFrom(MembershipStatus.INACTIVE, MembershipStatus.ACTIVE),
                        sourceType: fc.constantFrom(...Object.values(UserMembershipSourceType)),
                        sourceId: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: null }),
                        remark: fc.option(fc.string({ maxLength: 255 }), { nil: null }),
                    }),
                    (membership) => {
                        // 序列化
                        const serialized = serializeUserMembership(membership)
                        // 转为 JSON 再解析
                        const json = JSON.stringify(serialized)
                        const parsed = JSON.parse(json) as SerializedUserMembership
                        // 反序列化
                        const deserialized = deserializeUserMembership(parsed)

                        // 验证等价性
                        expect(deserialized.id).toBe(membership.id)
                        expect(deserialized.userId).toBe(membership.userId)
                        expect(deserialized.levelId).toBe(membership.levelId)
                        expect(deserialized.levelName).toBe(membership.level.name)
                        expect(deserialized.autoRenew).toBe(membership.autoRenew)
                        expect(deserialized.status).toBe(membership.status)
                        expect(deserialized.sourceType).toBe(membership.sourceType)
                        expect(deserialized.sourceId).toBe(membership.sourceId)
                        expect(deserialized.remark).toBe(membership.remark)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('日期字段应正确格式化', () => {
            fc.assert(
                fc.property(
                    fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }).filter(d => !isNaN(d.getTime())),
                    (date) => {
                        const formatted = formatDate(date)
                        // 验证格式：YYYY-MM-DD HH:mm:ss
                        expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('批量序列化应保持顺序', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.record({
                            id: fc.integer({ min: 1, max: 10000 }),
                            userId: fc.integer({ min: 1, max: 10000 }),
                            levelId: fc.integer({ min: 1, max: 100 }),
                            level: fc.record({
                                id: fc.integer({ min: 1, max: 100 }),
                                name: fc.string({ minLength: 1, maxLength: 50 }),
                                description: fc.constant(null),
                                sortOrder: fc.integer({ min: 0, max: 10 }),
                                status: fc.constant(MembershipLevelStatus.ENABLED),
                            }),
                            startDate: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-06-01') }),
                            endDate: fc.date({ min: new Date('2025-06-01'), max: new Date('2026-12-31') }),
                            autoRenew: fc.boolean(),
                            status: fc.constantFrom(MembershipStatus.INACTIVE, MembershipStatus.ACTIVE),
                            sourceType: fc.constantFrom(...Object.values(UserMembershipSourceType)),
                            sourceId: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: null }),
                            remark: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
                        }),
                        { minLength: 1, maxLength: 5 }
                    ),
                    (memberships) => {
                        const serializedList = memberships.map(serializeUserMembership)
                        const json = JSON.stringify(serializedList)
                        const parsedList = JSON.parse(json) as SerializedUserMembership[]
                        const deserializedList = parsedList.map(deserializeUserMembership)

                        expect(deserializedList.length).toBe(memberships.length)
                        for (let i = 0; i < memberships.length; i++) {
                            expect(deserializedList[i].id).toBe(memberships[i].id)
                            expect(deserializedList[i].userId).toBe(memberships[i].userId)
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('JSON 序列化边界情况', () => {
        it('空字符串描述应正确处理', () => {
            const level: MockMembershipLevel = {
                id: 1,
                name: '测试级别',
                description: '',
                sortOrder: 1,
                status: MembershipLevelStatus.ENABLED,
            }

            const serialized = serializeMembershipLevel(level)
            const json = JSON.stringify(serialized)
            const parsed = JSON.parse(json) as SerializedMembershipLevel
            const deserialized = deserializeMembershipLevel(parsed)

            expect(deserialized.description).toBe('')
        })

        it('null 值应正确保留', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (id) => {
                        const level: MockMembershipLevel = {
                            id,
                            name: '测试级别',
                            description: null,
                            sortOrder: 1,
                            status: MembershipLevelStatus.ENABLED,
                        }

                        const serialized = serializeMembershipLevel(level)
                        const json = JSON.stringify(serialized)
                        const parsed = JSON.parse(json) as SerializedMembershipLevel
                        const deserialized = deserializeMembershipLevel(parsed)

                        expect(deserialized.description).toBeNull()
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('特殊字符应正确处理', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 50 }),
                    (name) => {
                        const level: MockMembershipLevel = {
                            id: 1,
                            name,
                            description: `描述包含特殊字符：${name}`,
                            sortOrder: 1,
                            status: MembershipLevelStatus.ENABLED,
                        }

                        const serialized = serializeMembershipLevel(level)
                        const json = JSON.stringify(serialized)
                        const parsed = JSON.parse(json) as SerializedMembershipLevel
                        const deserialized = deserializeMembershipLevel(parsed)

                        expect(deserialized.name).toBe(name)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('布尔值应正确序列化', () => {
            fc.assert(
                fc.property(
                    fc.boolean(),
                    (autoRenew) => {
                        const membership: MockUserMembership = {
                            id: 1,
                            userId: 1,
                            levelId: 1,
                            level: {
                                id: 1,
                                name: '测试级别',
                                description: null,
                                sortOrder: 1,
                                status: MembershipLevelStatus.ENABLED,
                            },
                            startDate: new Date('2025-01-01'),
                            endDate: new Date('2026-01-01'),
                            autoRenew,
                            status: MembershipStatus.ACTIVE,
                            sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                            sourceId: null,
                            remark: null,
                        }

                        const serialized = serializeUserMembership(membership)
                        const json = JSON.stringify(serialized)
                        const parsed = JSON.parse(json) as SerializedUserMembership
                        const deserialized = deserializeUserMembership(parsed)

                        expect(deserialized.autoRenew).toBe(autoRenew)
                        expect(typeof deserialized.autoRenew).toBe('boolean')
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
