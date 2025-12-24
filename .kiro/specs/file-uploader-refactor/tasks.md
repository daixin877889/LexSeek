# 实现计划: 文件上传组件改造

## 概述

将 `fileUploader.vue` 组件改造为适配项目架构，包括创建 file store、适配 OSS V4 签名、使用 mime 工具、支持单选/多选模式、实现批量签名接口等。

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

- [x] 6. 实现批量预签名接口
  - [x] 6.1 创建 `server/api/v1/files/presigned-url/.post.ts` 文件
    - 参考 `.get.ts` 的实现逻辑
    - 接收 `source` 和 `files` 数组作为请求体
    - 使用 zod 验证请求体格式
    - _需求: 11.1_
  - [x] 6.2 实现批量文件验证逻辑
    - 遍历验证每个文件的类型和大小
    - 如果任何文件验证失败，返回具体错误信息
    - _需求: 11.2, 11.4_
  - [x] 6.3 实现批量签名生成
    - 为每个验证通过的文件生成独立签名
    - 返回与输入数组对应的签名数组
    - _需求: 11.3, 11.5_

- [x] 7. 更新 Store 支持批量签名
  - [x] 7.1 添加批量签名类型定义
    - 定义 `BatchPresignedUrlParams` 接口
    - 定义 `FileInfo` 接口
    - _需求: 12.2_
  - [x] 7.2 实现 `getBatchPresignedUrls` 方法
    - 调用 POST `/api/v1/files/presigned-url` 接口
    - 正确处理 loading 和 error 状态
    - 返回签名结果数组
    - _需求: 12.1, 12.3, 12.4_

- [x] 8. 改造组件支持多选模式
  - [x] 8.1 添加 `multiple` prop
    - 定义 `multiple` prop，默认值为 `false`
    - 根据 prop 值设置文件输入框的 `multiple` 属性
    - _需求: 10.1, 10.2, 10.3_
  - [x] 8.2 改造文件选择逻辑
    - 单选模式：保持现有逻辑，只保存一个文件
    - 多选模式：保存文件数组，支持多文件选择
    - _需求: 10.2, 10.3_
  - [x] 8.3 添加多选模式 UI
    - 显示已选文件列表和文件数量
    - 支持删除单个已选文件
    - _需求: 10.4_
  - [x] 8.4 实现批量上传逻辑
    - 多选模式下调用 `getBatchPresignedUrls` 获取批量签名
    - 依次上传每个文件到 OSS
    - _需求: 10.5_
  - [x] 8.5 添加多文件上传进度显示
    - 显示每个文件的上传进度和状态
    - 添加 `file-upload-progress` 事件
    - _需求: 10.6_
  - [x] 8.6 添加批量上传事件
    - 添加 `batch-upload-success` 事件
    - 添加 `onBatchSuccess` 回调 prop
    - _需求: 6.2, 6.3_

- [x] 9. 检查点 - 确保新功能编译通过
  - 运行 `bun run build` 确保无编译错误
  - 检查 TypeScript 类型是否正确
  - 如有问题，询问用户

- [x] 10. 编写新功能测试
  - [x] 10.1 编写批量签名接口测试
    - 测试批量验证逻辑
    - 测试签名数组生成
    - _需求: 11.2, 11.3, 11.4, 11.5_
  - [x] 10.2 编写属性测试 - 批量签名接口验证正确性
    - **Property 7: 批量签名接口验证正确性**
    - **验证: 需求 11.2, 11.3, 11.4, 11.5**
  - [x] 10.3 编写属性测试 - Store 批量签名方法正确性
    - **Property 8: Store 批量签名方法正确性**
    - **验证: 需求 12.1, 12.3, 12.4**

- [ ] 11. 最终检查点
  - 确保所有测试通过
  - 如有问题，询问用户

## 备注

- 任务 1-5 已完成，是之前的基础改造
- 任务 6-11 是新增的多选模式和批量签名功能
- 每个任务都引用了具体的需求以便追溯
- 检查点用于确保增量验证
- 所有任务都必须完成，包括测试任务
