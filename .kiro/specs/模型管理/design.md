# 设计文档

## 概述

本设计文档描述了 LexSeek AI 模型管理系统的技术架构。

## 架构

### 目录结构

```
server/
├── api/v1/admin/
│   ├── model-providers/       # 模型提供商 API
│   ├── models/                # 模型 API
│   └── model-api-keys/        # API 密钥 API
├── services/model/            # 模型服务
app/pages/admin/
├── model-providers/           # 模型提供商管理页面
├── models/                    # 模型管理页面
└── model-api-keys/            # API 密钥管理页面
```

## 数据模型

### 模型提供商表 (modelProviders)

```prisma
model modelProviders {
    id          Int       @id @default(autoincrement())
    name        String    @db.VarChar(100)
    code        String    @unique @db.VarChar(50)
    status      Int       @default(1)
    
    models models[]
    
    @@map("model_providers")
}
```

### 模型表 (models)

```prisma
model models {
    id          Int       @id @default(autoincrement())
    providerId  Int       @map("provider_id")
    name        String    @db.VarChar(100)
    code        String    @unique @db.VarChar(100)
    config      Json?
    status      Int       @default(1)
    
    provider modelProviders @relation(fields: [providerId], references: [id])
    
    @@map("models")
}
```

## 实现状态

所有组件已完成实现和测试。

### 相关文件

- `server/services/model/*.ts`
- `server/api/v1/admin/model-providers/*.ts`
- `server/api/v1/admin/models/*.ts`
- `app/pages/admin/model-providers/*.vue`
- `app/pages/admin/models/*.vue`
