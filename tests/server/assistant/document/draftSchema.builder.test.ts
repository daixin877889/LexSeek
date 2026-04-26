/**
 * buildDraftSchema 测试
 *
 * 验证动态 Zod schema 构造：
 * - 空占位符 → 空 values 对象
 * - 单个占位符 → 对应字符串字段
 * - 多个占位符 → 多个字符串字段
 * - 重复占位符 → 去重处理
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { buildDraftSchema } from '~~/server/agents/document/draftSchema.builder'
import type { Placeholder } from '#shared/types/document'

describe('buildDraftSchema', () => {
  it('空 placeholders 数组 → 返回空 values 结构', () => {
    const placeholders: Placeholder[] = []
    const schema = buildDraftSchema(placeholders)

    // 验证 schema 有 values 字段
    expect(schema.shape).toHaveProperty('values')

    // 验证空占位符时 values 是空对象
    const emptyObject = {}
    const result = schema.parse({ values: emptyObject })
    expect(result.values).toEqual({})
  })

  it('单个 placeholder → 返回对应 string 字段', () => {
    const placeholders: Placeholder[] = [
      {
        name: 'plaintiff_name',
        firstContext: '原告姓名为 {{plaintiff_name}}',
      },
    ]
    const schema = buildDraftSchema(placeholders)

    // 验证 schema 结构包含 plaintiff_name 字段
    const valueSchema = schema.shape.values as any
    expect(valueSchema.shape).toHaveProperty('plaintiff_name')

    // 验证能解析正常数据
    const result = schema.parse({
      values: { plaintiff_name: 'John Doe' },
    })
    expect(result.values.plaintiff_name).toBe('John Doe')

    // 验证能解析 null 值
    const resultWithNull = schema.parse({
      values: { plaintiff_name: null },
    })
    expect(resultWithNull.values.plaintiff_name).toBeNull()
  })

  it('多个占位符（中英混合）→ 每个映射到 string 字段', () => {
    const placeholders: Placeholder[] = [
      { name: 'plaintiff_name', firstContext: '原告：' },
      { name: '被告', firstContext: '被告为：' },
      { name: 'case_number', firstContext: '案号为：' },
    ]
    const schema = buildDraftSchema(placeholders)

    const result = schema.parse({
      values: {
        plaintiff_name: 'Alice',
        '被告': 'Bob',
        case_number: '2024-001',
      },
    })

    expect(result.values.plaintiff_name).toBe('Alice')
    expect(result.values['被告']).toBe('Bob')
    expect(result.values.case_number).toBe('2024-001')
  })

  it('重复 placeholder name → 去重后只保留一个字段', () => {
    const placeholders: Placeholder[] = [
      { name: 'plaintiff_name', firstContext: '第一次出现' },
      { name: 'plaintiff_name', firstContext: '第二次出现' },
      { name: 'defendant_name', firstContext: '被告' },
    ]
    const schema = buildDraftSchema(placeholders)

    // 验证去重：应该只有 2 个字段而不是 3 个
    const valueSchema = schema.shape.values as any
    const fieldCount = Object.keys(valueSchema.shape).length
    expect(fieldCount).toBe(2)

    // 验证包含去重后的字段
    expect(valueSchema.shape).toHaveProperty('plaintiff_name')
    expect(valueSchema.shape).toHaveProperty('defendant_name')

    const result = schema.parse({
      values: {
        plaintiff_name: 'Alice',
        defendant_name: 'Bob',
      },
    })
    expect(result.values.plaintiff_name).toBe('Alice')
    expect(result.values.defendant_name).toBe('Bob')
  })

  it('schema 可选字段 suggestions 用于存储填充建议', () => {
    const placeholders: Placeholder[] = [
      { name: 'plaintiff_name', firstContext: '原告：' },
    ]
    const schema = buildDraftSchema(placeholders)

    // suggestions 是可选的
    const resultWithoutSuggestions = schema.parse({
      values: { plaintiff_name: 'Alice' },
    })
    expect(resultWithoutSuggestions.values.plaintiff_name).toBe('Alice')

    // suggestions 可以包含
    const resultWithSuggestions = schema.parse({
      values: { plaintiff_name: 'Alice' },
      suggestions: { plaintiff_name: '从案件当事人推断' },
    })
    expect(resultWithSuggestions.suggestions).toEqual({
      plaintiff_name: '从案件当事人推断',
    })
  })

  describe('aiTitle 字段', () => {
    it('schema 包含可选 aiTitle', () => {
      const schema = buildDraftSchema([{ name: 'f1', firstContext: '' }] as any)
      const parsed = schema.parse({ values: { f1: 'x' }, aiTitle: '我的标题' })
      expect((parsed as any).aiTitle).toBe('我的标题')
    })

    it('aiTitle 可省略', () => {
      const schema = buildDraftSchema([{ name: 'f1', firstContext: '' }] as any)
      const parsed = schema.parse({ values: { f1: 'x' } })
      expect((parsed as any).aiTitle).toBeUndefined()
    })

    it('aiTitle 超长（>200）校验失败', () => {
      const schema = buildDraftSchema([{ name: 'f1', firstContext: '' }] as any)
      expect(() => schema.parse({ values: { f1: 'x' }, aiTitle: 'a'.repeat(201) })).toThrow()
    })
  })
})
