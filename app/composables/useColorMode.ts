/**
 * 颜色模式 composable
 * 支持 light、dark、system 三种模式
 */

export type ColorMode = "light" | "dark" | "system";

const COLOR_MODE_KEY = "color-mode";

export function useColorMode() {
    // 当前颜色模式（用户选择的）
    const colorMode = useState<ColorMode>("color-mode", () => "light");

    // 实际应用的模式（考虑系统偏好）
    const resolvedMode = computed<"light" | "dark">(() => {
        if (colorMode.value === "system") {
            // 服务端渲染时默认返回 light
            if (import.meta.server) return "light";
            return window.matchMedia("(prefers-color-scheme: dark)").matches
                ? "dark"
                : "light";
        }
        return colorMode.value;
    });

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

        const root = document.documentElement;
        const isDarkMode =
            mode === "dark" ||
            (mode === "system" &&
                window.matchMedia("(prefers-color-scheme: dark)").matches);

        if (isDarkMode) {
            root.classList.add("dark");
        } else {
            root.classList.remove("dark");
        }
    };

    /**
     * 初始化颜色模式
     */
    const initColorMode = () => {
        if (import.meta.server) return;

        // 从 localStorage 读取保存的模式
        const saved = localStorage.getItem(COLOR_MODE_KEY) as ColorMode | null;
        if (saved && ["light", "dark", "system"].includes(saved)) {
            colorMode.value = saved;
        }

        // 应用颜色模式
        applyColorMode(colorMode.value);

        // 监听系统主题变化
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        mediaQuery.addEventListener("change", () => {
            if (colorMode.value === "system") {
                applyColorMode("system");
            }
        });
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
