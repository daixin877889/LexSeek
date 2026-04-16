/**
 * 小索对话停止按钮和消息队列 E2E 测试
 *
 * 测试目标：验证小索对话的停止按钮和 FIFO 消息队列在以下场景下的完整行为：
 * 1. 发送消息 → 入队 → 停止 → 队列暂停 → 恢复 → 队列自动派发
 * 2. 队列满时拒绝入队并显示 toast 提示
 * 3. 暂停态下新消息自动入队（不直接发送）
 *
 * 依赖的 data-testid（Phase 4 AiPromptInput.vue 已实现）：
 * - [data-testid="stop-button"]     — 停止当前对话（loading 态）
 * - [data-testid="enqueue-button"]  — 加入发送队列（loading 态）
 * - [data-testid="send-button"]     — 普通发送按钮（非 loading 态）
 *
 * 依赖的 data-testid（Phase 4 AiChatQueueChips.vue 已实现）：
 * - [data-testid="queue-remove"]    — 删除队列中的单条 chip
 * - [data-testid="queue-resume"]    — 恢复队列（暂停态横幅按钮）
 * - [data-testid="queue-clear"]     — 清空队列（暂停态横幅按钮）
 * - [data-testid="queue-brain-icon"]— 深度思考标记（thinking=true 的 chip）
 *
 * ⚠️ 注意：小索浮窗触发入口（悬浮的 XiaosuoIcon 图标）在
 *   app/components/caseDetail/CaseDetailXiaosuo.vue:196-201 没有 data-testid，
 *   通过 class="cursor-pointer" 或 aria-label 选择，或在组件中补充 data-testid="xiaosuo-trigger"。
 *   当前 spec 使用 `.animate-float` class 选择器作为备用方案（唯一的动画图标）。
 *   推荐在执行 E2E 前在组件中添加：data-testid="xiaosuo-trigger"
 *
 * 运行命令（安装 Playwright 后）：
 *   npx playwright test tests/e2e/xiaosuo-chat-queue.spec.ts
 *   npx playwright test tests/e2e/xiaosuo-chat-queue.spec.ts --headed  # 有界面模式
 *   npx playwright test tests/e2e/xiaosuo-chat-queue.spec.ts --debug    # 调试模式
 */

import { test, expect } from '@playwright/test'

// 测试用常量
const BASE_URL = 'http://localhost:3000'
// 使用已有测试案件（确保该案件有完整的分析结果）
const TEST_CASE_ID = 16
const CASE_DETAIL_URL = `${BASE_URL}/dashboard/cases/${TEST_CASE_ID}`

// 等待 AI 流式生成开始（由 loading 态 + stop 按钮出现判断）
const LOADING_TIMEOUT = 10_000
// 等待 AI 回复完成（生成结束后 stop 按钮消失）
const REPLY_TIMEOUT = 30_000
// 队列 chip 出现的超时
const CHIP_TIMEOUT = 3_000
// toast 出现的超时
const TOAST_TIMEOUT = 5_000

test.describe('小索对话停止按钮和队列 E2E', () => {
  // 前置条件：登录并打开案件详情页
  test.beforeEach(async ({ page }) => {
    // 访问登录页并执行登录
    await page.goto(`${BASE_URL}/login`)
    // 填写测试账号（见 .env.testing：13064768490 / daixin88）
    await page.getByLabel('手机号').fill('13064768490')
    await page.getByLabel('密码').fill('daixin88')
    await page.getByRole('button', { name: '登录' }).click()

    // 等待跳转到 dashboard
    await page.waitForURL(`${BASE_URL}/dashboard/**`)

    // 导航到目标案件详情页
    await page.goto(CASE_DETAIL_URL)
    await page.waitForLoadState('networkidle')

    // 等待页面主体内容渲染
    await page.waitForSelector('header', { state: 'visible' })
  })

  /**
   * 测试 1：发送 → 入队 → 停止 → 队列暂停 → 恢复 → 派发下一条
   *
   * 完整的停止 + 队列恢复流程验证：
   * 1. 打开小索浮窗
   * 2. 发送第一条消息，等待 AI 开始流式生成（出现 stop-button）
   * 3. 在 loading 态输入第二条，点击 enqueue-button，断言 chip 出现
   * 4. 点击 stop-button，断言队列横幅切换为暂停态（"队列已暂停"）
   * 5. 点击 queue-resume，等待第二条消息的 AI 回复出现
   * 6. 断言队列 chip 最终消失（队列派发完毕）
   */
  test('场景 1：发送 → 入队 → 停止 → 队列暂停 → 恢复 → 派发下一条', async ({ page }) => {
    // === Step 1：打开小索浮窗 ===
    // ⚠️ 小索触发图标（CaseDetailXiaosuo.vue:196-201）当前无 data-testid
    //    推荐补充：data-testid="xiaosuo-trigger"
    //    临时方案：用动画类 .animate-float 选择悬浮图标（桌面端唯一的动画浮动图标）
    const xiaosuoTrigger = page.locator('.animate-float').first()
    await xiaosuoTrigger.click()

    // 等待小索对话窗出现（标题"小索"或对话容器可见）
    await page.waitForSelector('text=小索', { state: 'visible', timeout: 5000 })

    // === Step 2：发送第一条消息 ===
    const chatInput = page.getByPlaceholder('问我任何关于案件的问题...')
    await chatInput.fill('请简单介绍一下这个案件的基本情况')
    await chatInput.press('Enter')

    // 等待 AI 开始流式生成（stop-button 出现表示进入 loading 态）
    const stopButton = page.getByTestId('stop-button')
    await stopButton.waitFor({ state: 'visible', timeout: LOADING_TIMEOUT })

    // === Step 3：在 loading 态输入第二条消息并入队 ===
    await chatInput.fill('案件的主要争议焦点是什么？')

    // 点击加入队列按钮
    const enqueueButton = page.getByTestId('enqueue-button')
    await enqueueButton.waitFor({ state: 'visible' })
    await enqueueButton.click()

    // 断言：队列 chip 出现（队列横幅显示"排队中"）
    await page.waitForSelector('text=排队中', { state: 'visible', timeout: CHIP_TIMEOUT })

    // === Step 4：点击停止按钮 ===
    await stopButton.click()

    // 断言：横幅切换为"队列已暂停"（暂停态）
    await page.waitForSelector('text=队列已暂停', { state: 'visible', timeout: 5000 })
    // 恢复按钮和清空按钮也应出现
    await expect(page.getByTestId('queue-resume')).toBeVisible()
    await expect(page.getByTestId('queue-clear')).toBeVisible()

    // === Step 5：点击恢复队列 ===
    await page.getByTestId('queue-resume').click()

    // 等待队列恢复派发，第二条消息被发送并得到 AI 回复
    // 派发后 loading 态再次出现（stop-button 可见），等待完成后消失
    await stopButton.waitFor({ state: 'visible', timeout: LOADING_TIMEOUT })
    await stopButton.waitFor({ state: 'hidden', timeout: REPLY_TIMEOUT })

    // === Step 6：断言队列 chip 消失（队列已清空） ===
    await expect(page.locator('text=排队中')).not.toBeVisible()
    await expect(page.locator('text=队列已暂停')).not.toBeVisible()
  })

  /**
   * 测试 2：队列满拒绝入队 + toast 提示
   *
   * 验证队列容量上限（5条）的边界行为：
   * 1. 发送第一条消息，等待 loading 态
   * 2. 连续点击 enqueue-button 5 次（填满队列）
   * 3. 第 6 次点击 → 断言 toast 显示"队列已满"
   * 4. 断言输入框内容保留（不被清空）
   */
  test('场景 2：队列满拒绝入队 + toast 提示', async ({ page }) => {
    // 打开小索浮窗
    const xiaosuoTrigger = page.locator('.animate-float').first()
    await xiaosuoTrigger.click()
    await page.waitForSelector('text=小索', { state: 'visible', timeout: 5000 })

    // 发送第一条消息，等待 loading 态
    const chatInput = page.getByPlaceholder('问我任何关于案件的问题...')
    await chatInput.fill('请分析此案的法律适用问题')
    await chatInput.press('Enter')

    const stopButton = page.getByTestId('stop-button')
    await stopButton.waitFor({ state: 'visible', timeout: LOADING_TIMEOUT })

    const enqueueButton = page.getByTestId('enqueue-button')

    // 连续入队 5 次（填满）
    for (let i = 1; i <= 5; i++) {
      await chatInput.fill(`队列测试消息第 ${i} 条`)
      await enqueueButton.click()
      // 等待 chip 数量更新（队列 chip 应出现/增加）
      await page.waitForTimeout(300)
    }

    // 断言：队列横幅显示 5/5
    await page.waitForSelector('text=排队中 (5/5)', { state: 'visible', timeout: CHIP_TIMEOUT })

    // 第 6 次入队 → 应触发 toast"队列已满"
    await chatInput.fill('第六条消息（应被拒绝）')
    await enqueueButton.click()

    // 断言：toast 出现（vue-sonner 的 toast 容器）
    // ⚠️ toast 文案来自 CaseDetailXiaosuo.vue handleSubmit：`队列已满（最多 5 条），请等待当前对话结束或清空队列`
    await page.waitForSelector('text=队列已满', { state: 'visible', timeout: TOAST_TIMEOUT })

    // 断言：输入框内容未被清空（拒绝入队时不 reset 输入框）
    await expect(chatInput).toHaveValue('第六条消息（应被拒绝）')
  })

  /**
   * 测试 3：暂停态下新消息自动入队（不直接发送）
   *
   * 验证暂停态的强制入队行为（spec §5.3）：
   * 1. 触发停止进入暂停态（先发一条消息 + 停止）
   * 2. 在暂停态下输入新消息并回车
   * 3. 断言消息未直接发送，而是自动入队（chip 数量 +1）
   * 4. 点击清空按钮 → 队列清空 + 暂停标记自动解除（死锁防护）
   * 5. 断言恢复到普通态（enqueue-button 消失，send-button 出现）
   */
  test('场景 3：暂停态下新消息自动入队，清空队列后自动解除暂停', async ({ page }) => {
    // 打开小索浮窗
    const xiaosuoTrigger = page.locator('.animate-float').first()
    await xiaosuoTrigger.click()
    await page.waitForSelector('text=小索', { state: 'visible', timeout: 5000 })

    // 发送消息 + 等待 loading
    const chatInput = page.getByPlaceholder('问我任何关于案件的问题...')
    await chatInput.fill('请列举案件的关键证据')
    await chatInput.press('Enter')

    const stopButton = page.getByTestId('stop-button')
    await stopButton.waitFor({ state: 'visible', timeout: LOADING_TIMEOUT })

    // 在 loading 态入队一条（确保队列非空，否则停止后没有暂停 chip 显示）
    await chatInput.fill('预先入队的消息')
    await page.getByTestId('enqueue-button').click()
    await page.waitForSelector('text=排队中', { state: 'visible', timeout: CHIP_TIMEOUT })

    // 点击停止 → 进入暂停态
    await stopButton.click()
    await page.waitForSelector('text=队列已暂停', { state: 'visible', timeout: 5000 })

    // 记录当前 chip 数量（应为 1）
    const chipCountBefore = await page.locator('[data-testid="queue-remove"]').count()
    expect(chipCountBefore).toBe(1)

    // 在暂停态下输入新消息 + 回车
    await chatInput.fill('暂停态下新输入的消息')
    await chatInput.press('Enter')

    // 断言：新消息未直接发送（stop-button 不出现），而是自动入队（chip 数量 +1）
    await expect(stopButton).not.toBeVisible()
    const chipCountAfter = await page.locator('[data-testid="queue-remove"]').count()
    expect(chipCountAfter).toBe(chipCountBefore + 1) // chip 增加了 1

    // 点击清空队列
    await page.getByTestId('queue-clear').click()

    // 断言：队列清空 + 暂停标记解除（死锁防护 spec §5.3 / §8.1 #17）
    // 暂停横幅和 chip 都消失
    await expect(page.locator('text=队列已暂停')).not.toBeVisible()
    await expect(page.locator('[data-testid="queue-remove"]')).toHaveCount(0)

    // 确认输入框可以直接发送（send-button 可见，而非 enqueue-button）
    await chatInput.fill('清空队列后的普通消息')
    await expect(page.getByTestId('send-button')).toBeVisible()
  })
})
