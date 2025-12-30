# 需求文档

## 简介

本文档定义了会员升级价格计算的修复需求，主要解决升级时剩余价值计算方式的问题。当前系统使用套餐天数比例计算剩余价值，应改为按实际剩余天数计算。

## 术语表

- **会员升级系统 (Membership_Upgrade_System)**: 管理用户会员级别升级的核心系统
- **剩余价值 (Remaining_Value)**: 用户当前会员剩余时间对应的金额价值
- **日均价值 (Daily_Value)**: 会员每天的价值，等于实付金额除以套餐总天数
- **实付金额 (Paid_Amount)**: 用户购买当前会员时实际支付的金额
- **剩余天数 (Remaining_Days)**: 从今天到会员到期日的天数
- **升级价格 (Upgrade_Price)**: 用户升级到更高级别需要支付的差价

## 需求

### 需求 1: 按实际剩余天数计算剩余价值

**用户故事:** 作为用户，我希望升级会员时，系统按照我实际剩余的天数来计算剩余价值，而不是按套餐比例计算，这样更公平合理。

#### 验收标准

1. WHEN 计算当前会员剩余价值时，THE Membership_Upgrade_System SHALL 使用公式：剩余价值 = 日均价值 × 剩余天数
2. THE Membership_Upgrade_System SHALL 计算日均价值为：实付金额 / 套餐总天数
3. WHEN 用户没有实付金额记录时（如兑换码获得的会员），THE Membership_Upgrade_System SHALL 将剩余价值设为 0
4. THE Membership_Upgrade_System SHALL 确保剩余天数不超过套餐总天数
5. FOR ALL 升级价格计算，剩余价值 SHALL 基于实际剩余天数而非套餐比例

### 需求 2: 目标级别价值按剩余天数计算

**用户故事:** 作为用户，我希望升级后的会员价值也按照剩余天数来计算，确保我支付的升级费用与实际获得的服务时长相匹配。

#### 验收标准

1. WHEN 计算目标级别剩余价值时，THE Membership_Upgrade_System SHALL 使用公式：目标剩余价值 = 目标日均价值 × 剩余天数
2. THE Membership_Upgrade_System SHALL 计算目标日均价值为：目标级别年价 / 365
3. WHEN 目标级别只有月价时，THE Membership_Upgrade_System SHALL 使用月价 × 12 作为年价
4. THE Membership_Upgrade_System SHALL 确保升级后会员的结束时间与原会员一致

### 需求 3: 升级价格计算

**用户故事:** 作为用户，我希望看到清晰的升级价格计算，知道我需要支付多少差价。

#### 验收标准

1. THE Membership_Upgrade_System SHALL 计算升级价格为：目标剩余价值 - 当前剩余价值
2. WHEN 升级价格计算结果为负数时，THE Membership_Upgrade_System SHALL 将升级价格设为 0
3. THE Membership_Upgrade_System SHALL 将升级价格四舍五入到分（保留两位小数）
4. THE Membership_Upgrade_System SHALL 在升级选项中显示计算后的升级价格

### 需求 4: 计算示例验证

**用户故事:** 作为开发者，我希望系统的计算逻辑符合预期的示例场景。

#### 验收标准

1. WHEN 用户花 365 元购买基础版（365天），剩余 100 天，升级到专业版（680元/年）时：
   - 日均价值 = 365 / 365 = 1 元/天
   - 当前剩余价值 = 1 × 100 = 100 元
   - 目标日均价值 = 680 / 365 ≈ 1.863 元/天
   - 目标剩余价值 = 1.863 × 100 ≈ 186.30 元
   - 升级价格 = 186.30 - 100 = 86.30 元
2. WHEN 用户通过兑换码获得会员（实付金额为 0），剩余 100 天，升级到专业版（680元/年）时：
   - 当前剩余价值 = 0 元
   - 目标剩余价值 = 1.863 × 100 ≈ 186.30 元
   - 升级价格 = 186.30 元
