/**
 * CaseInfoCard 编辑态 - 全字段编辑测试
 *
 * **Feature: 2026-05-14-case-features / Task B4**
 *
 * 验证 saveChanges 把 title / courtName / firstInstanceCaseNo / stance /
 * status / content 等可编辑字段全部 PUT 出去。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import CaseInfoCard from '~/components/initAnalysis/CaseInfoCard.vue'
import { CaseStance } from '#shared/types/case'

const apiCalls: any[] = []
vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: vi.fn(async (url: string, opts?: any) => {
    if (opts?.method === 'PUT') {
      apiCalls.push({ url, body: opts.body })
      return { id: 1 }
    }
    return {
      title: '原标题',
      caseType: { name: '民商事案件' },
      plaintiff: ['甲'],
      defendant: ['乙'],
      stance: CaseStance.PLAINTIFF,
      courtName: '',
      firstInstanceCaseNo: '',
      firstInstanceJudge: '',
      secondInstanceCaseNo: '',
      secondInstanceJudge: '',
      content: '',
      status: 1,
    }
  }),
}))

describe('CaseInfoCard 编辑态 - 全字段编辑', () => {
  it('saveChanges 把所有可编辑字段 PUT 出去', async () => {
    apiCalls.length = 0
    const wrapper = mount(CaseInfoCard, { props: { caseId: 1, editable: true } })
    await flushPromises()
    const vm = wrapper.vm as any
    vm.startEditing()
    await flushPromises()
    vm.editForm.title = '新标题'
    vm.editForm.courtName = '朝阳法院'
    vm.editForm.firstInstanceCaseNo = '(2024)京01民初1号'
    vm.editForm.stance = CaseStance.DEFENDANT
    vm.editForm.status = 3
    vm.editForm.content = '新描述'
    await vm.saveChanges()
    expect(apiCalls).toHaveLength(1)
    expect(apiCalls[0].body).toMatchObject({
      title: '新标题',
      courtName: '朝阳法院',
      firstInstanceCaseNo: '(2024)京01民初1号',
      stance: CaseStance.DEFENDANT,
      status: 3,
      content: '新描述',
    })
  })
})
