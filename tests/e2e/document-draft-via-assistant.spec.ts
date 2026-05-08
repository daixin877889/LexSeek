/**
 * 端到端:法律助手起草起诉状(原始 bug 路径)
 *
 * 用 chrome-devtools MCP 跑真实浏览器,验证三入口共享同一组工具的行为一致。
 * 主要覆盖法律助手对话 → 调起草 → 选模板 → 字段被填好的全流程。
 *
 * 测试目标:验证 spec §11 决策 1 "原始 bug 永不重现" — 法律助手讲完案情后
 * "draft_document: 文书 Agent 起草失败" 错误不会再出现。
 */

import { describe, it, expect } from 'vitest'

// 注:具体 e2e 框架如何调用 chrome-devtools MCP 工具,参考项目其他 e2e spec
// 本文件当前是骨架,标记为 skip;待 chrome-devtools MCP e2e 基建完善后填充实际逻辑
describe.skip('e2e: 法律助手起草起诉状', () => {
    it('完整流程:对话讲案情 → 起草 → 选模板 → 草稿 ready', async () => {
        // 1. 启动浏览器,登录测试账号
        // 2. 访问 /dashboard/assistant
        // 3. 输入完整案情(房屋租赁纠纷)
        // 4. 等 LLM 回复
        // 5. 输入"帮我起草起诉状"
        // 6. 等 TemplateSelectCard 出现
        // 7. 选《民事起诉状(公民提起民事诉讼用)》提交
        // 8. 等草稿生成完成(SSE event DRAFT_SAVED)
        // 9. 跳转到 /dashboard/document/drafts/<id>
        // 10. 验证 draft.status='ready'
        // 11. 验证关键字段非 null:事实和理由 / 诉讼请求 / 原告

        expect(true).toBe(true) // 占位,实施时填充真实逻辑
    })
})
