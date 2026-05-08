/**
 * 工具名称中文显示映射（前端唯一权威源）
 *
 * 三类来源：
 * 1. 普通工具：直接 toolName → 中文名（TOOL_NAME_MAP）
 * 2. ask_*_expert 子代理：通过 EXPERT_PATTERN 提取分析模块名后查 ANALYSIS_NODE_LABEL
 * 3. 分析模块名（caseInfoCheck/claim/trend/...）：search_case_analysis 结果卡片用
 *
 * 历史背景：DefaultTool.vue / AnalysisSearchTool.vue 各自维护一份，名字不一致导致
 * 同一模块在不同 UI 显示不同标题。统一抽到这里后两侧都从此处 import。
 */

/** 工具名 → 中文显示名（专属组件未注册的工具走 DefaultTool） */
export const TOOL_NAME_MAP: Record<string, string> = {
    // search_*
    search_case_analysis: '案件分析检索',
    search_case_materials: '材料检索',
    search_case_memory: '案件记忆检索',
    search_law: '法律检索',
    // 案件记忆
    write_case_memory: '记入笔记',
    update_case_memory: '更新笔记',
    // 工作流核心
    upload_workspace_file: '上传工作区文件',
    save_analysis_result: '保存分析结果',
    generate_summary: '生成结果摘要',
    extract: '数据提取',
    extract_case_info: '提取案件信息',
    write_todos: '记录待办',
    // skill 系列
    write_skill_file: '写入技能文件',
    read_skill_file: '读取技能文件',
    run_skill_script: '运行技能脚本',
    // 积分
    reserve_points: '冻结积分',
    confirm_points: '扣减积分',
    rollback_points: '退回积分',
    // 文书 / 合同 / 子代理工具
    draft_document: '文书生成',
    review_contract: '合同审查',
    process_materials: '处理素材',
}

import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'

/**
 * 案件分析模块名 → 中文显示名。
 * 单一权威源：shared/types/initAnalysis.ts 的 INIT_ANALYSIS_MODULES。
 * 新增模块只需改 INIT_ANALYSIS_MODULES，本表自动跟进。
 *
 * caseInfoCheck 是初分前置校验阶段（不在 INIT_ANALYSIS_MODULES 里），单独补一行。
 */
export const ANALYSIS_NODE_LABEL: Record<string, string> = {
    caseInfoCheck: '案情信息检查',
    ...Object.fromEntries(INIT_ANALYSIS_MODULES.map(m => [m.name, m.title])),
}

/** ask_*_expert 工具名匹配：捕获中间的分析模块名 */
export const EXPERT_PATTERN = /^ask_([a-z0-9_]+?)_expert$/

/**
 * extract 系列工具：除原名外，部分场景下后端会下发带数字后缀的变体
 * （extract-1 / extract-2 / extract_3 ...），统一显示为「数据提取」
 */
export const EXTRACT_PATTERN = /^extract[-_]?\d*$/

/**
 * 工具名 → 中文显示名（统一入口）。
 * 找不到映射时返回原始 toolName，避免 UI 显示空字符串。
 */
export function toolDisplayName(toolName: string): string {
    if (!toolName) return ''
    const mapped = TOOL_NAME_MAP[toolName]
    if (mapped) return mapped
    if (EXTRACT_PATTERN.test(toolName)) return '数据提取'
    const expertMatch = toolName.match(EXPERT_PATTERN)
    if (expertMatch && expertMatch[1]) {
        return ANALYSIS_NODE_LABEL[expertMatch[1]] ?? `咨询${expertMatch[1]}专家`
    }
    return toolName
}
