/**
 * 系统配置状态
 */
export enum SystemConfigStatus {
    DISABLED = 0,
    ENABLED = 1
}

/**
 * OSS配置 value 类型
 */
export interface OSSConfig {
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
    region: string;
    endpoint?: string;
    callbackUrl?: string;
    expiration?: number; // 凭证过期时间，单位：秒
    roleArn?: string;    // 角色ARN
    roleSessionName?: string; // 临时Token的会话名称
    basePath?: string;    // 基础路径
    domain?: string;      // 公网域名
    internalDomain?: string; // 内网域名
}

/**
 * 免费用户每日分析限制 value 类型
 */
export interface FreeUserLimit {
    freeUserConcurrentLimit: number;
    freeUserDailyLimit: number;
    freeUserMonthlyLimit: number;
}

/**
 * 用户免费云盘空间 value 类型
 */
export interface FreeUserDiskSpace {
    benefitValue: number;
    unit: string;
}

/**
 * 新用户注册赠送会员 value 类型
 */
export interface RegisterGift {
    enable: boolean;
    membershipLevel: number;
    duration: number;
    giftPoint: number;
}

/**
 * 邀请新用户注册赠送会员 value 类型
 */
export interface InvitationToRegister {
    enable: boolean;
    membershipLevel: number;
    duration: number;
    giftPoint: number;
}