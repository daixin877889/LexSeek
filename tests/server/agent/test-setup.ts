/**
 * Agent 模块测试环境设置
 *
 * 模拟 Nuxt 自动导入的全局变量，使 DAO/Service 函数能在测试环境中运行
 */

import { getTestPrisma } from './test-db-helper'

const mockLogger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  debug: (...args: any[]) => console.debug('[DEBUG]', ...args),
}

;(globalThis as any).logger = mockLogger
;(globalThis as any).prisma = getTestPrisma()

export { mockLogger }
