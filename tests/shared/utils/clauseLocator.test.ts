import { describe, it, expect } from 'vitest'
import { locateClauseElement } from '#shared/utils/clauseLocator'

describe('clauseLocator · 三级兜底', () => {
    const html = `
        <div>
            <p>第一条 合同标的</p>
            <p>甲方委托乙方完成某项目</p>
            <p>第五条 违约责任</p>
            <p>5.2 乙方违反本合同约定造成损失……</p>
        </div>
    `
    const container = new DOMParser().parseFromString(html, 'text/html').body

    it('精确匹配命中', () => {
        const el = locateClauseElement(container, '甲方委托乙方完成某项目')
        expect(el).toBeTruthy()
    })

    it('精确不中 → 模糊匹配前 20 字去标点', () => {
        const el = locateClauseElement(container, '甲方委托乙方完成某项目（包括但不限于软件开发）')
        expect(el).toBeTruthy()
        expect(el?.textContent).toContain('甲方委托乙方')
    })

    it('两级都失败 → 返回 null', () => {
        const el = locateClauseElement(container, '完全不相干的文字')
        expect(el).toBeNull()
    })

    it('单字符 DOM 节点不应被 fuzzy 误命中', () => {
        const short = new DOMParser().parseFromString(
            '<div><p>甲</p><p>乙</p><p>完全不相干内容</p></div>',
            'text/html'
        ).body
        const el = locateClauseElement(short, '甲方委托乙方完成某项目（包括但不限于）')
        expect(el).toBeNull()
    })

    it('多行 clauseText：按 \\n 拆行后任一行命中即返回对应段落', () => {
        const multiline = [
            '第五条 违约责任',
            '5.2 乙方违反本合同约定造成损失……',
            '5.3 违约金按合同总额 20% 计算',
        ].join('\n')
        const el = locateClauseElement(container, multiline)
        expect(el).toBeTruthy()
        // 至少命中首行或第二行（两者都在 container 内）
        expect(el?.textContent).toMatch(/第五条 违约责任|5\.2 乙方违反本合同约定/)
    })

    it('多行 clauseText：首行无法匹配时，第二行兜底命中', () => {
        const multiline = [
            '不存在的首行文字',
            '甲方委托乙方完成某项目',
        ].join('\n')
        const el = locateClauseElement(container, multiline)
        expect(el?.textContent).toContain('甲方委托乙方完成某项目')
    })

    it('DOM 段落包含多余空白也能精确命中', () => {
        const spaced = new DOMParser().parseFromString(
            '<div><p>   甲方  委托   乙方   完成某项目   </p></div>',
            'text/html'
        ).body
        const el = locateClauseElement(spaced, '甲方 委托 乙方 完成某项目')
        expect(el).toBeTruthy()
    })

    describe('优先级 0：paragraphIndex 直定位（"非空段落序号"空间）', () => {
        // 真实 docx-preview 渲染会包含空段（页眉/分隔），后端 anchorParagraphIndex
        // 跑在"非空段落序号"空间内（见 server/agents/contract/utils/clauseToParagraph.ts），
        // 这里用包含空 <p> 的 fixture 模拟两个空间的差异
        const html = `
            <div>
                <p></p>
                <p>第一条 合同标的</p>
                <p>   </p>
                <p>甲方委托乙方完成某项目（含特殊空格 　）</p>
                <p>第五条 违约责任</p>
                <p>5.2 乙方违反本合同约定造成损失……</p>
            </div>
        `
        const container = new DOMParser().parseFromString(html, 'text/html').body

        it('paragraphIndex=0 命中第 1 个非空块（跳过空段）', () => {
            const el = locateClauseElement(container, '随便什么文案对不上', 0)
            expect(el?.textContent).toContain('第一条 合同标的')
        })

        it('paragraphIndex=1 命中第 2 个非空块（即使原文本因全角空格匹配失败）', () => {
            // 模拟 anchor_quote 文本归一化后与 reviewed docx 渲染产物有微差异，
            // 文本匹配失败也能凭 paragraphIndex 直接命中
            const el = locateClauseElement(container, '甲方委托乙方完成某项目', 1)
            expect(el?.textContent).toContain('甲方委托乙方完成某项目')
        })

        it('paragraphIndex 越界 → 回落到文本匹配', () => {
            const el = locateClauseElement(container, '甲方委托乙方完成某项目', 99)
            // 第 99 个非空段不存在，应回落到文本匹配；anchor 文案 substring 命中第 4 个非空段
            expect(el?.textContent).toContain('甲方委托乙方完成某项目')
        })

        it('paragraphIndex=null 等同未传，纯文本匹配路径', () => {
            const el = locateClauseElement(container, '5.2 乙方违反本合同约定', null)
            expect(el?.textContent).toContain('5.2 乙方违反本合同约定')
        })
    })
})
