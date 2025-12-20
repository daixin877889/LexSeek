/**
 * JWT工具模块
 *
 * 提供JWT令牌的生成、验证和解析功能。
 * JWT用于用户身份验证和API请求授权。
 */

import jwt, { Secret, SignOptions } from "jsonwebtoken";
// import config from "@/config/index.js";

const config = useRuntimeConfig()

export interface JwtPayload {
  /** 用户ID */
  id: number;
  /** 用户手机号 */
  phone: string;
  /** 用户角色 */
  role: string;
  /** 用户状态 */
  status?: number;
}

/**
 * JWT工具类
 *
 * 用于生成、验证和解析JWT令牌
 */
export class JwtUtil {
  /**
   * 创建JWT令牌
   *
   * @param payload 要编码到令牌中的数据
   * @returns 生成的JWT令牌
   */
  static generateToken(payload: JwtPayload): string {
    try {
      // 检查用户状态，如果是禁用状态，抛出错误
      if (payload.status === 0) {
        throw new Error("账号已禁用，无法生成令牌");
      }

      // 不在token中存储状态，减少token大小
      const { status, ...tokenPayload } = payload;

      return jwt.sign(tokenPayload, config.jwt.secret as Secret, { expiresIn: config.jwt.expiresIn } as SignOptions);
    } catch (error) {
      logger.error("JWT令牌生成失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (error) {
        throw error;
      }
      throw new Error("认证令牌生成失败");
    }
  }

  /**
   * 验证并解析JWT令牌
   *
   * @param token JWT令牌
   * @returns 解析后的令牌数据
   */
  static verifyToken(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, config.jwt.secret as Secret) as JwtPayload;
      return decoded
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error("认证令牌已过期");
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Error("无效的认证令牌");
      } else {
        logger.error("JWT令牌验证失败", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error("认证失败");
      }
    }
  }
}
