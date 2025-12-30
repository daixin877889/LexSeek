/**
 * 数据序列化属性测试
 *
 * 测试实际的 server/utils/serialization.ts 中的序列化函数
 *
 * **Feature: membership-system**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fc from 'fast-check'
import {
    serializeMembershipLevel,
    deserializeMembershipLevel,
    serializeUserMembership,
    deserializeUserMembership,
    serializeMembershipLevels,
    deserializeMembershipLevels,
    serializeUserMemberships,
    deserializeUserMemberships,
    toJSON,
    fromJSON,
    roundTripMembershipLevel,
    roundTripUserMembership,
    type SerializedMembershipLevel,
    type SerializedUserMembership,
} from '../../../server/utils/serialization'
import { MembershipLevelStatus, MembershipStatus, UserMembershipSourceType } from '#shared/types/membership'
import dayjs from 'dayjs'

// 测试数据库辅助
import { prisma } from '../../../server/utils/db'

/** 测试用的唯一标识前缀 */
const TEST_PREFIX = `serialization_test_${Date.now()}`

/** 测试用户 ID（使用已存在的用户） */
let testUserId: number

/** 测试会员级别 ID */
let testLevelId: number

/** 测试用户会员记录 ID */
let testMembershipId: number

/**
 * Property 13: 数据序列化往返
 *
 * 测试实际的序列化函数
 *
 * **Feature: membership-system, Property 13: 数据序列化往返**
 * **Validates: Requirements 12.1, 12.2, 12.3**
 */
describe('Property 13: 数据序列化往返', () => {
    beforeAll(async () => {
        // 获取一个已存在的用户用于测试
        const existingUser = await prisma.users.findFirst({
            where: { deletedAt: null },
        })
        if (!existingUser) {
            throw new Error('测试需要至少一个用户存在')
        }
        testUserId = existingUser.id

        // 创建测试会员级别
        const level = await prisma.membershipLevels.create({
            data: {
                name: `${TEST_PREFIX}_level`,
                description: '序列化测试级别',
                sortOrder: 999,
                status: MembershipLevelStatus.ENABLED,
            },
        })
        testLevelId = level.id

        // 创建测试用户会员记录
        const membership = await prisma.userMemberships.create({
            data: {
                userId: testUserId,
                levelId: testLevelId,
                startDate: new Date(),
                endDate: dayjs().add(1, 'year').toDate(),
                autoRenew: false,
                status: MembershipStatus.ACTIVE,
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
            },
        })
        testMembershipId = membership.id
    })

    afterAll(async () => {
        // 清理测试数据
        await prisma.userMemberships.deleteMany({
            where: { id: testMembershipId },
        })
        await prisma.membershipLevels.deleteMany({
            where: { name: { startsWith: TEST_PREFIX } },
        })
    })

    describe('会员级别序列化', () => {
        it('序列化后再反序列化应得到等价对象', async () => {
            // 从数据库获取真实的会员级别
            const level = await prisma.membershipLevels.findUnique({
                where: { id: testLevelId },
            })
            expect(level).not.toBeNull()

            // 使用实际的序列化函数
            const serialized = serializeMembershipLevel(level!)
            const json = toJSON(serialized)
            const parsed = fromJSON<SerializedMembershipLevel>(json)
            const deserialized = deserializeMembershipLevel(parsed)

            // 验证等价性
            expect(deserialized.id).toBe(level!.id)
            expect(deserialized.name).toBe(level!.name)
            expect(deserialized.description).toBe(level!.description)
            expect(deserialized.sortOrder).toBe(level!.sortOrder)
            expect(deserialized.status).toBe(level!.status)
        })

        it('roundTripMembershipLevel 应正确工作', async () => {
            const level = await prisma.membershipLevels.findUnique({
                where: { id: testLevelId },
            })
            expect(level).not.toBeNull()

            const result = roundTripMembershipLevel(level!)

            expect(result.id).toBe(level!.id)
            expect(result.name).toBe(level!.name)
        })

        it('批量序列化应保持顺序', async () => {
            // 获取多个会员级别
            const levels = await prisma.membershipLevels.findMany({
                take: 5,
                orderBy: { id: 'asc' },
            })

            if (levels.length === 0) {
                return // 跳过测试如果没有数据
            }

            // 批量序列化
            const serializedList = serializeMembershipLevels(levels)
            const json = toJSON(serializedList)
            const parsedList = fromJSON<SerializedMembershipLevel[]>(json)
            const deserializedList = deserializeMembershipLevels(parsedList)

            // 验证数量和顺序
            expect(deserializedList.length).toBe(levels.length)
            for (let i = 0; i < levels.length; i++) {
                expect(deserializedList[i].id).toBe(levels[i].id)
                expect(deserializedList[i].name).toBe(levels[i].name)
            }
        })
    })

    describe('用户会员记录序列化', () => {
        it('序列化后再反序列化应得到等价对象', async () => {
            // 从数据库获取真实的用户会员记录（包含级别信息）
            const membership = await prisma.userMemberships.findUnique({
                where: { id: testMembershipId },
                include: { level: true },
            })
            expect(membership).not.toBeNull()

            // 使用实际的序列化函数
            const serialized = serializeUserMembership(membership!)
            const json = toJSON(serialized)
            const parsed = fromJSON<SerializedUserMembership>(json)
            const deserialized = deserializeUserMembership(parsed)

            // 验证等价性
            expect(deserialized.id).toBe(membership!.id)
            expect(deserialized.userId).toBe(membership!.userId)
            expect(deserialized.levelId).toBe(membership!.levelId)
            expect(deserialized.levelName).toBe(membership!.level.name)
            expect(deserialized.autoRenew).toBe(membership!.autoRenew)
            expect(deserialized.status).toBe(membership!.status)
            expect(deserialized.sourceType).toBe(membership!.sourceType)
        })

        it('roundTripUserMembership 应正确工作', async () => {
            const membership = await prisma.userMemberships.findUnique({
                where: { id: testMembershipId },
                include: { level: true },
            })
            expect(membership).not.toBeNull()

            const result = roundTripUserMembership(membership!)

            expect(result.id).toBe(membership!.id)
            expect(result.userId).toBe(membership!.userId)
            expect(result.levelName).toBe(membership!.level.name)
        })

        it('日期字段应正确格式化', async () => {
            const membership = await prisma.userMemberships.findUnique({
                where: { id: testMembershipId },
                include: { level: true },
            })
            expect(membership).not.toBeNull()

            const serialized = serializeUserMembership(membership!)

            // 验证日期格式：YYYY-MM-DD HH:mm:ss
            expect(serialized.startDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
            expect(serialized.endDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
        })

        it('批量序列化应保持顺序', async () => {
            // 获取多个用户会员记录
            const memberships = await prisma.userMemberships.findMany({
                take: 5,
                include: { level: true },
                orderBy: { id: 'asc' },
            })

            if (memberships.length === 0) {
                return // 跳过测试如果没有数据
            }

            // 批量序列化
            const serializedList = serializeUserMemberships(memberships)
            const json = toJSON(serializedList)
            const parsedList = fromJSON<SerializedUserMembership[]>(json)
            const deserializedList = deserializeUserMemberships(parsedList)

            // 验证数量和顺序
            expect(deserializedList.length).toBe(memberships.length)
            for (let i = 0; i < memberships.length; i++) {
                expect(deserializedList[i].id).toBe(memberships[i].id)
                expect(deserializedList[i].userId).toBe(memberships[i].userId)
            }
        })
    })

    describe('JSON 序列化边界情况', () => {
        it('空字符串描述应正确处理', async () => {
            // 创建一个描述为空字符串的级别
            const level = await prisma.membershipLevels.create({
                data: {
                    name: `${TEST_PREFIX}_empty_desc`,
                    description: '',
                    sortOrder: 998,
                    status: MembershipLevelStatus.ENABLED,
                },
            })

            try {
                const serialized = serializeMembershipLevel(level)
                const json = toJSON(serialized)
                const parsed = fromJSON<SerializedMembershipLevel>(json)
                const deserialized = deserializeMembershipLevel(parsed)

                expect(deserialized.description).toBe('')
            } finally {
                await prisma.membershipLevels.delete({ where: { id: level.id } })
            }
        })

        it('null 值应正确保留', async () => {
            // 创建一个描述为 null 的级别
            const level = await prisma.membershipLevels.create({
                data: {
                    name: `${TEST_PREFIX}_null_desc`,
                    description: null,
                    sortOrder: 997,
                    status: MembershipLevelStatus.ENABLED,
                },
            })

            try {
                const serialized = serializeMembershipLevel(level)
                const json = toJSON(serialized)
                const parsed = fromJSON<SerializedMembershipLevel>(json)
                const deserialized = deserializeMembershipLevel(parsed)

                expect(deserialized.description).toBeNull()
            } finally {
                await prisma.membershipLevels.delete({ where: { id: level.id } })
            }
        })

        it('特殊字符应正确处理', async () => {
            // 创建包含特殊字符的级别
            const specialName = '测试"特殊\'字符<>&'
            const level = await prisma.membershipLevels.create({
                data: {
                    name: `${TEST_PREFIX}_${specialName}`,
                    description: `描述包含特殊字符：${specialName}`,
                    sortOrder: 996,
                    status: MembershipLevelStatus.ENABLED,
                },
            })

            try {
                const serialized = serializeMembershipLevel(level)
                const json = toJSON(serialized)
                const parsed = fromJSON<SerializedMembershipLevel>(json)
                const deserialized = deserializeMembershipLevel(parsed)

                expect(deserialized.name).toBe(level.name)
                expect(deserialized.description).toBe(level.description)
            } finally {
                await prisma.membershipLevels.delete({ where: { id: level.id } })
            }
        })

        it('布尔值应正确序列化', async () => {
            // 测试 autoRenew 为 true 的情况
            const membershipTrue = await prisma.userMemberships.create({
                data: {
                    userId: testUserId,
                    levelId: testLevelId,
                    startDate: new Date(),
                    endDate: dayjs().add(1, 'month').toDate(),
                    autoRenew: true,
                    status: MembershipStatus.ACTIVE,
                    sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                },
            })

            // 测试 autoRenew 为 false 的情况
            const membershipFalse = await prisma.userMemberships.create({
                data: {
                    userId: testUserId,
                    levelId: testLevelId,
                    startDate: new Date(),
                    endDate: dayjs().add(1, 'month').toDate(),
                    autoRenew: false,
                    status: MembershipStatus.ACTIVE,
                    sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                },
            })

            try {
                // 获取包含级别信息的记录
                const mTrue = await prisma.userMemberships.findUnique({
                    where: { id: membershipTrue.id },
                    include: { level: true },
                })
                const mFalse = await prisma.userMemberships.findUnique({
                    where: { id: membershipFalse.id },
                    include: { level: true },
                })

                // 序列化并验证
                const serializedTrue = serializeUserMembership(mTrue!)
                const serializedFalse = serializeUserMembership(mFalse!)

                const jsonTrue = toJSON(serializedTrue)
                const jsonFalse = toJSON(serializedFalse)

                const parsedTrue = fromJSON<SerializedUserMembership>(jsonTrue)
                const parsedFalse = fromJSON<SerializedUserMembership>(jsonFalse)

                const deserializedTrue = deserializeUserMembership(parsedTrue)
                const deserializedFalse = deserializeUserMembership(parsedFalse)

                expect(deserializedTrue.autoRenew).toBe(true)
                expect(typeof deserializedTrue.autoRenew).toBe('boolean')
                expect(deserializedFalse.autoRenew).toBe(false)
                expect(typeof deserializedFalse.autoRenew).toBe('boolean')
            } finally {
                await prisma.userMemberships.deleteMany({
                    where: { id: { in: [membershipTrue.id, membershipFalse.id] } },
                })
            }
        })
    })

    describe('toJSON 和 fromJSON 工具函数', () => {
        it('toJSON 应正确序列化对象', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        id: fc.integer({ min: 1, max: 10000 }),
                        name: fc.string({ minLength: 1, maxLength: 50 }),
                        value: fc.double({ min: 0, max: 1000, noNaN: true }),
                    }),
                    (obj) => {
                        const json = toJSON(obj)
                        expect(typeof json).toBe('string')
                        // 验证 JSON 是有效的，可以被解析回来
                        const parsed = fromJSON<typeof obj>(json)
                        expect(parsed.id).toBe(obj.id)
                        expect(parsed.name).toBe(obj.name)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('fromJSON 应正确反序列化字符串', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        id: fc.integer({ min: 1, max: 10000 }),
                        name: fc.string({ minLength: 1, maxLength: 50 }),
                    }),
                    (obj) => {
                        const json = JSON.stringify(obj)
                        const parsed = fromJSON<typeof obj>(json)
                        expect(parsed.id).toBe(obj.id)
                        expect(parsed.name).toBe(obj.name)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('toJSON 和 fromJSON 往返应保持数据一致', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        id: fc.integer({ min: 1, max: 10000 }),
                        name: fc.string({ minLength: 1, maxLength: 50 }),
                        active: fc.boolean(),
                        count: fc.integer({ min: 0, max: 100 }),
                    }),
                    (obj) => {
                        const json = toJSON(obj)
                        const parsed = fromJSON<typeof obj>(json)
                        expect(parsed).toEqual(obj)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
