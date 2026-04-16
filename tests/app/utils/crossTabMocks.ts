import { vi } from 'vitest'

/**
 * 建立 BroadcastChannel 的手工 pub/sub 实现
 *
 * 注意：useCrossTabEvents.ts 用 `ch.onmessage = fn` setter 模式，
 * 本 mock 用 setter 累加 listeners，与现有代码兼容。
 *
 * @returns 清理函数，测试结束后调用以还原全局状态
 */
export function stubBroadcastChannel() {
  const listeners = new Map<string, Set<(ev: MessageEvent) => void>>()

  class MockChannel {
    constructor(public name: string) {
      if (!listeners.has(name)) listeners.set(name, new Set())
    }

    postMessage(data: unknown) {
      // 异步派发模拟 BroadcastChannel 跨页面的微任务级延迟（真实行为）。
      // ⚠️ 测试中 postMessage 之后断言 listener 行为时，必须 `await flushPromises()`
      //    或 `await nextTick()`，否则断言执行时回调尚未触发（假阳性风险）。
      queueMicrotask(() => {
        listeners.get(this.name)?.forEach(fn => fn({ data } as MessageEvent))
      })
    }

    set onmessage(fn: (ev: MessageEvent) => void) {
      listeners.get(this.name)?.add(fn)
    }

    close() { /* no-op */ }
  }

  vi.stubGlobal('BroadcastChannel', MockChannel)

  return () => {
    listeners.clear()
    vi.unstubAllGlobals()
  }
}

/**
 * 建立 navigator.locks 的简单串行实现
 *
 * 支持 ifAvailable: true 时返回 null（与 Web Locks API 行为一致）。
 *
 * @returns 清理函数，测试结束后调用以还原全局状态
 */
export function stubNavigatorLocks() {
  const held = new Set<string>()

  vi.stubGlobal('navigator', {
    locks: {
      async request(
        name: string,
        opts: { ifAvailable?: boolean; mode?: string },
        cb: (lock: unknown) => Promise<void>,
      ) {
        if (held.has(name)) {
          if (opts.ifAvailable) return cb(null)
          throw new Error('lock held')
        }
        held.add(name)
        try { await cb({}) } finally { held.delete(name) }
      },
    },
  })

  return () => {
    held.clear()
    vi.unstubAllGlobals()
  }
}
