import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AiChatQueueChips from '~/components/ai/AiChatQueueChips.vue'
import type { QueueItem } from '~/composables/chatQueueActions'

function makeItem(text = '测试'): QueueItem {
  return {
    id: Math.random().toString(36).slice(2),
    text,
    thinking: false,
    enqueuedAt: Date.now(),
  }
}

describe('AiChatQueueChips', () => {
  it('空队列不渲染容器', () => {
    const w = mount(AiChatQueueChips, {
      props: { queue: [], max: 5, paused: false, pauseReason: null },
    })
    // Vue 3 在不同模式下 v-if 注释节点格式可能是 <!----> 或 <!--v-if-->，
    // 使用 find 确保没有实际的 div 容器渲染即可
    expect(w.find('div').exists()).toBe(false)
  })

  it('2 条运行中：渲染容器 + 2 个序号 badge（#1 以 spinner 代替）', () => {
    const w = mount(AiChatQueueChips, {
      props: { queue: [makeItem('a'), makeItem('b')], max: 5, paused: false, pauseReason: null },
    })
    // 当前组件不再渲染 "排队中 (N/M)" 状态横幅（运行态下由队头 spinner 指示即将派发）
    // 断言：容器存在，且第二条 chip 显示 #2 序号 badge
    expect(w.find('div').exists()).toBe(true)
    expect(w.text()).toContain('#2')
  })

  it('暂停 stopped 显示"已手动停止"，恢复/清空按钮通过 testid 暴露', () => {
    const w = mount(AiChatQueueChips, {
      props: { queue: [makeItem('a')], max: 5, paused: true, pauseReason: 'stopped' },
    })
    // 当前组件按钮只用 icon + aria-label/title（无可见文本），通过 data-testid 定位
    expect(w.text()).toContain('已手动停止')
    expect(w.find('[data-testid="queue-resume"]').exists()).toBe(true)
    expect(w.find('[data-testid="queue-clear"]').exists()).toBe(true)
  })

  it('暂停 failed 显示"上一条执行失败"', () => {
    const w = mount(AiChatQueueChips, {
      props: { queue: [makeItem('a')], max: 5, paused: true, pauseReason: 'failed' },
    })
    expect(w.text()).toContain('上一条执行失败')
  })

  it('点击 × 删除 chip 应 emit remove 携带 itemId', async () => {
    const item = makeItem('a')
    const w = mount(AiChatQueueChips, {
      props: { queue: [item], max: 5, paused: false, pauseReason: null },
    })
    await w.find('[data-testid="queue-remove"]').trigger('click')
    expect(w.emitted('remove')?.[0]).toEqual([item.id])
  })

  it('点击恢复按钮 emit resume', async () => {
    const w = mount(AiChatQueueChips, {
      props: { queue: [makeItem('a')], max: 5, paused: true, pauseReason: 'stopped' },
    })
    await w.find('[data-testid="queue-resume"]').trigger('click')
    expect(w.emitted('resume')).toBeTruthy()
  })

  it('点击清空按钮 emit clear', async () => {
    const w = mount(AiChatQueueChips, {
      props: { queue: [makeItem('a')], max: 5, paused: true, pauseReason: 'stopped' },
    })
    await w.find('[data-testid="queue-clear"]').trigger('click')
    expect(w.emitted('clear')).toBeTruthy()
  })

  it('thinking=true 显示 BrainIcon', () => {
    const item = { ...makeItem('a'), thinking: true }
    const w = mount(AiChatQueueChips, {
      props: { queue: [item], max: 5, paused: false, pauseReason: null },
    })
    expect(w.find('[data-testid="queue-brain-icon"]').exists()).toBe(true)
  })

  it('chip 文本超长截断（超过 24 字符以 … 结尾）', () => {
    const longText = 'a'.repeat(30)
    const item = makeItem(longText)
    const w = mount(AiChatQueueChips, {
      props: { queue: [item], max: 5, paused: false, pauseReason: null },
    })
    const chipText = w.find('span.line-clamp-1').text()
    expect(chipText.endsWith('…')).toBe(true)
    expect(chipText.length).toBeLessThanOrEqual(25) // 24 chars + ellipsis
  })
})
