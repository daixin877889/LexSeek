/**
 * 短信验证码数据访问层
 */

/**
 * 创建短信验证码
 * @param phone 手机号
 * @param type 类型
 * @param code 验证码
 * @param codeExpireMs 验证码过期时间（毫秒）
 * @returns 短信验证码
 */
export const createSmsRecordDao = async (phone: string, type: SmsType, code: string, codeExpireMs: number, tx?: any): Promise<smsRecords> => {
    try {
        const now = new Date()
        const expiredAt = new Date(now.getTime() + codeExpireMs)
        const smsRecord = await (tx || prisma).smsRecords.create({
            data: { phone, type, code, expiredAt, createdAt: now, updatedAt: now },
        })
        return smsRecord
    } catch (error) {
        logger.error('创建短信验证码失败：', error)
        throw error
    }
}

/**
 * 通过手机号和类型查询短信验证码
 * @param phone 手机号
 * @param type 类型
 * @returns 短信验证码
 */
export const findSmsRecordByPhoneAndTypeDao = async (phone: string, type: SmsType, tx?: any): Promise<smsRecords | null> => {
    try {
        const smsRecord = await (tx || prisma).smsRecords.findFirst({
            where: { phone, type, deletedAt: null },
        })
        if (!smsRecord) {
            return null
        }
        return smsRecord
    } catch (error) {
        logger.error('通过手机号和类型查询短信验证码失败：', error)
        throw error
    }
}

/**
 * 删除短信验证码
 * @param id 短信验证码ID
 * @returns 是否删除成功
 */
export const deleteSmsRecordByIdDao = async (id: string, tx?: any): Promise<boolean> => {
    try {
        await (tx || prisma).smsRecords.delete({
            where: { id, deletedAt: null },
        })
        return true
    } catch (error) {
        logger.error('删除短信验证码失败：', error)
        throw error
    }
}