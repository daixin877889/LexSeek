# 图片识别数据流测试

## 测试目的

验证加密 PNG 图片从前端到服务端的完整数据流，找出导致 sharp 报错的确切原因。

## 数据流步骤

### 前端（useImageRecognition.ts）

1. **下载加密文件**
   ```typescript
   const response = await fetch(downloadUrl)  // 下载 .age 文件
   let content = await response.arrayBuffer()  // 得到加密的 ArrayBuffer
   ```

2. **解密文件**
   ```typescript
   content = await ageCrypto.decryptFile(content)  // 返回解密后的 ArrayBuffer
   ```

3. **创建 File 对象**
   ```typescript
   const blob = new Blob([content], { type: mimeType || getImageMimeType(fileName) })
   const file = new File([blob], fileName, { type: blob.type })
   ```
   
   **问题点 1**：`mimeType` 参数未传递，`getImageMimeType(fileName)` 对于 `xxx.png.age` 会返回什么？
   
   ```typescript
   const ext = fileName.split('.').pop()?.toLowerCase()  // 得到 'age'
   return mimeMap[ext || ''] || 'image/jpeg'  // 返回 'image/jpeg'
   ```
   
   **结果**：PNG 图片被标记为 `image/jpeg`

4. **转换为 base64**
   ```typescript
   const reader = new FileReader()
   reader.readAsDataURL(file)  // 读取 File 对象
   const result = reader.result as string  // 得到 data:image/jpeg;base64,xxx
   const base64 = result.split(',')[1]  // 移除前缀
   ```
   
   **问题点 2**：FileReader 使用 `file.type`（即 `image/jpeg`）来生成 data URL

### 服务端（ocr.service.ts）

5. **接收 base64 数据**
   ```typescript
   const buffer = Buffer.from(base64Data, 'base64')
   ```

6. **压缩图片**
   ```typescript
   const result = await compressImageFromBase64(base64Data, mimeType, options)
   ```
   
   **问题点 3**：`mimeType` 参数是什么？来自前端的 `mimeType` 字段

7. **sharp 处理**
   ```typescript
   const buffer = Buffer.from(cleanBase64, 'base64')
   let image = sharp(buffer)
   let metadata = await image.metadata()  // ❌ 这里报错
   ```

## 验证假设

### 假设 1：mimeType 参数缺失导致问题

**验证方法**：
1. 在前端添加日志，打印 `file.type` 和 `mimeType` 参数
2. 在服务端添加日志，打印接收到的 `mimeType` 和 buffer 的前几个字节

### 假设 2：FileReader 的 MIME 类型影响

**验证方法**：
1. 测试：创建一个 PNG 文件，但 type 设置为 `image/jpeg`
2. 使用 FileReader 读取并转换为 base64
3. 在服务端解码并用 sharp 处理
4. 观察是否报同样的错误

### 假设 3：解密后的数据有问题

**验证方法**：
1. 在前端解密后，直接下载 ArrayBuffer 为文件
2. 手动验证文件是否能正常打开
3. 对比文件大小和原始文件

## 测试代码

### 前端测试

```typescript
// 在 useImageRecognition.ts 的 getFileContent 函数中添加日志
console.log('[DEBUG] 解密前 content.byteLength:', content.byteLength)
content = await ageCrypto.decryptFile(content)
console.log('[DEBUG] 解密后 content.byteLength:', content.byteLength)
console.log('[DEBUG] 解密后前16字节:', new Uint8Array(content.slice(0, 16)))

const blob = new Blob([content], { type: mimeType || getImageMimeType(fileName) })
console.log('[DEBUG] blob.type:', blob.type)
console.log('[DEBUG] blob.size:', blob.size)

const file = new File([blob], fileName, { type: blob.type })
console.log('[DEBUG] file.type:', file.type)
console.log('[DEBUG] file.size:', file.size)
```

### 服务端测试

```typescript
// 在 imageCompression.ts 的 compressImageFromBase64 函数中添加日志
const buffer = Buffer.from(cleanBase64, 'base64')
console.log('[DEBUG] buffer.length:', buffer.length)
console.log('[DEBUG] buffer 前16字节:', buffer.slice(0, 16).toString('hex'))
console.log('[DEBUG] mimeType:', mimeType)

// PNG 文件的魔数是：89 50 4E 47 0D 0A 1A 0A
// JPEG 文件的魔数是：FF D8 FF
```

## 预期结果

如果是 PNG 文件，buffer 的前8个字节应该是：
```
89 50 4E 47 0D 0A 1A 0A
```

如果 sharp 报错，可能的原因：
1. buffer 数据不完整（长度不对）
2. buffer 数据损坏（魔数不对）
3. buffer 是空的或全是0

## 下一步

根据测试结果，确定问题的确切原因，然后修复。
