# 设计文档

## 概述

本设计文档描述了 `fileUploader.vue` 组件的改造方案，主要包括：
1. 创建 `app/store/file.ts` 集中管理文件相关的 API 调用和状态
2. 改造组件使用 store 进行 API 调用
3. 适配 OSS V4 签名方式
4. 使用 `shared/utils/mime.ts` 进行 MIME 类型判断
5. 添加完整的 TypeScript 类型定义
6. **支持单选和多选上传模式**
7. **实现批量预签名 POST 接口**

## 架构

```mermaid
graph TD
    A[fileUploader.vue] --> B[useFileStore]
    B --> C[useApi]
    C --> D[/api/v1/files/presigned-url/config]
    C --> E[GET /api/v1/files/presigned-url - 单文件签名]
    C --> F[POST /api/v1/files/presigned-url - 批量签名]
    A --> G[mime.getType]
    A --> H[OSS Direct Upload]
    H --> I[Aliyun OSS]
```

### 数据流

**单选模式：**
1. 组件加载时，通过 store 获取场景配置
2. 用户选择文件后，使用 mime 工具检测 MIME 类型
3. 用户点击上传，通过 store 获取预签名信息（GET 接口）
4. 使用 V4 签名方式直传文件到 OSS

**多选模式：**
1. 组件加载时，通过 store 获取场景配置
2. 用户选择多个文件后，使用 mime 工具检测每个文件的 MIME 类型
3. 用户点击上传，通过 store 批量获取预签名信息（POST 接口）
4. 依次使用 V4 签名方式直传每个文件到 OSS
5. 显示每个文件的上传进度和状态

## 组件和接口

### File Store (`app/store/file.ts`)

```typescript
interface FileStoreState {
  loading: boolean
  error: string | null
}

interface FileStore {
  // 状态
  loading: Ref<boolean>
  error: Ref<string | null>
  
  // 方法
  getUploadConfig(source?: FileSource): Promise<FileSourceAccept[] | null>
  getPresignedUrl(params: PresignedUrlParams): Promise<PostSignatureResult | null>
  getBatchPresignedUrls(params: BatchPresignedUrlParams): Promise<PostSignatureResult[] | null>
}

interface PresignedUrlParams {
  source: FileSource
  originalFileName: string
  fileSize: number
  mimeType: string
}

// 批量签名请求参数
interface BatchPresignedUrlParams {
  source: FileSource
  files: FileInfo[]
}

interface FileInfo {
  originalFileName: string
  fileSize: number
  mimeType: string
}
```

### File Uploader Props

```typescript
interface FileUploaderProps {
  // 上传场景
  source?: FileSource
  // 是否多选模式
  multiple?: boolean
  // 上传成功回调（单选模式）
  onSuccess?: (signature: PostSignatureResult) => void
  // 批量上传成功回调（多选模式）
  onBatchSuccess?: (signatures: PostSignatureResult[]) => void
  // 上传失败回调
  onError?: (error: Error) => void
}
```

### File Uploader Emits

```typescript
interface FileUploaderEmits {
  (e: 'upload-success', signature: PostSignatureResult): void
  (e: 'upload-error', error: Error): void
  (e: 'batch-upload-success', signatures: PostSignatureResult[]): void
  (e: 'file-upload-progress', file: File, progress: number): void
}
```

## 数据模型

### 批量签名请求体

```typescript
// POST /api/v1/files/presigned-url 请求体
interface BatchPresignedUrlRequest {
  source: FileSource
  files: {
    originalFileName: string
    fileSize: number
    mimeType: string
  }[]
}
```

### 批量签名响应

```typescript
// POST /api/v1/files/presigned-url 响应
interface BatchPresignedUrlResponse {
  signatures: PostSignatureResult[]
}
```

### 场景配置响应

```typescript
// 来自 shared/types/file.ts
interface FileSourceAccept {
  name: string
  accept: {
    name: string
    mime: string
    maxSize: number
  }[]
}
```

### 预签名响应

```typescript
// 来自 shared/types/oss.ts
interface PostSignatureResult {
  host: string
  policy: string
  signatureVersion: string  // 'OSS4-HMAC-SHA256'
  credential: string
  date: string
  signature: string
  dir: string
  key?: string
  callback?: string
  callbackVar?: Record<string, string>
  securityToken?: string
}
```

### OSS V4 FormData 结构

```typescript
interface OssV4FormData {
  key: string                    // 文件路径
  policy: string                 // Base64 编码的策略
  'x-oss-signature-version': string  // 'OSS4-HMAC-SHA256'
  'x-oss-credential': string     // 凭证信息
  'x-oss-date': string           // 签名日期
  'x-oss-signature': string      // 签名
  'x-oss-security-token'?: string // STS 安全令牌（可选）
  callback?: string              // 回调配置（可选）
  file: File                     // 文件
}
```

## 正确性属性

*正确性属性是在系统所有有效执行中都应该成立的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### Property 1: Store API 方法正确调用对应端点

*对于任意* 有效的 source 参数，调用 `getUploadConfig(source)` 应该请求 `/api/v1/files/presigned-url/config` 端点；*对于任意* 有效的 PresignedUrlParams，调用 `getPresignedUrl(params)` 应该请求 `/api/v1/files/presigned-url` 端点并传递正确的查询参数。

**验证: 需求 1.2, 1.3**

### Property 2: Store 状态管理正确性

*对于任意* API 调用，在调用开始时 `loading` 应该为 `true`，调用结束后 `loading` 应该为 `false`；*对于任意* 失败的 API 调用，`error` 应该包含错误信息。

**验证: 需求 1.5**

### Property 3: OSS V4 FormData 构建正确性

*对于任意* 有效的 PostSignatureResult，构建的 FormData 应该包含所有必需的 V4 签名字段（`x-oss-signature-version`、`x-oss-credential`、`x-oss-date`、`x-oss-signature`）；如果 `securityToken` 存在，FormData 应该包含 `x-oss-security-token`；如果 `callback` 存在，FormData 应该包含 `callback`；`key` 字段应该使用后端返回的值。

**验证: 需求 3.1, 3.2, 3.3, 3.4**

### Property 4: MIME 类型推断正确性

*对于任意* 文件，如果浏览器返回的 `file.type` 为空或无效，应该使用 `mime.getType(extension)` 根据文件扩展名推断 MIME 类型。

**验证: 需求 4.2**

### Property 5: 文件验证正确性

*对于任意* 文件和场景配置，如果文件的 MIME 类型不在允许列表中，验证应该失败；如果文件大小超过该 MIME 类型的最大限制，验证应该失败；验证失败时应该返回具体的错误信息。

**验证: 需求 7.1, 7.2, 7.3, 7.4**

### Property 6: Multiple Prop 控制文件选择行为

*对于任意* `multiple` prop 值，当 `multiple` 为 `false` 时，组件应该只允许选择一个文件；当 `multiple` 为 `true` 时，组件应该允许选择多个文件，且文件输入框的 `multiple` 属性应该与 prop 值一致。

**验证: 需求 10.1, 10.2, 10.3**

### Property 7: 批量签名接口验证正确性

*对于任意* 批量签名请求，服务端应该验证每个文件的类型和大小；如果任何文件验证失败，应该返回包含具体文件名的错误信息；如果所有文件验证通过，返回的签名数组长度应该等于输入文件数组长度。

**验证: 需求 11.2, 11.3, 11.4, 11.5**

### Property 8: Store 批量签名方法正确性

*对于任意* 有效的 BatchPresignedUrlParams，调用 `getBatchPresignedUrls(params)` 应该请求 POST `/api/v1/files/presigned-url` 端点；返回的签名数组长度应该等于输入文件数组长度；在请求过程中 `loading` 应该为 `true`，请求结束后应该为 `false`。

**验证: 需求 12.1, 12.3, 12.4**

## 错误处理

### API 错误

- 网络错误：显示 "网络请求失败，请稍后重试"
- 业务错误：显示后端返回的错误信息
- 401 未授权：由 `useApi` 统一处理，跳转登录页

### 文件验证错误

- 文件类型不支持：显示 "不支持的文件格式：{extension}"
- 文件大小超限：显示 "文件大小超出限制: {size}，{mime}最大允许: {maxSize}"
- 未选择场景：显示 "请选择上传场景"

### 批量签名错误

- 单个文件验证失败：显示 "文件 {fileName} 验证失败: {reason}"
- 批量请求失败：显示 "批量获取签名失败: {error}"

### OSS 上传错误

- 上传失败：显示 "上传失败: {status} {statusText}"
- 网络错误：显示 "上传过程中发生错误"
- 多选模式部分失败：显示 "部分文件上传失败"，并列出失败的文件

## 测试策略

### 单元测试

- 测试 `useFileStore` 的 API 调用方法
- 测试文件验证逻辑
- 测试 MIME 类型推断逻辑
- 测试 FormData 构建逻辑

### 属性测试

- 使用 Vitest 的 property-based testing 功能
- 每个属性测试至少运行 100 次迭代
- 测试标签格式：**Feature: file-uploader-refactor, Property {number}: {property_text}**

### 组件测试

- 测试组件加载时是否调用 store 获取配置
- 测试文件选择后的验证行为
- 测试上传按钮的禁用状态
- 测试事件触发
