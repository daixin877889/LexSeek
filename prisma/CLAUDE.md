[根目录](../../CLAUDE.md) > **prisma**

# Prisma 模块

## 模块职责

Prisma 模块管理 LexSeek 的数据库相关配置，包括：
- 数据库模式定义
- 数据库迁移脚本
- Prisma 客户端配置

## 目录结构

```
prisma/
├── schema.prisma        # 数据库模式定义
├── migrations/          # 数据库迁移历史
│   └── 20251219075339_init/
│       └── migration.sql
└── migration_lock.toml  # 迁移锁文件
```

## 数据库配置

### 数据源
- **提供者**: PostgreSQL
- **连接**: 通过环境变量 `DATABASE_URL`

### Prisma 客户端
- **生成器**: prisma-client
- **输出目录**: `../app/generated/prisma`

## 数据模型

### 1. 用户表 (users)

```prisma
model users {
  id              Int       @id @default(autoincrement())
  name            String    @db.VarChar(100)
  username        String?   @unique @db.VarChar(100)
  email           String?   @unique @db.VarChar(100)
  phone           String    @unique @db.VarChar(11)
  password        String?   @db.VarChar(100)
  role            UserRole  @default(USER)
  status          Int       @default(1)
  company         String?   @db.VarChar(100)
  profile         String?
  inviteCode      String    @unique @map("invite_code") @db.VarChar(10)
  invitedBy       Int?      @map("invited_by")
  openid          String?   @db.VarChar(100)
  unionid         String?   @db.VarChar(100)
  registerChannel String?   @map("register_channel") @db.VarChar(100)
  createdAt       DateTime? @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt       DateTime? @default(now()) @map("updated_at") @db.Timestamptz()
  deletedAt       DateTime? @map("deleted_at") @db.Timestamptz()
}
```

**字段说明**:
- `phone`: 手机号，唯一标识
- `inviteCode`: 邀请码，10位字符串
- `role`: 用户角色（USER/ADMIN）
- `status`: 用户状态（1-启用，0-禁用）
- `deletedAt`: 软删除标记

### 2. 短信记录表 (smsRecords)

```prisma
model smsRecords {
  id        String    @id @default(uuid(7)) @db.Uuid
  phone     String    @db.VarChar(11)
  code      String    @db.VarChar(10)
  type      String    @db.VarChar(100)
  expiredAt DateTime  @map("expired_at") @db.Timestamptz()
  createdAt DateTime? @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt DateTime? @default(now()) @map("updated_at") @db.Timestamptz()
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz()
}
```

**字段说明**:
- `id`: UUID v7 主键
- `code`: 6位验证码
- `type`: 验证码类型（LOGIN/REGISTER/RESET_PASSWORD）
- `expiredAt`: 过期时间（创建后5分钟）

## 索引策略

### users 表索引
- `idx_users_id`: 主键索引
- `idx_users_status`: 状态查询优化
- `idx_users_deleted_at`: 软删除查询优化
- `idx_users_role`: 角色查询优化

### smsRecords 表索引
- `idx_sms_phone_type`: 唯一索引，防止同一手机号同类型重复
- `idx_sms_phone`: 手机号查询优化
- `idx_sms_expired_at`: 过期清理优化
- `idx_sms_type`: 类型查询优化

## 枚举类型

```prisma
enum UserRole {
  USER   // 普通用户
  ADMIN  // 管理员
}
```

## 命名规范

1. **表名**
   - 使用小写字母
   - 复数形式：`users`、`smsRecords`
   - 驼峰转下划线：`inviteCode` → `invite_code`

2. **字段名**
   - camelCase 命名：`createdAt`、`updatedAt`
   - 布尔字段使用 is/has/has 前缀

3. **索引名**
   - 格式：`idx_{table}_{column}`
   - 唯一索引：`uk_{table}_{column}`

## 迁移管理

### 创建迁移
```bash
npm run prisma:migrate
```

### 重置数据库
```bash
npm run prisma:migrate reset
```

### 生成客户端
```bash
npm run prisma:generate
```

### 数据库推送（开发阶段）
```bash
npm run prisma:push
```

## 数据库连接

### 连接池配置
```typescript
// server/utils/db.ts
const pool = new PrismaPg({
  connectionString: process.env.DATABASE_URL!
})
```

### 使用示例
```typescript
import { prisma } from '~/server/utils/db'

// 创建用户
const user = await prisma.users.create({
  data: {
    phone: '13812345678',
    name: '张三',
    inviteCode: generateInviteCode()
  }
})

// 查询（包含字段选择）
const user = await prisma.users.findUnique({
  where: { phone },
  select: {
    id: true,
    name: true,
    phone: true,
    role: true
  }
})
```

## 开发注意事项

1. **字段长度**
   - 手机号：11位
   - 邀请码：10位
   - 用户名/邮箱：100位

2. **时间处理**
   - 所有时间字段使用 Timestamptz
   - 自动设置 `createdAt` 和 `updatedAt`
   - 软删除使用 `deletedAt`

3. **数据验证**
   - 在应用层进行数据验证
   - 使用 Zod Schema 定义验证规则
   - 数据库层保持简洁

## 常见问题 (FAQ)

1. **如何修改表结构？**
   - 修改 `schema.prisma`
   - 运行 `npm run prisma:migrate`
   - 提交迁移文件

2. **如何备份？**
   - 使用 `pg_dump` 导出SQL
   - 保留迁移文件以便重建

3. **如何处理开发环境数据？**
   - 使用 `prisma/seed.ts` 创建种子数据
   - 运行 `npx prisma db seed`

## 相关文件清单

- `schema.prisma` - 数据库模式定义
- `migrations/20251219075339_init/migration.sql` - 初始化迁移
- `server/utils/db.ts` - 数据库连接封装

## 变更记录 (Changelog)

**2025-12-19**: 初始化 prisma 模块文档