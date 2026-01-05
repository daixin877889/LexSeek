/**
 * Markdown Front Matter 工具函数单元测试
 *
 * 测试 extractFrontMatter 和 mergeFrontMatter 函数的正确性
 */
import { describe, expect, it } from 'vitest'
import { extractFrontMatter, mergeFrontMatter } from '../../../shared/utils/markdownFrontMatter'

describe('extractFrontMatter', () => {
    describe('有效 front matter 提取', () => {
        it('应该正确提取标准的 YAML front matter', () => {
            const markdown = `---
title: 测试文档
date: 2025-01-05
---
这是正文内容`

            const result = extractFrontMatter(markdown)

            expect(result.hasFrontMatter).toBe(true)
            expect(result.frontMatter).toBe(`---
title: 测试文档
date: 2025-01-05
---
`)
            expect(result.content).toBe('这是正文内容')
        })

        it('应该正确处理包含中文字符的 front matter', () => {
            const markdown = `---
tags:
  - 民事诉讼法及司法解释/主管和管辖
cssclasses:
  - serif-index
发文机关: 最高人民法院
效力级别: 司法解释/两高司法文件
发布日期: 2025-12-16
施行日期: 2026-01-01
文号: 法〔2025〕227号
时效性: 现行有效
---
# 正文标题

这是正文内容。`

            const result = extractFrontMatter(markdown)

            expect(result.hasFrontMatter).toBe(true)
            expect(result.frontMatter).toContain('发文机关: 最高人民法院')
            expect(result.frontMatter).toContain('文号: 法〔2025〕227号')
            expect(result.content).toBe(`# 正文标题

这是正文内容。`)
        })

        it('应该正确处理包含特殊符号的 front matter', () => {
            const markdown = `---
文号: 法〔2025〕227号
符号测试: "引号内容"
冒号测试: 值:包含冒号
---
正文`

            const result = extractFrontMatter(markdown)

            expect(result.hasFrontMatter).toBe(true)
            expect(result.frontMatter).toContain('法〔2025〕227号')
            expect(result.frontMatter).toContain('"引号内容"')
        })

        it('应该正确处理空的 front matter', () => {
            const markdown = `---
---
正文内容`

            const result = extractFrontMatter(markdown)

            expect(result.hasFrontMatter).toBe(true)
            expect(result.frontMatter).toBe(`---
---
`)
            expect(result.content).toBe('正文内容')
        })

        it('应该正确处理只有 front matter 没有正文的情况', () => {
            const markdown = `---
title: 只有元数据
---
`

            const result = extractFrontMatter(markdown)

            expect(result.hasFrontMatter).toBe(true)
            expect(result.content).toBe('')
        })

        it('应该正确处理 Windows 换行符 (CRLF)', () => {
            const markdown = '---\r\ntitle: 测试\r\n---\r\n正文'

            const result = extractFrontMatter(markdown)

            expect(result.hasFrontMatter).toBe(true)
            expect(result.content).toBe('正文')
        })
    })

    describe('无 front matter 的内容处理', () => {
        it('应该正确处理不以 --- 开头的内容', () => {
            const markdown = `# 标题

这是普通的 Markdown 内容`

            const result = extractFrontMatter(markdown)

            expect(result.hasFrontMatter).toBe(false)
            expect(result.frontMatter).toBeNull()
            expect(result.content).toBe(markdown)
        })

        it('应该正确处理空字符串', () => {
            const result = extractFrontMatter('')

            expect(result.hasFrontMatter).toBe(false)
            expect(result.frontMatter).toBeNull()
            expect(result.content).toBe('')
        })

        it('应该正确处理只有空白的字符串', () => {
            const result = extractFrontMatter('   \n\n  ')

            expect(result.hasFrontMatter).toBe(false)
            expect(result.frontMatter).toBeNull()
        })
    })

    describe('不完整 front matter 的处理', () => {
        it('应该将缺少结束 --- 的内容作为普通内容处理', () => {
            const markdown = `---
title: 不完整的 front matter
这里没有结束标记`

            const result = extractFrontMatter(markdown)

            expect(result.hasFrontMatter).toBe(false)
            expect(result.frontMatter).toBeNull()
            expect(result.content).toBe(markdown)
        })

        it('应该将只有一个 --- 的内容作为普通内容处理', () => {
            const markdown = `---
这不是有效的 front matter`

            const result = extractFrontMatter(markdown)

            expect(result.hasFrontMatter).toBe(false)
            expect(result.content).toBe(markdown)
        })

        it('应该将 --- 不在开头的内容作为普通内容处理', () => {
            const markdown = `一些前置内容
---
title: 这不是 front matter
---
正文`

            const result = extractFrontMatter(markdown)

            expect(result.hasFrontMatter).toBe(false)
            expect(result.content).toBe(markdown)
        })
    })
})

describe('mergeFrontMatter', () => {
    it('应该正确合并 front matter 和正文', () => {
        const frontMatter = `---
title: 测试
---
`
        const content = '正文内容'

        const result = mergeFrontMatter(frontMatter, content)

        expect(result).toBe(`---
title: 测试
---
正文内容`)
    })

    it('应该在 front matter 没有换行结尾时自动添加换行', () => {
        const frontMatter = `---
title: 测试
---`
        const content = '正文内容'

        const result = mergeFrontMatter(frontMatter, content)

        expect(result).toBe(`---
title: 测试
---
正文内容`)
    })

    it('应该在 front matter 为 null 时只返回正文', () => {
        const content = '正文内容'

        const result = mergeFrontMatter(null, content)

        expect(result).toBe('正文内容')
    })

    it('应该正确处理空正文', () => {
        const frontMatter = `---
title: 测试
---
`
        const result = mergeFrontMatter(frontMatter, '')

        expect(result).toBe(`---
title: 测试
---
`)
    })
})

describe('往返一致性', () => {
    it('提取后再合并应该得到原始内容', () => {
        const original = `---
title: 测试文档
tags:
  - 标签1
  - 标签2
---
# 正文标题

这是正文内容。`

        const extracted = extractFrontMatter(original)
        const merged = mergeFrontMatter(extracted.frontMatter, extracted.content)

        expect(merged).toBe(original)
    })

    it('包含特殊字符的内容应该保持往返一致性', () => {
        const original = `---
文号: 法〔2025〕227号
发文机关: 最高人民法院
---
正文内容`

        const extracted = extractFrontMatter(original)
        const merged = mergeFrontMatter(extracted.frontMatter, extracted.content)

        expect(merged).toBe(original)
    })
})


/**
 * 属性测试 - 使用 fast-check 进行基于属性的测试
 *
 * **Feature: markdown-frontmatter-preserve**
 */
import * as fc from 'fast-check'

describe('Property Tests - Front Matter 往返一致性', () => {
    /**
     * Property 2: Front Matter 往返一致性
     *
     * 对于任意包含有效 YAML front matter 的 Markdown 内容，
     * 执行 extractFrontMatter 提取后再用 mergeFrontMatter 合并，
     * 应该产生与原始输入等价的内容。
     *
     * **Feature: markdown-frontmatter-preserve, Property 2: Front Matter 往返一致性**
     * **验证: 需求 1.2, 4.3**
     */
    it('Property 2: 提取后再合并应该得到原始内容', () => {
        // 生成有效的 YAML front matter 内容
        const yamlKeyArb = fc.stringMatching(/^[a-zA-Z\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]*$/)
        const yamlValueArb = fc.oneof(
            fc.string({ minLength: 0, maxLength: 50 }),
            fc.integer(),
            fc.boolean(),
            // 包含中文和特殊符号
            fc.constantFrom(
                '最高人民法院',
                '法〔2025〕227号',
                '司法解释/两高司法文件',
                '2025-12-16',
            ),
        )

        // 生成 YAML 键值对
        const yamlEntryArb = fc.tuple(yamlKeyArb, yamlValueArb).map(([key, value]) => {
            if (typeof value === 'string') {
                // 如果值包含特殊字符，需要引号包裹
                if (value.includes(':') || value.includes('#') || value.includes('\n')) {
                    return `${key}: "${value.replace(/"/g, '\\"')}"`
                }
                return `${key}: ${value}`
            }
            return `${key}: ${value}`
        })

        // 生成完整的 front matter
        const frontMatterArb = fc
            .array(yamlEntryArb, { minLength: 1, maxLength: 5 })
            .map(entries => `---\n${entries.join('\n')}\n---\n`)

        // 生成正文内容
        const contentArb = fc.string({ minLength: 0, maxLength: 200 })

        // 生成完整的 Markdown 内容
        const markdownArb = fc.tuple(frontMatterArb, contentArb).map(([fm, content]) => fm + content)

        fc.assert(
            fc.property(markdownArb, (markdown) => {
                const extracted = extractFrontMatter(markdown)
                const merged = mergeFrontMatter(extracted.frontMatter, extracted.content)

                // 往返一致性：提取后再合并应该得到原始内容
                expect(merged).toBe(markdown)
                expect(extracted.hasFrontMatter).toBe(true)
            }),
            { numRuns: 100 },
        )
    })

    /**
     * Property 1: Front Matter 解析正确性
     *
     * 对于任意以 `---` 开头并包含第二个 `---` 的 Markdown 字符串，
     * extractFrontMatter 函数应该正确提取 front matter 部分，
     * 且 hasFrontMatter 为 true。
     *
     * **Feature: markdown-frontmatter-preserve, Property 1: Front Matter 解析正确性**
     * **验证: 需求 1.1, 2.1**
     */
    it('Property 1: 有效 front matter 应该被正确识别', () => {
        // 生成有效的 front matter 内容（两个 --- 之间的内容）
        const innerContentArb = fc.string({ minLength: 0, maxLength: 100 }).filter(s => !s.includes('---'))

        // 生成完整的 front matter
        const frontMatterArb = innerContentArb.map(inner => `---\n${inner}\n---\n`)

        // 生成正文内容
        const contentArb = fc.string({ minLength: 0, maxLength: 100 })

        // 生成完整的 Markdown 内容
        const markdownArb = fc.tuple(frontMatterArb, contentArb).map(([fm, content]) => fm + content)

        fc.assert(
            fc.property(markdownArb, (markdown) => {
                const result = extractFrontMatter(markdown)

                // 应该正确识别 front matter
                expect(result.hasFrontMatter).toBe(true)
                expect(result.frontMatter).not.toBeNull()
                expect(result.frontMatter).toMatch(/^---\n/)
                expect(result.frontMatter).toMatch(/---\n?$/)
            }),
            { numRuns: 100 },
        )
    })

    /**
     * 无 front matter 的内容应该被正确处理
     *
     * 对于不以 `---` 开头的内容，hasFrontMatter 应该为 false
     */
    it('Property: 无 front matter 的内容应该返回 hasFrontMatter = false', () => {
        // 生成不以 --- 开头的内容
        const contentArb = fc.string({ minLength: 1, maxLength: 200 }).filter(s => !s.startsWith('---'))

        fc.assert(
            fc.property(contentArb, (content) => {
                const result = extractFrontMatter(content)

                expect(result.hasFrontMatter).toBe(false)
                expect(result.frontMatter).toBeNull()
                expect(result.content).toBe(content)
            }),
            { numRuns: 100 },
        )
    })
})


/**
 * 组件集成测试 - 模拟组件行为的属性测试
 *
 * 由于 Vue 组件测试需要复杂的 DOM 环境，这里测试组件的核心逻辑
 *
 * **Feature: markdown-frontmatter-preserve**
 */
describe('组件集成测试 - Front Matter 处理逻辑', () => {
    /**
     * Property 3: 正文编辑不影响 Front Matter
     *
     * 对于任意包含 front matter 的 Markdown 内容，
     * 在编辑器中修改正文内容后，获取输出时 front matter 部分应该与原始输入完全一致。
     *
     * **Feature: markdown-frontmatter-preserve, Property 3: 正文编辑不影响 Front Matter**
     * **验证: 需求 2.2**
     */
    it('Property 3: 正文编辑不影响 Front Matter', () => {
        // 模拟组件的 front matter 状态管理逻辑
        const simulateEditorBehavior = (
            originalContent: string,
            editedBody: string,
        ): { originalFrontMatter: string | null; outputFrontMatter: string | null } => {
            // 1. 输入时提取 front matter
            const extracted = extractFrontMatter(originalContent)
            const storedFrontMatter = extracted.frontMatter

            // 2. 模拟用户编辑正文（编辑器只处理正文）
            // editedBody 是用户编辑后的正文内容

            // 3. 输出时合并 front matter
            const output = mergeFrontMatter(storedFrontMatter, editedBody)

            // 4. 再次提取以验证 front matter 是否保持不变
            const outputExtracted = extractFrontMatter(output)

            return {
                originalFrontMatter: storedFrontMatter,
                outputFrontMatter: outputExtracted.frontMatter,
            }
        }

        // 生成有效的 front matter
        const frontMatterArb = fc
            .array(
                fc.tuple(
                    fc.stringMatching(/^[a-zA-Z\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]{0,10}$/),
                    fc.oneof(
                        fc.string({ minLength: 1, maxLength: 20 }),
                        fc.integer(),
                        fc.constantFrom('最高人民法院', '法〔2025〕227号'),
                    ),
                ),
                { minLength: 1, maxLength: 3 },
            )
            .map(entries => `---\n${entries.map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`)

        // 生成原始正文和编辑后的正文
        const contentArb = fc.string({ minLength: 0, maxLength: 100 })
        const editedContentArb = fc.string({ minLength: 0, maxLength: 100 })

        fc.assert(
            fc.property(
                frontMatterArb,
                contentArb,
                editedContentArb,
                (frontMatter, originalBody, editedBody) => {
                    const originalContent = frontMatter + originalBody
                    const result = simulateEditorBehavior(originalContent, editedBody)

                    // 验证 front matter 保持不变
                    expect(result.outputFrontMatter).toBe(result.originalFrontMatter)
                },
            ),
            { numRuns: 100 },
        )
    })

    /**
     * Property 4: 源码模式内容完整性
     *
     * 对于任意包含 front matter 的 Markdown 内容，
     * 切换到源码模式时显示的内容应该包含完整的 front matter 和正文。
     *
     * **Feature: markdown-frontmatter-preserve, Property 4: 源码模式内容完整性**
     * **验证: 需求 2.3, 3.1**
     */
    it('Property 4: 源码模式内容完整性', () => {
        // 模拟切换到源码模式的逻辑
        const simulateSourceModeSwitch = (
            originalContent: string,
        ): { sourceContent: string; isComplete: boolean } => {
            // 1. 输入时提取 front matter
            const extracted = extractFrontMatter(originalContent)
            const storedFrontMatter = extracted.frontMatter
            const bodyContent = extracted.content

            // 2. 切换到源码模式时，合并 front matter 和正文
            const sourceContent = mergeFrontMatter(storedFrontMatter, bodyContent)

            // 3. 验证源码内容是否完整
            const isComplete = sourceContent === originalContent

            return { sourceContent, isComplete }
        }

        // 生成有效的 front matter
        const frontMatterArb = fc
            .array(
                fc.tuple(
                    fc.stringMatching(/^[a-zA-Z\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]{0,10}$/),
                    fc.oneof(
                        fc.string({ minLength: 1, maxLength: 20 }),
                        fc.integer(),
                        fc.constantFrom('最高人民法院', '法〔2025〕227号'),
                    ),
                ),
                { minLength: 1, maxLength: 3 },
            )
            .map(entries => `---\n${entries.map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`)

        // 生成正文内容
        const contentArb = fc.string({ minLength: 0, maxLength: 100 })

        fc.assert(
            fc.property(frontMatterArb, contentArb, (frontMatter, body) => {
                const originalContent = frontMatter + body
                const result = simulateSourceModeSwitch(originalContent)

                // 验证源码模式显示完整内容
                expect(result.isComplete).toBe(true)
                expect(result.sourceContent).toBe(originalContent)
            }),
            { numRuns: 100 },
        )
    })

    /**
     * Property 5: 外部更新同步正确性
     *
     * 对于任意通过 v-model 更新的包含 front matter 的 Markdown 内容，
     * 编辑器应该正确解析并存储 front matter，后续获取内容时应该保持 front matter 完整。
     *
     * **Feature: markdown-frontmatter-preserve, Property 5: 外部更新同步正确性**
     * **验证: 需求 4.1**
     */
    it('Property 5: 外部更新同步正确性', () => {
        // 模拟 v-model 更新的逻辑
        const simulateVModelUpdate = (
            newValue: string,
        ): { storedFrontMatter: string | null; outputContent: string } => {
            // 1. 外部更新时提取 front matter
            const extracted = extractFrontMatter(newValue)
            const storedFrontMatter = extracted.frontMatter
            const bodyContent = extracted.content

            // 2. 模拟获取内容时合并 front matter
            const outputContent = mergeFrontMatter(storedFrontMatter, bodyContent)

            return { storedFrontMatter, outputContent }
        }

        // 生成有效的 front matter
        const frontMatterArb = fc
            .array(
                fc.tuple(
                    fc.stringMatching(/^[a-zA-Z\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]{0,10}$/),
                    fc.oneof(
                        fc.string({ minLength: 1, maxLength: 20 }),
                        fc.integer(),
                        fc.constantFrom('最高人民法院', '法〔2025〕227号'),
                    ),
                ),
                { minLength: 1, maxLength: 3 },
            )
            .map(entries => `---\n${entries.map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`)

        // 生成正文内容
        const contentArb = fc.string({ minLength: 0, maxLength: 100 })

        fc.assert(
            fc.property(frontMatterArb, contentArb, (frontMatter, body) => {
                const newValue = frontMatter + body
                const result = simulateVModelUpdate(newValue)

                // 验证 front matter 被正确存储
                expect(result.storedFrontMatter).toBe(frontMatter)
                // 验证输出内容与输入一致
                expect(result.outputContent).toBe(newValue)
            }),
            { numRuns: 100 },
        )
    })
})
