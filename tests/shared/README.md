# 共享类型测试

测试 `shared/types` 目录下的类型定义和运行时逻辑。

## 目录结构

```
tests/shared/
└── types/
    ├── encryption.test.ts    # 加密错误类测试
    ├── enums.test.ts         # 枚举值测试
    └── name-mappings.test.ts # 名称映射测试
```

## 测试文件说明

| 文件 | 说明 | 测试内容 |
|------|------|----------|
| `encryption.test.ts` | 加密类型测试 | 自定义错误类的行为和继承链 |
| `enums.test.ts` | 枚举类型测试 | 各模块枚举值的正确性 |
| `name-mappings.test.ts` | 名称映射测试 | 枚举值与中文名称的映射一致性 |

## 运行测试

```bash
# 运行所有共享类型测试
npx vitest run tests/shared --reporter=verbose

# 运行单个测试文件
npx vitest run tests/shared/types/encryption.test.ts --reporter=verbose
```

## 测试覆盖范围

### 加密类型 (encryption.ts)
- `IdentityNotUnlockedError` - 私钥未解锁错误
- `IdentityMismatchError` - 私钥不匹配错误
- `FileCorruptedError` - 文件损坏错误
- `InvalidAgeFileError` - 无效 age 文件错误
- `WrongPasswordError` - 密码错误

### 枚举类型
- `CampaignType` / `CampaignStatus` - 营销活动
- `FileSource` / `OssFileStatus` / `FileType` - 文件相关
- `UserMembershipSourceType` / `MembershipStatus` - 会员相关
- `PaymentChannel` / `PaymentMethod` / `OrderStatus` - 支付相关
- `PointRecordSourceType` / `PointRecordStatus` - 积分相关
- `ProductType` / `ProductStatus` - 商品相关
- `RedemptionCodeType` / `RedemptionCodeStatus` - 兑换码相关
- `SmsType` - 短信类型
- `SystemConfigStatus` - 系统配置
- `UnitType` / `TimeUnit` / `FileSizeUnit` - 单位类型
- `UserStatus` / `UserRegisterChannel` - 用户相关

### 名称映射
- `FileSourceName` - 文件来源名称
- `OssFileStatusName` - OSS 文件状态名称
- `FileTypeName` - 文件类型名称
- `PointRecordSourceTypeName` - 积分来源名称
- `PointConsumptionItemStatusName` - 积分消耗项目状态名称
- `PointConsumptionRecordStatusName` - 积分消耗记录状态名称

## 注意事项

1. `shared/types` 目录主要包含类型定义（接口、类型别名），这些在运行时不存在，无法测试
2. 测试重点是枚举值、名称映射和自定义错误类等运行时存在的代码
3. 接口和类型别名的正确性由 TypeScript 编译器保证
