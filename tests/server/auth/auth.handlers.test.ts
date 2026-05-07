/**
 * server/api/v1/auth/** handler 单元覆盖
 *
 * 覆盖 5 个 handler：
 * - login/password.post.ts
 * - login/sms.post.ts
 * - logout.post.ts
 * - register.post.ts
 * - reset-password.ts
 *
 * 策略：vi.mock 打桩所有外部 service / DAO，handler 入口直接 import + 调用。
 * 不打真库，保持测试 ≤ 100ms 单文件。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

// ---- 全部 mock 在 import handler 前装好 ----

vi.mock('~~/server/services/users/users.dao', () => ({
    findUserByPhoneDao: vi.fn(),
    findUserByUsernameDao: vi.fn(),
    findUserByInviteCodeDao: vi.fn(),
    findUserByIdDao: vi.fn(),
    updateUserPasswordDao: vi.fn(),
}))
vi.mock('~~/server/services/users/users.service', () => ({
    createUserService: vi.fn(),
}))
vi.mock('~~/server/services/users/userResponse.service', () => ({
    formatUserResponseService: vi.fn((u: any) => ({
        id: u.id,
        phone: u.phone,
        roles: (u.userRoles ?? []).map((r: any) => r.roleId),
        status: u.status,
    })),
}))
vi.mock('~~/server/services/users/tokenBlacklist.dao', () => ({
    addTokenBlacklistDao: vi.fn(),
}))
vi.mock('~~/server/services/auth/authToken.service', () => ({
    generateAuthTokenService: vi.fn(() => 'jwt-mock'),
    clearAuthCookiesService: vi.fn(),
}))
vi.mock('~~/server/services/sms/smsVerification.service', () => ({
    verifySmsCodeService: vi.fn(),
}))
vi.mock('~~/server/services/security/loginRisk.service', () => ({
    shouldRequirePasswordLoginCaptchaService: vi.fn(async () => ({ requireCaptcha: false, degraded: false })),
    recordPasswordLoginFailureService: vi.fn(),
    clearPasswordLoginFailureService: vi.fn(),
}))
vi.mock('~~/server/services/security/aliyunCaptcha.service', () => ({
    verifyAliyunCaptchaService: vi.fn(async () => ({ success: true })),
}))
vi.mock('~~/server/services/campaign/campaign.service', () => ({
    executeRegisterGiftService: vi.fn(),
    executeInvitationRewardService: vi.fn(),
}))

// prisma 打桩——register.post.ts 内部用 prisma.users.findUnique 检查 username 唯一性
;(globalThis as any).prisma = {
    users: {
        findUnique: vi.fn(async () => null),
    },
}

import { findUserByPhoneDao, findUserByUsernameDao, findUserByInviteCodeDao, findUserByIdDao, updateUserPasswordDao } from '~~/server/services/users/users.dao'
import { createUserService } from '~~/server/services/users/users.service'
import { addTokenBlacklistDao } from '~~/server/services/users/tokenBlacklist.dao'
import { clearAuthCookiesService } from '~~/server/services/auth/authToken.service'
import { verifySmsCodeService } from '~~/server/services/sms/smsVerification.service'
import { shouldRequirePasswordLoginCaptchaService, recordPasswordLoginFailureService } from '~~/server/services/security/loginRisk.service'
import { verifyAliyunCaptchaService } from '~~/server/services/security/aliyunCaptcha.service'

const mFindByPhone = vi.mocked(findUserByPhoneDao)
const mFindByUsername = vi.mocked(findUserByUsernameDao)
const mFindByInviteCode = vi.mocked(findUserByInviteCodeDao)
const mFindById = vi.mocked(findUserByIdDao)
const mUpdatePwd = vi.mocked(updateUserPasswordDao)
const mCreateUser = vi.mocked(createUserService)
const mAddBlacklist = vi.mocked(addTokenBlacklistDao)
const mClearCookies = vi.mocked(clearAuthCookiesService)
const mVerifySms = vi.mocked(verifySmsCodeService)
const mShouldRequireCaptcha = vi.mocked(shouldRequirePasswordLoginCaptchaService)
const mRecordPwdFailure = vi.mocked(recordPasswordLoginFailureService)
const mVerifyCaptcha = vi.mocked(verifyAliyunCaptchaService)

const { default: passwordLoginHandler } = await import('../../../server/api/v1/auth/login/password.post')
const { default: smsLoginHandler } = await import('../../../server/api/v1/auth/login/sms.post')
const { default: logoutHandler } = await import('../../../server/api/v1/auth/logout.post')
const { default: registerHandler } = await import('../../../server/api/v1/auth/register.post')
const { default: resetPasswordHandler } = await import('../../../server/api/v1/auth/reset-password')

const ACTIVE_USER = (overrides: Partial<any> = {}) => ({
    id: 100,
    phone: '13800001111',
    password: 'hashed:correct_password_8',
    status: 1,
    userRoles: [{ roleId: 1 }],
    ...overrides,
})

describe('POST /api/v1/auth/login/password', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mShouldRequireCaptcha.mockResolvedValue({ requireCaptcha: false, degraded: false } as any)
    })

    it('happy path → 返回 token + user', async () => {
        mFindByPhone.mockResolvedValue(ACTIVE_USER() as any)
        const res: any = await passwordLoginHandler(makeEvent({
            body: { phone: '13800001111', password: 'correct_password_8' },
        }) as any)
        expectSuccess(res, d => {
            expect(d.token).toBe('jwt-mock')
            expect(d.user.id).toBe(100)
        })
    })

    it('Zod 校验失败 → 400', async () => {
        const res: any = await passwordLoginHandler(makeEvent({
            body: { phone: '12345', password: 'short' },
        }) as any)
        expectError(res, 400)
    })

    it('用户不存在 → 401 + 记 failure', async () => {
        mFindByPhone.mockResolvedValue(null as any)
        const res: any = await passwordLoginHandler(makeEvent({
            body: { phone: '13800001111', password: 'correct_password_8' },
        }) as any)
        expectError(res, 401, '用户不存在')
        expect(mRecordPwdFailure).toHaveBeenCalled()
    })

    it('用户被禁用 → 401', async () => {
        mFindByPhone.mockResolvedValue(ACTIVE_USER({ status: 0 }) as any)
        const res: any = await passwordLoginHandler(makeEvent({
            body: { phone: '13800001111', password: 'correct_password_8' },
        }) as any)
        expectError(res, 401, '禁用')
    })

    it('未设置密码 → 401', async () => {
        mFindByPhone.mockResolvedValue(ACTIVE_USER({ password: '' }) as any)
        const res: any = await passwordLoginHandler(makeEvent({
            body: { phone: '13800001111', password: 'correct_password_8' },
        }) as any)
        expectError(res, 401, '短信')
    })

    it('密码错误 → 401', async () => {
        mFindByPhone.mockResolvedValue(ACTIVE_USER({ password: 'hashed:wrong' }) as any)
        const res: any = await passwordLoginHandler(makeEvent({
            body: { phone: '13800001111', password: 'correct_password_8' },
        }) as any)
        expectError(res, 401, '密码错误')
    })

    it('需要验证码但缺失 → 429', async () => {
        mShouldRequireCaptcha.mockResolvedValue({ requireCaptcha: true, degraded: false } as any)
        const res: any = await passwordLoginHandler(makeEvent({
            body: { phone: '13800001111', password: 'correct_password_8' },
        }) as any)
        expectError(res, 429, '安全验证')
    })

    it('需要验证码且校验失败 → 400', async () => {
        mShouldRequireCaptcha.mockResolvedValue({ requireCaptcha: true, degraded: false } as any)
        mVerifyCaptcha.mockResolvedValue({ success: false } as any)
        const res: any = await passwordLoginHandler(makeEvent({
            body: { phone: '13800001111', password: 'correct_password_8', captchaVerifyParam: 'cap-token' },
        }) as any)
        expectError(res, 400, '安全验证失败')
    })
})

describe('POST /api/v1/auth/login/sms', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mVerifySms.mockResolvedValue({ success: true } as any)
    })

    it('happy path → 返回 token + user', async () => {
        mFindByPhone.mockResolvedValue(ACTIVE_USER() as any)
        const res: any = await smsLoginHandler(makeEvent({
            body: { phone: '13800001111', code: '123456' },
        }) as any)
        expectSuccess(res, d => expect(d.token).toBe('jwt-mock'))
    })

    it('Zod 校验失败 → 400', async () => {
        const res: any = await smsLoginHandler(makeEvent({
            body: { phone: 'bad', code: '' },
        }) as any)
        expectError(res, 400)
    })

    it('用户不存在 → 401', async () => {
        mFindByPhone.mockResolvedValue(null as any)
        const res: any = await smsLoginHandler(makeEvent({
            body: { phone: '13800001111', code: '123456' },
        }) as any)
        expectError(res, 401, '不存在')
    })

    it('用户禁用 → 401', async () => {
        mFindByPhone.mockResolvedValue(ACTIVE_USER({ status: 0 }) as any)
        const res: any = await smsLoginHandler(makeEvent({
            body: { phone: '13800001111', code: '123456' },
        }) as any)
        expectError(res, 401, '禁用')
    })

    it('验证码错 → 业务码', async () => {
        mFindByPhone.mockResolvedValue(ACTIVE_USER() as any)
        mVerifySms.mockResolvedValue({ success: false, errorCode: 422, error: '验证码错误' } as any)
        const res: any = await smsLoginHandler(makeEvent({
            body: { phone: '13800001111', code: '123456' },
        }) as any)
        expectError(res, 422, '验证码')
    })
})

describe('POST /api/v1/auth/logout', () => {
    beforeEach(() => vi.clearAllMocks())

    it('无 token → 仅清 cookie 返成功', async () => {
        const res: any = await logoutHandler({ context: { auth: undefined } } as any)
        expectSuccess(res)
        expect(mClearCookies).toHaveBeenCalled()
        expect(mAddBlacklist).not.toHaveBeenCalled()
    })

    it('有 token 无 user → 清 cookie 返成功', async () => {
        const res: any = await logoutHandler({ context: { auth: { token: 'xx' } } } as any)
        expectSuccess(res)
        expect(mAddBlacklist).not.toHaveBeenCalled()
    })

    it('token 已过期 → 直接清 cookie 不入黑名单', async () => {
        const res: any = await logoutHandler({
            context: { auth: { token: 'xx', user: { id: 1, exp: Math.floor(Date.now() / 1000) - 60 } } },
        } as any)
        expectSuccess(res)
        expect(mAddBlacklist).not.toHaveBeenCalled()
    })

    it('正常退出 → 加入黑名单 + 清 cookie', async () => {
        const res: any = await logoutHandler({
            context: { auth: { token: 'xx', user: { id: 1, exp: Math.floor(Date.now() / 1000) + 3600 } } },
        } as any)
        expectSuccess(res)
        expect(mAddBlacklist).toHaveBeenCalled()
        expect(mClearCookies).toHaveBeenCalled()
    })

    it('addTokenBlacklistDao 抛错 → 仍清 cookie 返 400', async () => {
        mAddBlacklist.mockRejectedValueOnce(new Error('db down'))
        const res: any = await logoutHandler({
            context: { auth: { token: 'xx', user: { id: 1, exp: Math.floor(Date.now() / 1000) + 3600 } } },
        } as any)
        expectError(res, 400)
        expect(mClearCookies).toHaveBeenCalled()
    })
})

describe('POST /api/v1/auth/register', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mVerifySms.mockResolvedValue({ success: true } as any)
        mFindByPhone.mockResolvedValue(null as any)
        mFindByUsername.mockResolvedValue(null as any)
        mFindByInviteCode.mockResolvedValue(null as any)
        mCreateUser.mockResolvedValue({ id: 999 } as any)
        mFindById.mockResolvedValue(ACTIVE_USER({ id: 999 }) as any)
    })

    const baseBody = {
        phone: '13800001111',
        code: '123456',
        name: '张三',
        password: 'abc12345',
    }

    it('happy path → 创建用户 + 发 token', async () => {
        const res: any = await registerHandler(makeEvent({ body: baseBody }) as any)
        expectSuccess(res, d => {
            expect(d.token).toBe('jwt-mock')
            expect(d.user.id).toBe(999)
        })
        expect(mCreateUser).toHaveBeenCalled()
    })

    it('Zod 校验失败 → 400', async () => {
        const res: any = await registerHandler(makeEvent({
            body: { phone: '12345', code: '12', name: '', password: '1' },
        }) as any)
        expectError(res, 400)
    })

    it('短信码错误 → 透传业务码', async () => {
        mVerifySms.mockResolvedValue({ success: false, errorCode: 422, error: '验证码错误' } as any)
        const res: any = await registerHandler(makeEvent({ body: baseBody }) as any)
        expectError(res, 422)
    })

    it('用户名重复 → 400', async () => {
        mFindByUsername.mockResolvedValue({ id: 1 } as any)
        const res: any = await registerHandler(makeEvent({
            body: { ...baseBody, username: 'taken_name' },
        }) as any)
        expectError(res, 400, '用户名已存在')
    })

    it('手机号已注册 (active) → 400', async () => {
        mFindByPhone.mockResolvedValue({ status: 1 } as any)
        const res: any = await registerHandler(makeEvent({ body: baseBody }) as any)
        expectError(res, 400, '已注册')
    })

    it('手机号已被禁用 → 400', async () => {
        mFindByPhone.mockResolvedValue({ status: 0 } as any)
        const res: any = await registerHandler(makeEvent({ body: baseBody }) as any)
        expectError(res, 400, '禁用')
    })

    it('createUserService 返回 falsy → 400', async () => {
        mCreateUser.mockResolvedValue(null as any)
        const res: any = await registerHandler(makeEvent({ body: baseBody }) as any)
        expectError(res, 400, '创建用户失败')
    })

    it('findUserByIdDao 找不到 → 400', async () => {
        mFindById.mockResolvedValue(null as any)
        const res: any = await registerHandler(makeEvent({ body: baseBody }) as any)
        expectError(res, 400, '用户不存在')
    })

    it('带邀请码 → 注入 invitedById 并执行邀请奖励', async () => {
        mFindByInviteCode.mockResolvedValue({ id: 555 } as any)
        const res: any = await registerHandler(makeEvent({
            body: { ...baseBody, invitedBy: 'INV1234' },
        }) as any)
        expectSuccess(res)
        const args = mCreateUser.mock.calls[0][0] as any
        expect(args.invitedBy).toBe(555)
    })
})

describe('POST /api/v1/auth/reset-password', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mVerifySms.mockResolvedValue({ success: true } as any)
    })

    it('happy path → 更新密码 + 清 cookie', async () => {
        mFindByPhone.mockResolvedValue(ACTIVE_USER() as any)
        const res: any = await resetPasswordHandler(makeEvent({
            body: { phone: '13800001111', code: '123456', newPassword: 'newpass8' },
            cookies: { test_token: 'old-token' },
        }) as any)
        expectSuccess(res)
        expect(mUpdatePwd).toHaveBeenCalledWith(100, 'hashed:newpass8')
        expect(mClearCookies).toHaveBeenCalled()
    })

    it('Zod 校验失败 → 400', async () => {
        const res: any = await resetPasswordHandler(makeEvent({
            body: { phone: 'bad', code: '', newPassword: '1' },
        }) as any)
        expectError(res, 400)
    })

    it('用户不存在 → 401', async () => {
        mFindByPhone.mockResolvedValue(null as any)
        const res: any = await resetPasswordHandler(makeEvent({
            body: { phone: '13800001111', code: '123456', newPassword: 'newpass8' },
        }) as any)
        expectError(res, 401, '不存在')
    })

    it('用户被禁用 → 401', async () => {
        mFindByPhone.mockResolvedValue(ACTIVE_USER({ status: 0 }) as any)
        const res: any = await resetPasswordHandler(makeEvent({
            body: { phone: '13800001111', code: '123456', newPassword: 'newpass8' },
        }) as any)
        expectError(res, 401, '禁用')
    })

    it('短信码错误 → 业务码透传', async () => {
        mFindByPhone.mockResolvedValue(ACTIVE_USER() as any)
        mVerifySms.mockResolvedValue({ success: false, errorCode: 422, error: '验证码错误' } as any)
        const res: any = await resetPasswordHandler(makeEvent({
            body: { phone: '13800001111', code: '000000', newPassword: 'newpass8' },
        }) as any)
        expectError(res, 422)
    })

    it('cookie 中 token 异常解码不影响主流程', async () => {
        mFindByPhone.mockResolvedValue(ACTIVE_USER() as any)
        ;(globalThis as any).JwtUtil.verifyToken = vi.fn(() => { throw new Error('invalid') })
        const res: any = await resetPasswordHandler(makeEvent({
            body: { phone: '13800001111', code: '123456', newPassword: 'newpass8' },
            cookies: { test_token: 'malformed' },
        }) as any)
        expectSuccess(res)
        expect(mClearCookies).toHaveBeenCalled()
    })
})
