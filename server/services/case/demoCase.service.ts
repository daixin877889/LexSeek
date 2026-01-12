/**
 * 示范案例服务层
 *
 * 提供示范案例的业务逻辑封装
 * Requirements: 18.7, 18.8, 18.9, 18.10
 */

import type { demoCases } from '~~/generated/prisma/client'

// 导入 DAO 函数
import {
    createDemoCaseDao,
    findDemoCaseByIdDao,
    findDemoCaseByTitleDao,
    findManyDemoCasesDao,
    findEnabledDemoCasesDao,
    updateDemoCaseDao,
    softDeleteDemoCaseDao,
} from './demoCase.dao'

// 类型从 DAO 导入使用，不再 re-export 以避免 Nuxt 自动导入冲突
// 外部使用时请直接从 demoCase.dao 导入类型

/**
 * 创建示范案例
 * Requirements: 18.8
 */
export const createDemoCaseService = async (
    data: import('./demoCase.dao').CreateDemoCaseInput
): Promise<demoCases> => {
    // 检查标题是否已存在
    const existing = await findDemoCaseByTitleDao(data.title)
    if (existing) {
        throw new Error('示范案例标题已存在')
    }

    return await createDemoCaseDao(data)
}

/**
 * 获取示范案例详情
 */
export const getDemoCaseByIdService = async (
    id: number
): Promise<demoCases | null> => {
    return await findDemoCaseByIdDao(id)
}

/**
 * 获取示范案例列表（分页，后台管理用）
 * Requirements: 18.7
 */
export const getDemoCasesService = async (
    options: import('./demoCase.dao').DemoCaseListParams = {}
): Promise<{ list: demoCases[]; total: number }> => {
    return await findManyDemoCasesDao(options)
}


/**
 * 获取启用的示范案例列表（前台展示用）
 * Requirements: 18.1, 18.2
 */
export const getEnabledDemoCasesService = async (
    caseTypeId?: number
): Promise<demoCases[]> => {
    return await findEnabledDemoCasesDao(caseTypeId)
}

/**
 * 更新示范案例
 * Requirements: 18.9
 */
export const updateDemoCaseService = async (
    id: number,
    data: import('./demoCase.dao').UpdateDemoCaseInput
): Promise<demoCases> => {
    // 检查案例是否存在
    const existing = await findDemoCaseByIdDao(id)
    if (!existing) {
        throw new Error('示范案例不存在')
    }

    // 如果更新标题，检查标题是否已存在
    if (data.title && data.title !== existing.title) {
        const titleExists = await findDemoCaseByTitleDao(data.title)
        if (titleExists) {
            throw new Error('示范案例标题已存在')
        }
    }

    return await updateDemoCaseDao(id, data)
}

/**
 * 更新示范案例状态
 * Requirements: 18.10
 */
export const updateDemoCaseStatusService = async (
    id: number,
    status: number
): Promise<demoCases> => {
    // 检查案例是否存在
    const existing = await findDemoCaseByIdDao(id)
    if (!existing) {
        throw new Error('示范案例不存在')
    }

    return await updateDemoCaseDao(id, { status })
}

/**
 * 删除示范案例（软删除）
 */
export const deleteDemoCaseService = async (id: number): Promise<void> => {
    // 检查案例是否存在
    const existing = await findDemoCaseByIdDao(id)
    if (!existing) {
        throw new Error('示范案例不存在')
    }

    await softDeleteDemoCaseDao(id)
}
