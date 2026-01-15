# 设计文档

## 概述

本设计文档描述了 LexSeek 前端基础设施的技术方案。

## 架构

### 目录结构

```
app/
├── composables/
│   ├── useApi.ts              # API 请求封装
│   └── useApiFetch.ts         # 异步数据获取
├── utils/                     # 工具函数
└── components/                # 公共组件
```

## 关键实现

### useApi/useApiFetch

统一的数据获取 composable，支持：
- 自动处理加载状态
- 自动处理错误状态
- 请求缓存和去重
- SSR 支持

### 水合优化

- 使用 `<ClientOnly>` 包裹客户端组件
- 正确使用 `useAsyncData` 和 `useFetch`
- 避免在 setup 中直接访问 DOM

## 实现状态

所有组件已完成实现和测试。

### 相关文件

- `app/composables/useApi.ts`
- `app/composables/useApiFetch.ts`
