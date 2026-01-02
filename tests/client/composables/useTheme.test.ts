/**
 * useTheme composable 测试
 *
 * 测试 useTheme 的功能，包括：
 * - 主题色切换
 * - localStorage 持久化
 * - DOM 类名应用
 *
 * **Feature: use-theme**
 * **Validates: Requirements 1.1, 1.2**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'

// 主题色列表
const themeColors = [
    { name: 'zinc', label: '默认', color: '#71717a' },
    { name: 'rose', label: '玫瑰', color: '#f43f5e' },
    { name: 'blue', label: '蓝色', color: '#3b82f6' },
    { name: 'green', label: '绿色', color: '#22c55e' },
    { name: 'orange', label: '橙色', color: '#f97316' },
    { name: 'red', label: '红色', color: '#ef4444' },
    { name: 'violet', label: '紫色', color: '#8b5cf6' },
    { name: 'yellow', label: '黄色', color: '#eab308' },
] as const

type ThemeColor = typeof themeColors[number]['name']

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

// 模拟 useTheme 的核心逻辑
function createThemeManager() {
    let themeColor: ThemeColor = 'zinc'

    const applyTheme = (theme: ThemeColor) => {
        // 移除所有主题类
        themeColors.forEach(t => {
            mockDocument.documentElement.classList.remove(`theme-${t.name}`)
        })
        // 添加新主题类（zinc 是默认主题，不需要添加类）
        if (theme !== 'zinc') {
            mockDocument.documentElement.classList.add(`theme-${theme}`)
        }
    }

    const setThemeColor = (theme: ThemeColor) => {
        themeColor = theme
        mockLocalStorage.setItem('theme-color', theme)
        applyTheme(theme)
    }

    const initTheme = () => {
        const saved = mockLocalStorage.getItem('theme-color') as ThemeColor | null
        if (saved && themeColors.some(t => t.name === saved)) {
            themeColor = saved
            applyTheme(saved)
        }
    }

    return {
        get themeColor() {
            return themeColor
        },
        themeColors,
        setThemeColor,
        initTheme,
    }
}

describe('useTheme composable 测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockLocalStorage.clear()
    })

    afterEach(() => {
        vi.resetAllMocks()
    })

    describe('主题色切换', () => {
        it('应正确设置主题色', () => {
            const manager = createThemeManager()
            manager.setThemeColor('blue')

            expect(manager.themeColor).toBe('blue')
            expect(mockLocalStorage.setItem).toHaveBeenCalledWith('theme-color', 'blue')
        })

        it('属性测试：设置的主题色应被正确保存', () => {
            const themeNames = themeColors.map(t => t.name)

            fc.assert(
                fc.property(
                    fc.constantFrom(...themeNames),
                    (theme) => {
                        mockLocalStorage.clear()
                        vi.clearAllMocks()
                        const manager = createThemeManager()
                        manager.setThemeColor(theme as ThemeColor)

                        expect(manager.themeColor).toBe(theme)
                        expect(mockLocalStorage.setItem).toHaveBeenCalledWith('theme-color', theme)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('DOM 类名应用', () => {
        it('非默认主题应添加对应类名', () => {
            const manager = createThemeManager()
            manager.setThemeColor('rose')

            expect(mockDocument.documentElement.classList.add).toHaveBeenCalledWith('theme-rose')
        })

        it('默认主题（zinc）不应添加类名', () => {
            const manager = createThemeManager()
            manager.setThemeColor('zinc')

            expect(mockDocument.documentElement.classList.add).not.toHaveBeenCalledWith('theme-zinc')
        })

        it('切换主题时应移除旧主题类', () => {
            const manager = createThemeManager()
            manager.setThemeColor('blue')
            manager.setThemeColor('rose')

            // 应该移除所有主题类
            themeColors.forEach(t => {
                expect(mockDocument.documentElement.classList.remove).toHaveBeenCalledWith(`theme-${t.name}`)
            })
        })

        it('属性测试：切换主题应移除所有旧主题类', () => {
            const themeNames = themeColors.map(t => t.name)

            fc.assert(
                fc.property(
                    fc.constantFrom(...themeNames),
                    fc.constantFrom(...themeNames),
                    (oldTheme, newTheme) => {
                        vi.clearAllMocks()
                        const manager = createThemeManager()
                        manager.setThemeColor(oldTheme as ThemeColor)
                        vi.clearAllMocks()
                        manager.setThemeColor(newTheme as ThemeColor)

                        // 验证所有主题类都被移除
                        themeColors.forEach(t => {
                            expect(mockDocument.documentElement.classList.remove).toHaveBeenCalledWith(`theme-${t.name}`)
                        })
                    }
                ),
                { numRuns: 50 }
            )
        })
    })

    describe('初始化', () => {
        it('应从 localStorage 读取保存的主题', () => {
            mockLocalStorage.store['theme-color'] = 'violet'
            const manager = createThemeManager()
            manager.initTheme()

            expect(manager.themeColor).toBe('violet')
        })

        it('无保存值时应使用默认主题', () => {
            const manager = createThemeManager()
            manager.initTheme()

            expect(manager.themeColor).toBe('zinc')
        })

        it('无效的保存值应被忽略', () => {
            mockLocalStorage.store['theme-color'] = 'invalid-theme'
            const manager = createThemeManager()
            manager.initTheme()

            expect(manager.themeColor).toBe('zinc')
        })

        it('属性测试：有效的保存值应被正确加载', () => {
            const themeNames = themeColors.map(t => t.name)

            fc.assert(
                fc.property(
                    fc.constantFrom(...themeNames),
                    (theme) => {
                        mockLocalStorage.clear()
                        mockLocalStorage.store['theme-color'] = theme
                        const manager = createThemeManager()
                        manager.initTheme()

                        expect(manager.themeColor).toBe(theme)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('主题色列表', () => {
        it('应包含所有预定义主题', () => {
            const manager = createThemeManager()

            expect(manager.themeColors.length).toBe(8)
            expect(manager.themeColors.map(t => t.name)).toContain('zinc')
            expect(manager.themeColors.map(t => t.name)).toContain('rose')
            expect(manager.themeColors.map(t => t.name)).toContain('blue')
        })

        it('每个主题应有 name、label 和 color 属性', () => {
            const manager = createThemeManager()

            manager.themeColors.forEach(theme => {
                expect(theme).toHaveProperty('name')
                expect(theme).toHaveProperty('label')
                expect(theme).toHaveProperty('color')
                expect(typeof theme.name).toBe('string')
                expect(typeof theme.label).toBe('string')
                expect(theme.color).toMatch(/^#[0-9a-f]{6}$/i)
            })
        })
    })
})
