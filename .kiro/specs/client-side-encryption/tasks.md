# 实现计划：客户端文件加密

## 概述

本实现计划将客户端文件加密功能分解为可执行的编码任务。采用增量开发方式，每个任务都建立在前一个任务的基础上，确保功能逐步完善。

## 任务列表

- [x] 1. 基础设施搭建
  - [x] 1.1 安装 age-encryption 依赖
    - 使用 `bun add age-encryption` 安装加密库
    - 使用 `bun add -D fast-check` 安装属性测试库
    - _Requirements: 3.2_

  - [x] 1.2 创建加密相关类型定义
    - 在 `shared/types/encryption.ts` 中定义所有加密相关类型
    - 包括：AgeKeyPair、UserEncryptionConfig、EncryptionStatus、DecryptionStatus
    - 定义错误类：IdentityNotUnlockedError、IdentityMismatchError、FileCorruptedError、InvalidAgeFileError
    - _Requirements: 10.1_

  - [x] 1.3 扩展数据库模型
    - 在 `prisma/models/file.prisma` 中为 ossFiles 添加 encrypted、originalMimeType 字段
    - 创建 `prisma/models/encryption.prisma` 定义 userEncryptions 模型
    - 运行 `bunx prisma generate` 生成客户端
    - 创建数据库迁移
    - _Requirements: 10.5_

- [x] 2. 核心加密 Composable 实现
  - [x] 2.1 实现 useAgeCrypto composable
    - 创建 `app/composables/useAgeCrypto.ts`
    - 实现 generateKeyPair() 方法生成密钥对
    - 实现 encryptIdentity() 和 decryptIdentity() 方法处理私钥加密
    - 实现 unlockIdentity() 和 lockIdentity() 方法管理内存中的私钥
    - 实现 encryptFile() 方法进行文件加密
    - 实现 decryptFile() 方法进行文件解密
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 2.2 编写 useAgeCrypto 属性测试
    - **Property 1: 密钥对生成格式正确性**
    - **Property 2: 私钥加密解密往返一致性**
    - **Validates: Requirements 1.2, 1.3, 1.8**

  - [x] 2.3 实现 useFileEncryption composable
    - 创建 `app/composables/useFileEncryption.ts`
    - 返回响应式的 status、progress、error、encryptedBlob
    - 实现 encrypt() 和 reset() 方法
    - _Requirements: 9.5, 9.6_

  - [x] 2.4 实现 useFileDecryption composable
    - 创建 `app/composables/useFileDecryption.ts`
    - 返回响应式的 status、progress、error、objectUrl
    - 实现 decrypt()、revokeUrl()、reset() 方法
    - 组件卸载时自动释放 Object URL
    - _Requirements: 9.7, 9.8, 9.9, 9.10_

  - [x] 2.5 编写文件加密解密属性测试
    - **Property 5: 文件加密解密往返一致性**
    - **Property 9: 进度值范围**
    - **Validates: Requirements 3.7, 8.2, 8.3**

- [x] 3. 检查点 - 核心加密功能验证
  - 确保所有测试通过，如有问题请询问用户

- [x] 4. 服务端 API 实现
  - [x] 4.1 创建用户加密配置 DAO
    - 创建 `server/dao/encryption.ts`
    - 实现 getUserEncryption()、createUserEncryption()、updateUserEncryption() 方法
    - _Requirements: 1.4, 1.5, 1.6_

  - [x] 4.2 实现加密配置 GET API
    - 创建 `server/api/v1/encryption/config.get.ts`
    - 返回用户的公钥、加密后的私钥、是否有恢复密钥
    - _Requirements: 1.7_

  - [x] 4.3 实现加密配置 POST API
    - 创建 `server/api/v1/encryption/config.post.ts`
    - 使用 zod 验证参数
    - 保存用户的公钥和加密后的私钥
    - _Requirements: 1.4_

  - [x] 4.4 实现加密配置 PUT API
    - 创建 `server/api/v1/encryption/config.put.ts`
    - 用于修改加密密码后更新加密后的私钥
    - _Requirements: 1.1.1, 1.1.2, 1.1.3_

  - [x] 4.5 实现恢复密钥 API
    - 创建 `server/api/v1/encryption/recovery.post.ts`
    - 用于使用恢复密钥重置密码
    - _Requirements: 1.2.5, 1.2.6, 1.2.7_

  - [x] 4.6 编写 API 单元测试
    - 测试参数验证
    - 测试正常流程
    - 测试错误处理
    - _Requirements: 10.6_

- [x] 5. 预签名 URL API 修改
  - [x] 5.1 修改单文件预签名 API
    - 修改 `server/api/v1/files/presigned-url/.get.ts`
    - 添加 encrypted 参数验证
    - 加密文件使用 .age 后缀
    - 回调变量添加 encrypted、original_mime_type
    - _Requirements: 4.2, 4.3_

  - [x] 5.2 修改批量预签名 API
    - 修改 `server/api/v1/files/presigned-url/.post.ts`
    - 添加 encrypted 参数验证
    - 批量处理加密文件
    - _Requirements: 6.4_

  - [x] 5.3 修改 OSS 回调处理
    - 修改 OSS 回调 API 解析加密相关变量
    - 更新文件记录的 encrypted 和 originalMimeType 字段
    - _Requirements: 4.5_

  - [x] 5.4 编写属性测试
    - **Property 7: 文件元数据保留**
    - **Validates: Requirements 4.6, 4.7**

- [x] 6. 检查点 - 服务端功能验证
  - 确保所有测试通过，如有问题请询问用户

- [x] 7. 客户端 Store 实现
  - [x] 7.1 创建加密配置 Store
    - 创建 `app/store/encryption.ts`
    - 实现获取、保存、更新加密配置的方法
    - 管理私钥解锁状态
    - _Requirements: 1.7, 1.8, 1.10, 1.11_

  - [x] 7.2 修改文件 Store
    - 修改 `app/store/file.ts`
    - getPresignedUrl 和 getBatchPresignedUrls 方法添加 encrypted 参数
    - _Requirements: 4.3_

- [x] 8. 文件上传组件修改
  - [x] 8.1 添加加密相关 Props
    - 修改 `app/components/general/fileUploader.vue`
    - 添加 enableEncryption、defaultEncrypted props
    - _Requirements: 10.2, 10.3_

  - [x] 8.2 实现加密开关 UI
    - 添加加密开关组件
    - 未设置密钥时禁用并显示提示
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [x] 8.3 实现加密上传流程
    - 选择加密时先调用 encryptFile 加密
    - 加密完成后上传加密后的 Blob
    - 传递 encrypted 参数给预签名 API
    - _Requirements: 3.1, 3.3, 3.4, 4.1_

  - [x] 8.4 实现加密进度显示
    - 显示"加密中..."状态
    - 显示加密百分比进度
    - 显示组合进度（加密 + 上传）
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 8.5 实现批量加密上传
    - 依次加密每个文件
    - 显示每个文件的单独进度
    - 单个文件失败继续处理其他文件
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 9. 检查点 - 上传功能验证
  - 确保所有测试通过，如有问题请询问用户

- [x] 10. 密钥管理 UI 组件
  - [x] 10.1 创建加密设置对话框
    - 创建 `app/components/encryption/EncryptionSetupDialog.vue`
    - 首次设置加密密码流程
    - 生成密钥对并用密码加密私钥
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 10.2 创建密码输入对话框
    - 创建 `app/components/encryption/PasswordDialog.vue`
    - 解密时输入密码解锁私钥
    - 密码错误提示
    - _Requirements: 1.7, 1.9_

  - [x] 10.3 创建修改密码对话框
    - 创建 `app/components/encryption/ChangePasswordDialog.vue`
    - 输入旧密码解密私钥
    - 输入新密码重新加密
    - _Requirements: 1.1.1, 1.1.2, 1.1.3_

  - [x] 10.4 创建恢复密钥组件（可选）
    - 创建 `app/components/encryption/RecoveryKeyDialog.vue`
    - 生成和显示恢复密钥
    - 使用恢复密钥重置密码
    - _Requirements: 1.2.1, 1.2.2, 1.2.3, 1.2.4_

- [x] 11. 解密功能集成
  - [x] 11.1 创建文件解密工具方法
    - 在 useAgeCrypto 中完善 decryptToBlob 和 decryptToObjectURL 方法
    - _Requirements: 7.9, 7.10, 7.11_

  - [x] 11.2 编写解密属性测试
    - **Property 8: 解密输出格式正确性**
    - **Property 10: 错误消息用户友好性**
    - **Validates: Requirements 7.8, 7.9, 8.8**

- [x] 12. 最终检查点
  - 确保所有测试通过
  - 验证完整的加密上传和解密下载流程
  - 如有问题请询问用户

## 注意事项

- 每个属性测试应标注对应的设计文档属性编号
- 属性测试最少运行 100 次迭代
- 所有代码注释使用中文
- 所有任务都必须完成，包括测试任务
