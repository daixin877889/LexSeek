import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CaseStatusBadge from '~/components/cases/CaseStatusBadge.vue'
import { CaseStatus } from '#shared/types/case'

describe('CaseStatusBadge', () => {
  it('显示 CONSULTING 咨询阶段', () => {
    const w = mount(CaseStatusBadge, { props: { status: CaseStatus.CONSULTING } })
    expect(w.text()).toContain('咨询阶段')
  })

  it('显示 FIRST_TRIAL 一审阶段', () => {
    const w = mount(CaseStatusBadge, { props: { status: CaseStatus.FIRST_TRIAL } })
    expect(w.text()).toContain('一审阶段')
  })

  it('显示 CLOSED 结案', () => {
    const w = mount(CaseStatusBadge, { props: { status: CaseStatus.CLOSED } })
    expect(w.text()).toContain('结案')
  })

  it('显示 ARCHIVED 归档', () => {
    const w = mount(CaseStatusBadge, { props: { status: CaseStatus.ARCHIVED } })
    expect(w.text()).toContain('归档')
  })

  it('未知 status 显示"未知"占位', () => {
    const w = mount(CaseStatusBadge, { props: { status: 12345 } })
    expect(w.text()).toContain('未知')
  })
})
