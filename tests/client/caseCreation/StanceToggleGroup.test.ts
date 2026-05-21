import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StanceToggleGroup from '~/components/caseCreation/StanceToggleGroup.vue'
import { CaseStance } from '#shared/types/case'

function checkedOption(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[role="radio"][aria-checked="true"]')
}

describe('StanceToggleGroup', () => {
  it('默认值 plaintiff 渲染时高亮原告', async () => {
    const wrapper = mount(StanceToggleGroup, {
      props: { modelValue: CaseStance.PLAINTIFF },
    })
    expect(checkedOption(wrapper).text()).toContain('原告')
  })

  it('v-model 切换到 defendant 时高亮被告', async () => {
    const wrapper = mount(StanceToggleGroup, {
      props: { modelValue: CaseStance.PLAINTIFF, 'onUpdate:modelValue': () => {} },
    })
    await wrapper.setProps({ modelValue: CaseStance.DEFENDANT })
    expect(checkedOption(wrapper).text()).toContain('被告')
  })

  it('再次点击当前选项时仍保持一个明确立场', async () => {
    let val: CaseStance = CaseStance.PLAINTIFF
    const wrapper = mount(StanceToggleGroup, {
      props: {
        modelValue: val,
        'onUpdate:modelValue': (v: any) => { val = v },
      },
    })
    await checkedOption(wrapper).trigger('click')
    expect(val).toBe(CaseStance.PLAINTIFF)
  })
})
