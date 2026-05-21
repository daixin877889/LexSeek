/**
 * CaseInfoCard 展示态 - 基础信息全字段补全测试
 *
 * **Feature: 2026-05-14-case-features / Task B3**
 *
 * 验证卡片展示态渲染 7+1 字段（法院 / 一二审案号 / 一二审法官 /
 * 状态 / 分析立场 / 案件描述折叠）；空字段不渲染。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import CaseInfoCard from '~/components/initAnalysis/CaseInfoCard.vue'

vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: vi.fn(async () => ({
    title: '某案',
    caseType: { name: '民商事案件' },
    plaintiff: ['甲'],
    defendant: ['乙'],
    summary: '案件摘要',
    status: 3,
    content: '案件描述长文本',
    courtName: '朝阳法院',
    firstInstanceCaseNo: '(2024)京01民初1号',
    firstInstanceJudge: '王法官',
    secondInstanceCaseNo: '',
    secondInstanceJudge: '',
    stance: 'defendant',
    extraFields: [],
  })),
}))

describe('CaseInfoCard 展示态 - 全字段补全', () => {
  it('展示法院名称', async () => {
    const wrapper = mount(CaseInfoCard, { props: { caseId: 1 } })
    await flushPromises()
    expect(wrapper.text()).toContain('朝阳法院')
  })
  it('展示一审案号 + 一审法官', async () => {
    const wrapper = mount(CaseInfoCard, { props: { caseId: 1 } })
    await flushPromises()
    expect(wrapper.text()).toContain('(2024)京01民初1号')
    expect(wrapper.text()).toContain('王法官')
  })
  it('展示分析立场（被告）', async () => {
    const wrapper = mount(CaseInfoCard, { props: { caseId: 1 } })
    await flushPromises()
    expect(wrapper.text()).toContain('被告')
  })
  it('空字段不渲染整行（secondInstanceCaseNo 为空时不出现"二审案号"标签）', async () => {
    const wrapper = mount(CaseInfoCard, { props: { caseId: 1 } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('二审案号')
  })
})
