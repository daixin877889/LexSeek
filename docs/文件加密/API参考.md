# API 参考

本文档详细介绍 `useAgeCrypto` composable 的完整 API。

## useAgeCrypto

加密功能的核心 composable，提供密钥管理和文件加密/解密功能。

### 导入

```typescript
const {
    identity,
    isUnlocked,
    isRestored,
    generateKeyPair,
    encryptIdentity,
    decryptIdentity,
    unlockIdentity,
    lockIdentity,
    encryptFile,
    decryptFile,
    decryptToBlob,
    decryptToObjectURL,
    isEncryptedUrl,
    fetchAndDecryptToObjectURL,
    restoreIdentity,
} = useAgeCrypto()
```

---

## 状态属性

### identity

```typescript
identity: Readonly<Ref<string | null>>
```

当前解锁的私钥（只读）。

**返回值**：
- `string` - 私钥字符串（以 `AGE-SECRET-KEY-1` 开头）
- `null` - 私钥未解锁

**示例**：
```typescript
const { identity } = useAgeCrypto()
console.log(identity.value) // 'AGE-SECRET-KEY-1...' 或 null
```

---

### isUnlocked

```typescript
isUnlocked: ComputedRef<boolean>
```

私钥是否已解锁。

**示例**：
```typescript
const { isUnlocked } = useAgeCrypto()

if (isUnlocked.value) {
    // 可以解密文件
} else {
    // 需要先解锁私钥
}
```

---

### isRestored

```typescript
isRestored: Readonly<Ref<boolean>>
```

是否已从 IndexedDB 恢复私钥状态。

**用途**：判断是否已尝试从本地存储恢复私钥，避免重复恢复。

---

## 密钥管理方法

### generateKeyPair

```typescript
generateKeyPair(): Promise<AgeKeyPair>
```

生成新的 age 密钥对。

**返回值**：
```typescript
interface AgeKeyPair {
    identity: string   // 私钥 (AGE-SECRET-KEY-1...)
    recipient: string  // 公钥 (age1...)
}
```

**示例**：
```typescript
const { generateKeyPair } = useAgeCrypto()

const { identity, recipient } = await generateKeyPair()
console.log('公钥:', recipient)  // age1...
console.log('私钥:', identity)   // AGE-SECRET-KEY-1...
```

---

### encryptIdentity

```typescript
encryptIdentity(identity: string, password: string): Promise<string>
```

使用密码加密私钥。

**参数**：
- `identity` - 私钥字符串
- `password` - 用户密码

**返回值**：Base64 编码的加密后私钥

**示例**：
```typescript
const { encryptIdentity } = useAgeCrypto()

const encryptedKey = await encryptIdentity(identity, 'user-password')
// 存储到服务器
await saveToServer(encryptedKey)
```

---

### decryptIdentity

```typescript
decryptIdentity(encryptedId: string, password: string): Promise<string>
```

使用密码解密私钥。

**参数**：
- `encryptedId` - Base64 编码的加密后私钥
- `password` - 用户密码

**返回值**：解密后的私钥字符串

**异常**：
- `WrongPasswordError` - 密码错误

**示例**：
```typescript
const { decryptIdentity } = useAgeCrypto()

try {
    const identity = await decryptIdentity(encryptedKey, 'user-password')
    console.log('解密成功:', identity)
} catch (err) {
    if (err.name === 'WrongPasswordError') {
        console.error('密码错误')
    }
}
```

---

### unlockIdentity

```typescript
unlockIdentity(encryptedId: string, password: string): Promise<void>
```

解锁私钥（解密并存入内存和 IndexedDB）。

私钥会以 `identity-user-{userId}` 的格式存储在 IndexedDB 中，确保多用户环境下互不干扰。

**参数**：
- `encryptedId` - Base64 编码的加密后私钥
- `password` - 用户密码

**异常**：
- `WrongPasswordError` - 密码错误
- `Error` - 用户未登录

**示例**：
```typescript
const { unlockIdentity, isUnlocked } = useAgeCrypto()

await unlockIdentity(encryptedKey, 'user-password')
console.log('解锁状态:', isUnlocked.value) // true
```

---

### lockIdentity

```typescript
lockIdentity(): Promise<void>
```

锁定私钥（清除内存和 IndexedDB 中的私钥）。

会自动清除当前用户的私钥存储（`identity-user-{userId}`）。

**示例**：
```typescript
const { lockIdentity, isUnlocked } = useAgeCrypto()

await lockIdentity()
console.log('解锁状态:', isUnlocked.value) // false
```

---

### restoreIdentity

```typescript
restoreIdentity(): Promise<boolean>
```

从 IndexedDB 恢复私钥状态。应在应用启动时调用。

**返回值**：是否成功恢复（`true` 表示找到并恢复了私钥）

**示例**：
```typescript
const { restoreIdentity, isUnlocked } = useAgeCrypto()

onMounted(async () => {
    const restored = await restoreIdentity()
    if (restored) {
        console.log('私钥已从本地恢复')
    }
})
```

---

## 文件加密方法

### encryptFile

```typescript
encryptFile(
    file: File | Blob,
    recipient: string,
    onProgress?: (progress: number) => void
): Promise<Blob>
```

加密文件（在 Web Worker 中执行）。

**参数**：
- `file` - 要加密的文件或 Blob
- `recipient` - 公钥
- `onProgress` - 进度回调（0-100）

**返回值**：加密后的 Blob

**示例**：
```typescript
const { encryptFile } = useAgeCrypto()

const encryptedBlob = await encryptFile(
    file,
    'age1...',
    (progress) => console.log(`加密进度: ${progress}%`)
)

// 上传加密后的文件
await uploadToOSS(encryptedBlob)
```

---

### decryptFile

```typescript
decryptFile(
    encryptedData: Blob | ArrayBuffer,
    onProgress?: (progress: number) => void
): Promise<ArrayBuffer>
```

解密文件（在 Web Worker 中执行）。

**参数**：
- `encryptedData` - 加密的数据
- `onProgress` - 进度回调（0-100）

**返回值**：解密后的 ArrayBuffer

**异常**：
- `IdentityNotUnlockedError` - 私钥未解锁
- `IdentityMismatchError` - 私钥不匹配
- `InvalidAgeFileError` - 文件格式无效
- `FileCorruptedError` - 文件损坏

**示例**：
```typescript
const { decryptFile, isUnlocked } = useAgeCrypto()

if (!isUnlocked.value) {
    throw new Error('请先解锁私钥')
}

const decryptedBuffer = await decryptFile(
    encryptedBlob,
    (progress) => console.log(`解密进度: ${progress}%`)
)
```

---

### decryptToBlob

```typescript
decryptToBlob(
    encryptedData: Blob | ArrayBuffer,
    mimeType: string,
    onProgress?: (progress: number) => void
): Promise<Blob>
```

解密文件并返回带有正确 MIME 类型的 Blob。

**参数**：
- `encryptedData` - 加密的数据
- `mimeType` - 原始文件的 MIME 类型
- `onProgress` - 进度回调

**返回值**：带有正确 MIME 类型的 Blob

**示例**：
```typescript
const { decryptToBlob } = useAgeCrypto()

const blob = await decryptToBlob(encryptedData, 'image/jpeg')
// blob.type === 'image/jpeg'
```

---

### decryptToObjectURL

```typescript
decryptToObjectURL(
    encryptedData: Blob | ArrayBuffer,
    mimeType: string,
    onProgress?: (progress: number) => void
): Promise<string>
```

解密文件并返回 Object URL。

**参数**：
- `encryptedData` - 加密的数据
- `mimeType` - 原始文件的 MIME 类型
- `onProgress` - 进度回调

**返回值**：可直接用于展示的 Object URL（`blob:...`）

**注意**：使用完毕后需调用 `URL.revokeObjectURL()` 释放内存。

**示例**：
```typescript
const { decryptToObjectURL } = useAgeCrypto()

const objectUrl = await decryptToObjectURL(encryptedData, 'image/jpeg')

// 用于图片展示
imageElement.src = objectUrl

// 使用完毕后释放
URL.revokeObjectURL(objectUrl)
```

---

### isEncryptedUrl

```typescript
isEncryptedUrl(url: string): boolean
```

判断 URL 是否为加密文件（路径以 `.age` 结尾）。

**参数**：
- `url` - 文件 URL

**返回值**：是否为加密文件

**示例**：
```typescript
const { isEncryptedUrl } = useAgeCrypto()

isEncryptedUrl('https://oss.example.com/files/photo.jpg')      // false
isEncryptedUrl('https://oss.example.com/files/photo.jpg.age')  // true
```

---

### fetchAndDecryptToObjectURL

```typescript
fetchAndDecryptToObjectURL(
    url: string,
    mimeType: string,
    onProgress?: (info: { 
        stage: 'check' | 'download' | 'decrypt', 
        progress?: number 
    }) => void
): Promise<string>
```

从 URL 获取文件并根据需要解密，返回 Object URL。

自动判断是否需要解密（根据 URL 路径是否以 `.age` 结尾）。

**参数**：
- `url` - 文件下载 URL
- `mimeType` - 原始文件的 MIME 类型
- `onProgress` - 进度回调
  - `stage: 'check'` - 检查加密状态
  - `stage: 'download'` - 下载文件
  - `stage: 'decrypt'` - 解密文件

**返回值**：
- 加密文件：解密后的 Object URL
- 非加密文件：原始 URL

**异常**：
- `IdentityNotUnlockedError` - 需要解密但私钥未解锁

**示例**：
```typescript
const { fetchAndDecryptToObjectURL } = useAgeCrypto()

try {
    const objectUrl = await fetchAndDecryptToObjectURL(
        fileUrl,
        'image/jpeg',
        ({ stage, progress }) => {
            switch (stage) {
                case 'check':
                    console.log('检查加密状态...')
                    break
                case 'download':
                    console.log(`下载进度: ${progress}%`)
                    break
                case 'decrypt':
                    console.log(`解密进度: ${progress}%`)
                    break
            }
        }
    )
    
    imageElement.src = objectUrl
} catch (err) {
    if (err.name === 'IdentityNotUnlockedError') {
        // 提示用户解锁私钥
    }
}
```

---

## 错误类型

### IdentityNotUnlockedError

私钥未解锁时抛出。

```typescript
import { IdentityNotUnlockedError } from '~~/shared/types/encryption'

try {
    await decryptFile(data)
} catch (err) {
    if (err instanceof IdentityNotUnlockedError) {
        // 提示用户输入密码解锁
    }
}
```

### IdentityMismatchError

私钥不匹配时抛出（文件不是用当前用户的公钥加密的）。

### InvalidAgeFileError

文件格式无效时抛出（不是有效的 age 加密文件）。

### FileCorruptedError

文件损坏时抛出。

### WrongPasswordError

密码错误时抛出。

---

## 类型定义

```typescript
// shared/types/encryption.ts

interface AgeKeyPair {
    identity: string   // 私钥
    recipient: string  // 公钥
}

interface UserEncryptionConfig {
    recipient: string           // 公钥
    encryptedIdentity: string   // 加密后的私钥
    hasRecoveryKey: boolean     // 是否有恢复密钥
}

type EncryptionStatus = 
    | 'idle'        // 空闲
    | 'encrypting'  // 加密中
    | 'uploading'   // 上传中
    | 'success'     // 成功
    | 'error'       // 错误

type DecryptionStatus = 
    | 'idle'        // 空闲
    | 'locked'      // 私钥未解锁
    | 'unlocking'   // 正在解锁
    | 'decrypting'  // 解密中
    | 'success'     // 成功
    | 'error'       // 错误
```
