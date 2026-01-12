/**
 * 材料模块测试环境设置
 *
 * 复用案件模块的测试环境设置
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 3.1, 4.1**
 */

// 导入案件模块的测试设置（会设置全局变量）
import '../case/test-setup'

export { mockLogger } from '../case/test-setup'
