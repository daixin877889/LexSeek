/**
 * ai-elements 工具组件共享类型
 *
 * `ExtendedToolState` 被 app/components/ai/tools/**.vue 用作工具组件的状态 prop。
 * 基于 `ai` 包中 `ToolUIPart['state']` 扩展出 'input-paused' 状态，
 * 用于工作流 interrupt 期间（如积分不足）把"运行中"改显为"已暂停"。
 */

import type { ToolUIPart } from 'ai'

/**
 * 工具组件状态类型。
 * - ai 包标准状态 + 自定义 'input-paused'
 * - 'input-paused'：工具已发起但被工作流 interrupt 暂停，等待用户处理
 */
export type ExtendedToolState = ToolUIPart['state'] | 'input-paused'
