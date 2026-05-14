import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import StanceToggleGroup from '~/components/caseCreation/StanceToggleGroup.vue'
import { CaseStance } from '#shared/types/case'

describe('StanceToggleGroup', () => {
  it('默认值 plaintiff 渲染时高亮原告', async () => {
    const wrapper = mount(StanceToggleGroup, {
      props: { modelValue: CaseStance.PLAINTIFF },
    })
    expect(wrapper.find('[data-state="on"]').text()).toContain('原告')
  })

  it('v-model 切换到 defendant 时高亮被告', async () => {
    const wrapper = mount(StanceToggleGroup, {
      props: { modelValue: CaseStance.PLAINTIFF, 'onUpdate:modelValue': () => {} },
    })
    await wrapper.setProps({ modelValue: CaseStance.DEFENDANT })
    expect(wrapper.find('[data-state="on"]').text()).toContain('被告')
  })

  it('用户取消选中（v-model 变空字符串）时自动还原为上一个值', async () => {
    let val: CaseStance = CaseStance.PLAINTIFF
    const wrapper = mount(StanceToggleGroup, {
      props: {
        modelValue: val,
        'onUpdate:modelValue': (v: any) => { val = v },
      },
    })
    // 模拟 shadcn ToggleGroup 在再次点击当前项时把 v-model 设为空字符串
    await wrapper.findComponent({ name: 'ToggleGroup' }).vm.$emit('update:modelValue', '')
    await nextTick()
    expect(val).toBe(CaseStance.PLAINTIFF) // 仍为 plaintiff（被拦截还原）
  })
})
