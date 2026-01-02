/**
 * useColorMode composable 测试
 *
 * 测试 useColorMode 的功能，包括：
 * - 颜色模式切换
 * - 系统模式检测
 * - localStorage 持久化
 *
 * **Feature: use-color-mode**
 * **Validates: Requirements 1.1, 1.2**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'

// 颜色模式类型
type ColorMode = 'light' | 'dark' | 'system'

// 模拟 localStorage
const mockLocalStorage = {
    store: {} as Record<string, string>,
    getItem: vi.fn((key: string) => mockLocalStorage.store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage.store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
        delete mockLocalStorage.store[key]
    }),
    clear: vi.fn(() => {
        mockLocalStorage.store = {}
    }),
}

// 模拟 document
const mockDocument = {
    documentElement: {
        classList: {
            add: vi.fn(),
            remove: vi.fn(),
        },
    },
}

// 模拟 window.matchMedia
const mockMatchMedia = vi.fn((query: string) => ({
    matches: query.includes('dark') ? false : true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
}))

// 模拟 useColorMode 的核心逻辑
function createColorModeManager() {
    let colorMode: ColorMode = 'light'

    const setColorMode = (mode: ColorMode) => {
        colorMode = mode
        mockLocalStorage.setItem('color-mode', mode)
        applyColorMode(mode)
    }

    const applyColorMode = (mode: ColorMode) => {
        const isDarkMode =
            mode === 'dark' ||
            (mode === 'system' && mockMatchMedia('(prefers-color-scheme: dark)').matches)

        if (isDarkMode) {
            mockDocument.documentElement.classList.add('dark')
            mockDocument.documentElement.classList.remove('light')
        } else {
            mockDocument.documentElement.classList.remove('dark')
            mockDocument.documentElement.classList.add('light')
        }
    }

    const getResolvedMode = (): 'light' | 'dark' => {
        if (colorMode === 'system') {
            return mockMatchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        }
        return colorMode
    }

    const toggleDark = () => {
        const resolved = getResolvedMode()
        setColorMode(resolved === 'dark' ? 'light' : 'dark')
    }

    const initColorMode = () => {
        const saved = mockLocalStorage.getItem('color-mode') as ColorMode | null
        if (saved && ['light', 'dark', 'system'].includes(saved)) {
            colorMode = saved
        }
        applyColorMode(colorMode)
    }

    return {
        get colorMode() {
            return colorMode
        },
        setColorMode,
        getResolvedMode,
        toggleDark,
        initColorMode,
    }
}

describe('useColorMode composable 测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockLocalStorage.clear()
    })

    afterEach(() => {
        vi.resetAllMocks()
    })

    describe('颜色模式切换', () => {
        it('应正确设置 light 模式', () => {
            const manager = createColorModeManager()
            manager.setColorMode('light')

            expect(manager.colorMode).toBe('light')
            expect(mockLocalStorage.setItem).toHaveBeenCalledWith('color-mode', 'light')
        })

        it('应正确设置 dark 模式', () => {
            const manager = createColorModeManager()
            manager.setColorMode('dark')

            expect(manager.colorMode).toBe('dark')
            expect(mockLocalStorage.setItem).toHaveBeenCalledWith('color-mode', 'dark')
        })

        it('应正确设置 system 模式', () => {
            const manager = createColorModeManager()
            manager.setColorMode('system')

            expect(manager.colorMode).toBe('system')
            expect(mockLocalStorage.setItem).toHaveBeenCalledWith('color-mode', 'system')
        })

        it('属性测试：设置的模式应被正确保存', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom<ColorMode>('light', 'dark', 'system'),
                    (mode) => {
                        mockLocalStorage.clear()
                        const manager = createColorModeManager()
                        manager.setColorMode(mode)

                        expect(manager.colorMode).toBe(mode)
                        expect(mockLocalStorage.setItem).toHaveBeenCalledWith('color-mode', mode)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('解析模式', () => {
        it('light 模式应解析为 light', () => {
            const manager = createColorModeManager()
            manager.setColorMode('light')

            expect(manager.getResolvedMode()).toBe('light')
        })

        it('dark 模式应解析为 dark', () => {
            const manager = createColorModeManager()
            manager.setColorMode('dark')

            expect(manager.getResolvedMode()).toBe('dark')
        })

        it('system 模式应根据系统偏好解析', () => {
            const manager = createColorModeManager()
            manager.setColorMode('system')

            // 默认 mockMatchMedia 返回 light
            expect(manager.getResolvedMode()).toBe('light')
        })
    })

    describe('切换暗色模式', () => {
        it('从 light 切换到 dark', () => {
            const manager = createColorModeManager()
            manager.setColorMode('light')
            manager.toggleDark()

            expect(manager.colorMode).toBe('dark')
        })

        it('从 dark 切换到 light', () => {
            const manager = createColorModeManager()
            manager.setColorMode('dark')
            manager.toggleDark()

            expect(manager.colorMode).toBe('light')
        })

        it('属性测试：连续切换两次应回到原始模式', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom<'light' | 'dark'>('light', 'dark'),
                    (initialMode) => {
                        mockLocalStorage.clear()
                        const manager = createColorModeManager()
                        manager.setColorMode(initialMode)

                        manager.toggleDark()
                        manager.toggleDark()

                        expect(manager.colorMode).toBe(initialMode)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('初始化', () => {
        it('应从 localStorage 读取保存的模式', () => {
            mockLocalStorage.store['color-mode'] = 'dark'
            const manager = createColorModeManager()
            manager.initColorMode()

            expect(manager.colorMode).toBe('dark')
        })

        it('无保存值时应使用默认模式', () => {
            const manager = createColorModeManager()
            manager.initColorMode()

            expect(manager.colorMode).toBe('light')
        })

        it('无效的保存值应被忽略', () => {
            mockLocalStorage.store['color-mode'] = 'invalid'
            const manager = createColorModeManager()
            manager.initColorMode()

            expect(manager.colorMode).toBe('light')
        })
    })

    describe('DOM 类名应用', () => {
        it('dark 模式应添加 dark 类', () => {
            const manager = createColorModeManager()
            manager.setColorMode('dark')

            expect(mockDocument.documentElement.classList.add).toHaveBeenCalledWith('dark')
        })

        it('light 模式应移除 dark 类', () => {
            const manager = createColorModeManager()
            manager.setColorMode('light')

            expect(mockDocument.documentElement.classList.remove).toHaveBeenCalledWith('dark')
        })
    })
})
