/**
 * 模块对话历史消息加载 E2E 测试
 *
 * 测试目标：验证模块对话框在以下场景下能正确加载历史消息
 * 1. 新建对话 → 发送消息 → AI 回复 → 历史消息正确显示
 * 2. 页面刷新 → 展开对话模块 → 历史消息从 checkpoint 正确恢复
 * 3. 发送第二条消息 → AI 回复 → 所有历史消息正确追加
 * 4. 再次刷新 → 展开对话 → 所有消息（含多条人机对话）正确显示
 *
 * 核心需求：
 * - 需求 1：非运行中对话，只返回 values 消息（从 PostgresSaver checkpoint），加快渲染
 * - 需求 2：运行中对话，先返回 values 补发历史，再继续发送实时消息
 * - 需求 3：发送新消息应继续会话（非新建 session）
 */

import { test, expect } from '@playwright/test'

test.describe('模块对话历史消息加载', () => {
  const TEST_MESSAGE_1 = '测试消息 1：请回复"收到 1"'
  const TEST_MESSAGE_2 = '测试消息 2：请回复"收到 2"'
  const TEST_MESSAGE_3 = '测试消息 3：请回复"收到 3"'
  const MODULE_NAME = '争议焦点归纳' // 使用第一个模块

  test.beforeEach(async ({ page }) => {
    // 访问案件分析页面（假设已有案件）
    await page.goto('/dashboard/cases')
    // TODO: 需要确保有一个已完成的分析案件
    // 可以点击第一个案件进入分析页面
    await page.getByRole('link', { name: /案件名称/ }).first().click()
    await page.getByRole('tab', { name: '分析结果' }).click()
    // 等待分析结果页面加载完成
    await page.waitForLoadState('networkidle')
  })

  test('场景 1：新建对话并发送第一条消息', async ({ page }) => {
    // 1. 展开争议焦点归纳模块对话框
    await page.getByRole('button', { name: MODULE_NAME }).click()
    // 等待对话框展开且加载完成
    await page.waitForSelector('[data-testid="module-chat-window"]', { state: 'visible' })
    await page.waitForTimeout(1000) // 等待历史加载完成

    // 2. 验证初始状态：无历史消息
    const messagesContainer = page.getByTestId('chat-messages')
    await expect(messagesContainer).toBeEmpty()

    // 3. 发送第一条消息
    await page.getByTestId('chat-input').fill(TEST_MESSAGE_1)
    await page.getByTestId('chat-send-button').click()

    // 4. 等待 AI 回复
    await page.waitForTimeout(3000) // 等待 AI 响应
    await page.getByTestId('chat-messages').getByText(/收到 1/).first().waitFor({ state: 'visible' })

    // 5. 验证消息列表：1 条用户消息 + 1 条 AI 回复
    const userMessages = page.getByTestId('user-message')
    const aiMessages = page.getByTestId('ai-message')
    await expect(userMessages).toHaveCount(1)
    await expect(aiMessages).toHaveCount(1)

    // 6. 收起对话框
    await page.getByTestId('chat-close-button').click()
    await page.waitForTimeout(500)
  })

  test('场景 2：页面刷新后展开对话，历史消息正确恢复', async ({ page }) => {
    // 前置：发送一条消息（复用场景 1 的逻辑）
    await page.getByRole('button', { name: MODULE_NAME }).click()
    await page.waitForTimeout(1000)
    await page.getByTestId('chat-input').fill(TEST_MESSAGE_1)
    await page.getByTestId('chat-send-button').click()
    await page.waitForTimeout(3000)
    await page.getByTestId('chat-messages').getByText(/收到 1/).first().waitFor({ state: 'visible' })
    await page.getByTestId('chat-close-button').click()
    await page.waitForTimeout(500)

    // 1. 刷新页面
    await page.reload()
    await page.waitForLoadState('networkidle')
    // 重新进入分析结果页面
    await page.getByRole('tab', { name: '分析结果' }).click()
    await page.waitForTimeout(2000)

    // 2. 展开对话模块
    await page.getByRole('button', { name: MODULE_NAME }).click()
    await page.waitForTimeout(2000) // 等待历史加载

    // 3. 验证历史消息正确恢复
    const userMessages = page.getByTestId('user-message')
    const aiMessages = page.getByTestId('ai-message')
    await expect(userMessages).toHaveCount(1)
    await expect(aiMessages).toHaveCount(1)
    await expect(page.getByText(TEST_MESSAGE_1)).toBeVisible()
    await expect(page.getByText(/收到 1/)).toBeVisible()

    // 4. 收起对话框
    await page.getByTestId('chat-close-button').click()
    await page.waitForTimeout(500)
  })

  test('场景 3：发送第二条消息并追加到历史', async ({ page }) => {
    // 前置：已有一条历史消息（复用场景 2 的逻辑）
    await page.getByRole('button', { name: MODULE_NAME }).click()
    await page.waitForTimeout(1000)
    await page.getByTestId('chat-input').fill(TEST_MESSAGE_1)
    await page.getByTestId('chat-send-button').click()
    await page.waitForTimeout(3000)
    await page.getByTestId('chat-messages').getByText(/收到 1/).first().waitFor({ state: 'visible' })
    await page.getByTestId('chat-close-button').click()
    await page.waitForTimeout(500)

    // 1. 重新展开对话框
    await page.getByRole('button', { name: MODULE_NAME }).click()
    await page.waitForTimeout(1000)

    // 2. 发送第二条消息
    await page.getByTestId('chat-input').fill(TEST_MESSAGE_2)
    await page.getByTestId('chat-send-button').click()
    await page.waitForTimeout(3000)
    await page.getByTestId('chat-messages').getByText(/收到 2/).first().waitFor({ state: 'visible' })

    // 3. 验证消息列表：2 条用户消息 + 2 条 AI 回复
    const userMessages = page.getByTestId('user-message')
    const aiMessages = page.getByTestId('ai-message')
    await expect(userMessages).toHaveCount(2)
    await expect(aiMessages).toHaveCount(2)
    await expect(page.getByText(TEST_MESSAGE_1)).toBeVisible()
    await expect(page.getByText(TEST_MESSAGE_2)).toBeVisible()

    // 4. 收起对话框
    await page.getByTestId('chat-close-button').click()
    await page.waitForTimeout(500)
  })

  test('场景 4：多次刷新后所有历史消息正确显示', async ({ page }) => {
    // 前置：发送两条消息
    await page.getByRole('button', { name: MODULE_NAME }).click()
    await page.waitForTimeout(1000)

    // 发送第一条
    await page.getByTestId('chat-input').fill(TEST_MESSAGE_1)
    await page.getByTestId('chat-send-button').click()
    await page.waitForTimeout(3000)
    await page.getByTestId('chat-messages').getByText(/收到 1/).first().waitFor({ state: 'visible' })

    // 发送第二条
    await page.getByTestId('chat-input').fill(TEST_MESSAGE_2)
    await page.getByTestId('chat-send-button').click()
    await page.waitForTimeout(3000)
    await page.getByTestId('chat-messages').getByText(/收到 2/).first().waitFor({ state: 'visible' })
    await page.getByTestId('chat-close-button').click()
    await page.waitForTimeout(500)

    // 1. 刷新页面
    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.getByRole('tab', { name: '分析结果' }).click()
    await page.waitForTimeout(2000)

    // 2. 展开对话框
    await page.getByRole('button', { name: MODULE_NAME }).click()
    await page.waitForTimeout(2000)

    // 3. 验证所有历史消息
    const userMessages = page.getByTestId('user-message')
    const aiMessages = page.getByTestId('ai-message')
    await expect(userMessages).toHaveCount(2)
    await expect(aiMessages).toHaveCount(2)
    await expect(page.getByText(TEST_MESSAGE_1)).toBeVisible()
    await expect(page.getByText(TEST_MESSAGE_2)).toBeVisible()
    await expect(page.getByText(/收到 1/)).toBeVisible()
    await expect(page.getByText(/收到 2/)).toBeVisible()

    // 4. 发送第三条消息验证继续会话
    await page.getByTestId('chat-input').fill(TEST_MESSAGE_3)
    await page.getByTestId('chat-send-button').click()
    await page.waitForTimeout(3000)
    await page.getByTestId('chat-messages').getByText(/收到 3/).first().waitFor({ state: 'visible' })

    // 5. 验证消息列表：3 条用户消息 + 3 条 AI 回复
    await expect(userMessages).toHaveCount(3)
    await expect(aiMessages).toHaveCount(3)
  })

  test('场景 5：并发对话（多个模块同时发送消息）', async ({ page }) => {
    const MODULE_2 = '证据清单生成'

    // 1. 展开争议焦点模块并发送消息
    await page.getByRole('button', { name: MODULE_NAME }).click()
    await page.waitForTimeout(1000)
    await page.getByTestId('chat-input').fill(TEST_MESSAGE_1)
    await page.getByTestId('chat-send-button').click()
    await page.waitForTimeout(3000)

    // 2. 不收起第一个对话框，直接展开第二个模块
    await page.getByRole('button', { name: MODULE_2 }).click()
    await page.waitForTimeout(1000)
    await page.getByTestId('chat-input').fill(TEST_MESSAGE_2)
    await page.getByTestId('chat-send-button').click()
    await page.waitForTimeout(3000)

    // 3. 验证两个模块的消息独立
    await expect(page.getByText(TEST_MESSAGE_1)).toBeVisible()
    await expect(page.getByText(TEST_MESSAGE_2)).toBeVisible()

    // 4. 收起所有对话框
    await page.getByTestId('chat-close-button').click()
    await page.waitForTimeout(500)

    // 5. 重新展开第一个模块，验证历史消息仍存在
    await page.getByRole('button', { name: MODULE_NAME }).click()
    await page.waitForTimeout(1000)
    await expect(page.getByText(TEST_MESSAGE_1)).toBeVisible()
    await expect(page.getByText(/收到 1/)).toBeVisible()
    // 第二个模块的消息不应出现在第一个模块中
    await expect(page.getByText(TEST_MESSAGE_2)).not.toBeVisible()
  })

  test('场景 6：快速连续发送多条消息', async ({ page }) => {
    // 1. 展开对话框
    await page.getByRole('button', { name: MODULE_NAME }).click()
    await page.waitForTimeout(1000)

    // 2. 快速连续发送 3 条消息
    await page.getByTestId('chat-input').fill('消息 A')
    await page.getByTestId('chat-send-button').click()
    await page.getByTimeout(500) // 不等待响应，立即发送下一条

    await page.getByTestId('chat-input').fill('消息 B')
    await page.getByTestId('chat-send-button').click()
    await page.getByTimeout(500)

    await page.getByTestId('chat-input').fill('消息 C')
    await page.getByTestId('chat-send-button').click()

    // 3. 等待所有 AI 回复
    await page.waitForTimeout(10000)

    // 4. 验证所有消息都正确显示
    await expect(page.getByText('消息 A')).toBeVisible()
    await expect(page.getByText('消息 B')).toBeVisible()
    await expect(page.getByText('消息 C')).toBeVisible()
    const aiMessages = page.getByTestId('ai-message')
    await expect(aiMessages).toHaveCount(3)
  })
})
