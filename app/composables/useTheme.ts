/**
 * 主题管理 composable
 * 支持主题色切换，配合 useColorMode 实现完整的主题系统
 */

// 可用的主题色列表
export const themeColors = [
    { name: 'zinc', label: '默认', color: '#71717a' },
    { name: 'rose', label: '玫瑰', color: '#f43f5e' },
    { name: 'blue', label: '蓝色', color: '#3b82f6' },
    { name: 'green', label: '绿色', color: '#22c55e' },
    { name: 'orange', label: '橙色', color: '#f97316' },
    { name: 'red', label: '红色', color: '#ef4444' },
    { name: 'violet', label: '紫色', color: '#8b5cf6' },
    { name: 'yellow', label: '黄色', color: '#eab308' },
] as const

export type ThemeColor = typeof themeColors[number]['name']

// 主题色存储 key
const THEME_COLOR_KEY = 'theme-color'

/**
 * 主题管理 composable
 */
export function useTheme() {
    // 当前主题色（初始值从 localStorage 读取）
    const themeColor = useState<ThemeColor>('theme-color', () => {
        if (import.meta.client) {
            const saved = localStorage.getItem(THEME_COLOR_KEY) as ThemeColor | null
            if (saved && themeColors.some(t => t.name === saved)) {
                return saved
            }
        }
        return 'zinc'
    })

    /**
     * 初始化主题
     * 注意：主题已在 nuxt.config.ts 的内联脚本中初始化，这里不需要再次应用
     */
    const initTheme = () => {
        // 主题已在内联脚本中初始化，这里只需要确保状态同步
    }

    /**
     * 应用主题到 DOM
     */
    const applyTheme = (theme: ThemeColor) => {
        if (import.meta.client) {
            const html = document.documentElement
            // 移除所有主题类
            themeColors.forEach(t => {
                html.classList.remove(`theme-${t.name}`)
            })
            // 添加新主题类（zinc 是默认主题，不需要添加类）
            if (theme !== 'zinc') {
                html.classList.add(`theme-${theme}`)
            }
        }
    }

    /**
     * 设置主题色
     */
    const setThemeColor = (theme: ThemeColor) => {
        themeColor.value = theme
        if (import.meta.client) {
            localStorage.setItem(THEME_COLOR_KEY, theme)
            applyTheme(theme)
        }
    }

    return {
        themeColor,
        themeColors,
        setThemeColor,
        initTheme,
    }
}
