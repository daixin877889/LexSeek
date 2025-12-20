/**
 * 密码工具类
 */

import bcrypt from "bcryptjs";
/**
 * 密码加密的盐轮数
 */
export const SALT_ROUNDS = 10;

/**
 * 加密密码
 *
 * @param password 密码
 * @returns 加密后的密码
 */
export const generatePassword = (password: string) => {
    return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * 验证密码 
 *
 * @param password 密码
 * @param hashedPassword 加密后的密码
 * @returns 是否匹配
 */
export const comparePassword = (password: string, hashedPassword: string) => {
    return bcrypt.compare(password, hashedPassword);
}


/**
 * 验证密码复杂度
 *
 * @param password 密码
 * @returns 密码是否符合复杂度要求
 */
export function isValidPassword(password: string): boolean {
    // 至少8个字符，包含字母和数字
    const hasMinLength = password.length >= 8;
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    return hasMinLength && hasLetter && hasNumber;
}

/**
 * 生成随机邀请码
 * 生成6位数字和大写字母组合的随机字符串
 */
export function generateRandomCode(): string {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}


/**
 * 生成唯一邀请码
 * 生成6位数字和大写字母组合的随机邀请码，并确保唯一性
 */
export async function generateUniqueInviteCode(): Promise<string> {
    // 最大重试次数
    const MAX_RETRIES = 10;
    let retries = 0;

    while (retries < MAX_RETRIES) {
        // 生成随机邀请码
        const code = generateRandomCode();

        // 检查邀请码是否已存在
        const existingCode = await prisma.users.findFirst({
            where: { inviteCode: code }
        })
        // 如果不存在，则返回这个邀请码
        if (!existingCode) {
            return code;
        }

        // 如果存在，增加重试次数
        retries++;
        logger.warn(`生成的邀请码 ${code} 已存在，尝试重新生成 (${retries}/${MAX_RETRIES})`);
    }

    // 如果超过最大重试次数，使用时间戳加随机数确保唯一性
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.floor(Math.random() * 10000)
        .toString(36)
        .toUpperCase();
    const uniqueCode = (timestamp + random).slice(0, 6);

    logger.warn(`已达到最大重试次数，使用时间戳生成邀请码: ${uniqueCode}`);
    return uniqueCode;
}
