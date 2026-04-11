/**
 * ai-elements 工具组件共享类型
 *
 * `ExtendedToolState` 被 app/components/ai/tools/**.vue 用作工具组件的状态 prop。
 * 与 `ai` 包中 `ToolUIPart['state']` 对应。
 */

import type { ToolUIPart } from 'ai'

/** 工具组件状态类型（对应 ai 包的 ToolUIPart['state']） */
export type ExtendedToolState = ToolUIPart['state']
