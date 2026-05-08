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
    // 字段都存在且类型对（具体值由 process.env / runtimeConfig 决定，
    // 测试环境下 NODE_ENV='test' 会落进 environment 字段，所以不强断三选一）
    expect(typeof cfg.tracingEnabled).toBe('boolean')
    expect(typeof cfg.maskPII).toBe('boolean')
    expect(typeof cfg.environment).toBe('string')
    expect(cfg.environment.length).toBeGreaterThan(0)
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

  it('缺 publicKey/secretKey 时返回 NoopCallbackHandler（避免无谓的 OTel span 创建开销）', () => {
    // 测试环境一般不配真凭据，应回退到 Noop
    const cfg = getLangfuseRuntimeConfig()
    if (cfg.publicKey && cfg.secretKey && cfg.tracingEnabled) {
      // 配了凭据 → 真 handler；本断言场景不适用
      return
    }
    const h = getLangfuseHandler()
    expect(h.name).toBe('NoopLangfuseCallbackHandler')
  })
})
