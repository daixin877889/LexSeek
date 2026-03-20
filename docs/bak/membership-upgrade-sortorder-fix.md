# 会员升级 sortOrder 逻辑修复说明

## 问题描述

会员升级功能中，判断级别高低的逻辑出现错误，导致基础版用户无法升级到专业版或旗舰版。

### 数据库实际数据

```sql
-- 会员级别数据
INSERT INTO "membership_levels" ("id", "name", "sort_order", "status") VALUES 
(1, '基础版', 1, 1),
(2, '专业版', 2, 1),
(3, '旗舰版', 3, 1);
```

**实际规则**：sortOrder 越大，级别越高
- 基础版：sortOrder = 1（最低级别）
- 专业版：sortOrder = 2（中级）
- 旗舰版：sortOrder = 3（最高级别）

### 代码中的错误

**错误逻辑**：代码中使用 `sortOrder < currentSortOrder` 来筛选更高级别，这是错误的。

```typescript
// ❌ 错误：这会筛选出 sortOrder 更小的级别（实际是更低的级别）
const higherLevels = allLevels.filter(
    (level) => level.sortOrder < currentMembership.level.sortOrder
)

// ❌ 错误：这会拒绝 sortOrder 更大的级别（实际是更高的级别）
if (targetLevel.sortOrder >= currentMembership.level.sortOrder) {
    return { success: false, errorMessage: '目标级别必须高于当前级别' }
}
```

### 问题影响

当基础版用户（sortOrder = 1）尝试升级时：
1. 筛选条件 `level.sortOrder < 1` 找不到任何级别（因为没有 sortOrder < 1 的级别）
2. 返回空的升级选项列表
3. 前端显示"暂无可升级的级别"

## 解决方案

修正 sortOrder 的比较逻辑，使用正确的大小关系判断。

### 修改内容

**文件**：`lexseek/server/services/membership/membershipUpgrade.service.ts`

#### 1. 修正筛选更高级别的逻辑

```typescript
// ✅ 正确：筛选 sortOrder 更大的级别（更高级别）
const higherLevels = allLevels.filter(
    (level) => level.sortOrder > currentMembership.level.sortOrder
)
```

#### 2. 修正升级条件检查（calculateUpgradePriceService）

```typescript
// ✅ 正确：目标级别的 sortOrder 必须大于当前级别
if (targetLevel.sortOrder <= currentMembership.level.sortOrder) {
    return { success: false, errorMessage: '目标级别必须高于当前级别' }
}
```

#### 3. 修正升级条件检查（executeMembershipUpgradeService）

```typescript
// ✅ 正确：目标级别的 sortOrder 必须大于当前级别
if (targetLevel.sortOrder <= currentMembership.level.sortOrder) {
    return { success: false, errorMessage: '目标级别必须高于当前级别' }
}
```

## 修改位置

### 1. getUpgradeOptionsService（第 56-59 行）

```typescript
// 修改前
const higherLevels = allLevels.filter(
    (level) => level.sortOrder < currentMembership.level.sortOrder
)

// 修改后
const higherLevels = allLevels.filter(
    (level) => level.sortOrder > currentMembership.level.sortOrder
)
```

### 2. calculateUpgradePriceService（第 179-181 行）

```typescript
// 修改前
if (targetLevel.sortOrder >= currentMembership.level.sortOrder) {
    return { success: false, errorMessage: '目标级别必须高于当前级别' }
}

// 修改后
if (targetLevel.sortOrder <= currentMembership.level.sortOrder) {
    return { success: false, errorMessage: '目标级别必须高于当前级别' }
}
```

### 3. executeMembershipUpgradeService（第 243-245 行）

```typescript
// 修改前
if (targetLevel.sortOrder >= currentMembership.level.sortOrder) {
    return { success: false, errorMessage: '目标级别必须高于当前级别' }
}

// 修改后
if (targetLevel.sortOrder <= currentMembership.level.sortOrder) {
    return { success: false, errorMessage: '目标级别必须高于当前级别' }
}
```

## 验证场景

### 场景 1：基础版升级到专业版

**数据**：
- 当前级别：基础版（sortOrder = 1）
- 目标级别：专业版（sortOrder = 2）

**预期结果**：
- ✅ 筛选条件：`2 > 1` → 通过
- ✅ 升级检查：`2 <= 1` → 不通过，允许升级
- ✅ 可以成功升级

### 场景 2：基础版升级到旗舰版

**数据**：
- 当前级别：基础版（sortOrder = 1）
- 目标级别：旗舰版（sortOrder = 3）

**预期结果**：
- ✅ 筛选条件：`3 > 1` → 通过
- ✅ 升级检查：`3 <= 1` → 不通过，允许升级
- ✅ 可以成功升级

### 场景 3：专业版升级到旗舰版

**数据**：
- 当前级别：专业版（sortOrder = 2）
- 目标级别：旗舰版（sortOrder = 3）

**预期结果**：
- ✅ 筛选条件：`3 > 2` → 通过
- ✅ 升级检查：`3 <= 2` → 不通过，允许升级
- ✅ 可以成功升级

### 场景 4：专业版降级到基础版（应拒绝）

**数据**：
- 当前级别：专业版（sortOrder = 2）
- 目标级别：基础版（sortOrder = 1）

**预期结果**：
- ❌ 筛选条件：`1 > 2` → 不通过，不会出现在升级选项中
- ❌ 升级检查：`1 <= 2` → 通过，拒绝升级
- ✅ 正确拒绝降级

### 场景 5：旗舰版无法升级（已是最高级别）

**数据**：
- 当前级别：旗舰版（sortOrder = 3）
- 可用级别：基础版（1）、专业版（2）、旗舰版（3）

**预期结果**：
- ✅ 筛选条件：没有 sortOrder > 3 的级别
- ✅ 返回空的升级选项列表
- ✅ 正确显示"暂无可升级的级别"

## 测试建议

1. **基础版用户升级测试**：
   - 登录基础版用户
   - 访问会员升级页面
   - 应该看到专业版和旗舰版的升级选项

2. **专业版用户升级测试**：
   - 登录专业版用户
   - 访问会员升级页面
   - 应该只看到旗舰版的升级选项

3. **旗舰版用户测试**：
   - 登录旗舰版用户
   - 访问会员升级页面
   - 应该显示"暂无可升级的级别"或隐藏升级按钮

## 注意事项

### 测试代码也需要修正

测试文件 `lexseek/tests/server/membership/test-generators.ts` 中的注释和逻辑也是错误的：

```typescript
// ❌ 错误的注释和逻辑
export const membershipUpgradeScenarioArb = fc.record({
    originalLevelSortOrder: fc.integer({ min: 2, max: 10 }),
    targetLevelSortOrder: fc.integer({ min: 1, max: 9 }),
}).filter(({ originalLevelSortOrder, targetLevelSortOrder }) =>
    // 确保目标级别比原级别高（sortOrder 更小）← 错误的注释
    targetLevelSortOrder < originalLevelSortOrder // ← 错误的逻辑
)
```

**应该修改为**：

```typescript
// ✅ 正确的注释和逻辑
export const membershipUpgradeScenarioArb = fc.record({
    originalLevelSortOrder: fc.integer({ min: 1, max: 9 }),
    targetLevelSortOrder: fc.integer({ min: 2, max: 10 }),
}).filter(({ originalLevelSortOrder, targetLevelSortOrder }) =>
    // 确保目标级别比原级别高（sortOrder 更大）
    targetLevelSortOrder > originalLevelSortOrder
)
```

### sortOrder 的语义

在系统中，sortOrder 的语义应该统一：
- **sortOrder 越大** = 级别越高 = 功能越强大
- 在列表显示时，按 sortOrder 升序排列（基础版 → 专业版 → 旗舰版）

这两个概念不冲突：
- 在列表显示时，按 sortOrder 升序排列（基础版 → 专业版 → 旗舰版）
- 在判断级别高低时，sortOrder 大的级别更高

## 相关文件

- `lexseek/server/services/membership/membershipUpgrade.service.ts` - 会员升级服务（已修复）
- `lexseek/tests/server/membership/test-generators.ts` - 测试生成器（需要修复）
- `lexseek/tests/server/membership/membership-upgrade.test.ts` - 升级测试（需要修复）

## 修改日期

2025-01-XX
