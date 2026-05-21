/**
 * 合同审查 · 风险详情抽屉 分段/对照 切换 E2E 测试 · **蓝图状态**
 *
 * ⚠️ 项目当前未安装 @playwright/test，本文件为未来 playwright 工具链启用后的执行底稿。
 * 重做验收用 chrome-devtools MCP 手动跑。
 *
 * 测试目标：验证"点风险卡 → 打开详情抽屉 → 抽屉内切分段/对照 → DOM 跟随重渲染 →
 * localStorage 偏好持久化 → 重新加载后偏好仍在"。
 *
 * 重做说明：分段/对照段控原在风险清单顶部，重做后移入风险详情抽屉（RiskDetailPanel）。
 *
 * 前置条件：
 * - 开发服务器在 http://localhost:3000 运行（`bun dev`）
 * - 测试账号名下至少有一份 status=completed 的合同审查（手动预创建）
 * - 测试账号：13064768490 / daixin88（见 .env.testing）
 *
 * 未来启用 playwright 后运行命令：
 *   bun add -D @playwright/test && npx playwright install chromium
 *   npx playwright test tests/e2e/contract-review-risk-card-layout.spec.ts
 */

import { test, expect } from '@playwright/test'

const BASE_URL = 'http://localhost:3000'
const CONTRACT_LIST_PATH = '/dashboard/contract'
const NAV_TIMEOUT = 10_000
const STATE_TIMEOUT = 8_000

test.describe('合同审查 · 风险详情抽屉 分段/对照 切换 E2E', () => {
    test.beforeEach(async ({ page }) => {
        // 登录
        await page.goto(`${BASE_URL}/login`)
        await page.getByLabel('手机号').fill('13064768490')
        await page.getByLabel('密码').fill('daixin88')
        await page.getByRole('button', { name: '登录' }).click()
        await page.waitForURL(`${BASE_URL}/dashboard/**`, { timeout: NAV_TIMEOUT })

        // 清理 localStorage 偏好，确保用例从默认 stacked 起步
        await page.evaluate(() => localStorage.removeItem('contract-review-risk-card-layout'))

        // 进入第一份 completed 合同审查
        await page.goto(`${BASE_URL}${CONTRACT_LIST_PATH}`)
        await page.waitForLoadState('networkidle')
        await page.locator('[data-testid="contract-review-list-item"]').first().click()
        await page.waitForLoadState('networkidle')

        // 点第一条风险卡 → 打开风险详情抽屉
        const firstRiskCard = page.locator('[data-risk-id]').first()
        await firstRiskCard.scrollIntoViewIfNeeded()
        await firstRiskCard.click()
        // 等抽屉出现（关闭按钮是抽屉独有标识）
        await page.locator('[aria-label="关闭详情"]').waitFor({ timeout: STATE_TIMEOUT })
    })

    test('场景 1：默认 stacked → 切换 对照 → 抽屉内 DOM 跟随变化', async ({ page }) => {
        // 默认 stacked：抽屉内可见 "完整原文" + "建议改写" 小标题（分段模式标识文案）
        await expect(page.locator('text=完整原文').first()).toBeVisible()
        await expect(page.locator('text=建议改写').first()).toBeVisible()

        // 抽屉内切换到 对照
        await page.getByRole('button', { name: '对照', exact: true }).click()
        await page.waitForTimeout(300)

        // 对照模式：可见"原文 → 建议（行内差异）"小标题；不再出现"完整原文"
        await expect(page.locator('text=原文 → 建议（行内差异）').first()).toBeVisible()
        await expect(page.locator('text=完整原文')).toHaveCount(0)
    })

    test('场景 2：localStorage 偏好持久化 · 切换后刷新页面仍是 对照', async ({ page }) => {
        await page.getByRole('button', { name: '对照', exact: true }).click()
        await page.waitForTimeout(300)

        // 验证 localStorage 已写入（@vueuse/core string serializer 存裸字符串，无 JSON 引号）
        const stored = await page.evaluate(() =>
            localStorage.getItem('contract-review-risk-card-layout'),
        )
        expect(stored).toBe('inline-diff')

        // 重载页面，重新打开抽屉
        await page.reload()
        await page.waitForLoadState('networkidle')
        const firstRiskCard = page.locator('[data-risk-id]').first()
        await firstRiskCard.click()
        await page.locator('[aria-label="关闭详情"]').waitFor({ timeout: STATE_TIMEOUT })

        // 渲染应直接是 对照模式
        await expect(page.locator('text=原文 → 建议（行内差异）').first()).toBeVisible()
    })

    test('场景 3：切回 分段 → 偏好同步切回', async ({ page }) => {
        await page.getByRole('button', { name: '对照', exact: true }).click()
        await page.waitForTimeout(200)
        await page.getByRole('button', { name: '分段', exact: true }).click()
        await page.waitForTimeout(200)

        const stored = await page.evaluate(() =>
            localStorage.getItem('contract-review-risk-card-layout'),
        )
        // 裸字符串，无 JSON 引号
        expect(stored).toBe('stacked')
        await expect(page.locator('text=完整原文').first()).toBeVisible()
    })
})
