# 设计文档

## 概述

本设计文档描述了 LexSeek 后端基础设施的技术方案。

## 架构

### 目录结构

```
server/
├── middleware/
│   └── 01.requestId.ts        # RequestId 中间件
├── plugins/
│   └── logger.ts              # 日志插件
├── services/                  # 服务层
│   └── [module]/
│       ├── [entity].dao.ts    # 数据访问层
│       └── [entity].service.ts # 业务逻辑层
├── utils/
│   └── db.ts                  # 数据库工具
shared/
├── types/                     # 类型定义
└── utils/                     # 共享工具
```

## 关键实现

### 日志系统

使用 pino 作为日志库，支持：
- 日志级别控制
- RequestId 追踪
- 文件输出
- 结构化日志

### 服务层架构

- DAO 层：封装 Prisma 操作
- Service 层：处理业务逻辑
- API 层：处理请求响应

## 实现状态

所有组件已完成实现和测试。

### 相关文件

- `server/middleware/01.requestId.ts`
- `server/plugins/logger.ts`
- `server/utils/db.ts`
- `shared/types/*.ts`
- `shared/utils/*.ts`
