import { describe, it, expect } from 'vitest'
import { CaseExtractionSchema } from '~~/server/services/case/caseExtraction.service'

describe('CaseExtractionSchema · M1 新增 5 字段', () => {
  it('接受 5 个新字段（均可选）', () => {
    const parsed = CaseExtractionSchema.parse({
      title: '张李房屋租赁纠纷',
      courtName: '北京市朝阳区人民法院',
      firstInstanceCaseNo: '(2023)京0105民初12345号',
      secondInstanceCaseNo: '(2024)京03民终6789号',
      firstInstanceJudge: '王某某',
      secondInstanceJudge: '李某某',
    })
    expect(parsed.courtName).toBe('北京市朝阳区人民法院')
    expect(parsed.firstInstanceCaseNo).toBe('(2023)京0105民初12345号')
    expect(parsed.secondInstanceCaseNo).toBe('(2024)京03民终6789号')
    expect(parsed.firstInstanceJudge).toBe('王某某')
    expect(parsed.secondInstanceJudge).toBe('李某某')
  })

  it('5 个字段全部缺失也合法', () => {
    const parsed = CaseExtractionSchema.parse({ title: 'x' })
    expect(parsed.courtName).toBeUndefined()
  })
})
