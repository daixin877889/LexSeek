/**
 * 数据序列化工具
 *
 * 提供会员系统数据的序列化和反序列化方法
 */
import dayjs from 'dayjs'
import type {
    MembershipLevelInfo,
    UserMembershipInfo,
    MembershipStatus,
    MembershipLevelStatus,
    UserMembershipSourceType,
} from '#shared/types/membership'

/** 序列化后的会员级别 */
export interface SerializedMembershipLevel {
    id: number
    name: string
    description: string | null
    sortOrder: number
    status: number
}

/** 序列化后的用户会员记录 */
export interface SerializedUserMembership {
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
 * @param level 会员级别数据库记录
 * @returns 序列化后的会员级别
 */
export const serializeMembershipLevel = (
    level: membershipLevels
): SerializedMembershipLevel => {
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
 * @param data 序列化的会员级别数据
 * @returns 会员级别信息
 */
export const deserializeMembershipLevel = (
    data: SerializedMembershipLevel
): MembershipLevelInfo => {
    return {
        id: data.id,
        name: data.name,
        description: data.description,
        sortOrder: data.sortOrder,
        status: data.status as MembershipLevelStatus,
    }
}

/**
 * 序列化用户会员记录
 * @param membership 用户会员数据库记录（包含级别信息）
 * @returns 序列化后的用户会员记录
 */
export const serializeUserMembership = (
    membership: userMemberships & { level: membershipLevels }
): SerializedUserMembership => {
    return {
        id: membership.id,
        userId: membership.userId,
        levelId: membership.levelId,
        levelName: membership.level.name,
        startDate: dayjs(membership.startDate).format('YYYY-MM-DD HH:mm:ss'),
        endDate: dayjs(membership.endDate).format('YYYY-MM-DD HH:mm:ss'),
        autoRenew: membership.autoRenew,
        status: membership.status,
        sourceType: membership.sourceType,
        sourceId: membership.sourceId,
        remark: membership.remark,
    }
}

/**
 * 反序列化用户会员记录
 * @param data 序列化的用户会员数据
 * @returns 用户会员信息
 */
export const deserializeUserMembership = (
    data: SerializedUserMembership
): UserMembershipInfo => {
    return {
        id: data.id,
        userId: data.userId,
        levelId: data.levelId,
        levelName: data.levelName,
        startDate: data.startDate,
        endDate: data.endDate,
        autoRenew: data.autoRenew,
        status: data.status as MembershipStatus,
        sourceType: data.sourceType as UserMembershipSourceType,
        sourceId: data.sourceId,
        remark: data.remark,
    }
}

/**
 * 批量序列化会员级别
 * @param levels 会员级别列表
 * @returns 序列化后的会员级别列表
 */
export const serializeMembershipLevels = (
    levels: membershipLevels[]
): SerializedMembershipLevel[] => {
    return levels.map(serializeMembershipLevel)
}

/**
 * 批量反序列化会员级别
 * @param dataList 序列化的会员级别列表
 * @returns 会员级别信息列表
 */
export const deserializeMembershipLevels = (
    dataList: SerializedMembershipLevel[]
): MembershipLevelInfo[] => {
    return dataList.map(deserializeMembershipLevel)
}

/**
 * 批量序列化用户会员记录
 * @param memberships 用户会员记录列表
 * @returns 序列化后的用户会员记录列表
 */
export const serializeUserMemberships = (
    memberships: (userMemberships & { level: membershipLevels })[]
): SerializedUserMembership[] => {
    return memberships.map(serializeUserMembership)
}

/**
 * 批量反序列化用户会员记录
 * @param dataList 序列化的用户会员记录列表
 * @returns 用户会员信息列表
 */
export const deserializeUserMemberships = (
    dataList: SerializedUserMembership[]
): UserMembershipInfo[] => {
    return dataList.map(deserializeUserMembership)
}

/**
 * 将对象序列化为 JSON 字符串
 * @param data 要序列化的数据
 * @returns JSON 字符串
 */
export const toJSON = <T>(data: T): string => {
    return JSON.stringify(data)
}

/**
 * 从 JSON 字符串反序列化
 * @param json JSON 字符串
 * @returns 反序列化后的对象
 */
export const fromJSON = <T>(json: string): T => {
    return JSON.parse(json) as T
}

/**
 * 序列化往返测试辅助函数
 * 用于验证序列化和反序列化的一致性
 */
export const roundTripMembershipLevel = (
    level: membershipLevels
): MembershipLevelInfo => {
    const serialized = serializeMembershipLevel(level)
    const json = toJSON(serialized)
    const parsed = fromJSON<SerializedMembershipLevel>(json)
    return deserializeMembershipLevel(parsed)
}

export const roundTripUserMembership = (
    membership: userMemberships & { level: membershipLevels }
): UserMembershipInfo => {
    const serialized = serializeUserMembership(membership)
    const json = toJSON(serialized)
    const parsed = fromJSON<SerializedUserMembership>(json)
    return deserializeUserMembership(parsed)
}
