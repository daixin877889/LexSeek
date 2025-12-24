# 需求文档

## 简介

对 `app/components/general/fileUploader.vue` 组件进行改造，使其适配当前项目架构。主要改造点包括：
1. 创建 `app/store/file.ts` 存放文件相关的 API 调用和状态管理
2. 使用 `shared/utils/mime.ts` 进行 MIME 类型判断
3. 适配 OSS V4 签名方式
4. 添加完整的 TypeScript 类型定义

## 术语表

- **File_Uploader**: 文件上传组件，负责处理文件选择、验证和上传到阿里云 OSS
- **File_Store**: 文件状态管理 store（`app/store/file.ts`），负责文件相关的 API 调用和状态管理
- **OSS**: 阿里云对象存储服务（Object Storage Service）
- **V4_Signature**: 阿里云 OSS 的 V4 版本签名方式，使用 `x-oss-signature-version`、`x-oss-credential`、`x-oss-date`、`x-oss-signature` 等字段
- **Post_Signature**: 客户端直传签名，允许前端直接上传文件到 OSS
- **useApi**: 项目封装的 API 请求 composable，基于 Nuxt 的 useFetch
- **mime**: 项目的 MIME 类型工具（`shared/utils/mime.ts`），用于根据文件扩展名获取 MIME 类型

## 需求

### 需求 1：创建文件状态管理 Store

**用户故事：** 作为开发者，我希望文件相关的 API 调用和状态集中管理在 store 中，以便保持代码一致性和可复用性。

#### 验收标准

1. THE File_Store SHALL 位于 `app/store/file.ts` 文件中
2. THE File_Store SHALL 提供 `getUploadConfig` 方法调用 `/api/v1/files/presigned-url/config` 获取场景配置
3. THE File_Store SHALL 提供 `getPresignedUrl` 方法调用 `/api/v1/files/presigned-url` 获取预签名信息
4. THE File_Store SHALL 使用 `useApi` composable 进行 API 调用
5. THE File_Store SHALL 管理 `loading` 和 `error` 状态

### 需求 2：组件调用 Store

**用户故事：** 作为开发者，我希望组件通过 store 进行 API 调用，以便保持代码分层清晰。

#### 验收标准

1. WHEN 组件加载时，THE File_Uploader SHALL 调用 File_Store 的 `getUploadConfig` 方法获取场景配置
2. WHEN 用户点击上传按钮时，THE File_Uploader SHALL 调用 File_Store 的 `getPresignedUrl` 方法获取预签名信息
3. THE File_Uploader SHALL 正确处理 store 返回的错误信息并显示给用户

### 需求 3：OSS V4 签名适配

**用户故事：** 作为开发者，我希望组件使用 OSS V4 签名方式上传文件，以便与后端签名服务保持一致。

#### 验收标准

1. WHEN 上传文件到 OSS 时，THE File_Uploader SHALL 使用 V4 签名字段（`x-oss-signature-version`、`x-oss-credential`、`x-oss-date`、`x-oss-signature`）
2. IF 签名信息包含 `securityToken`，THEN THE File_Uploader SHALL 添加 `x-oss-security-token` 字段
3. IF 签名信息包含 `callback`，THEN THE File_Uploader SHALL 添加 `callback` 字段
4. THE File_Uploader SHALL 使用后端返回的 `key` 字段作为文件路径

### 需求 4：MIME 类型处理

**用户故事：** 作为用户，我希望组件能正确识别各种文件类型，包括浏览器无法自动识别的类型。

#### 验收标准

1. WHEN 用户选择文件时，THE File_Uploader SHALL 使用 `shared/utils/mime.ts` 的 `mime` 工具获取文件 MIME 类型
2. IF 浏览器无法识别文件 MIME 类型，THEN THE File_Uploader SHALL 根据文件扩展名使用 `mime.getType()` 推断 MIME 类型
3. THE File_Uploader SHALL 支持 `.md`、`.m4a`、`.heic`、`.heif` 等特殊文件类型的识别

### 需求 5：TypeScript 类型安全

**用户故事：** 作为开发者，我希望组件使用 TypeScript 并具有完整的类型定义，以便获得更好的开发体验和代码质量。

#### 验收标准

1. THE File_Uploader SHALL 使用 `<script setup lang="ts">` 语法
2. THE File_Uploader SHALL 为所有 props 定义 TypeScript 类型
3. THE File_Uploader SHALL 使用项目 `shared/types` 中定义的类型（如 `FileSource`、`PostSignatureResult`、`FileSourceAccept`）
4. THE File_Store SHALL 为所有方法参数和返回值定义明确的类型

### 需求 6：事件和回调处理

**用户故事：** 作为开发者，我希望组件提供标准的事件机制，以便父组件能够响应上传状态变化。

#### 验收标准

1. THE File_Uploader SHALL 使用 `defineEmits` 定义 `upload-success` 和 `upload-error` 事件
2. WHEN 文件上传成功时，THE File_Uploader SHALL 触发 `upload-success` 事件并传递签名信息
3. WHEN 文件上传失败时，THE File_Uploader SHALL 触发 `upload-error` 事件并传递错误信息
4. THE File_Uploader SHALL 同时支持 props 回调函数和事件两种方式

### 需求 7：文件验证

**用户故事：** 作为用户，我希望在上传前能够验证文件类型和大小，以便避免上传不支持的文件。

#### 验收标准

1. WHEN 用户选择文件时，THE File_Uploader SHALL 验证文件类型是否在允许列表中
2. WHEN 用户选择文件时，THE File_Uploader SHALL 验证文件大小是否超过该类型的最大限制
3. IF 文件验证失败，THEN THE File_Uploader SHALL 显示具体的错误信息
4. THE File_Uploader SHALL 根据 store 返回的场景配置动态设置允许的文件类型

### 需求 8：用户界面反馈

**用户故事：** 作为用户，我希望在上传过程中能够看到清晰的进度和状态反馈。

#### 验收标准

1. WHILE 文件正在上传，THE File_Uploader SHALL 显示上传进度百分比
2. WHILE 文件正在上传，THE File_Uploader SHALL 禁用拖拽区域和上传按钮
3. WHEN 上传成功时，THE File_Uploader SHALL 显示成功消息并使用 toast 提示
4. WHEN 上传失败时，THE File_Uploader SHALL 显示错误消息并使用 toast 提示

### 需求 9：代码清理

**用户故事：** 作为开发者，我希望组件代码整洁，移除未使用的代码和注释。

#### 验收标准

1. THE File_Uploader SHALL 移除所有被注释掉的旧代码
2. THE File_Uploader SHALL 移除未使用的 `FILE_TYPE_MAPPINGS` 常量（改用 `shared/utils/mime.ts`）
3. THE File_Uploader SHALL 使用项目的 logger 工具
4. THE File_Uploader SHALL 遵循项目的代码规范和命名约定
