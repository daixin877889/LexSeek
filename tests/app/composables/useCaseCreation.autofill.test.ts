import { describe, it, expect } from 'vitest'
import { mergeAutofillPreservingUserInput } from '~/composables/useCaseCreation'

describe('mergeAutofillPreservingUserInput · AI 回填只填空字段', () => {
  it('用户已填字段不被 AI 覆盖', () => {
    const userFilled = { title: '用户写的标题', courtName: '' }
    const aiExtracted = { title: 'AI 改写的标题', courtName: '北京朝阳法院' }
    const result = mergeAutofillPreservingUserInput(userFilled, aiExtracted)
    expect(result.title).toBe('用户写的标题')
    expect(result.courtName).toBe('北京朝阳法院')
  })

  it('空字符串视为空（会被 AI 回填）', () => {
    const result = mergeAutofillPreservingUserInput(
      { firstInstanceJudge: '' },
      { firstInstanceJudge: '王法官' },
    )
    expect(result.firstInstanceJudge).toBe('王法官')
  })

  it('AI 未命中的字段保持用户态', () => {
    const result = mergeAutofillPreservingUserInput(
      { secondInstanceJudge: '张法官' },
      {},
    )
    expect(result.secondInstanceJudge).toBe('张法官')
  })

  it('AI 返回空字符串不覆盖用户填的', () => {
    const result = mergeAutofillPreservingUserInput(
      { courtName: '用户法院' },
      { courtName: '' },
    )
    expect(result.courtName).toBe('用户法院')
  })
})
