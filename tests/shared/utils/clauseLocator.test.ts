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
})
