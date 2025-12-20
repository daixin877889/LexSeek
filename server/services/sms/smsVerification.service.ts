/**
 * 短信验证码验证服务
 *
 * 提供验证码验证、锁定检查、失败计数等功能
 * 用于统一处理注册、登录、重置密码等场景的验证码验证逻辑
 */

/**
 * 验证码验证结果
 */
export interface VerificationResult {
    /** 验证是否成功 */
    success: boolean
    /** 错误信息（验证失败时） */
    error?: string
    /** 错误码（验证失败时） */
    errorCode?: number
    /** 验证码记录（验证成功时） */
    record?: smsRecords
}

/**
 * 验证失败记录
 * 使用内存 Map 存储，key 格式: `${phone}:${type}`
 */
interface VerificationFailureRecord {
    /** 失败次数 */
    count: number
    /** 首次失败时间 */
    firstFailureAt: Date
    /** 锁定截止时间（如果被锁定） */
    lockedUntil?: Date
}

/**
 * 内存存储验证失败记录
 * key 格式: `${phone}:${type}`
 */
const verificationFailures = new Map<string, VerificationFailureRecord>()

/**
 * 生成失败记录的 key
 * @param phone 手机号
 * @param type 验证码类型
 * @returns 格式化的 key
 */
const getFailureKey = (phone: string, type: SmsType): string => {
    return `${phone}:${type}`
}

/**
 * 时间安全的字符串比较
 *
 * 使用固定时间比较两个字符串，防止时序攻击
 * 无论字符串在哪个位置不匹配，比较时间都保持一致
 *
 * @param a 字符串 a
 * @param b 字符串 b
 * @returns 两个字符串是否相等
 */
export const timingSafeEqual = (a: string, b: string): boolean => {
    // 如果长度不同，仍然需要进行完整比较以保持时间一致性
    // 使用较长字符串的长度作为比较基准
    const len = Math.max(a.length, b.length)

    // 用于累积比较结果，使用位运算避免短路求值
    let result = a.length === b.length ? 0 : 1

    // 逐字符比较，即使已经发现不匹配也继续比较
    for (let i = 0; i < len; i++) {
        // 使用异或运算比较字符，不同则结果非零
        // 对于超出长度的索引，使用 0 作为默认值
        const charA = i < a.length ? a.charCodeAt(i) : 0
        const charB = i < b.length ? b.charCodeAt(i) : 0
        result |= charA ^ charB
    }

    return result === 0
}


/**
 * 检查验证码是否被锁定
 *
 * 当同一手机号验证失败次数达到上限时，会被锁定一段时间
 * 锁定期间无法进行验证操作
 *
 * @param phone 手机号
 * @param type 验证码类型
 * @returns 是否被锁定
 */
export const isVerificationLocked = async (phone: string, type: SmsType): Promise<boolean> => {
    const key = getFailureKey(phone, type)
    const record = verificationFailures.get(key)

    if (!record || !record.lockedUntil) {
        return false
    }

    // 检查锁定是否已过期
    if (record.lockedUntil <= new Date()) {
        // 锁定已过期，清除记录
        verificationFailures.delete(key)
        return false
    }

    return true
}

/**
 * 记录验证失败
 *
 * 每次验证失败时调用，累计失败次数
 * 当失败次数达到上限时，自动锁定该手机号的验证码
 *
 * @param phone 手机号
 * @param type 验证码类型
 */
export const recordVerificationFailure = async (phone: string, type: SmsType): Promise<void> => {
    const config = useRuntimeConfig()
    const maxFailures = config.aliyun.sms.maxFailures
    // 配置单位为秒，转换为毫秒
    const lockDurationMs = config.aliyun.sms.lockDurationMs * 1000

    const key = getFailureKey(phone, type)
    const record = verificationFailures.get(key)

    if (!record) {
        // 首次失败，创建新记录
        verificationFailures.set(key, {
            count: 1,
            firstFailureAt: new Date(),
        })
        return
    }

    // 累加失败次数
    record.count += 1

    // 检查是否达到锁定阈值
    if (record.count >= maxFailures) {
        // 设置锁定截止时间
        record.lockedUntil = new Date(Date.now() + lockDurationMs)
    }

    verificationFailures.set(key, record)
}

/**
 * 重置验证失败计数
 *
 * 验证成功后调用，清除该手机号的失败记录
 *
 * @param phone 手机号
 * @param type 验证码类型
 */
export const resetVerificationFailures = async (phone: string, type: SmsType): Promise<void> => {
    const key = getFailureKey(phone, type)
    verificationFailures.delete(key)
}


/**
 * 验证短信验证码
 *
 * 执行完整的验证流程：
 * 1. 检查是否被锁定
 * 2. 检查验证码是否存在
 * 3. 检查验证码是否过期
 * 4. 使用时间安全比较验证码是否正确
 * 5. 验证成功后删除验证码记录并重置失败计数
 * 6. 验证失败时记录失败次数
 *
 * @param phone 手机号
 * @param code 用户输入的验证码
 * @param type 验证码类型（登录、注册、重置密码）
 * @returns 验证结果，包含成功状态、错误信息和验证码记录
 */
export const verifySmsCode = async (
    phone: string,
    code: string,
    type: SmsType
): Promise<VerificationResult> => {
    // 1. 检查是否被锁定
    const locked = await isVerificationLocked(phone, type)
    if (locked) {
        return {
            success: false,
            error: '验证码已锁定，请稍后再试',
            errorCode: 400,
        }
    }

    // 2. 查询验证码记录
    const smsRecord = await findSmsRecordByPhoneAndTypeDao(phone, type)
    if (!smsRecord) {
        return {
            success: false,
            error: '验证码不存在,请先获取验证码!',
            errorCode: 400,
        }
    }

    // 3. 检查验证码是否过期
    if (smsRecord.expiredAt < new Date()) {
        // 删除过期的验证码记录
        await deleteSmsRecordByIdDao(smsRecord.id)
        return {
            success: false,
            error: '验证码已过期',
            errorCode: 400,
        }
    }

    // 4. 使用时间安全比较验证码
    const isCodeValid = timingSafeEqual(smsRecord.code, code)
    if (!isCodeValid) {
        // 记录验证失败
        await recordVerificationFailure(phone, type)
        return {
            success: false,
            error: '验证码不正确',
            errorCode: 400,
        }
    }

    // 5. 验证成功，删除验证码记录
    await deleteSmsRecordByIdDao(smsRecord.id)

    // 6. 重置失败计数
    await resetVerificationFailures(phone, type)

    return {
        success: true,
        record: smsRecord,
    }
}

/**
 * 获取验证失败记录（仅用于测试）
 *
 * @param phone 手机号
 * @param type 验证码类型
 * @returns 失败记录或 undefined
 */
export const getVerificationFailureRecord = (
    phone: string,
    type: SmsType
): VerificationFailureRecord | undefined => {
    const key = getFailureKey(phone, type)
    return verificationFailures.get(key)
}

/**
 * 清除所有验证失败记录（仅用于测试）
 */
export const clearAllVerificationFailures = (): void => {
    verificationFailures.clear()
}
