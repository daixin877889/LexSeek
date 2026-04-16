import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AiPromptInput from '~/components/ai/AiPromptInput.vue'

/**
 * AiPromptInput 按钮区域交互测试
 * 覆盖 Phase 4 修复的 3 个 bug + 新增 props 相关行为
 */
describe('AiPromptInput 按钮区域', () => {
  /**
   * 通用挂载配置：禁用文件上传简化测试环境
   */
  function mountInput(props: Record<string, unknown> = {}) {
    return mount(AiPromptInput, {
      props: {
        loading: false,
        enableFileUpload: false,
        showThinkingToggle: false,
        ...props,
      },
    })
  }

  it('loading=false 时只有发送按钮，无停止和加入队列按钮', () => {
    const w = mountInput({ loading: false })
    expect(w.find('[data-testid="send-button"]').exists()).toBe(true)
    expect(w.find('[data-testid="stop-button"]').exists()).toBe(false)
    expect(w.find('[data-testid="enqueue-button"]').exists()).toBe(false)
  })

  it('loading=true 输入为空时：停止按钮可用，加入队列按钮禁用', async () => {
    const w = mountInput({ loading: true })
    // 发送按钮不可见
    expect(w.find('[data-testid="send-button"]').exists()).toBe(false)
    // 停止按钮存在（loading 态总可用）
    const stopBtn = w.find('[data-testid="stop-button"]')
    expect(stopBtn.exists()).toBe(true)
    expect(stopBtn.attributes('disabled')).toBeUndefined()
    // 加入队列按钮存在但禁用（无内容）
    const enqueueBtn = w.find('[data-testid="enqueue-button"]')
    expect(enqueueBtn.exists()).toBe(true)
    expect(enqueueBtn.attributes('disabled')).toBeDefined()
  })

  it('loading=true 输入有内容时：停止和加入队列按钮都可点击', async () => {
    const w = mountInput({ loading: true })
    // 模拟输入内容（通过 textarea）
    const textarea = w.find('textarea')
    await textarea.setValue('有内容的测试消息')
    await textarea.trigger('input')
    // 等待响应式更新
    await w.vm.$nextTick()

    const stopBtn = w.find('[data-testid="stop-button"]')
    expect(stopBtn.exists()).toBe(true)
    expect(stopBtn.attributes('disabled')).toBeUndefined()

    const enqueueBtn = w.find('[data-testid="enqueue-button"]')
    expect(enqueueBtn.exists()).toBe(true)
    expect(enqueueBtn.attributes('disabled')).toBeUndefined()
  })

  it('loading=true 队列满时：加入队列按钮禁用（queueFull=true）', () => {
    const w = mountInput({ loading: true, queueFull: true })
    const enqueueBtn = w.find('[data-testid="enqueue-button"]')
    expect(enqueueBtn.exists()).toBe(true)
    expect(enqueueBtn.attributes('disabled')).toBeDefined()
    expect(enqueueBtn.attributes('title')).toContain('队列已满')
  })

  it('有队列内容时显示 +N badge（queueLength > 0）', () => {
    const w = mountInput({ loading: true, queueLength: 3 })
    // badge 显示 +3
    expect(w.text()).toContain('+3')
  })

  it('queueLength=0 时不显示角标', () => {
    const w = mountInput({ loading: true, queueLength: 0 })
    expect(w.find('[data-testid="enqueue-button"]').exists()).toBe(true)
    // 不包含 +0 文字
    expect(w.text()).not.toContain('+0')
  })

  it('点击停止按钮 emit stop 事件', async () => {
    const w = mountInput({ loading: true })
    await w.find('[data-testid="stop-button"]').trigger('click')
    expect(w.emitted('stop')).toBeTruthy()
    expect(w.emitted('stop')?.length).toBe(1)
  })

  it('点击加入队列按钮 emit submit 事件（有内容时）', async () => {
    const w = mountInput({ loading: true })
    // 先输入内容
    const textarea = w.find('textarea')
    await textarea.setValue('测试消息')
    await textarea.trigger('input')
    await w.vm.$nextTick()

    await w.find('[data-testid="enqueue-button"]').trigger('click')
    expect(w.emitted('submit')).toBeTruthy()
  })

  it('loading 态 + isStopping=true 时停止按钮禁用', () => {
    const w = mountInput({ loading: true, isStopping: true })
    const stopBtn = w.find('[data-testid="stop-button"]')
    expect(stopBtn.exists()).toBe(true)
    expect(stopBtn.attributes('disabled')).toBeDefined()
  })
})
