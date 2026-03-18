/**
 * 案件服务层
 *
 * 提供案件的业务逻辑封装，包括案件创建、获取、更新、会话管理
 * Requirements: 3.1, 3.2, 5.6, 5.7, 8.3, 8.4, 8.5
 */

import type { cases, caseSessions } from '~~/generated/prisma/client'
import { v7 as uuidv7 } from 'uuid'

// 导入 DAO 函数
import { findCaseBySessionIdDao, type CaseWithRelations } from './case.dao'
import { findByCaseIdDAO } from './caseMaterial.dao'
import { CaseStatus, SessionStatus, CaseMaterialType } from '#shared/types/case'



/**
 * 获取会话详情
 *
 * @param sessionId 会话 ID
 * @returns 会话详情或 null
 */
export const findCaseBySessionIdService = async (
    sessionId: string
): Promise<CaseWithRelations | null> => {
    return await findCaseBySessionIdDao(sessionId)
}
