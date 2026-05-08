import { describe, it, expect } from 'vitest'
import {
  isInjectorFromContextMiddleware,
  getMessageInjector,
  isInjectedContextMessage,
} from '~~/server/services/agent-platform/context/injectorDetection'

describe('injectorDetection - 新 tag CaseContextSyncMiddleware', () => {
  it('isInjectorFromContextMiddleware 识别新 tag', () => {
    expect(isInjectorFromContextMiddleware('CaseContextSyncMiddleware')).toBe(true)
  })

  it('isInjectorFromContextMiddleware 仍识别旧 tag（兼容历史 checkpoint）', () => {
    expect(isInjectorFromContextMiddleware('CaseContextMiddleware')).toBe(true)
    expect(isInjectorFromContextMiddleware('ModuleContext_caseSummary')).toBe(true)
    expect(isInjectorFromContextMiddleware('CaseMaterial_xxx')).toBe(true)
    expect(isInjectorFromContextMiddleware('SubAgentContext_yyy')).toBe(true)
  })

  it('getMessageInjector 从 response_metadata 读 injectedBy', () => {
    const msg = { response_metadata: { injectedBy: 'CaseContextSyncMiddleware' } }
    expect(getMessageInjector(msg)).toBe('CaseContextSyncMiddleware')
  })

  it('getMessageInjector 从 additional_kwargs 读 injectedBy（双轨兜底）', () => {
    const msg = { additional_kwargs: { injectedBy: 'CaseContextSyncMiddleware' } }
    expect(getMessageInjector(msg)).toBe('CaseContextSyncMiddleware')
  })

  it('getMessageInjector 优先 response_metadata（双字段都存在时）', () => {
    const msg = {
      response_metadata: { injectedBy: 'CaseContextSyncMiddleware' },
      additional_kwargs: { injectedBy: 'OldTag' },
    }
    expect(getMessageInjector(msg)).toBe('CaseContextSyncMiddleware')
  })

  it('isInjectedContextMessage 整合双轨判定', () => {
    expect(isInjectedContextMessage({
      additional_kwargs: { injectedBy: 'CaseContextSyncMiddleware' },
    })).toBe(true)
    expect(isInjectedContextMessage({})).toBe(false)
    expect(isInjectedContextMessage({ response_metadata: { injectedBy: 'foo' } })).toBe(false)
  })
})
