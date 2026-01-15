# 设计文档

## 概述

本设计文档描述了 LexSeek 用户认证系统的技术架构。

## 架构

### 目录结构

```
server/
├── api/v1/auth/               # 认证 API
├── middleware/
│   └── 02.auth.ts             # 认证中间件
├── services/auth/             # 认证服务
├── utils/
│   ├── jwt.ts                 # JWT 工具
│   └── password.ts            # 密码工具
app/pages/
├── login.vue                  # 登录页面
├── register.vue               # 注册页面
└── reset-password.vue         # 重置密码页面
```

## 实现状态

所有组件已完成实现和测试。

### 相关文件

- `server/services/auth/*.ts`
- `server/api/v1/auth/*.ts`
- `server/middleware/02.auth.ts`
- `server/utils/jwt.ts`
- `server/utils/password.ts`
