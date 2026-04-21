/**
 * parseAndAskStance 工具
 *
 * 合同审查 agent 首轮必调；职责：
 * 1. 下载原 .docx + parser 提取段落 + partyDetector 识别甲乙方
 * 2. 更新 DB 为 awaiting_stance 并 interrupt 等待用户立场
 * 3. 恢复后写回 stance + partyA/B（允许用户修正）→ 置 reviewing
 * 4. 返回 agent 继续审查所需上下文（含 paragraphs）
 */

import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'
import { InterruptType } from '#shared/types/case'
import type { Stance } from '#shared/types/contract'
import { emitContractReviewEvent } from '../nodes/contractReviewStageEmitter'
import {
    getContractReviewDAO,
    updateContractReviewDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { downloadFileService } from '~~/server/services/storage/storage.service'
import {
    parseContractDocx,
    detectParties,
} from '~~/server/services/assistant/contract/docx'

const schema = z.object({})

const VALID_STANCES: readonly Stance[] = ['partyA', 'partyB', 'neutral']

function isValidStance(value: unknown): value is Stance {
    return typeof value === 'string' && (VALID_STANCES as readonly string[]).includes(value)
}

const STANCE_LABELS: Record<Stance, string> = {
    partyA: '甲方',
    partyB: '乙方',
    neutral: '中立',
}

const STANCE_FOCUS_TABLE: Record<Stance, string> = {
    partyA: '延长付款期限、缩短交付、减少己方违约责任、增加对方违约成本、选择己方管辖地',
    partyB: '缩短付款周期、增加预付款、明确逾期违约金、放宽己方交付期限、减少己方违约责任',
    neutral: '识别所有可能产生歧义或权利义务不对等的条款，不偏向任何一方',
}

/** 工具定义（`ToolModule.toolDefinition`——注册表通过 `import * as` 聚合此模块导出） */
export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'parse_and_ask_stance',
    description:
        '解析合同段落、识别甲乙方与合同类型、通过 interrupt 请求用户立场。返回立场相关的审查上下文。此工具无需任何参数，直接调用即可。一次会话只应调用一次。',
    schema,
}

/** 工具工厂（`ToolModule.createTool`——注册表通过 `import * as` 聚合此模块导出） */
export const createTool = (context: ToolContext) => tool(
    async () => {
        const { reviewId, sessionId, runId } = context
        if (!reviewId) throw new Error('parseAndAskStance: reviewId 缺失')
        // emitter 上下文：仅当 runId 存在时发送 SSE 事件
        const emitterCtx = runId ? { runId, sessionId } : null

        const review = await getContractReviewDAO(reviewId)
        if (!review) throw new Error(`parseAndAskStance: review ${reviewId} not found`)

        const ossFile = await findOssFileByIdDao(review.originalFileId)
        if (!ossFile) throw new Error(`OSS file ${review.originalFileId} not found`)
        if (!ossFile.filePath) throw new Error(`OSS file ${review.originalFileId} filePath 缺失`)

        const docxBuffer = await downloadFileService(ossFile.filePath)
        const { paragraphs } = await parseContractDocx(docxBuffer)
        const { partyA, partyB, contractType } = await detectParties(paragraphs)

        // M6.1：detect 完成，发送 detect done 并紧接 stance running
        if (emitterCtx) {
            await emitContractReviewEvent(emitterCtx, {
                type: 'stage', stage: 'detect', status: 'done',
                partyA: partyA ?? undefined,
                partyB: partyB ?? undefined,
                contractType: contractType ?? undefined,
            })
            await emitContractReviewEvent(emitterCtx, {
                type: 'stage', stage: 'stance', status: 'running',
            })
        }

        await updateContractReviewDAO(reviewId, {
            contractType: contractType ?? null,
            partyA: partyA ?? null,
            partyB: partyB ?? null,
            status: 'awaiting_stance',
        })

        const resumed = interrupt({
            type: InterruptType.AWAITING_STANCE,
            reviewId,
            partyA,
            partyB,
            contractType,
        }) as unknown

        // resume 来自 /stance 端点（zod 已校验），但 tool 作为 workflow 边界仍需防御：
        // 旧 run 手工 resume / 外部脚本调用 / 测试场景都可能传入任意 payload。
        if (!resumed || typeof resumed !== 'object') {
            throw new Error(`parseAndAskStance: resume payload 非法 (${typeof resumed})`)
        }
        const payload = resumed as { stance?: unknown; partyA?: unknown; partyB?: unknown }
        if (!isValidStance(payload.stance)) {
            throw new Error(`parseAndAskStance: stance 必须是 partyA/partyB/neutral，收到 "${String(payload.stance)}"`)
        }
        const stance: Stance = payload.stance
        const resumedPartyA = typeof payload.partyA === 'string' ? payload.partyA : undefined
        const resumedPartyB = typeof payload.partyB === 'string' ? payload.partyB : undefined

        const finalPartyA = resumedPartyA ?? partyA ?? null
        const finalPartyB = resumedPartyB ?? partyB ?? null

        // M6.1：用户立场已确认，发送 stance done + analyze running
        if (emitterCtx) {
            await emitContractReviewEvent(emitterCtx, {
                type: 'stage', stage: 'stance', status: 'done',
            })
            await emitContractReviewEvent(emitterCtx, {
                type: 'stage', stage: 'analyze', status: 'running',
            })
        }

        await updateContractReviewDAO(reviewId, {
            stance,
            partyA: finalPartyA,
            partyB: finalPartyB,
            status: 'reviewing',
        })

        return {
            stance,
            stanceLabel: STANCE_LABELS[stance],
            stanceFocus: STANCE_FOCUS_TABLE[stance],
            partyA: finalPartyA,
            partyB: finalPartyB,
            contractType: contractType ?? null,
            paragraphs,
        }
    },
    toolDefinition,
)
