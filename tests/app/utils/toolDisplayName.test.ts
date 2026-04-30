import { describe, it, expect } from 'vitest'
import { toolDisplayName, TOOL_NAME_MAP, ANALYSIS_NODE_LABEL } from '~/utils/toolDisplayName'

describe('toolDisplayName', () => {
    it('普通工具走 TOOL_NAME_MAP 直查', () => {
        expect(toolDisplayName('search_case_analysis')).toBe('案件分析检索')
        expect(toolDisplayName('search_law')).toBe('法律检索')
        expect(toolDisplayName('write_case_memory')).toBe('记入笔记')
    })

    it('ask_*_expert 走 ANALYSIS_NODE_LABEL', () => {
        expect(toolDisplayName('ask_claim_expert')).toBe('请求权分析')
        expect(toolDisplayName('ask_evidence_expert')).toBe('证据清单')
    })

    it('未知 expert 模块名时降级为 "咨询X专家"', () => {
        expect(toolDisplayName('ask_unknown_expert')).toBe('咨询unknown专家')
    })

    it('extract 系列（含 extract-N / extract_N 变体）统一映射为「数据提取」', () => {
        expect(toolDisplayName('extract')).toBe('数据提取')
        expect(toolDisplayName('extract-1')).toBe('数据提取')
        expect(toolDisplayName('extract-12')).toBe('数据提取')
        expect(toolDisplayName('extract_3')).toBe('数据提取')
    })

    it('extract 字符串前缀但不在白名单内不被误匹配', () => {
        expect(toolDisplayName('extractor')).toBe('extractor')
        expect(toolDisplayName('extract_case_info')).toBe('提取案件信息')   // TOOL_NAME_MAP 优先
    })

    it('完全未知工具回退到原始 toolName', () => {
        expect(toolDisplayName('totally_random_tool')).toBe('totally_random_tool')
    })

    it('空字符串安全', () => {
        expect(toolDisplayName('')).toBe('')
    })

    it('TOOL_NAME_MAP / ANALYSIS_NODE_LABEL 公开导出便于复用', () => {
        expect(TOOL_NAME_MAP.search_law).toBe('法律检索')
        expect(ANALYSIS_NODE_LABEL.claim).toBe('请求权分析')
    })
})
