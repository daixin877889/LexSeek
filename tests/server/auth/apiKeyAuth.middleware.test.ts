/**
 * 鉴权中间件 02.auth · 对外 API（/api/open/**）apiKey 鉴权分支测试
 *
 * 聚焦 apiKey 分支：缺 key / 格式非法 / key 不存在 / 用户被禁用 / 放行并写上下文。
 * 公开 API 列表与用户 DAO 打桩，避免依赖数据库与 RBAC 配置。
 *
 * **Feature: open-api-auth**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectError } from '../_helpers/handler-test'
import { UserStatus } from '#shared/types/user'

vi.mock('../../../server/services/rbac/permission.service', () => ({
    getPublicApiPermissions: vi.fn(),
}))
vi.mock('../../../server/services/users/users.dao', () => ({
    findUserByApiKeyDao: vi.fn(),
    findUserByIdDao: vi.fn(),
}))
vi.mock('../../../server/services/auth/authToken.service', () => ({
    clearAuthCookiesService: vi.fn(),
}))
vi.mock('../../../server/services/users/tokenBlacklist.dao', () => ({
    findTokenBlacklistByTokenDao: vi.fn(),
}))

import { getPublicApiPermissions } from '../../../server/services/rbac/permission.service'
import { findUserByApiKeyDao, findUserByIdDao } from '../../../server/services/users/users.dao'

const mGetPublicApis = vi.mocked(getPublicApiPermissions)
const mFindUserByApiKey = vi.mocked(findUserByApiKeyDao)
const mFindUserById = vi.mocked(findUserByIdDao)

const { default: authMiddleware } = await import('../../../server/middleware/02.auth')

/** 合法 uuid 格式的测试 apiKey */
const VALID_API_KEY = '11111111-1111-4111-8111-111111111111'

/** 构造一个带 method 的 mock 事件 */
function makeAuthEvent(opts: {
    path: string
    method?: string
    headers?: Record<string, string>
    cookies?: Record<string, string>
}) {
    return {
        ...makeEvent({
            url: `http://localhost${opts.path}`,
            headers: opts.headers,
            cookies: opts.cookies,
        }),
        method: opts.method ?? 'POST',
    }
}

describe('02.auth · /api/open/** apiKey 鉴权分支', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 公开 API 列表为空 → /api/open 路径不会被当作公开 API 提前放行
        mGetPublicApis.mockResolvedValue([])
    })

    it('缺少 apikey 请求头 → 401 未提供 API Key', async () => {
        const res = await authMiddleware(makeAuthEvent({ path: '/api/open/legal/search-law' }) as never)
        expectError(res, 401, '未提供 API Key')
        expect(mFindUserByApiKey).not.toHaveBeenCalled()
    })

    it('apikey 格式非法（非 UUID）→ 401，不触达数据库', async () => {
        const res = await authMiddleware(makeAuthEvent({
            path: '/api/open/legal/search-law',
            headers: { apikey: 'not-a-uuid' },
        }) as never)
        expectError(res, 401, 'API Key 无效')
        // 格式不合法直接判定无效，脏输入不应打到数据库
        expect(mFindUserByApiKey).not.toHaveBeenCalled()
    })

    it('apikey 格式合法但查无对应用户 → 401 API Key 无效', async () => {
        mFindUserByApiKey.mockResolvedValue(null)
        const res = await authMiddleware(makeAuthEvent({
            path: '/api/open/legal/search-law',
            headers: { apikey: VALID_API_KEY },
        }) as never)
        expectError(res, 401, 'API Key 无效')
        expect(mFindUserByApiKey).toHaveBeenCalled()
    })

    it('apikey 对应用户已被禁用 → 401 用户被禁用', async () => {
        mFindUserByApiKey.mockResolvedValue({ id: 7, status: UserStatus.INACTIVE })
        const res = await authMiddleware(makeAuthEvent({
            path: '/api/open/legal/search-law',
            headers: { apikey: VALID_API_KEY },
        }) as never)
        expectError(res, 401, '用户被禁用')
    })

    it('有效 apikey → 放行，写入 apikey 类型 auth 上下文与 isOpenApi 标记', async () => {
        mFindUserByApiKey.mockResolvedValue({ id: 42, status: UserStatus.ACTIVE })
        const event = makeAuthEvent({
            path: '/api/open/legal/search-law',
            headers: { apikey: VALID_API_KEY },
        })
        const res = await authMiddleware(event as never)
        // 放行：中间件返回 undefined
        expect(res).toBeUndefined()
        const ctx = event.context as Record<string, unknown> & {
            auth?: { user?: { id: number; roles?: number[] }; type?: string }
            isOpenApi?: boolean
        }
        expect(ctx.auth?.user?.id).toBe(42)
        expect(ctx.auth?.user?.roles).toEqual([])
        expect(ctx.auth?.type).toBe('apikey')
        expect(ctx.isOpenApi).toBe(true)
    })

    it('apikey 分支优先于 JWT：/api/open 路径带 cookie 仍走 apikey，不做 JWT 校验', async () => {
        mFindUserByApiKey.mockResolvedValue({ id: 42, status: UserStatus.ACTIVE })
        const event = makeAuthEvent({
            path: '/api/open/legal/search-law',
            headers: { apikey: VALID_API_KEY },
            cookies: { auth_token: 'some-jwt' },
        })
        const res = await authMiddleware(event as never)
        expect(res).toBeUndefined()
        // 未触发 JWT 路径的用户查询
        expect(mFindUserById).not.toHaveBeenCalled()
        expect((event.context as { isOpenApi?: boolean }).isOpenApi).toBe(true)
    })
})
