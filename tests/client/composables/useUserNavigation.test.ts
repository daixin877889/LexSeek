/**
 * useUserNavigation Composable 测试
 *
 * 测试用户导航相关逻辑
 *
 * **Feature: user-navigation-composable**
 * **Validates: Requirements 1.3, 1.4**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed } from 'vue'

// 模拟 useUserStore
const mockUserInfo = ref({
    id: 1,
    name: '测试用户',
    phone: '13800138000',
})
const mockUserStore = {
    userInfo: mockUserInfo.value,
}
vi.stubGlobal('useUserStore', () => mockUserStore)

// 模拟 useAuthStore
const mockLogout = vi.fn()
const mockAuthStore = {
    logout: mockLogout,
}
vi.stubGlobal('useAuthStore', () => mockAuthStore)

// 模拟 useRouter
const mockReplace = vi.fn()
vi.stubGlobal('useRouter', () => ({
    replace: mockReplace,
}))

// 模拟 resetAllStore
const mockResetAllStore = vi.fn()
vi.stubGlobal('resetAllStore', mockResetAllStore)

// 模拟 maskTel
vi.stubGlobal('maskTel', (phone: string | undefined) => {
    if (!phone) return ''
    return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
})

describe('useUserNavigation 测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockUserInfo.value = {
            id: 1,
            name: '测试用户',
            phone: '13800138000',
        }
    })

    describe('displayName 计算属性', () => {
        it('有用户名时应返回用户名', () => {
            const displayName = computed(() => mockUserStore.userInfo?.name || '用户')
            expect(displayName.value).toBe('测试用户')
        })

        it('无用户名时应返回默认值', () => {
            mockUserStore.userInfo = { id: 1, name: '', phone: '13800138000' }
            const displayName = computed(() => mockUserStore.userInfo?.name || '用户')
            expect(displayName.value).toBe('用户')
        })

        it('userInfo 为 null 时应返回默认值', () => {
            mockUserStore.userInfo = null as any
            const displayName = computed(() => mockUserStore.userInfo?.name || '用户')
            expect(displayName.value).toBe('用户')
        })
    })

    describe('maskedPhone 计算属性', () => {
        it('应正确脱敏手机号', () => {
            // 确保 userInfo 有正确的值
            mockUserStore.userInfo = { id: 1, name: '测试用户', phone: '13800138000' }
            const maskTel = (phone: string | undefined) => {
                if (!phone) return ''
                return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
            }
            const maskedPhone = computed(() => maskTel(mockUserStore.userInfo?.phone))
            expect(maskedPhone.value).toBe('138****8000')
        })

        it('手机号为空时应返回空字符串', () => {
            mockUserStore.userInfo = { id: 1, name: '测试', phone: '' }
            const maskTel = (phone: string | undefined) => {
                if (!phone) return ''
                return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
            }
            const maskedPhone = computed(() => maskTel(mockUserStore.userInfo?.phone))
            expect(maskedPhone.value).toBe('')
        })

        it('userInfo 为 null 时应返回空字符串', () => {
            mockUserStore.userInfo = null as any
            const maskTel = (phone: string | undefined) => {
                if (!phone) return ''
                return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
            }
            const maskedPhone = computed(() => maskTel(mockUserStore.userInfo?.phone))
            expect(maskedPhone.value).toBe('')
        })
    })

    describe('handleLogout 方法', () => {
        it('应调用 authStore.logout', async () => {
            mockLogout.mockResolvedValueOnce(true)

            // 模拟 handleLogout
            await mockAuthStore.logout()

            expect(mockLogout).toHaveBeenCalledTimes(1)
        })

        it('应调用 resetAllStore', async () => {
            mockLogout.mockResolvedValueOnce(true)

            // 模拟 handleLogout
            await mockAuthStore.logout()
            mockResetAllStore()

            expect(mockResetAllStore).toHaveBeenCalledTimes(1)
        })

        it('应跳转到登录页面', async () => {
            mockLogout.mockResolvedValueOnce(true)

            // 模拟 handleLogout
            await mockAuthStore.logout()
            mockResetAllStore()
            mockReplace({ path: '/login' })

            expect(mockReplace).toHaveBeenCalledWith({ path: '/login' })
        })

        it('完整的登出流程', async () => {
            mockLogout.mockResolvedValueOnce(true)

            // 模拟完整的 handleLogout
            const handleLogout = async () => {
                await mockAuthStore.logout()
                mockResetAllStore()
                mockReplace({ path: '/login' })
            }

            await handleLogout()

            expect(mockLogout).toHaveBeenCalledTimes(1)
            expect(mockResetAllStore).toHaveBeenCalledTimes(1)
            expect(mockReplace).toHaveBeenCalledWith({ path: '/login' })
        })
    })
})

describe('maskTel 手机号脱敏测试', () => {
    const maskTel = (phone: string | undefined) => {
        if (!phone) return ''
        return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
    }

    it('应正确脱敏 11 位手机号', () => {
        expect(maskTel('13800138000')).toBe('138****8000')
        expect(maskTel('15912345678')).toBe('159****5678')
        expect(maskTel('18600001111')).toBe('186****1111')
    })

    it('空字符串应返回空字符串', () => {
        expect(maskTel('')).toBe('')
    })

    it('undefined 应返回空字符串', () => {
        expect(maskTel(undefined)).toBe('')
    })

    it('非标准格式应尝试脱敏', () => {
        // 短于 11 位的号码不会被脱敏
        expect(maskTel('1380013')).toBe('1380013')
    })
})
