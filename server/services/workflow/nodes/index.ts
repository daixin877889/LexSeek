/**
 * LangGraph 工作流节点导出
 *
 * 统一导出所有工作流节点，便于在工作流组装时使用
 */

// 材料处理节点
export {
    materialProcessNode,
    checkMaterialsReady,
    MATERIAL_PROCESS_NODE_NAME,
} from './materialProcess'

// 案情信息检查节点（中断点1）
export {
    caseInfoCheckNode,
    isCaseInfoSufficient,
    getCaseInfoCheckResult,
    CASE_INFO_CHECK_NODE_NAME,
    CASE_INFO_CHECK_NODE_CONFIG_NAME,
} from './caseInfoCheck'

// 基本信息提取节点（中断点2）
export {
    extractInfoNode,
    isBasicInfoConfirmed,
    getExtractedBasicInfo,
    EXTRACT_INFO_NODE_NAME,
    EXTRACT_INFO_NODE_CONFIG_NAME,
    type ExtractedInfo,
    type ExtractInfoInterruptData,
    type ConfirmedInfo,
} from './extractInfo'

// 模块选择节点（中断点3）
export {
    moduleSelectNode,
    hasSelectedModules,
    getSelectedModules,
    getAvailableModules,
    MODULE_SELECT_NODE_NAME,
    type ModuleSelectInterruptData,
    type SelectedModulesInput,
} from './moduleSelect'

// 分析任务节点
export {
    analysisTaskNode,
    getCurrentModuleName,
    getCompletedModuleCount,
    getTotalModuleCount,
    getAnalysisProgress,
    isAnalysisComplete,
    getLastAnalysisResult,
    getAllAnalysisResults,
    ANALYSIS_TASK_NODE_NAME,
    AnalysisStatus,
} from './analysisTask'
