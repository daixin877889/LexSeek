# 设计文档

## 概述

本设计文档描述了基于 `age-encryption` 库的客户端文件加密功能的技术实现方案。该功能允许用户在上传文件到 OSS 之前在浏览器端进行加密，确保服务端和存储提供商无法访问原始文件内容。

### 技术选型

- **加密库**: `age-encryption` - 成熟的 TypeScript 加密库，基于 age 文件加密格式
- **加密算法**: X25519 + ChaCha20-Poly1305（age 内部实现）
- **执行环境**: Web Worker（避免阻塞主线程）
- **流式处理**: 使用 Streams API 处理大文件

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        客户端 (Browser)                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ fileUploader│  │useAgeCrypto │  │ useFileEncryption/      │  │
│  │   .vue      │──│ Composable  │──│ useFileDecryption       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│         │                │                      │               │
│         │                │                      │               │
│         ▼                ▼                      ▼               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Encryption Worker                        ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ ││
│  │  │age-encryption│  │ Encrypter   │  │ Decrypter           │ ││
│  │  │   Library   │  │ (加密)      │  │ (解密)              │ ││
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        服务端 (Server)                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ 用户加密配置 API │  │ 文件元数据 API  │  │ OSS 预签名 API  │  │
│  │ /encryption/*   │  │ /files/*        │  │ /presigned-url  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│           │                    │                    │           │
│           ▼                    ▼                    ▼           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      数据库 (Prisma)                        ││
│  │  UserEncryption: encryptedIdentity, recipient, recoveryKey  ││
│  │  OssFile: encrypted, originalName, originalMimeType         ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      阿里云 OSS                                  │
│  存储加密后的文件 (*.age)                                        │
└─────────────────────────────────────────────────────────────────┘
```

## 组件和接口

### 1. 数据库模型

```prisma
// 用户加密配置
model UserEncryption {
  id                  String   @id @default(cuid())
  userId              String   @unique
  recipient           String   // 公钥 (age1...)，明文存储
  encryptedIdentity   String   @db.Text // 加密后的私钥
  encryptedRecoveryKey String? @db.Text // 恢复密钥加密的私钥（可选）
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  
  user User @relation(fields: [userId], references: [id])
}

// OssFile 模型扩展
model OssFile {
  // ... 现有字段
  encrypted         Boolean  @default(false) // 是否加密
  originalName      String?  // 原始文件名（加密文件需要）
  originalMimeType  String?  // 原始 MIME 类型（加密文件需要）
}
```

### 2. 类型定义

```typescript
// shared/types/encryption.ts

/**
 * 密钥对
 */
export interface AgeKeyPair {
  /** 私钥 (AGE-SECRET-KEY-1...) */
  identity: string
  /** 公钥 (age1...) */
  recipient: string
}

/**
 * 用户加密配置
 */
export interface UserEncryptionConfig {
  /** 公钥 */
  recipient: string
  /** 加密后的私钥 */
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
 * 加密错误类型
 */
export class IdentityNotUnlockedError extends Error {
  constructor() {
    super('私钥未解锁，请先输入加密密码')
    this.name = 'IdentityNotUnlockedError'
  }
}

export class IdentityMismatchError extends Error {
  constructor() {
    super('私钥不匹配，无法解密此文件')
    this.name = 'IdentityMismatchError'
  }
}

export class FileCorruptedError extends Error {
  constructor() {
    super('文件已损坏，无法解密')
    this.name = 'FileCorruptedError'
  }
}

export class InvalidAgeFileError extends Error {
  constructor() {
    super('无效的加密文件格式')
    this.name = 'InvalidAgeFileError'
  }
}
```

### 3. Composables

#### useAgeCrypto

```typescript
// app/composables/useAgeCrypto.ts

export const useAgeCrypto = () => {
  // 内存中的私钥（解锁后）
  const identity = ref<string | null>(null)
  const isUnlocked = computed(() => identity.value !== null)
  
  /**
   * 生成新的密钥对
   */
  const generateKeyPair = async (): Promise<AgeKeyPair> => {
    const { generateIdentity, identityToRecipient } = await import('age-encryption')
    const id = await generateIdentity()
    const recipient = await identityToRecipient(id)
    return { identity: id, recipient }
  }
  
  /**
   * 用密码加密私钥
   */
  const encryptIdentity = async (id: string, password: string): Promise<string> => {
    const { Encrypter } = await import('age-encryption')
    const e = new Encrypter()
    e.setPassphrase(password)
    const encrypted = await e.encrypt(id)
    return btoa(String.fromCharCode(...encrypted))
  }
  
  /**
   * 用密码解密私钥
   */
  const decryptIdentity = async (encryptedId: string, password: string): Promise<string> => {
    const { Decrypter } = await import('age-encryption')
    const d = new Decrypter()
    d.addPassphrase(password)
    const bytes = Uint8Array.from(atob(encryptedId), c => c.charCodeAt(0))
    return await d.decrypt(bytes, 'text')
  }
  
  /**
   * 解锁私钥（存入内存）
   */
  const unlockIdentity = async (encryptedId: string, password: string): Promise<void> => {
    identity.value = await decryptIdentity(encryptedId, password)
  }
  
  /**
   * 锁定私钥（清除内存）
   */
  const lockIdentity = () => {
    identity.value = null
  }
  
  /**
   * 加密文件
   */
  const encryptFile = async (
    file: File | Blob,
    recipient: string,
    onProgress?: (progress: number) => void
  ): Promise<Blob> => {
    const { Encrypter } = await import('age-encryption')
    const e = new Encrypter()
    e.addRecipient(recipient)
    
    // 流式加密
    const stream = file.stream()
    const encryptedStream = await e.encrypt(stream)
    
    // 收集加密数据
    const reader = encryptedStream.getReader()
    const chunks: Uint8Array[] = []
    let totalSize = 0
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalSize += value.length
      onProgress?.(Math.min(99, (totalSize / file.size) * 100))
    }
    
    onProgress?.(100)
    return new Blob(chunks, { type: 'application/octet-stream' })
  }
  
  /**
   * 解密文件
   */
  const decryptFile = async (
    encryptedData: Blob | ArrayBuffer,
    onProgress?: (progress: number) => void
  ): Promise<ArrayBuffer> => {
    if (!identity.value) {
      throw new IdentityNotUnlockedError()
    }
    
    const { Decrypter } = await import('age-encryption')
    const d = new Decrypter()
    d.addIdentity(identity.value)
    
    const data = encryptedData instanceof Blob 
      ? new Uint8Array(await encryptedData.arrayBuffer())
      : new Uint8Array(encryptedData)
    
    try {
      const decrypted = await d.decrypt(data)
      onProgress?.(100)
      return decrypted.buffer
    } catch (error) {
      if (error.message?.includes('no identity matched')) {
        throw new IdentityMismatchError()
      }
      if (error.message?.includes('invalid header')) {
        throw new InvalidAgeFileError()
      }
      throw new FileCorruptedError()
    }
  }
  
  // 登出时清除私钥
  onUnmounted(() => {
    lockIdentity()
  })
  
  return {
    identity: readonly(identity),
    isUnlocked,
    generateKeyPair,
    encryptIdentity,
    decryptIdentity,
    unlockIdentity,
    lockIdentity,
    encryptFile,
    decryptFile,
  }
}
```

#### useFileEncryption

```typescript
// app/composables/useFileEncryption.ts

export const useFileEncryption = () => {
  const { encryptFile } = useAgeCrypto()
  
  const status = ref<EncryptionStatus>('idle')
  const progress = ref(0)
  const error = ref<Error | null>(null)
  const encryptedBlob = ref<Blob | null>(null)
  
  const encrypt = async (file: File, recipient: string): Promise<Blob> => {
    status.value = 'encrypting'
    progress.value = 0
    error.value = null
    
    try {
      encryptedBlob.value = await encryptFile(file, recipient, (p) => {
        progress.value = p
      })
      status.value = 'success'
      return encryptedBlob.value
    } catch (e) {
      error.value = e instanceof Error ? e : new Error(String(e))
      status.value = 'error'
      throw e
    }
  }
  
  const reset = () => {
    status.value = 'idle'
    progress.value = 0
    error.value = null
    encryptedBlob.value = null
  }
  
  return {
    status: readonly(status),
    progress: readonly(progress),
    error: readonly(error),
    encryptedBlob: readonly(encryptedBlob),
    encrypt,
    reset,
  }
}
```

#### useFileDecryption

```typescript
// app/composables/useFileDecryption.ts

export const useFileDecryption = () => {
  const { decryptFile, isUnlocked } = useAgeCrypto()
  
  const status = ref<DecryptionStatus>('idle')
  const progress = ref(0)
  const error = ref<Error | null>(null)
  const objectUrl = ref<string | null>(null)
  
  const decrypt = async (
    encryptedData: Blob | ArrayBuffer,
    mimeType: string
  ): Promise<string> => {
    if (!isUnlocked.value) {
      status.value = 'locked'
      throw new IdentityNotUnlockedError()
    }
    
    status.value = 'decrypting'
    progress.value = 0
    error.value = null
    
    try {
      const decrypted = await decryptFile(encryptedData, (p) => {
        progress.value = p
      })
      
      const blob = new Blob([decrypted], { type: mimeType })
      objectUrl.value = URL.createObjectURL(blob)
      status.value = 'success'
      return objectUrl.value
    } catch (e) {
      error.value = e instanceof Error ? e : new Error(String(e))
      status.value = 'error'
      throw e
    }
  }
  
  const revokeUrl = () => {
    if (objectUrl.value) {
      URL.revokeObjectURL(objectUrl.value)
      objectUrl.value = null
    }
  }
  
  const reset = () => {
    revokeUrl()
    status.value = 'idle'
    progress.value = 0
    error.value = null
  }
  
  // 组件卸载时释放 URL
  onUnmounted(() => {
    revokeUrl()
  })
  
  return {
    status: readonly(status),
    progress: readonly(progress),
    error: readonly(error),
    objectUrl: readonly(objectUrl),
    isUnlocked,
    decrypt,
    revokeUrl,
    reset,
  }
}
```

### 4. API 接口

#### 获取/保存用户加密配置

```typescript
// server/api/v1/encryption/config.get.ts
export default defineEventHandler(async (event) => {
  try {
    const user = event.context.auth.user
    
    const config = await prisma.userEncryption.findUnique({
      where: { userId: user.id },
      select: {
        recipient: true,
        encryptedIdentity: true,
        encryptedRecoveryKey: true,
      }
    })
    
    if (!config) {
      return resSuccess(event, '获取加密配置成功', null)
    }
    
    return resSuccess(event, '获取加密配置成功', {
      recipient: config.recipient,
      encryptedIdentity: config.encryptedIdentity,
      hasRecoveryKey: !!config.encryptedRecoveryKey,
    })
  } catch (error) {
    return resError(event, 500, parseErrorMessage(error, '获取加密配置失败'))
  }
})

// server/api/v1/encryption/config.post.ts
export default defineEventHandler(async (event) => {
  try {
    const user = event.context.auth.user
    
    // 使用 zod 进行参数验证
    const body = z.object({
      recipient: z.string({ message: '公钥不能为空' })
        .startsWith('age1', { message: '公钥格式错误，应以 age1 开头' }),
      encryptedIdentity: z.string({ message: '加密后的私钥不能为空' }),
      encryptedRecoveryKey: z.string().optional(),
    }).parse(await readBody(event))
    
    const { recipient, encryptedIdentity, encryptedRecoveryKey } = body
    
    await prisma.userEncryption.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        recipient,
        encryptedIdentity,
        encryptedRecoveryKey,
      },
      update: {
        recipient,
        encryptedIdentity,
        encryptedRecoveryKey,
      }
    })
    
    return resSuccess(event, '保存加密配置成功', { success: true })
  } catch (error) {
    return resError(event, 500, parseErrorMessage(error, '保存加密配置失败'))
  }
})

// server/api/v1/encryption/config.put.ts - 修改加密密码
export default defineEventHandler(async (event) => {
  try {
    const user = event.context.auth.user
    
    // 使用 zod 进行参数验证
    const body = z.object({
      encryptedIdentity: z.string({ message: '加密后的私钥不能为空' }),
      encryptedRecoveryKey: z.string().optional(),
    }).parse(await readBody(event))
    
    const { encryptedIdentity, encryptedRecoveryKey } = body
    
    // 检查用户是否已有加密配置
    const existing = await prisma.userEncryption.findUnique({
      where: { userId: user.id }
    })
    
    if (!existing) {
      return resError(event, 404, '未找到加密配置，请先初始化')
    }
    
    await prisma.userEncryption.update({
      where: { userId: user.id },
      data: {
        encryptedIdentity,
        ...(encryptedRecoveryKey !== undefined && { encryptedRecoveryKey }),
      }
    })
    
    return resSuccess(event, '修改加密密码成功', { success: true })
  } catch (error) {
    return resError(event, 500, parseErrorMessage(error, '修改加密密码失败'))
  }
})
```

#### 预签名 URL API 加密处理

```typescript
// server/api/v1/files/presigned-url/.get.ts 修改
// 新增参数：encrypted

export default defineEventHandler(async (event) => {
  try {
    // 使用 zod 进行参数验证，新增 encrypted 参数
    const query = z.object({
      source: z.enum(FileSource, { message: '场景值错误' }),
      fileSize: z.string().refine((val) => { 
        return Number(val) > 0 && Number.isInteger(Number(val)) 
      }, { message: '文件大小必须为整数且大于0' }),
      mimeType: z.string({ message: '文件类型不能为空' }),
      originalFileName: z.string({ message: '文件名称不能为空' })
        .refine((val) => val.includes('.'), { message: '文件名称必须包含扩展名' }),
      encrypted: z.enum(['true', 'false']).optional().default('false'),  // 新增：是否加密
    }).parse(getQuery(event))

    const { source, fileSize, mimeType, originalFileName, encrypted } = query
    const isEncrypted = encrypted === 'true'
    
    // ... 现有的文件类型和大小验证逻辑 ...
    
    // 如果是加密文件，修改保存名称添加 .age 后缀
    const extension = isEncrypted ? 'age' : (mime.getExtension(mimeType) ?? '')
    const saveName = `${uuidv7()}.${extension}`
    
    // 创建文件记录时添加加密相关字段
    const file = await createOssFileDao({
      userId: user.id,
      bucketName: bucket,
      fileName: originalFileName,
      filePath: `${dir}${saveName}`,
      fileSize: Number(fileSize),
      fileType: mimeType,  // 存储原始 MIME 类型
      source: source as FileSource,
      status: OssFileStatus.PENDING,
      encrypted: isEncrypted,  // 新增：是否加密
      originalMimeType: isEncrypted ? mimeType : null,  // 新增：原始 MIME 类型
    })

    // 生成 OSS 预签名，回调变量中添加加密相关信息
    const signature = await generateOssPostSignature({
      bucket,
      originalFileName: isEncrypted ? `${originalFileName}.age` : originalFileName,
      maxSize,
      dir,
      saveName,
      allowedMimeTypes: isEncrypted ? ['application/octet-stream'] : allowedMimeTypes,
      callbackVar: {
        user_id: user.id,
        source: source,
        original_file_name: originalFileName,
        file_id: file.id.toString(),
        encrypted: isEncrypted ? '1' : '0',  // 新增：加密标识
        original_mime_type: mimeType,  // 新增：原始 MIME 类型
      }
    })

    return resSuccess(event, "获取预签名URL成功", signature)
  } catch (error) {
    return resError(event, 500, parseErrorMessage(error, "获取预签名URL失败"))
  }
})

// server/api/v1/files/presigned-url/.post.ts 修改（批量）
export default defineEventHandler(async (event) => {
  try {
    // 使用 zod 进行参数验证
    const body = z.object({
      source: z.enum(FileSource, { message: '场景值错误' }),
      files: z.array(z.object({
        originalFileName: z.string({ message: '文件名称不能为空' })
          .refine((val) => val.includes('.'), { message: '文件名称必须包含扩展名' }),
        fileSize: z.number({ message: '文件大小必须为数字' })
          .int({ message: '文件大小必须为整数' })
          .positive({ message: '文件大小必须大于0' }),
        mimeType: z.string({ message: '文件类型不能为空' }),
      })).min(1, { message: '文件列表不能为空' }),
      encrypted: z.boolean().optional().default(false),  // 新增：是否加密
    }).parse(await readBody(event))
    
    const { source, files, encrypted } = body
    
    // 批量处理每个文件
    const signatures = await Promise.all(
      files.map(async (file) => {
        // 如果是加密文件，修改保存名称添加 .age 后缀
        const extension = encrypted ? 'age' : (mime.getExtension(file.mimeType) ?? '')
        const saveName = `${uuidv7()}.${extension}`
        
        // 创建文件记录
        const fileRecord = await createOssFileDao({
          userId: user.id,
          bucketName: bucket,
          fileName: file.originalFileName,
          filePath: `${dir}${saveName}`,
          fileSize: file.fileSize,
          fileType: file.mimeType,
          source: source as FileSource,
          status: OssFileStatus.PENDING,
          encrypted,
          originalMimeType: encrypted ? file.mimeType : null,
        })

        return generateOssPostSignature({
          bucket,
          originalFileName: encrypted ? `${file.originalFileName}.age` : file.originalFileName,
          maxSize,
          dir,
          saveName,
          allowedMimeTypes: encrypted ? ['application/octet-stream'] : allowedMimeTypes,
          callbackVar: {
            user_id: user.id,
            source: source,
            original_file_name: file.originalFileName,
            file_id: fileRecord.id.toString(),
            encrypted: encrypted ? '1' : '0',
            original_mime_type: file.mimeType,
          }
        })
      })
    )
    
    return resSuccess(event, "批量获取预签名URL成功", signatures)
  } catch (error) {
    return resError(event, 500, parseErrorMessage(error, "批量获取预签名URL失败"))
  }
})
```

#### OSS 回调处理

```typescript
// server/api/v1/files/oss-callback.post.ts 修改
// OSS 回调不使用 zod 验证，因为回调参数由 OSS 服务端发送
export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const logger = createLogger('oss-callback')
    
    // 解析回调变量（OSS 回调变量格式为 x:变量名）
    const fileId = body['x:file_id']
    const encrypted = body['x:encrypted'] === '1'
    const originalMimeType = body['x:original_mime_type']
    
    if (!fileId) {
      logger.error('OSS 回调缺少 file_id', body)
      return resError(event, 400, '缺少文件ID')
    }
    
    // 更新文件记录状态
    await prisma.ossFiles.update({
      where: { id: Number(fileId) },
      data: {
        status: OssFileStatus.SUCCESS,
        encrypted,
        originalMimeType: encrypted ? originalMimeType : null,
      }
    })
    
    logger.info('OSS 回调处理成功', { fileId, encrypted })
    
    // OSS 回调需要返回 JSON 格式
    return { success: true, fileId }
  } catch (error) {
    const logger = createLogger('oss-callback')
    logger.error('OSS 回调处理失败:', error)
    return resError(event, 500, parseErrorMessage(error, 'OSS 回调处理失败'))
  }
})
```

#### 恢复密钥相关 API

```typescript
// server/api/v1/encryption/recovery.post.ts - 使用恢复密钥重置密码
export default defineEventHandler(async (event) => {
  try {
    const user = event.context.auth.user
    
    // 使用 zod 进行参数验证
    const body = z.object({
      newEncryptedIdentity: z.string({ message: '新的加密私钥不能为空' }),
      newEncryptedRecoveryKey: z.string().optional(),
    }).parse(await readBody(event))
    
    const { newEncryptedIdentity, newEncryptedRecoveryKey } = body
    
    // 检查用户是否已有加密配置
    const existing = await prisma.userEncryption.findUnique({
      where: { userId: user.id }
    })
    
    if (!existing) {
      return resError(event, 404, '未找到加密配置')
    }
    
    if (!existing.encryptedRecoveryKey) {
      return resError(event, 400, '未设置恢复密钥')
    }
    
    // 更新加密配置（客户端已验证恢复密钥并重新加密私钥）
    await prisma.userEncryption.update({
      where: { userId: user.id },
      data: {
        encryptedIdentity: newEncryptedIdentity,
        encryptedRecoveryKey: newEncryptedRecoveryKey ?? null,  // 恢复密钥使用后需要重新生成
      }
    })
    
    return resSuccess(event, '密码重置成功', { success: true })
  } catch (error) {
    return resError(event, 500, parseErrorMessage(error, '密码重置失败'))
  }
})
```
```

## 数据模型

### 加密文件元数据

```typescript
interface EncryptedFileMetadata {
  // 存储在数据库
  encrypted: boolean        // 是否加密
  originalName: string      // 原始文件名 (不含 .age)
  originalMimeType: string  // 原始 MIME 类型
  
  // OSS 文件
  ossKey: string           // 文件路径 (xxx.age)
}
```

### 加密文件格式

使用标准 age 格式，无需自定义：

```
age-encryption.org/v1
-> X25519 <recipient-public-key>
<encrypted-file-key>
---
<encrypted-content>
```

## 正确性属性

*正确性属性是系统应该满足的通用规则，用于验证实现的正确性。每个属性都应该对所有有效输入成立。*

### Property 1: 密钥对生成格式正确性

*对于任意* 生成的密钥对，identity 应以 "AGE-SECRET-KEY-1" 开头，recipient 应以 "age1" 开头

**Validates: Requirements 1.2**

### Property 2: 私钥加密解密往返一致性

*对于任意* 有效的私钥和密码，使用密码加密私钥后再用相同密码解密，应得到原始私钥

**Validates: Requirements 1.3, 1.8**

### Property 3: 密码修改后私钥保持不变

*对于任意* 私钥和两个不同的密码，用旧密码加密私钥后用旧密码解密，再用新密码加密后用新密码解密，两次解密结果应相同

**Validates: Requirements 1.1.1, 1.1.2, 1.2.8**

### Property 4: 恢复密钥解密一致性

*对于任意* 私钥和恢复密钥，使用恢复密钥加密私钥后再用恢复密钥解密，应得到原始私钥

**Validates: Requirements 1.2.2, 1.2.5**

### Property 5: 文件加密解密往返一致性

*对于任意* 有效的文件内容和密钥对，使用公钥加密文件后再用私钥解密，应得到原始文件内容

**Validates: Requirements 3.7, 8.3**

### Property 6: 加密无需密码

*对于任意* 文件和公钥，加密过程应只需要公钥，不需要私钥或密码

**Validates: Requirements 2.6**

### Property 7: 文件元数据保留

*对于任意* 加密上传的文件，数据库中存储的 originalName 应为原始文件名（不含 .age），originalMimeType 应为原始 MIME 类型

**Validates: Requirements 4.6, 4.7**

### Property 8: 解密输出格式正确性

*对于任意* 加密文件和正确的 MIME 类型，decryptToBlob 返回的 Blob 的 type 应等于传入的 MIME 类型

**Validates: Requirements 7.8, 7.9**

### Property 9: 进度值范围

*对于任意* 加密或解密操作的进度回调，报告的进度值应在 0-100 范围内

**Validates: Requirements 8.2**

### Property 10: 错误消息用户友好性

*对于任意* 加密错误类型，错误消息应为非空的中文字符串

**Validates: Requirements 8.8**

## 错误处理

| 错误类型 | 触发条件 | 用户提示 |
|---------|---------|---------|
| `IdentityNotUnlockedError` | 解密时私钥未解锁 | "私钥未解锁，请先输入加密密码" |
| `IdentityMismatchError` | 私钥与加密文件不匹配 | "私钥不匹配，无法解密此文件" |
| `FileCorruptedError` | 加密文件损坏 | "文件已损坏，无法解密" |
| `InvalidAgeFileError` | 文件不是有效的 age 格式 | "无效的加密文件格式" |
| 密码错误 | age 解密私钥失败 | "加密密码错误，请重试" |

## 测试策略

### 单元测试

- 密钥对生成格式验证
- 私钥加密/解密往返测试
- 文件加密/解密往返测试
- 错误类型和消息验证
- 进度回调值范围验证

### 属性测试

使用 `fast-check` 进行属性测试：

- 对于随机生成的文件内容，加密后解密应得到原始内容
- 对于随机生成的密码，私钥加密后解密应得到原始私钥
- 对于随机生成的文件名和 MIME 类型，元数据应正确保留

### 集成测试

- 完整的加密上传流程
- 完整的解密下载流程
- 密码修改流程
- 恢复密钥流程

### 测试配置

- 属性测试最少运行 100 次迭代
- 每个属性测试应标注对应的设计文档属性编号
