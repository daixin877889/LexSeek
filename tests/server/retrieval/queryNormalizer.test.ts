import { describe, it, expect } from 'vitest'
import { normalizeQuery, tryExactRegex } from '../../../server/services/retrieval/queryNormalizer'

describe('normalizeQuery', () => {
  it('去空白：trim + 合并连续空格', () => {
    expect(normalizeQuery('  民法典  第100条  ')).toBe('民法典 第100条')
  })

  it('去 Unicode 控制字符', () => {
    expect(normalizeQuery('民法典\u200B第100条')).toBe('民法典第100条')
  })

  it('去冗余前缀：中华人民共和国', () => {
    expect(normalizeQuery('中华人民共和国民法典第一百条')).toBe('民法典第100条')
  })

  it('中文数字仅作用于"第X条"和"第X款"模式', () => {
    expect(normalizeQuery('民法典第一千零七十九条')).toBe('民法典第1079条')
    expect(normalizeQuery('刑法第二百六十四条第二款')).toBe('刑法第264条第2款')
    // "第三编" 不匹配条/款模式，保持不变
    expect(normalizeQuery('民法典第三编 合同')).toBe('民法典第三编 合同')
  })

  it('全角转半角', () => {
    expect(normalizeQuery('民法典第１００条')).toBe('民法典第100条')
  })

  it('不同写法归一化为相同结果', () => {
    const expected = '民法典第100条'
    expect(normalizeQuery('民法典第一百条')).toBe(expected)
    expect(normalizeQuery('民法典第１００条')).toBe(expected)
    expect(normalizeQuery('中华人民共和国民法典第一百条')).toBe(expected)
    expect(normalizeQuery('  民法典  第100条  ')).toBe('民法典 第100条')
  })

  it('空字符串安全', () => {
    expect(normalizeQuery('')).toBe('')
  })

  it('非中文数字字符不被转换', () => {
    // "abc" 不匹配中文数字正则，不会进入 replaceChinese
    expect(normalizeQuery('民法典第abc条')).toBe('民法典第abc条')
  })
})

describe('tryExactRegex', () => {
  describe('数字边界测试：encodeS 转换验证', () => {
    const cases: Array<[number, string]> = [
      [10, '十'],
      [11, '十一'],
      [20, '二十'],
      [100, '一百'],
      [101, '一百零一'],
      [110, '一百一十'],
      [1000, '一千'],
      [1001, '一千零一'],
      [1010, '一千零一十'],
      [1079, '一千零七十九'],
    ]

    for (const [num, expectedChinese] of cases) {
      it(`数字 ${num} → articleRef "第${expectedChinese}条"`, () => {
        const result = tryExactRegex(`民法典第${num}条`)
        expect(result).not.toBeNull()
        expect(result!.articleRef).toBe(`第${expectedChinese}条`)
      })
    }
  })

  describe('匹配边界测试', () => {
    it('纯 exact 命中', () => {
      const result = tryExactRegex('民法典第1079条')
      expect(result).toEqual({
        intent: 'exact',
        legalName: '民法典',
        articleRef: '第一千零七十九条',
      })
    })

    it('带款号只保留到条', () => {
      const result = tryExactRegex('刑法第264条第2款')
      expect(result).not.toBeNull()
      expect(result!.intent).toBe('exact')
      expect(result!.legalName).toBe('刑法')
      expect(result!.articleRef).toBe('第二百六十四条')
    })

    it('空格 trim', () => {
      const result = tryExactRegex('  民法典 第100条')
      expect(result).not.toBeNull()
      expect(result!.legalName).toBe('民法典')
    })

    it('复合查询不匹配', () => {
      // 包含条号以外的内容
      expect(tryExactRegex('民法典第100条的解释')).toBeNull()
    })

    it('仅条文号不匹配', () => {
      expect(tryExactRegex('第100条')).toBeNull()
    })

    it('单字法律名称不匹配（长度 < 2）', () => {
      expect(tryExactRegex('法第100条')).toBeNull()
    })

    it('无模式不匹配', () => {
      expect(tryExactRegex('民法典合同编')).toBeNull()
    })

    it('不含 rewrittenQuery 和 keywords', () => {
      const result = tryExactRegex('民法典第100条')
      expect(result).not.toBeNull()
      expect(result).not.toHaveProperty('rewrittenQuery')
      expect(result).not.toHaveProperty('keywords')
    })

    it('空字符串返回 null', () => {
      expect(tryExactRegex('')).toBeNull()
    })

    it('articleNum 为 0 返回 null', () => {
      expect(tryExactRegex('民法典第0条')).toBeNull()
    })
  })
})
