# 需求文档

## 简介

重构 `app/composables/useApi.ts`，将当前基于回调（`onSuccess`、`onError`）的 API 调用方式改为类似 Nuxt 原生 `useFetch` 的 `await` 同步方式。保留自动错误处理（toast 提示）功能，同时让调用方可以通过返回值直接获取数据和错误状态。

## 术语表

- **useApi**: 封装 API 请求的 Vue composable 函数
- **useFetch**: Nuxt 内置的数据获取 composable
- **ApiBaseResponse**: 服务端统一响应格式接口
- **toast**: 用于显示提示消息的 UI 组件

## 需求

### 需求 1

**用户故事:** 作为开发者，我希望使用 await 方式调用 API，以便代码更简洁、流程更清晰。

#### 验收标准

1. WHEN 开发者调用 useApi 并使用 await 等待 execute 方法 THEN useApi SHALL 返回包含 data、error、pending 等响应式引用的对象
2. WHEN API 请求成功 THEN useApi SHALL 将响应数据填充到 data ref 中
3. WHEN API 请求失败（网络错误或业务错误）THEN useApi SHALL 将错误信息填充到 error ref 中
4. WHEN execute 方法被调用 THEN useApi SHALL 返回一个 Promise，允许调用方使用 await 等待请求完成

### 需求 2

**用户故事:** 作为开发者，我希望 API 错误能自动显示 toast 提示，以便减少重复的错误处理代码。

#### 验收标准

1. WHEN API 请求返回业务错误（success: false）且 showError 选项为 true THEN useApi SHALL 自动调用 toast.error 显示错误消息
2. WHEN API 请求发生网络错误且 showError 选项为 true THEN useApi SHALL 自动调用 toast.error 显示错误消息
3. WHEN showError 选项设置为 false THEN useApi SHALL 不显示任何 toast 提示
4. WHERE showError 选项未指定 THEN useApi SHALL 默认启用错误提示（showError 默认为 true）

### 需求 3

**用户故事:** 作为开发者，我希望 useApi 的返回值结构与 useFetch 保持一致，以便降低学习成本和迁移成本。

#### 验收标准

1. WHEN useApi 被调用 THEN useApi SHALL 返回包含 data、error、pending、refresh、execute 属性的对象
2. WHEN 调用 refresh 方法 THEN useApi SHALL 重新执行请求并更新 data 和 error 状态
3. WHEN pending 状态变化 THEN useApi SHALL 在请求开始时设置 pending 为 true，请求结束时设置为 false

### 需求 4

**用户故事:** 作为开发者，我希望移除 onSuccess 和 onError 回调选项，以便统一使用 await 方式处理结果。

#### 验收标准

1. WHEN useApi 配置选项被定义 THEN useApi SHALL 不包含 onSuccess 回调选项
2. WHEN useApi 配置选项被定义 THEN useApi SHALL 不包含 onError 回调选项
3. WHEN 开发者需要处理成功或错误 THEN 开发者 SHALL 通过检查返回的 data 和 error ref 值来处理
