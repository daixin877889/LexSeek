/**
 * splitSentences 单元测试（spec §5.1 / §10.1）
 *
 * 切分规则：
 *  - 标点：。！？；\n（中文逗号 / 顿号 不切；引号 / 括号内的标点不切）
 *  - 行首子项编号：复用 clauseSegmenter.ts 的 RE_DI_TIAO / RE_NUM_DOT / RE_CN_COMMA
 *
 * 输出：1-based id + 0-based [charStart, charEnd) offset，offset 同 segmentText 空间
 *
 * **测试矩阵（对应 spec §10.1 splitSentences 行的全部 6 类，删减 case 时务必保留每类至少 1 个）**：
 *  1. 边角行为（空字符串 / 整段无切分点 / 仅含 1 个标点）
 *  2. 中文标点切分（句号 / 分号 / ！？ / \n / 中文逗号顿号不切）
 *  3. 引号 / 括号内标点不切（嵌套 / 中英双引号 / 单引号）
 *  4. 行首子项编号（3.1 / 一、/ 第二条 + 行内不切防回归）
 *  5. charStart/charEnd 一致性（slice 拼回原文 + id 1-based 连续）
 *  6. 连续分号 / 连续切分点（已在第 2 类长 case 覆盖）
 */
import { describe, it, expect } from 'vitest'
import { splitSentences } from '~~/server/agents/contract/utils/splitSentences'

describe('splitSentences', () => {
    describe('边角行为', () => {
        it('空字符串返回空数组', () => {
            expect(splitSentences('')).toEqual([])
        })

        it('整段无切分点 → 整段作 1 个 sentence（如标题行）', () => {
            const r = splitSentences('合同标题')
            expect(r).toHaveLength(1)
            expect(r[0]).toEqual({ id: 1, text: '合同标题', charStart: 0, charEnd: 4 })
        })

        it('仅含 1 个标点符号 "。" → 切出 1 个空文本 sentence', () => {
            const r = splitSentences('。')
            expect(r).toHaveLength(1)
            expect(r[0]).toEqual({ id: 1, text: '', charStart: 0, charEnd: 1 })
        })
    })

    describe('中文标点切分', () => {
        it('按句号切', () => {
            const r = splitSentences('甲方应按月支付工资。乙方应按时打卡。')
            expect(r.map(s => s.text)).toEqual(['甲方应按月支付工资', '乙方应按时打卡'])
            expect(r[0]!.charStart).toBe(0)
            expect(r[0]!.charEnd).toBe(10) // 含句号
            expect(r[1]!.charStart).toBe(10)
            expect(r[1]!.charEnd).toBe(18)
        })

        it('按分号切（合同条款常见）', () => {
            const r = splitSentences('工资按月支付；逾期支付的，每日加收 0.05% 违约金；累计逾期超 30 日的，乙方有权解除合同。')
            expect(r).toHaveLength(3)
            expect(r[0]!.text).toBe('工资按月支付')
            expect(r[1]!.text).toBe('逾期支付的，每日加收 0.05% 违约金') // 中文逗号不切
        })

        it('感叹号 / 问号也是切分点', () => {
            expect(splitSentences('这条款有效吗？是的！').map(s => s.text)).toEqual(['这条款有效吗', '是的'])
        })

        it('换行符 \\n 也是切分点', () => {
            const r = splitSentences('第一句\n第二句')
            expect(r).toHaveLength(2)
            expect(r[0]!.text).toBe('第一句')
            expect(r[1]!.text).toBe('第二句')
        })

        it('中文逗号 / 顿号不切', () => {
            const r = splitSentences('甲方、乙方，应当履行各自义务。')
            expect(r).toHaveLength(1)
            expect(r[0]!.text).toBe('甲方、乙方，应当履行各自义务')
        })
    })

    describe('引号 / 括号内标点不切', () => {
        it('双引号 "" 内的句号 / 分号不切', () => {
            const r = splitSentences('合同所称"工资。津贴；奖金"包括基本工资。')
            expect(r).toHaveLength(1) // 引号内不切，只在最外层句号切
            expect(r[0]!.text).toBe('合同所称"工资。津贴；奖金"包括基本工资')
        })

        it('括号 () 内分号不切', () => {
            const r = splitSentences('赔偿（含直接损失；不含间接损失）按月计算。')
            expect(r).toHaveLength(1)
            expect(r[0]!.text).toBe('赔偿（含直接损失；不含间接损失）按月计算')
        })

        it('单引号 \\u2018\\u2019 内不切', () => {
            const r = splitSentences("条款称'A。B'有效。")
            expect(r).toHaveLength(1)
        })
    })

    describe('行首子项编号作为切分点（spec §5.1 复用 clauseSegmenter 三个正则）', () => {
        // 注：合同实际文本里 \n 已经是切分点，"行首子项编号"99% 与 \n 切点重合；
        // 本段保留 1 个综合 case 验证三种编号格式可识别 + 1 个回归 case 防"行内编号被误切"。
        it('三种行首编号（3.1 / 一、/ 第二条）都能识别为切分点', () => {
            const seg = '3 工资。\n3.1 月薪标准。\n一、生效条件。\n第二条 主体'
            const r = splitSentences(seg)
            const texts = r.map(s => s.text)
            expect(texts.some(t => t.startsWith('3.1'))).toBe(true)
            expect(texts.some(t => t.startsWith('一、'))).toBe(true)
            expect(texts.some(t => t.includes('第二条'))).toBe(true)
        })

        it('行内「第二」/「3.1」不作切分点（仅行首识别）', () => {
            const r = splitSentences('前段说明。第二，违约金按月计算')
            expect(r).toHaveLength(2)
            expect(r[1]!.text).toBe('第二，违约金按月计算')
        })
    })

    describe('charStart / charEnd 一致性', () => {
        it('每个 sentence 的 [charStart, charEnd) slice 等于 text + 切分标点', () => {
            const seg = '工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。'
            const r = splitSentences(seg)
            // 整篇拼回应等于 seg
            const reconstructed = r.map(s => seg.slice(s.charStart, s.charEnd)).join('')
            expect(reconstructed).toBe(seg)
        })

        it('id 是 1-based 连续递增', () => {
            const r = splitSentences('A。B。C。')
            expect(r.map(s => s.id)).toEqual([1, 2, 3])
        })
    })
})
