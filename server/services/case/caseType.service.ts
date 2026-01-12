/**
 * 案件类型服务层
 *
 * 提供案件类型的业务逻辑封装
 * Requirements: 11.1
 */

import type { caseTypes } from '~~/generated/prisma/client'

// 导入 DAO 函数
import {
    createCaseTypeDao,
    findCaseTypeByIdDao,
    findCaseTypeByNameDao,
    findManyCaseTypesDao,
    findEnabledCaseTypesDao,
    updateCaseTypeDao,
    softDeleteCaseTypeDao,
    checkCaseTypeInUseDao,
} from './caseType.dao'

// 类型从 DAO 导入使用，不再 re-export 以避免 Nuxt 自动导入冲突
// 外部使用时请直接从 caseType.dao 导入类型

/**
 * 创建案件类型
 * Requirements: 11.1
 */
export const createCaseTypeService = async (
    data: import('./caseType.dao').CreateCaseTypeInput
): Promise<caseTypes> => {
    // 检查名称是否已存在
    const existing = await findCaseTypeByNameDao(data.name)
    if (existing) {
        throw new Error('案件类型名称已存在')
    }

    return await createCaseTypeDao(data)
}

/**
 * 获取案件类型详情
 */
export const getCaseTypeByIdService = async (
    id: number
): Promise<caseTypes | null> => {
    return await findCaseTypeByIdDao(id)
}

/**
 * 获取案件类型列表（分页，后台管理用）
 * Requirements: 11.1
 */
export const getCaseTypesService = async (
    options: import('./caseType.dao').CaseTypeListParams = {}
): Promise<{ list: caseTypes[]; total: number }> => {
    return await findManyCaseTypesDao(options)
}


/**
 * 获取启用的案件类型列表（前台展示用）
 * Requirements: 11.1
 */
export const getEnabledCaseTypesService = async (): Promise<caseTypes[]> => {
    return await findEnabledCaseTypesDao()
}

/**
 * 更新案件类型
 * Requirements: 11.1
 */
export const updateCaseTypeService = async (
    id: number,
    data: import('./caseType.dao').UpdateCaseTypeInput
): Promise<caseTypes> => {
    // 检查类型是否存在
    const existing = await findCaseTypeByIdDao(id)
    if (!existing) {
        throw new Error('案件类型不存在')
    }

    // 如果更新名称，检查名称是否已存在
    if (data.name && data.name !== existing.name) {
        const nameExists = await findCaseTypeByNameDao(data.name)
        if (nameExists) {
            throw new Error('案件类型名称已存在')
        }
    }

    return await updateCaseTypeDao(id, data)
}

/**
 * 更新案件类型状态
 * Requirements: 11.1
 */
export const updateCaseTypeStatusService = async (
    id: number,
    status: number
): Promise<caseTypes> => {
    // 检查类型是否存在
    const existing = await findCaseTypeByIdDao(id)
    if (!existing) {
        throw new Error('案件类型不存在')
    }

    return await updateCaseTypeDao(id, { status })
}

/**
 * 删除案件类型（软删除）
 * Requirements: 11.1
 */
export const deleteCaseTypeService = async (id: number): Promise<void> => {
    // 检查类型是否存在
    const existing = await findCaseTypeByIdDao(id)
    if (!existing) {
        throw new Error('案件类型不存在')
    }

    // 检查是否被使用
    const inUse = await checkCaseTypeInUseDao(id)
    if (inUse) {
        throw new Error('该案件类型正在被使用，无法删除')
    }

    await softDeleteCaseTypeDao(id)
}
