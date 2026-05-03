/**
 * 合同审查 · 风险卡 Layout A/C 切换 E2E 测试（PR 4）· **蓝图状态**
 *
 * ⚠️ 项目当前未安装 @playwright/test，本文件为未来 playwright 工具链 PR 启用后的执行底稿。
 * PR 4 验收用 chrome-devtools MCP 手动跑（详见 plan Task 8 Step 8.4）。
 *
 * 测试目标：验证"切换布局 Tabs → 风险卡 DOM 跟随重渲染 → localStorage 偏好持久化 → 重新加载后偏好仍在"。
 *
 * 前置条件：
 * - 开发服务器在 http://localhost:3000 运行（`bun dev`）
 * - 测试账号名下至少有一份 status=completed 的合同审查（手动预创建）
 * - 测试账号：13064768490 / daixin88（见 .env.testing）
 *
 * 未来启用 playwright 后运行命令：
 *   bun add -D @playwright/test && npx playwright install chromium
 *   npx playwright test tests/e2e/contract-review-risk-card-layout.spec.ts
 *
 * 不覆盖：
 * - PR 3 的 quote 字符级高亮（取决于 PR 3 是否合）
 * - DocxPreview 的字符级高亮（PR 5 范围）
 */

import { test, expect } from '@playwright/test'

const BASE_URL = 'http://localhost:3000'
const CONTRACT_LIST_PATH = '/dashboard/assistant/contract'  // 视实际路由调整
const NAV_TIMEOUT = 10_000
const STATE_TIMEOUT = 8_000

test.describe('合同审查 · 风险卡 Layout 切换 E2E', () => {
    test.beforeEach(async ({ page }) => {
        // 登录
        await page.goto(`${BASE_URL}/login`)
        await page.getByLabel('手机号').fill('13064768490')
        await page.getByLabel('密码').fill('daixin88')
        await page.getByRole('button', { name: '登录' }).click()
        await page.waitForURL(`${BASE_URL}/dashboard/**`, { timeout: NAV_TIMEOUT })

        // 清理 localStorage 偏好，确保用例从默认 stacked 起步
        await page.evaluate(() => localStorage.removeItem('contract-review-risk-card-layout'))

        // 进入第一份 completed 合同审查（Step 8.2.5 已在列表行加 data-testid）
        await page.goto(`${BASE_URL}${CONTRACT_LIST_PATH}`)
        await page.waitForLoadState('networkidle')
        await page.locator('[data-testid="contract-review-list-item"]').first().click()
        await page.waitForLoadState('networkidle')

        // 等顶部布局 Tabs 出现（验证 RiskListPanel 已 mount）
        await page.locator('[data-testid="risk-card-layout-tabs"]').waitFor({ timeout: STATE_TIMEOUT })

        // 展开第一条风险卡（让 RiskClauseDiff 进入 DOM）
        const firstRiskCard = page.locator('[data-risk-id]').first()
        await firstRiskCard.scrollIntoViewIfNeeded()
        await firstRiskCard.click()
    })

    test('场景 1：默认 stacked → 切换 inline-diff → DOM 跟随变化', async ({ page }) => {
        const tabs = page.locator('[data-testid="risk-card-layout-tabs"]')

        // 默认 stacked：可见 "完整原文" 小标题 + "建议改写" 小标题（Layout A 标识文案）
        await expect(page.locator('text=完整原文').first()).toBeVisible()
        await expect(page.locator('text=建议改写').first()).toBeVisible()

        // 切换到 inline-diff
        await tabs.getByRole('tab', { name: '对照' }).click()
        // 等动画 + 重渲染
        await page.waitForTimeout(300)

        // inline-diff：应可见"原文 → 建议（行内差异）"小标题；不应再出现 stacked 模式的"完整原文"标题
        await expect(page.locator('text=原文 → 建议（行内差异）').first()).toBeVisible()
        await expect(page.locator('text=完整原文')).toHaveCount(0)
    })

    test('场景 2：localStorage 偏好持久化 · 切换后刷新页面仍是 inline-diff', async ({ page }) => {
        const tabs = page.locator('[data-testid="risk-card-layout-tabs"]')
        await tabs.getByRole('tab', { name: '对照' }).click()
        await page.waitForTimeout(300)

        // 验证 localStorage 已写入（@vueuse/core string serializer 存裸字符串，无 JSON 引号）
        const stored = await page.evaluate(() =>
            localStorage.getItem('contract-review-risk-card-layout'),
        )
        expect(stored).toBe('inline-diff')

        // 重载页面
        await page.reload()
        await page.waitForLoadState('networkidle')
        await page.locator('[data-testid="risk-card-layout-tabs"]').waitFor({ timeout: STATE_TIMEOUT })

        // 展开第一条风险卡
        const firstRiskCard = page.locator('[data-risk-id]').first()
        await firstRiskCard.click()

        // 渲染应直接是 inline-diff
        await expect(page.locator('text=原文 → 建议（行内差异）').first()).toBeVisible()
    })

    test('场景 3：切回 stacked → 偏好同步切回', async ({ page }) => {
        const tabs = page.locator('[data-testid="risk-card-layout-tabs"]')

        await tabs.getByRole('tab', { name: '对照' }).click()
        await page.waitForTimeout(200)

        await tabs.getByRole('tab', { name: '分段' }).click()
        await page.waitForTimeout(200)

        const stored = await page.evaluate(() =>
            localStorage.getItem('contract-review-risk-card-layout'),
        )
        // 裸字符串，无 JSON 引号
        expect(stored).toBe('stacked')
        await expect(page.locator('text=完整原文').first()).toBeVisible()
    })
})
