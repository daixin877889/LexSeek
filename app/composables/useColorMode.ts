/**
 * 颜色模式 composable
 * 仅保留 light / dark。品牌色固定，不再跟随旧多色主题切换。
 */

export type ColorMode = "light" | "dark";

const COLOR_MODE_KEY = "color-mode";
const LEGACY_THEME_COLOR_KEY = "theme-color";
const LEGACY_THEME_CLASSES = [
    "theme-zinc",
    "theme-rose",
    "theme-blue",
    "theme-green",
    "theme-orange",
    "theme-red",
    "theme-violet",
    "theme-yellow",
];

const isColorMode = (value: string | null): value is ColorMode =>
    value === "light" || value === "dark";

const removeLegacyThemeColor = () => {
    if (import.meta.server) return;

    const root = document.documentElement;
    root.classList.remove(...LEGACY_THEME_CLASSES);
    localStorage.removeItem(LEGACY_THEME_COLOR_KEY);
};

export function useColorMode() {
    // 当前颜色模式（用户选择的）
    // 初始值从 localStorage 读取（如果在客户端）
    const colorMode = useState<ColorMode>("color-mode", () => {
        if (import.meta.client) {
            const saved = localStorage.getItem(COLOR_MODE_KEY);
            if (isColorMode(saved)) {
                return saved;
            }
        }
        return "light";
    });

    if (import.meta.client && !isColorMode(colorMode.value)) {
        colorMode.value = "light";
        localStorage.setItem(COLOR_MODE_KEY, colorMode.value);
    }

    // 实际应用的模式
    const resolvedMode = computed<"light" | "dark">(() => colorMode.value);

    // 是否为暗色模式
    const isDark = computed(() => resolvedMode.value === "dark");

    /**
     * 设置颜色模式
     */
    const setColorMode = (mode: ColorMode) => {
        colorMode.value = mode;
        if (import.meta.client) {
            localStorage.setItem(COLOR_MODE_KEY, mode);
            applyColorMode(mode);
        }
    };

    /**
     * 切换暗色模式
     */
    const toggleDark = () => {
        setColorMode(isDark.value ? "light" : "dark");
    };

    /**
     * 应用颜色模式到 DOM
     */
    const applyColorMode = (mode: ColorMode) => {
        if (import.meta.server) return;

        removeLegacyThemeColor();

        const root = document.documentElement;

        if (mode === "dark") {
            root.classList.add("dark");
        } else {
            root.classList.remove("dark");
        }
    };

    /**
     * 初始化颜色模式
     * 注意：首屏 class 已在 nuxt.config.ts 的内联脚本中初始化，这里只清理旧主题残留。
     */
    const initColorMode = () => {
        if (import.meta.server) return;

        removeLegacyThemeColor();
    };

    // 客户端初始化
    if (import.meta.client) {
        initColorMode();
    }

    return {
        colorMode,
        resolvedMode,
        isDark,
        setColorMode,
        toggleDark,
    };
}
