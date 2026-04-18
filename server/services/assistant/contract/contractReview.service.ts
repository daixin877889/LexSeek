/**
 * 合同审查 Service 层
 *
 * `createAndStartContractReviewService` 的完整实现由 Task 7 POST /reviews 端点补齐；
 * 本文件先暴露类型占位，避免其他 Task 引用时 TS 报错。
 *
 * **Feature: contract-review-m3**
 */
import type { CreateReviewRequest, CreateReviewResponse } from '#shared/types/contract'

export interface CreateAndStartOptions extends CreateReviewRequest {
    userId: number
}

export type CreateAndStartResult =
    | CreateReviewResponse
    | { error: string; code: number }

// 实际实现在 Task 7 补齐；留 throw 占位防止误调
export async function createAndStartContractReviewService(
    _options: CreateAndStartOptions,
): Promise<CreateAndStartResult> {
    throw new Error('createAndStartContractReviewService: not yet implemented (Task 7)')
}
