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
    it.each([
      ['resume', true],
      ['continue', true],
      ['try_again', true],
      [undefined, false],
      ['', false],
      ['delete_case', false],
      ['RESET', false],
      ['resume ', false],
      ['Resume', false],
    ] as const)('command=%s → %s', (cmd, expected) => {
      expect(isValidResumeCommand(cmd)).toBe(expected)
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
