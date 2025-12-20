/**
 * 用户状态
 */
export enum UserStatus {
    ACTIVE = 1,
    INACTIVE = 0
}

/**
 * 用户注册渠道定义
 */
export enum UserRegisterChannel {
    /** 官网注册 */
    WEB = "web",
    /** 微信小程序注册 */
    WECHAT_MINIAPP = "wxMiniApp"
}
