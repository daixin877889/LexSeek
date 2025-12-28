/**
 * API 测试辅助函数
 *
 * 提供测试数据创建、认证、清理等辅助功能
 * 
 * 原则：
 * - 用户创建通过注册 API
 * - 验证码通过发送 API
 * - 数据验证和清理可以直接操作数据库
 *
 * **Feature: api-integration-tests**
 * **Validates: Requirements 1.5, 1.6**
 */

import { ApiTestClient, createApiClient, type ApiResponse } from './test-api-client'
import {
    testPrisma,
    createEmptyTestIds,
    cleanupTestData,
    connectTestDb,
    disconnectTestDb,
    TEST_USER_PHONE_PREFIX,
    type TestIds,
} from '../membership/test-db-helper'
import { SmsType } from '../../../shared/types/sms'

/** 测试用户信息 */
export interface TestUserInfo {
    id: number
    phone: string
    name: string
    password: string  // 明文密码
    token?: string
}

/** 注册数据 */
export interface RegisterData {
    phone: string
    code: string
    name: string
    password: string
    username?: string
    company?: string
    profile?: string
    invitedBy?: string
}

/** 登录响应数据 */
export interface LoginResponseData {
    token: string
    user: {
        id: number
        phone: string
        name: string
        roles: number[]
        status: number
    }
}

/**
 * API 测试辅助类
 *
 * 封装测试数据创建、认证、清理等功能
 */
export class ApiTestHelper {
    private client: ApiTestClient
    private testIds: TestIds

    constructor(client?: ApiTestClient) {
        this.client = client || createApiClient()
        this.testIds = createEmptyTestIds()
    }

    /**
     * 获取 API 客户端
     */
    getClient(): ApiTestClient {
        return this.client
    }

    /**
     * 获取测试 ID 追踪对象
     */
    getTestIds(): TestIds {
        return this.testIds
    }

    /**
     * 生成唯一的测试手机号
     */
    generatePhone(): string {
        const timestamp = Date.now()
        const random = Math.floor(Math.random() * 10000)
        const suffix = String(timestamp).slice(-4) + String(random).padStart(4, '0')
        return `${TEST_USER_PHONE_PREFIX}${suffix}`
    }

    /**
     * 生成有效的密码
     */
    generatePassword(): string {
        return `Test${Date.now()}!`
    }

    /**
     * 生成 6 位验证码
     */
    generateSmsCode(): string {
        return String(Math.floor(100000 + Math.random() * 900000))
    }

    /**
     * 生成用户名
     */
    generateUsername(): string {
        return `testuser_${Date.now()}_${Math.floor(Math.random() * 1000)}`
    }

    /**
     * 通过 API 发送验证码，然后从数据库获取验证码
     * 这是测试环境的做法：通过 API 发送，从数据库读取
     */
    async sendAndGetSmsCode(phone: string, type: SmsType): Promise<string> {
        // 先删除旧记录（避免频率限制）
        await testPrisma.smsRecords.deleteMany({
            where: { phone, type },
        })

        // 通过 API 发送验证码
        const response = await this.client.post('/api/v1/sms/send', {
            phone,
            type,
        })

        if (!response.success) {
            throw new Error(`发送验证码失败: ${response.message}`)
        }

        // 从数据库获取验证码（用于测试验证）
        const record = await testPrisma.smsRecords.findFirst({
            where: { phone, type },
            orderBy: { createdAt: 'desc' },
        })

        if (!record) {
            throw new Error('验证码记录未找到')
        }

        return record.code
    }

    /**
     * 删除短信验证码记录（用于清理）
     */
    async deleteSmsCode(phone: string, type: SmsType): Promise<void> {
        await testPrisma.smsRecords.deleteMany({
            where: { phone, type },
        })
    }

    /**
     * 通过 API 注册用户
     */
    async registerUser(data: RegisterData): Promise<ApiResponse<LoginResponseData>> {
        const response = await this.client.post<LoginResponseData>('/api/v1/auth/register', data)

        if (response.success && response.data?.user?.id) {
            this.testIds.userIds.push(response.data.user.id)
            if (response.data.token) {
                this.client.setAuthToken(response.data.token)
            }
        }

        return response
    }

    /**
     * 通过 API 使用密码登录
     */
    async loginWithPassword(phone: string, password: string): Promise<ApiResponse<LoginResponseData>> {
        const response = await this.client.post<LoginResponseData>('/api/v1/auth/login/password', {
            phone,
            password,
        })

        if (response.success && response.data?.token) {
            this.client.setAuthToken(response.data.token)
        }

        return response
    }

    /**
     * 通过 API 使用短信验证码登录
     */
    async loginWithSms(phone: string, code: string): Promise<ApiResponse<LoginResponseData>> {
        const response = await this.client.post<LoginResponseData>('/api/v1/auth/login/sms', {
            phone,
            code,
        })

        if (response.success && response.data?.token) {
            this.client.setAuthToken(response.data.token)
        }

        return response
    }

    /**
     * 通过 API 登出
     */
    async logout(): Promise<ApiResponse<any>> {
        const response = await this.client.post('/api/v1/auth/logout')
        this.client.clearAuthToken()
        return response
    }

    /**
     * 通过注册 API 创建用户并登录（完整流程）
     * 这是创建测试用户的标准方法
     */
    async createAndLoginUser(
        phone?: string,
        password?: string,
        name?: string
    ): Promise<TestUserInfo> {
        const userPhone = phone || this.generatePhone()
        const userPassword = password || this.generatePassword()
        const userName = name || `测试用户_${Date.now()}`

        // 通过 API 发送验证码并获取
        const code = await this.sendAndGetSmsCode(userPhone, SmsType.REGISTER)

        // 通过 API 注册
        const response = await this.registerUser({
            phone: userPhone,
            code,
            name: userName,
            password: userPassword,
        })

        // 清理验证码记录
        await this.deleteSmsCode(userPhone, SmsType.REGISTER)

        if (!response.success || !response.data) {
            throw new Error(`注册失败: ${response.message}`)
        }

        return {
            id: response.data.user.id,
            phone: userPhone,
            name: userName,
            password: userPassword,
            token: response.data.token,
        }
    }

    /**
     * 通过注册流程创建用户并登录（支持邀请码）
     */
    async registerAndLogin(
        phone?: string,
        password?: string,
        name?: string,
        invitedBy?: string
    ): Promise<TestUserInfo> {
        const userPhone = phone || this.generatePhone()
        const userPassword = password || this.generatePassword()
        const userName = name || `测试用户_${Date.now()}`

        // 通过 API 发送验证码并获取
        const code = await this.sendAndGetSmsCode(userPhone, SmsType.REGISTER)

        // 通过 API 注册
        const response = await this.registerUser({
            phone: userPhone,
            code,
            name: userName,
            password: userPassword,
            invitedBy,
        })

        // 清理验证码记录
        await this.deleteSmsCode(userPhone, SmsType.REGISTER)

        if (!response.success || !response.data) {
            throw new Error(`注册失败: ${response.message}`)
        }

        return {
            id: response.data.user.id,
            phone: userPhone,
            name: userName,
            password: userPassword,
            token: response.data.token,
        }
    }

    /**
     * 清理测试数据
     */
    async cleanup(): Promise<void> {
        await cleanupTestData(this.testIds)
        this.testIds = createEmptyTestIds()
        this.client.clearAuthToken()
    }

    /**
     * 重置测试状态
     */
    reset(): void {
        this.testIds = createEmptyTestIds()
        this.client.clearAuthToken()
    }
}

/** 创建新的测试辅助实例 */
export const createTestHelper = (client?: ApiTestClient): ApiTestHelper => {
    return new ApiTestHelper(client)
}

// 导出数据库连接函数（仅用于数据验证和清理）
export { connectTestDb, disconnectTestDb, testPrisma, TEST_USER_PHONE_PREFIX }
export { SmsType }
