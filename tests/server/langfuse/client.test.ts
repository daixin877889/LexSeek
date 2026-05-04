import { describe, it, expect, afterEach } from 'vitest'
import {
  _resetLangfuseClientCache,
  getLangfuseHandler,
  getLangfuseRuntimeConfig,
} from '~~/server/lib/langfuse/client'

describe('getLangfuseRuntimeConfig', () => {
  afterEach(() => {
    _resetLangfuseClientCache()
  })

  it('返回 runtimeConfig.langfuse 字段（vitest nuxt 环境）', () => {
    const cfg = getLangfuseRuntimeConfig()
    // tracingEnabled 在测试环境被 global-setup 强制 false
    expect(cfg.tracingEnabled).toBe(false)
    expect(cfg.environment).toBeDefined()
  })

  it('多次调用返回同一缓存对象', () => {
    const cfg1 = getLangfuseRuntimeConfig()
    const cfg2 = getLangfuseRuntimeConfig()
    expect(cfg1).toBe(cfg2)
  })
})

describe('getLangfuseHandler', () => {
  afterEach(() => {
    _resetLangfuseClientCache()
  })

  it('多次调用返回同一单例', () => {
    const h1 = getLangfuseHandler()
    const h2 = getLangfuseHandler()
    expect(h1).toBe(h2)
  })

  it('handler 暴露 LangChain BaseCallbackHandler 接口（name 字符串、handle* 方法可调）', () => {
    const h = getLangfuseHandler()
    expect(typeof h.name).toBe('string')
    // BaseCallbackHandler 的 handle* 方法是可选的，不存在也安全
    if (typeof h.handleLLMStart === 'function') {
      expect(() => h.handleLLMStart!({ lc: 1, type: 'not_implemented', id: [], kwargs: {} } as any, [], 'r1')).not.toThrow()
    }
  })
})
