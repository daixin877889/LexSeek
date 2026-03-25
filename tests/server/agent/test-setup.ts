/**
 * Agent 模块测试环境设置
 *
 * 模拟 Nuxt 自动导入的全局变量，使 DAO/Service 函数能在测试环境中运行
 */

import { vi } from 'vitest'
import { getTestPrisma } from './test-db-helper'

const mockLogger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  debug: (...args: any[]) => console.debug('[DEBUG]', ...args),
}

/** 可变的 runtimeConfig mock，测试中可通过修改此对象来覆盖配置 */
const mockRuntimeConfig = {
  agent: {
    maxConcurrent: 3,
    maxUserConcurrent: 2,
    timeoutMs: 3_600_000,
    heartbeatIntervalMs: 15_000,
    crashThresholdMs: 60_000,
    databaseUrl: '',
  },
  redis: {
    url: 'redis://localhost:6379',
  },
}

vi.stubGlobal('logger', mockLogger)
vi.stubGlobal('prisma', getTestPrisma())
vi.stubGlobal('useRuntimeConfig', () => mockRuntimeConfig)

export { mockLogger, mockRuntimeConfig }
