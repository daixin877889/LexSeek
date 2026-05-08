/**
 * chat.post.ts 分支逻辑测试 - 纯函数测试
 *
 * **Feature: agent-background-queue**
 * **Validates: Requirements 3.1, 3.2**
 */

import { describe, it, expect } from 'vitest'
import './test-setup'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'
import {
  shouldRejectMessage,
  isValidResumeCommand,
  shouldRejectResume,
  getResumeCount,
} from '~~/server/utils/chat-branch-utils'

describe('chat.post.ts - 纯函数测试', () => {
  describe('shouldRejectMessage', () => {
    it.each([
      [AGENT_RUN_STATUS.RUNNING, true, true],
      [AGENT_RUN_STATUS.RUNNING, false, false],
      [AGENT_RUN_STATUS.PENDING, true, false],
      [AGENT_RUN_STATUS.PENDING, false, false],
      [AGENT_RUN_STATUS.INTERRUPTED, true, false],
      [AGENT_RUN_STATUS.COMPLETED, true, false],
      [AGENT_RUN_STATUS.FAILED, true, false],
      [AGENT_RUN_STATUS.CANCELLED, true, false],
    ] as const)('status=%s, hasMessage=%s → %s', (status, hasMessage, expected) => {
      expect(shouldRejectMessage(status, hasMessage)).toBe(expected)
    })
  })

  describe('isValidResumeCommand', () => {
    // LangGraph SDK Command 协议：{ resume: <payload> }
    // payload 可以是任何 JSON-serializable 值（按 interrupt id / toolCallId 索引的 dict、动作 dict、字符串、数字等）
    // 之前实现把 command 当字符串白名单，与所有前端调用方（useDomainAgentSession / [sessionId].vue / useInitAnalysisRuntime）的 LangGraph dict 协议不匹配
    it.each([
      // ✅ LangGraph dict 协议 — 都应通过
      [{ resume: { action: 'continue' } }, true],
      [{ resume: { action: 'approve', data: { foo: 1 } } }, true],
      [{ resume: { action: 'reject' } }, true],
      [{ resume: { call_00_xyz: { templateId: 1 } } }, true],  // template_select 场景（按 toolCallId 索引）
      [{ resume: 'plain-string-payload' }, true],
      [{ resume: 42 }, true],
      [{ resume: null }, true],

      // ❌ 不是 LangGraph 协议 — 拒绝
      [undefined, false],
      [null, false],
      ['resume', false],     // 旧字符串白名单
      ['continue', false],
      ['try_again', false],
      ['', false],
      [{}, false],            // 缺 resume 字段
      [{ goto: 'node' }, false],
      [{ Resume: {} }, false], // 大小写敏感
      [42, false],
    ] as const)('command=%s → %s', (cmd, expected) => {
      expect(isValidResumeCommand(cmd as any)).toBe(expected)
    })
  })

  describe('shouldRejectResume', () => {
    it.each([
      [0, false],
      [1, false],
      [2, false],
      [3, true],
      [4, true],
    ] as const)('resumeCount=%s → %s', (count, expected) => {
      expect(shouldRejectResume(count)).toBe(expected)
    })
  })

  describe('getResumeCount', () => {
    it.each([
      [null, 0],
      [undefined, 0],
      [{}, 0],
      [{ resumeCount: 2 }, 2],
      [{ resumeCount: 0 }, 0],
      [{ resumeCount: -1 }, -1],
    ] as const)('metadata=%s → %s', (metadata, expected) => {
      expect(getResumeCount(metadata)).toBe(expected)
    })
  })
})
