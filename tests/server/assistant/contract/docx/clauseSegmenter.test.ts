import { describe, it, expect } from 'vitest'
import { segmentClausesByRegex } from '~~/server/agents/contract/docx/clauseSegmenter'

describe('clauseSegmenter · 正则切分', () => {
    it('按 "第X条" 切分', () => {
        const text = [
            '第一条 合同标的',
            '甲方委托乙方……',
            '第二条 付款方式',
            '3.1 首付 40%',
            '第三条 争议解决',
            '以仲裁方式解决。',
        ].join('\n')
        const { segments } = segmentClausesByRegex(text)
        expect(segments.map(s => s.number)).toEqual(['第一条', '第二条', '第三条'])
        expect(segments[0]?.text).toContain('甲方委托乙方')
    })

    it('按 "1.1" 级层级编号切分', () => {
        const text = [
            '1. 总则',
            '1.1 本合同……',
            '1.2 双方应……',
            '2. 权利义务',
            '2.1 甲方应……',
        ].join('\n')
        const { segments } = segmentClausesByRegex(text)
        expect(segments.map(s => s.number)).toEqual(['1.', '1.1', '1.2', '2.', '2.1'])
    })

    it('按 "一、" 中文序号切分', () => {
        const text = ['一、协议内容', '双方约定如下。', '二、违约责任', '违约方承担……'].join('\n')
        const { segments } = segmentClausesByRegex(text)
        expect(segments.map(s => s.number)).toEqual(['一、', '二、'])
    })

    it('无编号散段整篇作为一个 segment（number=null）', () => {
        const text = '双方经友好协商，就某项目达成如下约定。'
        const { segments } = segmentClausesByRegex(text)
        expect(segments).toHaveLength(1)
        expect(segments[0]?.number).toBeNull()
        expect(segments[0]?.text).toBe(text)
    })

    it('混合编号：第X条 + 1.1 共存，各自识别', () => {
        const text = [
            '第一条 定义',
            '1.1 本合同项下……',
            '1.2 双方约定……',
            '第二条 付款',
            '2.1 总金额 100 万。',
        ].join('\n')
        const { segments } = segmentClausesByRegex(text)
        expect(segments).toHaveLength(5)
        expect(segments.map(s => s.number)).toEqual(['第一条', '1.1', '1.2', '第二条', '2.1'])
        expect(segments.map(s => s.index)).toEqual([1, 2, 3, 4, 5])
    })

    it('第X条 + 单数字子项「1.」「2.」「3.」（截图实际合同格式）', () => {
        // 截图反馈的真实合同格式：父条款是「第X条」，子项是单数字「1.」「2.」「3.」
        // （每个父条款内部从 1. 重置计数，与全局父级序号无关）
        // PR9 修复前：约 50% 子项漏识别（如「第二条」内的「1.」intPrefix=1≠currentDiTiaoIdx=2 被忽略）
        const text = [
            '第一条 合同期限与试用期',
            '1. 合同期限： 本合同期限为 3 年。',
            '2. 试用期： 试用期为 6 个月。',
            '3. 试用期工资： 试用期工资为转正后工资的 50%。',
            '第二条 工作内容与地点',
            '1. 岗位调整： 乙方聘用岗位为[填入岗位]。',
            '2. 工作地点： 乙方工作地点不仅限于[当前城市]。',
            '第三条 工作时间与休息休假',
            '1. 奋斗者协议：乙方自愿加入甲方的"奋斗者计划"。',
            '2. 放弃年休假：为体现敬业精神，乙方自愿放弃入职前 3 年的带薪年休假。',
        ].join('\n')
        const { segments } = segmentClausesByRegex(text)
        expect(segments).toHaveLength(10)
        expect(segments.map(s => s.number)).toEqual([
            '第一条', '1.', '2.', '3.',
            '第二条', '1.', '2.',
            '第三条', '1.', '2.',
        ])
    })

    it('误判保护：「第二条」内出现错位多级「3.1」时仍按 intPrefix 检查忽略（既有契约不破坏）', () => {
        // 修复必须区分单数字 X.（总识别）vs 多级 X.Y（保持 intPrefix 检查）
        // 否则「3.1」在「第二条」（currentDiTiaoIdx=2）内会被误判为子项
        const text = [
            '第一条 定义',
            '1.1 内容 A',
            '第二条 付款',
            '3.1 这是错位多级编号，应被忽略',
            '2.1 这条整数前缀对应当前父级，应识别',
        ].join('\n')
        const { segments } = segmentClausesByRegex(text)
        expect(segments.map(s => s.number)).toEqual(['第一条', '1.1', '第二条', '2.1'])
    })

    it('返回结果 index 从 1 开始且连续', () => {
        const text = '第一条 A\n第二条 B\n第三条 C'
        const { segments } = segmentClausesByRegex(text)
        expect(segments.map(s => s.index)).toEqual([1, 2, 3])
    })

    it('含 \\r\\n 时 normalizedText.slice(offsetStart, offsetEnd) === segment.text', () => {
        // 验证 \r\n 归一化后 offset 与文本仍对齐（Phase B diff 的核心保证）
        const fullText = [
            '第一条 总则\r\n甲方应履行义务。',
            '第二条 价款\r\n乙方应支付 100 万元。',
            '第三条 争议\r\n以仲裁方式解决。',
        ].join('\r\n')
        const { segments, normalizedText } = segmentClausesByRegex(fullText)
        expect(segments.length).toBeGreaterThan(0)
        for (const s of segments) {
            expect(normalizedText.slice(s.offsetStart, s.offsetEnd)).toBe(s.text)
        }
    })

    it('纯 \\n 文本 normalizedText.slice(offsetStart, offsetEnd) === segment.text', () => {
        // 验证纯 \n 文本同样满足 offset 一致性
        const fullText = '第一条 总则\n甲方应履行义务。\n第二条 价款\n乙方应支付 100 万元。'
        const { segments, normalizedText } = segmentClausesByRegex(fullText)
        expect(segments.length).toBeGreaterThan(0)
        for (const s of segments) {
            expect(normalizedText.slice(s.offsetStart, s.offsetEnd)).toBe(s.text)
        }
    })

    it('无标号散段含 \\r\\n 时 offset 也正确', () => {
        const fullText = '双方经友好协商，\r\n就某项目达成如下约定。'
        const { segments, normalizedText } = segmentClausesByRegex(fullText)
        expect(segments).toHaveLength(1)
        const s = segments[0]!
        expect(normalizedText.slice(s.offsetStart, s.offsetEnd)).toBe(s.text)
    })
})

describe('PR10 textWithoutNumber 填充', () => {
    it('单数字「1. 合同期限」剥编号字符', () => {
        const text = '1. 合同期限：本合同期限为 3 年\n2. 试用期：2 个月'
        const r = segmentClausesByRegex(text)
        expect(r.segments).toHaveLength(2)
        const s1 = r.segments[0]!
        expect(s1.text).toBe('1. 合同期限：本合同期限为 3 年')
        expect(s1.textWithoutNumber).toBe('合同期限：本合同期限为 3 年')
        expect(s1.offsetStartWithoutNumber).toBe(s1.offsetStart + 3)  // "1. " 占 3 字符
    })

    it('「第一条」剥编号字符', () => {
        const text = '第一条 总则\n第二条 双方义务'
        const r = segmentClausesByRegex(text)
        expect(r.segments).toHaveLength(2)
        const s1 = r.segments[0]!
        expect(s1.number).toBe('第一条')
        expect(s1.textWithoutNumber).toBe('总则')
    })

    it('「一、」剥编号字符', () => {
        const text = '一、双方义务\n二、违约责任'
        const r = segmentClausesByRegex(text)
        expect(r.segments).toHaveLength(2)
        const s1 = r.segments[0]!
        expect(s1.textWithoutNumber).toBe('双方义务')
    })

    it('多级「3.1」剥编号字符', () => {
        const text = '第三条 工作时间\n3.1 标准工时\n3.2 加班规则'
        const r = segmentClausesByRegex(text)
        const sub = r.segments.find(s => s.number === '3.1')
        expect(sub).toBeDefined()
        expect(sub!.textWithoutNumber).toBe('标准工时')
    })

    it('无编号 segment（fallback 散段）：textWithoutNumber === text', () => {
        // segmentClausesByRegex 命中 0 时不切；测试用前置编号逼出散段
        const text = '1. xxx\n散段无编号正文也归到此 segment\n2. yyy'
        const r = segmentClausesByRegex(text)
        const s1 = r.segments[0]!
        // s1.text 跨多行，textWithoutNumber 仅剥行首 "1. "
        expect(s1.textWithoutNumber.startsWith('xxx')).toBe(true)
        expect(s1.textWithoutNumber).not.toMatch(/^1\./)
    })
})
