/**
 * 颜色模式初始化插件（仅客户端）
 * 在应用启动时立即应用保存的颜色模式，避免页面闪烁
 *
 * 逻辑：
 * - 没有缓存时：默认浅色主题
 * - 缓存为 'light'：浅色主题
 * - 缓存为 'dark'：深色主题
 */

export default defineNuxtPlugin(() => {
    // 立即执行，不等待 Vue 挂载
    const COLOR_MODE_KEY = "color-mode";
    if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") return;
    const saved = localStorage.getItem(COLOR_MODE_KEY);
    const root = document.documentElement;

    const mode = saved === "dark" ? "dark" : "light";
    localStorage.setItem(COLOR_MODE_KEY, mode);

    if (mode === "dark") {
        root.classList.add("dark");
    } else {
        root.classList.remove("dark");
    }
});
