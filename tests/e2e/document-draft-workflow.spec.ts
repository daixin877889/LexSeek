/**
 * 文书生成核心链路 E2E 测试
 *
 * 测试目标：验证"选模板 → 工作区 → 手填字段 → 持久化 → 返回首页 → 再次进入 → 值仍在 → 唤起 AI 窗"
 *           这条原始需求 #1 的主干链路端到端可用（不覆盖 AI 回复与材料上传）。
 *
 * 前置条件：
 * - 开发服务器在 http://localhost:3000 运行（`bun dev`）
 * - 至少存在一个 scope=global 的文书模板（seedData.sql 已提供民事起诉状等）
 * - 测试账号：13064768490 / daixin88（见 .env.testing）
 *
 * 运行命令（安装 Playwright 后）：
 *   npx playwright test tests/e2e/document-draft-workflow.spec.ts
 *   npx playwright test tests/e2e/document-draft-workflow.spec.ts --headed   # 有界面模式
 *   npx playwright test tests/e2e/document-draft-workflow.spec.ts --debug    # 调试模式
 *
 * ⚠️ 选择器说明：
 * 当前组件大量依赖文案/结构选择器（未引入 data-testid）。若后续出现文案漂移，
 * 建议补充如下 data-testid：
 *   - DocumentTemplatePicker.vue     → 模板卡片按钮      data-testid="doc-template-card"
 *   - DocumentFieldForm.vue          → 字段输入框        data-testid="doc-field-input"
 *   - DraftList.vue "进入" 按钮       → data-testid="draft-open-btn"
 *   - drafts/[id].vue "AI 生成"       → data-testid="doc-ai-trigger"
 *   - drafts/[id].vue "返回"          → data-testid="doc-back-btn"
 *   - drafts/[id].vue "导出 .docx"   → data-testid="doc-export-btn"
 *
 * 不覆盖场景（需要在独立 spec 或手动验证）：
 * - AI 真正回复（依赖 LLM 服务稳定性，且耗时不可控）
 * - 材料文件上传（依赖 OSS 上传链路与预置素材）
 * - 导出 .docx 文件下载校验（依赖浏览器下载行为）
 */

import { test, expect } from '@playwright/test'

// 测试用常量
const BASE_URL = 'http://localhost:3000'
const DOCUMENT_HOME = `${BASE_URL}/dashboard/document`

// 输入字段持久化等待时间：FieldForm 内 useDebounceFn 500ms + 服务端写入冗余
const PATCH_DEBOUNCE_WAIT = 1_200
// 页面跳转与组件挂载的通用超时
const NAV_TIMEOUT = 10_000
// 模板卡片列表加载超时
const LIST_TIMEOUT = 8_000

test.describe('文书生成核心链路 E2E', () => {
  // 前置：登录并进入文书生成首页
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    await page.getByLabel('手机号').fill('13064768490')
    await page.getByLabel('密码').fill('daixin88')
    await page.getByRole('button', { name: '登录' }).click()

    // 登录后进入 dashboard
    await page.waitForURL(`${BASE_URL}/dashboard/**`, { timeout: NAV_TIMEOUT })

    // 跳转到文书生成首页
    await page.goto(DOCUMENT_HOME)
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: '文书生成' })).toBeVisible()
  })

  /**
   * 场景 1：核心链路 - 选模板 → 手填 → 返回首页可见 → 再次进入字段仍在 → 唤起 AI 窗
   *
   * 覆盖原始需求 #1 的主干：
   *   Step 1. 选一个 global 模板 → 跳 `/dashboard/document/drafts/:id`
   *   Step 2. 手填一个字段（FieldForm，500ms debounce PATCH）
   *   Step 3. 点"返回" → 回到 /dashboard/document
   *   Step 4. "我的草稿"列表里能看到刚创建的草稿
   *   Step 5. 点"进入" → 回到同一工作区，原字段值仍在
   *   Step 6. 点 "AI 生成" → 悬浮 Agent 窗打开（不发消息、不等 AI 回复）
   *   Step 7. "导出 .docx" 按钮可见（状态可能为 disabled，不强断言）
   */
  test('场景 1：选模板 → 手填 → 返回 → 再次进入字段仍在 → 唤起 AI 窗', async ({ page }) => {
    // === Step 1：先切到 "公共" tab，保证命中 global 模板 ===
    // DocumentTemplatePicker 内 scope tab：全部 / 我的 / 公共
    const scopeTabs = page.getByRole('tab')
    await scopeTabs.getByText('公共', { exact: true }).click()

    // 等第一张模板卡片渲染
    // 卡片结构：<button> ... <FileTextIcon class="lucide-file-text" /> ... </button>
    const firstTemplateCard = page
      .locator('button:has(svg.lucide-file-text)')
      .filter({ hasText: /.+/ })
      .first()
    await firstTemplateCard.waitFor({ state: 'visible', timeout: LIST_TIMEOUT })

    // 点击第一张模板 → 触发 handleTemplateSelect → POST /drafts → 跳工作区
    await firstTemplateCard.click()

    // 工作区路径：/dashboard/document/drafts/:id
    await page.waitForURL(/\/dashboard\/document\/drafts\/\d+/, { timeout: NAV_TIMEOUT })
    const draftUrl = page.url() // 记住 draftId 对应的完整 URL，用于 Step 5 比对

    // 等工作区挂载完成：顶部 "返回" 按钮可见，说明 mountDraft 已完成
    await expect(page.getByRole('button', { name: '返回' })).toBeVisible({
      timeout: NAV_TIMEOUT,
    })

    // === Step 2：手填第一个字段 ===
    // FieldForm 左侧的第一个 <input>（未被折叠的占位符字段）
    // ⚠️ 跳过日期 popover 触发按钮（它是 button 而非 input）
    const firstInput = page.locator('input[placeholder^="请输入"]').first()
    await firstInput.waitFor({ state: 'visible', timeout: NAV_TIMEOUT })

    const testValue = `E2E测试-甲方-${Date.now()}`
    await firstInput.fill(testValue)

    // 等 debounce 500ms + 服务端写入
    await page.waitForTimeout(PATCH_DEBOUNCE_WAIT)

    // 断言：输入框当前值确实是我们填入的
    await expect(firstInput).toHaveValue(testValue)

    // === Step 3：点"返回"回到首页 ===
    await page.getByRole('button', { name: '返回' }).click()
    await page.waitForURL(DOCUMENT_HOME, { timeout: NAV_TIMEOUT })
    await expect(page.getByRole('heading', { name: '文书生成' })).toBeVisible()

    // === Step 4：草稿列表中能看到刚创建的草稿 ===
    // DraftList 组件有 "我的草稿" 标题
    await expect(page.getByRole('heading', { name: '我的草稿' })).toBeVisible({
      timeout: LIST_TIMEOUT,
    })

    // 断言：列表中至少有一条"进入"按钮（说明有草稿行）
    const enterButtons = page.getByRole('button', { name: '进入' })
    await expect(enterButtons.first()).toBeVisible({ timeout: LIST_TIMEOUT })
    const count = await enterButtons.count()
    expect(count).toBeGreaterThanOrEqual(1)

    // === Step 5：点第一个"进入"按钮，应回到同一个 draft ===
    await enterButtons.first().click()
    await page.waitForURL(/\/dashboard\/document\/drafts\/\d+/, { timeout: NAV_TIMEOUT })
    // 最新创建的草稿应该排在第一位，URL 应等于 Step 1 保存的 draftUrl
    expect(page.url()).toBe(draftUrl)

    // 等字段重新挂载
    const reopenedInput = page.locator('input[placeholder^="请输入"]').first()
    await reopenedInput.waitFor({ state: 'visible', timeout: NAV_TIMEOUT })

    // 断言：第一个字段的值仍是 Step 2 填的 testValue（持久化验证）
    await expect(reopenedInput).toHaveValue(testValue, { timeout: NAV_TIMEOUT })

    // === Step 6：点 "AI 生成" → 悬浮 Agent 窗打开 ===
    await page.getByRole('button', { name: 'AI 生成' }).click()

    // AI 窗 AiPromptInput 的 placeholder 为 "告诉 AI 你想怎么填..."（drafts/[id].vue 传入）
    const aiPrompt = page.getByPlaceholder(/告诉 AI/)
    await expect(aiPrompt).toBeVisible({ timeout: NAV_TIMEOUT })

    // === Step 7：导出按钮可见 ===
    // 按钮文案 "导出 .docx"。初始状态可能 disabled（runStatus !== 'ready' | 'exported'），不强断言 enabled
    const exportBtn = page.getByRole('button', { name: /导出\s*\.docx/ })
    await expect(exportBtn).toBeVisible()
  })
})
