/**
 * shared/utils/markdown.ts 单元测试
 *
 * 覆盖 spec docs/superpowers/specs/2026-05-17-strip-pre-h1-on-save-design.md
 * 列出的全部规则与边界情况。
 */
import { describe, it, expect } from 'vitest'
import { stripContentBeforeFirstH1 } from '../../../shared/utils/markdown'

describe('stripContentBeforeFirstH1', () => {
    describe('Happy path', () => {
        it('前言 + 一级标题 + 正文 → 删前言，首行就是一级标题', () => {
            const input = [
                '好的，我已经详细阅读了技能的全部参考资料。',
                '现在开始提取和分析案件大事记。',
                '',
                '# 案件大事记',
                '',
                '| 时间 | 事件 |',
                '| --- | --- |',
                '| 2021-05-22 | 定金支付 |',
            ].join('\n')

            const result = stripContentBeforeFirstH1(input)

            expect(result.startsWith('# 案件大事记')).toBe(true)
            expect(result).toContain('| 2021-05-22 | 定金支付 |')
            expect(result).not.toContain('好的，我已经详细阅读')
        })

        it('无前言（首行就是一级标题）→ 完全不变', () => {
            const input = '# 案件大事记\n\n正文内容。\n'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('没有任何一级标题（纯文本）→ 完全不变', () => {
            const input = '这是一段没有标题的纯文本。\n第二行。\n'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('只有二级 / 三级标题，没有一级标题 → 完全不变', () => {
            const input = '## 二级\n### 三级\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })
    })

    describe('空白处理', () => {
        it('前言后紧跟多个空行才到一级标题 → 空行一起删，首行就是一级标题', () => {
            const input = '前言段落\n\n\n\n# 标题\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe('# 标题\n正文')
        })

        it('入参只是空白前缀 + 一级标题 → 输出首行就是一级标题', () => {
            const input = '   \n\n# 标题\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe('# 标题\n正文')
        })

        it('一级标题前只有空白字符（无任何文字）→ 仍清洗，结果首行为一级标题', () => {
            const input = '\n\n\n# 标题\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe('# 标题\n正文')
        })
    })

    describe('边界 / 抗误判', () => {
        it('fenced code block 内有 # foo，外面有真的一级标题 → 找外面那个', () => {
            const input = [
                '示例：',
                '```markdown',
                '# foo（这是代码块内的伪标题）',
                '```',
                '',
                '# 真正的标题',
                '正文',
            ].join('\n')

            const result = stripContentBeforeFirstH1(input)
            expect(result.startsWith('# 真正的标题')).toBe(true)
            expect(result).not.toContain('示例：')
            expect(result).not.toContain('```')
        })

        it('fenced code block 内有 # foo，外面没有真一级标题 → 原文不变', () => {
            const input = [
                '说明文字。',
                '```markdown',
                '# foo',
                '```',
                '结尾。',
            ].join('\n')

            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('~~~ 围栏的 code block 内 # foo → 同样不算', () => {
            const input = [
                '说明',
                '~~~',
                '# foo',
                '~~~',
                '结尾',
            ].join('\n')

            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('indented code block（4 空格）内的 # foo → 不算', () => {
            const input = [
                '前面是一段普通文字。',
                '',
                '    # foo（这是缩进代码块）',
                '',
                '结尾。',
            ].join('\n')

            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('blockquote > # foo → 不算一级标题', () => {
            const input = '前言\n> # 引用里的标题\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('多个一级标题 → 只在第一个之前删', () => {
            const input = '前言\n# 第一段\n内容1\n# 第二段\n内容2'
            expect(stripContentBeforeFirstH1(input)).toBe('# 第一段\n内容1\n# 第二段\n内容2')
        })

        it('首行 #标题（# 后无空格）→ 不算 ATX 一级标题', () => {
            const input = '#标题\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('首行单独一个 # → 不算', () => {
            const input = '#\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('一级标题后紧跟一个换行 + 内容 → 保留标题与所有正文', () => {
            const input = '前言\n# 标题\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe('# 标题\n正文')
        })

        it('Windows 风格 CRLF 换行 → 也能正确匹配', () => {
            const input = '前言\r\n\r\n# 标题\r\n正文\r\n'
            const result = stripContentBeforeFirstH1(input)
            expect(result.startsWith('# 标题')).toBe(true)
            expect(result).toContain('正文')
        })

        it('setext 风格 H1（下划线 ===）→ 不识别，视为无一级标题', () => {
            const input = '前言\n\n标题\n===\n正文'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })

        it('混用围栏：``` 围栏内出现 ~~~（或反之）→ 闭围栏匹配开围栏字符，跳过整段', () => {
            const input = [
                '前言',
                '```',
                '~~~ 这是 ``` 内的伪围栏，不应提前闭合',
                '# foo（仍在围栏内）',
                '```',
                '',
                '# 真正的标题',
                '正文',
            ].join('\n')

            const result = stripContentBeforeFirstH1(input)
            expect(result.startsWith('# 真正的标题')).toBe(true)
            expect(result).not.toContain('前言')
            expect(result).not.toContain('~~~')
        })
    })

    describe('防御', () => {
        it('入参 null → 返回空串', () => {
            expect(stripContentBeforeFirstH1(null)).toBe('')
        })

        it('入参 undefined → 返回空串', () => {
            expect(stripContentBeforeFirstH1(undefined)).toBe('')
        })

        it('入参空串 → 返回空串', () => {
            expect(stripContentBeforeFirstH1('')).toBe('')
        })

        it('入参只有空白 → 返回原值（无一级标题不变）', () => {
            const input = '   \n\n\t'
            expect(stripContentBeforeFirstH1(input)).toBe(input)
        })
    })
})
