# 设计文档

## 概述

本设计文档描述了 LexSeek 权限管理系统的技术架构和实现方案。

## 架构

### 目录结构

```
server/
├── api/v1/admin/
│   ├── roles/                 # 角色管理 API
│   ├── permissions/           # 权限管理 API
│   └── access/                # 访问控制 API
├── middleware/
│   └── 03.permission.ts       # 权限中间件
├── services/rbac/             # RBAC 服务
app/pages/admin/
├── roles/                     # 角色管理页面
├── permissions/               # 权限管理页面
└── access/                    # 访问控制页面
```

## 数据模型

### 角色表 (roles)

```prisma
model roles {
    id          Int       @id @default(autoincrement())
    name        String    @db.VarChar(50)
    description String?   @db.VarChar(255)
    status      Int       @default(1)
    
    userRoles userRoles[]
    rolePermissions rolePermissions[]
    
    @@map("roles")
}
```

### 权限表 (permissions)

```prisma
model permissions {
    id          Int       @id @default(autoincrement())
    name        String    @db.VarChar(100)
    code        String    @unique @db.VarChar(100)
    type        String    @db.VarChar(20)
    
    rolePermissions rolePermissions[]
    
    @@map("permissions")
}
```

## 实现状态

所有组件已完成实现和测试。

### 相关文件

**服务层**:
- `server/services/rbac/*.ts`

**中间件**:
- `server/middleware/03.permission.ts`

**API 层**:
- `server/api/v1/admin/roles/*.ts`
- `server/api/v1/admin/permissions/*.ts`

**前端**:
- `app/pages/admin/roles/*.vue`
- `app/pages/admin/permissions/*.vue`
