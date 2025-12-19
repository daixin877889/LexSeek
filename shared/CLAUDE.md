[根目录](../../CLAUDE.md) > **shared**

# Shared 模块

## 模块职责

Shared 模块存放前后端共享的代码，包括：
- TypeScript 类型定义
- 通用工具函数
- 数据验证规则
- 常量定义

## 目录结构

```
shared/
├── types/          # 类型定义
│   └── sms.ts     # 短信相关类型
└── utils/          # 工具函数
    ├── phone.ts   # 手机号处理
    └── zod.ts     # Zod验证规则
```

## 类型定义

### 短信类型 (`types/sms.ts`)
```typescript
export const SmsType = [
  'LOGIN',        // 登录验证
  'REGISTER',     // 注册验证
  'RESET_PASSWORD' // 重置密码
] as const;

export type SmsType = typeof SmsType[number];
```

## 工具函数

### 手机号处理 (`utils/phone.ts`)

#### 1. 手机号脱敏
```typescript
maskPhone(phone: string): string
// 13812345678 -> 138****5678
```

#### 2. 电话号码脱敏
```typescript
maskTel(tel: string): string
// 支持手机号、固话、国际号码
```

#### 3. 手机号验证
```typescript
validatePhone(phoneNumber: string): boolean
// 使用正则: /^1[3-9]\d{9}$/
```

### Zod验证规则 (`utils/zod.ts`)
待扩展，用于定义通用的数据验证规则。

## 使用规范

### 导入示例
```typescript
// 导入类型
import { SmsType } from '~/shared/types/sms'

// 导入工具函数
import { validatePhone, maskPhone } from '~/shared/utils/phone'
```

### Nuxt 自动导入
配置在 `nuxt.config.ts` 中，shared 目录下的内容会被自动导入，无需手动import。

## 设计原则

1. **纯函数优先**
   - 所有工具函数应为纯函数
   - 无副作用，便于测试

2. **类型安全**
   - 使用 TypeScript 严格模式
   - 明确定义所有类型

3. **前后端共享**
   - 不依赖特定环境的API
   - 可同时用于客户端和服务端

## 扩展指南

### 添加新的类型定义
1. 在 `types/` 目录创建对应文件
2. 导出所有需要的类型
3. 添加必要的注释说明

### 添加新的工具函数
1. 在 `utils/` 目录创建对应文件
2. 编写单元测试（如需要）
3. 添加 JSDoc 注释

### 命名规范
- 类型文件使用 PascalCase: `user.ts`
- 工具文件使用 camelCase: `dateHelper.ts`
- 类型定义使用 PascalCase: `UserType`
- 函数使用 camelCase: `formatDate`

## 常见问题 (FAQ)

1. **如何在前端使用共享类型？**
   - Nuxt 会自动导入，直接使用即可
   - 例如：`const smsType: SmsType = 'LOGIN'`

2. **如何验证复杂对象？**
   - 使用 Zod 创建验证 Schema
   - 放在 `utils/zod.ts` 中共享

3. **如何处理日期格式？**
   - 建议创建 `utils/date.ts`
   - 提供格式化、解析等通用函数

## 相关文件清单

- `types/sms.ts` - 短信类型定义
- `utils/phone.ts` - 手机号处理工具
- `utils/zod.ts` - Zod验证规则（待扩展）

## 变更记录 (Changelog)

**2025-12-19**: 初始化 shared 模块文档