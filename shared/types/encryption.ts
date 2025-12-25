/**
 * 客户端文件加密相关类型定义
 * 基于 age-encryption 库实现端到端加密
 */

/**
 * age 密钥对
 * identity: 私钥，以 AGE-SECRET-KEY-1 开头
 * recipient: 公钥，以 age1 开头
 */
export interface AgeKeyPair {
    /** 私钥 (AGE-SECRET-KEY-1...) */
    identity: string
    /** 公钥 (age1...) */
    recipient: string
}

/**
 * 用户加密配置（从服务端获取）
 */
export interface UserEncryptionConfig {
    /** 公钥 */
    recipient: string
    /** 加密后的私钥（使用用户密码加密） */
    encryptedIdentity: string
    /** 是否有恢复密钥 */
    hasRecoveryKey: boolean
}

/**
 * 加密状态
 */
export type EncryptionStatus =
    | 'idle'           // 空闲
    | 'encrypting'     // 加密中
    | 'uploading'      // 上传中
    | 'success'        // 成功
    | 'error'          // 错误

/**
 * 解密状态
 */
export type DecryptionStatus =
    | 'idle'           // 空闲
    | 'locked'         // 私钥未解锁
    | 'unlocking'      // 正在解锁
    | 'decrypting'     // 解密中
    | 'success'        // 成功
    | 'error'          // 错误

/**
 * 加密错误：私钥未解锁
 */
export class IdentityNotUnlockedError extends Error {
    constructor() {
        super('私钥未解锁，请先输入加密密码')
        this.name = 'IdentityNotUnlockedError'
    }
}

/**
 * 加密错误：私钥不匹配
 */
export class IdentityMismatchError extends Error {
    constructor() {
        super('私钥不匹配，无法解密此文件')
        this.name = 'IdentityMismatchError'
    }
}

/**
 * 加密错误：文件损坏
 */
export class FileCorruptedError extends Error {
    constructor() {
        super('文件已损坏，无法解密')
        this.name = 'FileCorruptedError'
    }
}

/**
 * 加密错误：无效的 age 文件格式
 */
export class InvalidAgeFileError extends Error {
    constructor() {
        super('无效的加密文件格式')
        this.name = 'InvalidAgeFileError'
    }
}

/**
 * 加密错误：密码错误
 */
export class WrongPasswordError extends Error {
    constructor() {
        super('加密密码错误，请重试')
        this.name = 'WrongPasswordError'
    }
}

/**
 * 保存加密配置请求参数
 */
export interface SaveEncryptionConfigRequest {
    /** 公钥 */
    recipient: string
    /** 加密后的私钥 */
    encryptedIdentity: string
    /** 恢复密钥加密的私钥（可选） */
    encryptedRecoveryKey?: string
}

/**
 * 更新加密配置请求参数（修改密码）
 */
export interface UpdateEncryptionConfigRequest {
    /** 新的加密后私钥 */
    encryptedIdentity: string
    /** 新的恢复密钥加密的私钥（可选） */
    encryptedRecoveryKey?: string
}

/**
 * 使用恢复密钥重置密码请求参数
 */
export interface RecoveryResetRequest {
    /** 新的加密后私钥 */
    newEncryptedIdentity: string
    /** 新的恢复密钥加密的私钥（可选） */
    newEncryptedRecoveryKey?: string
}
