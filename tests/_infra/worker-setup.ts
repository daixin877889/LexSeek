/**
 * Worker 级 setupFiles（每个 vitest worker 进程加载一次）
 *
 * 职责：
 *   1. 加载 .env.testing
 *   2. 创建 worker 专属 PrismaClient（连接到 ls_test_w<id>）
 *   3. 在加载业务代码前注入 globalThis.prisma —— 让 server/utils/db.ts 的
 *      `globalForPrisma.prisma ?? prismaClientSingleton()` 拿到 worker 实例
 *   4. 注入 logger / localStorage / 14 个枚举常量（保留原 test-setup.ts 行为）
 */
import { resolve } from 'node:path'
import { config } from 'dotenv'
import { createRequire } from 'node:module'
import { getWorkerPrisma } from './worker-prisma'

const ROOT = resolve(__dirname, '../..')
config({ path: resolve(ROOT, '.env.testing') })

// ==================== 重写 DATABASE_URL 指向当前 worker DB ====================
// dotenv 默认不覆盖已设置的 env，所以即使后续测试代码再次 dotenv.config 也不会改回来。
// 这样保证：
//   1. 业务代码 import '~~/server/utils/db' → 拿到 globalThis.prisma（worker 实例）
//   2. 少数测试自建 PrismaPg + 读 process.env.DATABASE_URL → 自动连到 worker DB
{
    const base = process.env.DATABASE_URL
    if (!base) throw new Error('DATABASE_URL 未在 .env.testing 配置')
    const id = process.env.VITEST_POOL_ID ?? '1'
    process.env.DATABASE_URL = base.replace(/\/[^/?]+(\?|$)/, `/ls_test_w${id}$1`)
}

// ==================== Nuxt 路径别名（为 require 解析） ====================
const sharedDir = resolve(ROOT, 'shared')
const appDir = resolve(ROOT, 'app')

const reqResolve = createRequire(import.meta.url)
;(reqResolve.resolve as any).define = function (id: string) {
    if (id === '#shared' || id.startsWith('#shared/')) {
        return resolve(sharedDir, id === '#shared' ? '' : id.slice('#shared'.length))
    }
    if (id === '~~' || id.startsWith('~~/')) {
        return resolve(ROOT, id === '~~' ? '' : id.slice('~~'.length))
    }
    if (id === '~' || id.startsWith('~/')) {
        return resolve(appDir, id === '~' ? '' : id.slice('~'.length))
    }
    return id
}

// ==================== 注入 prisma（必须在业务代码 import 之前完成） ====================
;(globalThis as any).prisma = getWorkerPrisma()

// ==================== logger mock ====================
// 14 个测试文件通过 import { mockLogger } from '../membership/test-setup' 引用，
// 那个 shim 文件会从这里 re-export
export const mockLogger = {
    info: (...a: any[]) => console.log('[INFO]', ...a),
    warn: (...a: any[]) => console.warn('[WARN]', ...a),
    error: (...a: any[]) => console.error('[ERROR]', ...a),
    debug: (...a: any[]) => console.debug('[DEBUG]', ...a),
}
;(globalThis as any).logger = mockLogger

// ==================== localStorage mock（node env 没有原生实现） ====================
if (typeof (globalThis as any).localStorage === 'undefined') {
    const storage: Record<string, string> = {}
    ;(globalThis as any).localStorage = {
        getItem: (k: string) => storage[k] ?? null,
        setItem: (k: string, v: string) => { storage[k] = v },
        removeItem: (k: string) => { delete storage[k] },
        clear: () => { for (const k in storage) delete storage[k] },
        length: 0,
        key: (i: number) => Object.keys(storage)[i] ?? null,
    }
}

// ==================== 枚举常量（搬自原 tests/server/membership/test-setup.ts） ====================
;(globalThis as any).MembershipStatus = {
    INACTIVE: 0,
    ACTIVE: 1,
}

;(globalThis as any).MembershipLevelStatus = {
    DISABLED: 0,
    ENABLED: 1,
}

;(globalThis as any).UserMembershipSourceType = {
    REDEMPTION_CODE: 1,
    DIRECT_PURCHASE: 2,
    ADMIN_GIFT: 3,
    ACTIVITY_AWARD: 4,
    TRIAL: 5,
    REGISTRATION_AWARD: 6,
    INVITATION_TO_REGISTER: 7,
    MEMBERSHIP_UPGRADE: 8,
    OTHER: 99,
}

;(globalThis as any).RedemptionCodeStatus = {
    VALID: 1,
    USED: 2,
    EXPIRED: 3,
    INVALID: 4,
}

;(globalThis as any).RedemptionCodeType = {
    MEMBERSHIP_ONLY: 1,
    POINTS_ONLY: 2,
    MEMBERSHIP_AND_POINTS: 3,
}

;(globalThis as any).CampaignType = {
    REGISTER_GIFT: 1,
    INVITATION_REWARD: 2,
    ACTIVITY_REWARD: 3,
}

;(globalThis as any).CampaignStatus = {
    DISABLED: 0,
    ENABLED: 1,
}

;(globalThis as any).PointRecordStatus = {
    VALID: 1,
    MEMBERSHIP_UPGRADE_SETTLEMENT: 2,
    CANCELLED: 3,
}

;(globalThis as any).PointRecordSourceType = {
    MEMBERSHIP_PURCHASE_GIFT: 1,
    DIRECT_PURCHASE: 2,
    EXCHANGE_CODE_GIFT: 3,
    ADMIN_GIFT: 4,
    ACTIVITY_AWARD: 5,
    REGISTER_GIFT: 6,
    INVITATION_TO_REGISTER: 7,
}

;(globalThis as any).ProductType = {
    MEMBERSHIP: 1,
    POINTS: 2,
}

;(globalThis as any).PointConsumptionItemStatus = {
    DISABLED: 0,
    ENABLED: 1,
}

;(globalThis as any).PointConsumptionRecordStatus = {
    INVALID: 0,
    PRE_DEDUCT: 1,
    SETTLED: 2,
}

;(globalThis as any).ImageRecognitionStatus = {
    PENDING: 1,
    COMPLETED: 2,
    FAILED: 3,
}

;(globalThis as any).ImageType = {
    DOC: 'doc',
    PHOTO: 'photo',
}
