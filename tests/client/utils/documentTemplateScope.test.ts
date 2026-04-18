/**
 * documentTemplateScope 工具测试
 *
 * **Feature: assistant-document-templates (#6)**
 * **Validates: 我的文书模板页"归属"徽章与配额计数语义**
 *
 * 背景：admin 用户上传 .docx 模板后，后端强制落库为 scope='global'、userId=null。
 * 页面若固定按 scope='user' 查询，admin 上传的模板将永远不显示。
 * 修复方向：前端改为混合视图（不传 scope）+ 在列表新增"归属"列。
 * 由于后端 list 返回的 total 变成"混合总数"（global + 当前用户 user），
 * 前端需要自行用 scope='user' 过滤出真正的配额计数。
 */

import { describe, it, expect } from 'vitest'
import {
    getScopeBadge,
    countUserScopeTemplates,
} from '~/utils/documentTemplateScope'

describe('getScopeBadge 归属徽章映射', () => {
    it('scope=global 返回"全局"标签 + secondary 变体', () => {
        expect(getScopeBadge('global')).toEqual({ label: '全局', variant: 'secondary' })
    })

    it('scope=user 返回"我的"标签 + default 变体', () => {
        expect(getScopeBadge('user')).toEqual({ label: '我的', variant: 'default' })
    })

    it('未知 scope 回退到"全局"（容错）', () => {
        expect(getScopeBadge('unknown')).toEqual({ label: '全局', variant: 'secondary' })
    })
})

describe('countUserScopeTemplates 配额计数', () => {
    it('仅统计 scope=user 的条目', () => {
        const list = [
            { scope: 'global' as const },
            { scope: 'user' as const },
            { scope: 'user' as const },
            { scope: 'global' as const },
        ]
        expect(countUserScopeTemplates(list)).toBe(2)
    })

    it('空列表返回 0', () => {
        expect(countUserScopeTemplates([])).toBe(0)
    })

    it('全是 global 返回 0（admin 视角）', () => {
        const list = [{ scope: 'global' as const }, { scope: 'global' as const }]
        expect(countUserScopeTemplates(list)).toBe(0)
    })
})
