/**
 * paragraphIndexOfElement 测试
 * **Feature: contract-add-risk-hover**
 */
import { describe, it, expect } from 'vitest'
import { paragraphIndexOfElement } from '#shared/utils/clauseLocator'

function parse(html: string): HTMLElement {
    return new DOMParser().parseFromString(html, 'text/html').body
}

describe('paragraphIndexOfElement', () => {
    it('只数 section.docx 直接子级非空 <p>，返回 0-based 序号', () => {
        const body = parse(`<div class="docx-wrapper"><section class="docx">
            <p>第一段</p>
            <p>   </p>
            <p>第二段</p>
            <table><tbody><tr><td><p>表格内段落</p></td></tr></tbody></table>
            <p>第三段</p>
        </section></div>`)
        const section = body.querySelector('section.docx')!
        const ps = section.querySelectorAll(':scope > p')   // 直接子级 p
        expect(paragraphIndexOfElement(body, ps[0]!)).toBe(0)  // 第一段
        expect(paragraphIndexOfElement(body, ps[1]!)).toBe(-1) // 空段不计入
        expect(paragraphIndexOfElement(body, ps[2]!)).toBe(1)  // 第二段
        expect(paragraphIndexOfElement(body, ps[3]!)).toBe(2)  // 第三段（表格内 p 不占序号）
        const tdP = body.querySelector('td p')!
        expect(paragraphIndexOfElement(body, tdP)).toBe(-1)    // 表格内段落不在序号体系
    })
})
