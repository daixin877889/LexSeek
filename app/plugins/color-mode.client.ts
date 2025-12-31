/**
 * 颜色模式初始化插件（仅客户端）
 * 在应用启动时立即应用保存的颜色模式，避免页面闪烁
 */

export default defineNuxtPlugin(() => {
    // 立即执行，不等待 Vue 挂载
    const COLOR_MODE_KEY = "color-mode";
    const saved = localStorage.getItem(COLOR_MODE_KEY);
    const root = document.documentElement;

    const isDarkMode =
        saved === "dark" ||
        (saved !== "light" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches);

    if (isDarkMode) {
        root.classList.add("dark");
    } else {
        root.classList.remove("dark");
    }
});
