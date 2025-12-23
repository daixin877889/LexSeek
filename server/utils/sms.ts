export * as AliSms from '../lib/aliSms'


/**
 * 生成随机验证码
 *
 * @returns 随机生成的验证码
 */
export function generateSmsCode(): string {
    return Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
}

