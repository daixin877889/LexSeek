/**
 * 案件模块测试环境设置
 *
 * 模拟 Nuxt 自动导入的全局变量，使 DAO/Service 函数能在测试环境中运行
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 1.1, 2.1**
 */

import { getTestPrisma, resetDatabaseSequences } from './test-db-helper'

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

// 在测试开始前重置数据库序列
resetDatabaseSequences().catch(err => {
    console.warn('全局序列重置失败：', err)
})

    // 导出状态常量（模拟 Nuxt 自动导入）
    ; (globalThis as any).CaseStatus = {
        IN_PROGRESS: 1,
        COMPLETED: 2,
        CLOSED: 3,
    }

    ; (globalThis as any).SessionStatus = {
        IN_PROGRESS: 1,
        COMPLETED: 2,
        INTERRUPTED: 3,
        FAILED: 4,
    }

    ; (globalThis as any).MaterialStatus = {
        PENDING: 1,
        PROCESSING: 2,
        COMPLETED: 3,
        FAILED: 4,
    }

    ; (globalThis as any).MaterialType = {
        TEXT: 1,
        DOCUMENT: 2,
        IMAGE: 3,
        AUDIO: 4,
    }

    ; (globalThis as any).AnalysisStatus = {
        IN_PROGRESS: 1,
        COMPLETED: 2,
        FAILED: 3,
    }

    ; (globalThis as any).CaseTypeStatus = {
        DISABLED: 0,
        ENABLED: 1,
    }

export { mockLogger }
