# 实现计划: 文件上传组件改造

## 概述

将 `fileUploader.vue` 组件改造为适配项目架构，包括创建 file store、适配 OSS V4 签名、使用 mime 工具等。

## 任务

- [x] 1. 创建文件状态管理 Store
  - [x] 1.1 创建 `app/store/file.ts` 文件，定义 store 结构
    - 定义 `loading` 和 `error` 状态
    - 使用 Pinia 的 `defineStore` 和组合式 API
    - _需求: 1.1, 1.4, 1.5_
  - [x] 1.2 实现 `getUploadConfig` 方法
    - 调用 `/api/v1/files/presigned-url/config` 获取场景配置
    - 使用 `useApi` composable
    - 正确处理 loading 和 error 状态
    - _需求: 1.2, 1.5_
  - [x] 1.3 实现 `getPresignedUrl` 方法
    - 调用 `/api/v1/files/presigned-url` 获取预签名信息
    - 使用 `useApi` composable
    - 正确处理 loading 和 error 状态
    - _需求: 1.3, 1.5_

- [x] 2. 改造文件上传组件
  - [x] 2.1 添加 TypeScript 类型定义
    - 使用 `<script setup lang="ts">` 语法
    - 为 props 定义类型接口
    - 使用 `defineEmits` 定义事件类型
    - 导入 `shared/types` 中的类型
    - _需求: 5.1, 5.2, 5.3, 6.1_
  - [x] 2.2 改造 API 调用为使用 store
    - 替换 `loadScenes` 方法，使用 `useFileStore().getUploadConfig`
    - 替换 `getUploadSignature` 方法，使用 `useFileStore().getPresignedUrl`
    - _需求: 2.1, 2.2, 2.3_
  - [x] 2.3 改造 MIME 类型处理
    - 导入 `shared/utils/mime.ts` 的 `mime` 工具
    - 移除 `FILE_TYPE_MAPPINGS` 常量
    - 使用 `mime.getType()` 推断 MIME 类型
    - 使用 `mime.getExtension()` 获取扩展名
    - _需求: 4.1, 4.2, 4.3, 9.2_
  - [x] 2.4 适配 OSS V4 签名方式
    - 修改 `uploadToOSS` 方法，使用 V4 签名字段
    - 添加 `x-oss-signature-version`、`x-oss-credential`、`x-oss-date`、`x-oss-signature`
    - 条件添加 `x-oss-security-token` 和 `callback`
    - 使用后端返回的 `key` 字段
    - _需求: 3.1, 3.2, 3.3, 3.4_
  - [x] 2.5 完善事件和回调处理
    - 实现 `upload-success` 和 `upload-error` 事件触发
    - 同时支持 props 回调和事件
    - _需求: 6.2, 6.3, 6.4_
  - [x] 2.6 代码清理
    - 移除注释掉的旧代码
    - 使用项目的 logger 工具
    - 确保代码符合项目规范
    - _需求: 9.1, 9.3, 9.4_

- [x] 3. 检查点 - 确保代码编译通过
  - 运行 `bun run build` 确保无编译错误
  - 检查 TypeScript 类型是否正确
  - 如有问题，询问用户

- [x] 4. 编写测试
  - [x] 4.1 编写 store 单元测试
    - 测试 `getUploadConfig` 方法
    - 测试 `getPresignedUrl` 方法
    - 测试 loading 和 error 状态管理
    - _需求: 1.2, 1.3, 1.5_
  - [x] 4.2 编写属性测试 - FormData 构建正确性
    - **Property 3: OSS V4 FormData 构建正确性**
    - **验证: 需求 3.1, 3.2, 3.3, 3.4**
  - [x] 4.3 编写属性测试 - 文件验证正确性
    - **Property 5: 文件验证正确性**
    - **验证: 需求 7.1, 7.2, 7.3, 7.4**

- [x] 5. 最终检查点
  - 确保所有测试通过 ✅ (15 个测试全部通过)
  - 如有问题，询问用户

## 备注

- 每个任务都引用了具体的需求以便追溯
- 检查点用于确保增量验证
- 属性测试验证正确性属性
