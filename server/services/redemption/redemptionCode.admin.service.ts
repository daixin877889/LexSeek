/**
 * 兑换码管理员服务层
 *
 * 提供兑换码管理相关的业务逻辑
 */
import crypto from 'crypto'
import dayjs from 'dayjs'

// 导入 DAO 函数
import {
    bulkCreateRedemptionCodesDao,
    findRedemptionCodesWithFiltersDao,
    findRedemptionCodesForExportDao,
    findRedemptionCodeByIdDao,
    updateRedemptionCodeStatusDao,
} from './redemptionCode.dao'
import { findRedemptionRecordsAdminDao } from './redemptionRecord.dao'

// 导入类型
import {
    RedemptionCodeStatus,
    RedemptionCodeType,
    getRedemptionCodeTypeName,
    getRedemptionCodeStatusName,
} from '#shared/types/redemption'
import type {
    RedemptionCodeAdminInfo,
    RedemptionRecordAdminInfo,
    GenerateCodesParams,
    GenerateCodesResult,
} from '#shared/types/redemption'

// 导入 Prisma 客户端和日志工具
import { prisma } from '../../utils/db'
import { logger } from '../../../shared/utils/logger'

/**
 * 生成唯一的兑换码
 * 格式：XXXXXXXX-XXXXXXXX（16位十六进制字符）
 */
export const generateUniqueCode = (): string => {
    const prefix = crypto.randomBytes(4).toString('hex').toUpperCase()
    const suffix = crypto.randomBytes(4).toString('hex').toUpperCase()
    return `${prefix}-${suffix}`
}

/**
 * 批量生成兑换码
 * @param params 生成参数
 * @returns 生成结果
 */
export const generateRedemptionCodesService = async (
    params: GenerateCodesParams
): Promise<GenerateCodesResult> => {
    const { type, quantity, levelId, duration, pointAmount, expiredAt, remark } = params

    // 验证数量限制
    if (quantity <= 0 || quantity > 1000) {
        throw new Error('生成数量必须在 1-1000 之间')
    }

    // 验证类型参数完整性
    if (type === RedemptionCodeType.MEMBERSHIP_ONLY || type === RedemptionCodeType.MEMBERSHIP_AND_POINTS) {
        if (!levelId) {
            throw new Error('会员类型兑换码必须指定会员级别')
        }
        if (!duration || duration <= 0) {
            throw new Error('会员类型兑换码必须指定有效时长')
        }
    }

    if (type === RedemptionCodeType.POINTS_ONLY || type === RedemptionCodeType.MEMBERSHIP_AND_POINTS) {
        if (!pointAmount || pointAmount <= 0) {
            throw new Error('积分类型兑换码必须指定积分数量')
        }
    }


    // 根据类型确定需要存储的字段
    const needsMembership = type === RedemptionCodeType.MEMBERSHIP_ONLY || type === RedemptionCodeType.MEMBERSHIP_AND_POINTS
    const needsPoints = type === RedemptionCodeType.POINTS_ONLY || type === RedemptionCodeType.MEMBERSHIP_AND_POINTS

    // 生成兑换码数据
    const codes: string[] = []
    const codesData = []
    const now = new Date()

    for (let i = 0; i < quantity; i++) {
        const code = generateUniqueCode()
        codes.push(code)
        codesData.push({
            code,
            type,
            // 只有需要会员的类型才存储 levelId 和 duration
            levelId: needsMembership ? (levelId || null) : null,
            duration: needsMembership ? (duration || null) : null,
            // 只有需要积分的类型才存储 pointAmount
            pointAmount: needsPoints ? (pointAmount || null) : null,
            expiredAt: expiredAt || null,
            status: RedemptionCodeStatus.ACTIVE,
            remark: remark || null,
            createdAt: now,
            updatedAt: now,
        })
    }

    // 批量创建
    try {
        const count = await bulkCreateRedemptionCodesDao(codesData)
        logger.info(`成功生成 ${count} 个兑换码`, { type, quantity, levelId, duration, pointAmount })
        return { codes, count }
    } catch (error) {
        logger.error('批量生成兑换码失败：', error)
        throw new Error('生成兑换码失败')
    }
}

/**
 * 获取兑换码列表（管理员）
 * @param options 查询选项
 * @returns 分页结果
 */
export const getRedemptionCodesAdminService = async (options: {
    page?: number
    pageSize?: number
    status?: RedemptionCodeStatus
    type?: RedemptionCodeType
    code?: string
    remark?: string
}): Promise<{
    items: RedemptionCodeAdminInfo[]
    total: number
    page: number
    pageSize: number
    totalPages: number
}> => {
    const { page = 1, pageSize = 20 } = options

    const { list, total } = await findRedemptionCodesWithFiltersDao(options)

    const items: RedemptionCodeAdminInfo[] = list.map((item) => ({
        id: item.id,
        code: item.code,
        type: item.type as RedemptionCodeType,
        typeName: getRedemptionCodeTypeName(item.type as RedemptionCodeType),
        levelId: item.levelId,
        levelName: item.level?.name || null,
        duration: item.duration,
        pointAmount: item.pointAmount,
        expiredAt: item.expiredAt ? dayjs(item.expiredAt).format('YYYY-MM-DD HH:mm:ss') : null,
        status: item.status as RedemptionCodeStatus,
        statusName: getRedemptionCodeStatusName(item.status as RedemptionCodeStatus),
        remark: item.remark,
        createdAt: dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss'),
        updatedAt: dayjs(item.updatedAt).format('YYYY-MM-DD HH:mm:ss'),
    }))

    return {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
    }
}


/**
 * 作废兑换码
 * @param id 兑换码 ID
 */
export const invalidateRedemptionCodeService = async (id: number): Promise<void> => {
    // 查询兑换码
    const code = await findRedemptionCodeByIdDao(id)
    if (!code) {
        throw new Error('兑换码不存在')
    }

    // 检查状态
    if (code.status === RedemptionCodeStatus.USED) {
        throw new Error('已使用的兑换码不能作废')
    }

    if (code.status === RedemptionCodeStatus.INVALID) {
        throw new Error('兑换码已经是作废状态')
    }

    // 更新状态为已作废
    await updateRedemptionCodeStatusDao(id, RedemptionCodeStatus.INVALID)
    logger.info(`兑换码已作废: ${code.code}`, { id })
}

/**
 * 获取兑换记录列表（管理员）
 * @param options 查询选项
 * @returns 分页结果
 */
export const getRedemptionRecordsAdminService = async (options: {
    page?: number
    pageSize?: number
    userId?: number
    code?: string
    /** 用户关键词搜索（用户名/姓名/手机号） */
    userKeyword?: string
}): Promise<{
    items: RedemptionRecordAdminInfo[]
    total: number
    page: number
    pageSize: number
    totalPages: number
}> => {
    const { page = 1, pageSize = 20 } = options

    const { list, total } = await findRedemptionRecordsAdminDao(options)

    const items: RedemptionRecordAdminInfo[] = list.map((item) => ({
        id: item.id,
        userId: item.userId,
        userName: item.user.name,
        userPhone: item.user.phone,
        codeId: item.codeId,
        code: item.code.code,
        type: item.code.type as RedemptionCodeType,
        typeName: getRedemptionCodeTypeName(item.code.type as RedemptionCodeType),
        levelName: item.code.level?.name || null,
        duration: item.code.duration,
        pointAmount: item.code.pointAmount,
        createdAt: dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss'),
    }))

    return {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
    }
}

/**
 * 导出兑换码
 * @param options 查询选项
 * @returns CSV 内容
 */
export const exportRedemptionCodesService = async (options: {
    status?: RedemptionCodeStatus
    type?: RedemptionCodeType
    code?: string
    remark?: string
    ids?: number[]
    limit?: number
}): Promise<string> => {
    const { limit = 10000 } = options

    const list = await findRedemptionCodesForExportDao({ ...options, limit })

    // 生成 CSV 内容
    const headers = ['兑换码', '类型', '会员级别', '时长(天)', '积分数量', '状态', '过期时间', '备注', '创建时间']
    const rows = list.map((item) => [
        item.code,
        getRedemptionCodeTypeName(item.type as RedemptionCodeType),
        item.level?.name || '',
        item.duration?.toString() || '',
        item.pointAmount?.toString() || '',
        getRedemptionCodeStatusName(item.status as RedemptionCodeStatus),
        item.expiredAt ? dayjs(item.expiredAt).format('YYYY-MM-DD HH:mm:ss') : '',
        item.remark || '',
        dayjs(item.createdAt).format('YYYY-MM-DD HH:mm:ss'),
    ])

    // 添加 BOM 以支持 Excel 正确识别 UTF-8
    const BOM = '\uFEFF'
    const csv = BOM + [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join('\n')

    return csv
}
