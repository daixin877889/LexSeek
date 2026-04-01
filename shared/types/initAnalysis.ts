/** 初始化分析模块定义 */
export interface InitAnalysisModule {
  name: string
  title: string
  description: string
  icon: string
}

/** 模块执行状态 */
export type ModuleStatus = 'idle' | 'streaming' | 'complete' | 'failed' | 'interrupted'

/** 初始化分析模块固定顺序 */
export const INIT_ANALYSIS_MODULES: InitAnalysisModule[] = [
  { name: 'summary', title: '生成案件概要', description: '基于案件材料生成结构化案件概要', icon: 'FileText' },
  { name: 'chronicle', title: '提取案件大事记', description: '按时间线提取案件关键事件', icon: 'Calendar' },
  { name: 'claim', title: '预分析案件请求权', description: '分析案件可能的请求权基础', icon: 'Scale' },
  { name: 'trend', title: '判决趋势预测', description: '基于类案数据预测判决趋势', icon: 'TrendingUp' },
  { name: 'cause', title: '预选案由', description: '推荐适用的案由分类', icon: 'Tag' },
  { name: 'defense', title: '抗辩分析及应对策略预测', description: '预测对方抗辩策略并制定应对方案', icon: 'Shield' },
  { name: 'evidence', title: '证据清单预梳理', description: '梳理需要准备的证据清单', icon: 'ClipboardList' },
]

/** 有效模块名列表 */
export const VALID_MODULE_NAMES = INIT_ANALYSIS_MODULES.map(m => m.name)

/** 默认选中的模块 */
export const DEFAULT_SELECTED_MODULES = ['summary', 'chronicle']

/** 模块运行时状态 */
export interface ModuleRunState {
  name: string
  status: ModuleStatus
  content: string
  error?: string
}

/** SSE 事件类型 */
export type InitAnalysisEventType =
  | 'module_start'
  | 'module_streaming'
  | 'module_complete'
  | 'module_failed'
  | 'analysis_complete'
  | 'interrupt'
  | 'resume'

/** 初始化分析状态响应 */
export interface InitAnalysisStatusResponse {
  status: 'not_started' | 'in_progress' | 'completed' | 'failed'
  sessionId?: string
  /** 用户原始选中的模块列表（从 run input 恢复） */
  selectedModules?: string[]
  modules: Array<{
    name: string
    status: 'idle' | 'in_progress' | 'complete' | 'failed'
    result?: string
    version?: number
  }>
  /** 已完成模块的结果，用于页面刷新后恢复右侧面板结果 */
  result?: Record<string, string>
  /** 是否有待处理的 interrupt（如积分扣减失败等待充值） */
  hasPendingInterrupt?: boolean
}
