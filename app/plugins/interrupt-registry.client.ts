/**
 * Interrupt 注册表副作用触发（阶段 7）
 *
 * `app/components/case/interrupt/index.ts` 顶部 import 各 handler 组件后立即调用
 * `globalInterruptRegistry.register(...)`。该 index 文件不在任何业务模块中被显式 import，
 * 注册副作用永远不会触发。本插件通过 `import '~/components/case/interrupt'` 触发副作用，
 * 让 InterruptDispatcher 能在运行时查到所有已注册的 handler。
 *
 * client 端运行（注册表只在浏览器侧使用）。
 */

import '~/components/case/interrupt'

export default defineNuxtPlugin(() => {
  // 副作用已通过顶层 import 触发，无需在 setup 中做额外动作。
})
