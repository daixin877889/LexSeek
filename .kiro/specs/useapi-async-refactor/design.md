# 设计文档

## 概述

本设计文档描述了 `useApi` composable 的重构方案，将其从回调模式改为 await 同步模式，同时保留自动错误处理功能。重构后的 API 将与 Nuxt 原生 `useFetch` 保持一致的使用体验。

## 架构

重构后的 `useApi` 保持单文件结构，主要变更：

1. 移除 `onSuccess` 和 `onError` 回调选项
2. 保留 `execute` 方法返回 Promise，支持 await
3. 保留自动 toast 错误提示功能
4. 返回值结构与 `useFetch` 一致

```
┌─────────────────────────────────────────────────────┐
│                    useApi                           │
├─────────────────────────────────────────────────────┤
│  输入:                                              │
│  - url: string | (() => string)                     │
│  - options: UseApiOptions<T>                        │
│    - method: HttpMethod                             │
│    - body: any                                      │
│    - query: Record<string, any>                     │
│    - headers: Record<string, string>                │
│    - lazy: boolean                                  │
│    - showError: boolean (默认 true)                 │
├─────────────────────────────────────────────────────┤
│  输出:                                              │
│  - data: Ref<T | null>                              │
│  - error: Ref<ApiError | null>                      │
│  - pending: Ref<boolean>                            │
│  - refresh: () => Promise<void>                     │
│  - execute: () => Promise<void>                     │
└─────────────────────────────────────────────────────┘
```

## 组件和接口

### UseApiOptions 接口（重构后）

```typescript
export interface UseApiOptions<T> {
    method?: HttpMethod
    body?: any
    query?: Record<string, any>
    headers?: Record<string, string>
    lazy?: boolean           // 是否延迟执行，默认 false
    showError?: boolean      // 是否显示错误提示，默认 true
    // 移除: onError, onSuccess
}
```

### UseApiReturn 接口

```typescript
export interface UseApiReturn<T> {
    data: Ref<T | null>
    error: Ref<ApiError | null>
    pending: Ref<boolean>
    refresh: () => Promise<void>
    execute: () => Promise<void>
}
```

## 数据模型

### ApiBaseResponse（保持不变）

```typescript
export interface ApiBaseResponse<T = any> {
    requestId: string
    success: boolean
    code: number
    message: string
    timestamp: number
    data?: T
}
```

### ApiError（保持不变）

```typescript
export interface ApiError {
    code: number
    message: string
    requestId?: string
}
```

## 正确性属性

*属性是系统在所有有效执行中应保持为真的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### Property 1: 返回值结构完整性

*对于任意* useApi 调用，返回对象应包含 data、error、pending、refresh、execute 五个属性，且 data、error、pending 为响应式引用

**验证: 需求 1.1, 3.1**

### Property 2: 成功请求数据填充

*对于任意* 成功的 API 响应（success: true），data ref 应包含响应的 data 字段值，error ref 应为 null

**验证: 需求 1.2**

### Property 3: 失败请求错误填充

*对于任意* 失败的 API 响应（success: false 或网络错误），error ref 应包含错误信息，data ref 应保持为 null

**验证: 需求 1.3**

### Property 4: execute 返回 Promise

*对于任意* execute 方法调用，返回值应为 Promise 类型，允许使用 await 等待

**验证: 需求 1.4**

### Property 5: 错误提示控制

*对于任意* showError 为 false 的请求，无论成功或失败，都不应调用 toast 函数

**验证: 需求 2.3**

### Property 6: pending 状态正确性

*对于任意* 请求执行过程，pending 应在请求开始时为 true，请求结束后为 false

**验证: 需求 3.3**

## 错误处理

1. **业务错误**（response.success === false）：
   - 填充 error ref
   - 如果 showError 为 true，调用 toast.error 显示 response.message

2. **网络错误**（$fetch 抛出异常）：
   - 填充 error ref，包含错误码和消息
   - 如果 showError 为 true，调用 toast.error 显示错误消息

3. **默认错误消息**：网络请求失败时使用 "网络请求失败，请稍后重试"

## 测试策略

### 单元测试

由于 `useApi` 依赖 Nuxt 的 `$fetch` 和 Vue 的响应式系统，单元测试需要：

1. Mock `$fetch` 函数模拟不同的响应场景
2. Mock `toast` 函数验证错误提示行为
3. 测试返回值结构和类型

### 属性测试

使用 `fast-check` 作为属性测试库：

1. 生成随机的 API 响应数据，验证 data 填充正确性
2. 生成随机的错误响应，验证 error 填充正确性
3. 生成随机的 showError 配置，验证 toast 调用行为

### 测试用例覆盖

- 成功请求场景
- 业务错误场景（success: false）
- 网络错误场景
- showError 为 true/false 的场景
- lazy 模式和立即执行模式
- refresh 方法调用

## 使用示例

### 重构前（回调方式）

```typescript
const { error, execute } = useApiPost(
  "/api/v1/sms/send",
  { phone: formData.phone, type: SmsType.REGISTER },
  {
    showError: false,
    onError: (err) => {
      errorMessage.value = err.message || "获取验证码失败";
    },
    onSuccess: () => {
      toast.success("获取验证码成功");
      startCountdown();
    },
  }
);
await execute();
```

### 重构后（await 方式）

```typescript
const { data, error, execute } = useApiPost(
  "/api/v1/sms/send",
  { phone: formData.phone, type: SmsType.REGISTER },
  { showError: false }
);

await execute();

if (error.value) {
  errorMessage.value = error.value.message || "获取验证码失败";
} else {
  toast.success("获取验证码成功");
  startCountdown();
}
```
