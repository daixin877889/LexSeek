/**
 * 颜色模式初始化插件（仅客户端）
 * 在应用启动时立即应用保存的颜色模式，避免页面闪烁
 * 
 * 逻辑：
 * - 没有缓存时：默认浅色主题
 * - 缓存为 'light'：浅色主题
 * - 缓存为 'dark'：深色主题
 * - 缓存为 'system'：跟随系统偏好
 */

export default defineNuxtPlugin(() => {
    // 立即执行，不等待 Vue 挂载
    const COLOR_MODE_KEY = "color-mode";
    const saved = localStorage.getItem(COLOR_MODE_KEY);
    const root = document.documentElement;

    // 只有明确设置为 dark 或 system 模式下系统为深色时才应用深色主题
    const isDarkMode =
        saved === "dark" ||
        (saved === "system" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches);

    if (isDarkMode) {
        root.classList.add("dark");
    } else {
        root.classList.remove("dark");
    }
});
