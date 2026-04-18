/**
 * documentPlaceholder 工具测试
 *
 * **Feature: assistant-document-placeholder (#7)**
 * **Validates: docx-preview 场景下跨 Text 节点的 {{xxx}} 正确替换**
 *
 * 背景：docx-preview 渲染 Word 模板时，{{xxx}} 会被 Word 的 rsidR 等元数据
 * 拆到多个 <w:r> → 多个 <span> → 多个 Text 节点。逐节点正则匹配无法命中
 * 跨节点的占位符。本工具通过"按块级容器合并 + 正则替换 + 写回第一个节点"
 * 解决该问题，并支持重播（第二次调用覆盖第一次的写入）。
 */

import { describe, it, expect } from 'vitest'
import {
    capturePlaceholderSnapshot,
    replacePlaceholdersWithSnapshot,
    PLACEHOLDER_RE,
} from '~/utils/documentPlaceholder'

function makeRoot(html: string): HTMLElement {
    const root = document.createElement('div')
    root.innerHTML = html
    return root
}

describe('PLACEHOLDER_RE', () => {
    it('matches simple placeholder', () => {
        expect('{{甲方}}'.match(PLACEHOLDER_RE)).toEqual(['{{甲方}}'])
    })

    it('matches placeholder with slash', () => {
        expect('{{法定代理人/指定代理人}}'.match(PLACEHOLDER_RE)).toEqual(['{{法定代理人/指定代理人}}'])
    })

    it('matches underscore / ASCII name', () => {
        expect('{{party_a}}'.match(PLACEHOLDER_RE)).toEqual(['{{party_a}}'])
    })
})

describe('capturePlaceholderSnapshot + replacePlaceholdersWithSnapshot', () => {
    it('replaces single-node placeholder', () => {
        const root = makeRoot('<p>甲方：{{甲方}}，住址：北京</p>')
        const snap = capturePlaceholderSnapshot(root)
        replacePlaceholdersWithSnapshot(snap, { 甲方: '张三' })
        expect(root.textContent).toBe('甲方：张三，住址：北京')
    })

    it('replaces cross-node placeholder split across 3 text nodes', () => {
        const root = makeRoot('<p><span>{{</span><span>甲方</span><span>}}</span></p>')
        const snap = capturePlaceholderSnapshot(root)
        replacePlaceholdersWithSnapshot(snap, { 甲方: '张三' })
        expect(root.textContent).toBe('张三')
    })

    it('replaces placeholder with bracket fragmented into 2 single }', () => {
        const root = makeRoot('<p><span>{{</span><span>工作单位</span><span>}</span><span>}</span></p>')
        const snap = capturePlaceholderSnapshot(root)
        replacePlaceholdersWithSnapshot(snap, { 工作单位: 'LexSeek' })
        expect(root.textContent).toBe('LexSeek')
    })

    it('replaces placeholder containing slash name', () => {
        const root = makeRoot('<p><span>{{</span><span>法定代理人/指定代理人</span><span>}}</span></p>')
        const snap = capturePlaceholderSnapshot(root)
        replacePlaceholdersWithSnapshot(snap, { '法定代理人/指定代理人': '李四' })
        expect(root.textContent).toBe('李四')
    })

    it('leaves unknown placeholder untouched', () => {
        const root = makeRoot('<p>{{未知}}</p>')
        const snap = capturePlaceholderSnapshot(root)
        replacePlaceholdersWithSnapshot(snap, { 甲方: '张三' })
        expect(root.textContent).toBe('{{未知}}')
    })

    it('is replayable: second call with different values overrides first', () => {
        const root = makeRoot('<p><span>{{</span><span>甲方</span><span>}}</span></p>')
        const snap = capturePlaceholderSnapshot(root)
        replacePlaceholdersWithSnapshot(snap, { 甲方: '张三' })
        expect(root.textContent).toBe('张三')
        replacePlaceholdersWithSnapshot(snap, { 甲方: '李四' })
        expect(root.textContent).toBe('李四')
    })

    it('handles multiple placeholders in same block', () => {
        const root = makeRoot('<p>原告：{{原告}}，被告：{{被告}}</p>')
        const snap = capturePlaceholderSnapshot(root)
        replacePlaceholdersWithSnapshot(snap, { 原告: '张三', 被告: '李四' })
        expect(root.textContent).toBe('原告：张三，被告：李四')
    })

    it('independent blocks do not interfere', () => {
        const root = makeRoot('<p>{{甲方}}</p><p>{{乙方}}</p>')
        const snap = capturePlaceholderSnapshot(root)
        replacePlaceholdersWithSnapshot(snap, { 甲方: '张三', 乙方: '李四' })
        expect(root.textContent).toBe('张三李四')
    })

    it('null value falls back to original placeholder text', () => {
        const root = makeRoot('<p>{{甲方}}</p>')
        const snap = capturePlaceholderSnapshot(root)
        replacePlaceholdersWithSnapshot(snap, { 甲方: null })
        expect(root.textContent).toBe('{{甲方}}')
    })
})
