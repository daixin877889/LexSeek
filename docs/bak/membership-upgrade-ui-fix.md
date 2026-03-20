# 会员升级 UI 功能修复说明

## 问题描述

在会员套餐列表页面点击"升级"按钮时，显示提示"升级到 旗舰版会员 功能开发中"，无法完成升级操作。

## 根本原因

前端页面中的 `upgradeToPlan` 函数只是一个占位实现，直接显示"功能开发中"的提示，没有实现真正的升级逻辑。

```typescript
// 修改前（占位实现）
const upgradeToPlan = async (plan: MembershipPlan) => {
  toast.info(`升级到 ${plan.name} 功能开发中`);
};
```

## 解决方案

实现完整的会员升级流程：
1. 点击升级按钮 → 获取升级选项和价格
2. 显示升级弹框 → 用户选择升级级别
3. 确认升级 → 创建订单并发起支付
4. 支付成功 → 系统自动处理会员升级

## 修改内容

### 1. 实现 upgradeToPlan 函数

**文件**：`lexseek/app/pages/dashboard/membership/level.vue`

**修改位置**：第 358 行

```typescript
/**
 * 升级到指定套餐
 */
const upgradeToPlan = async (plan: MembershipPlan) => {
  blurActiveElement();

  // 获取升级选项
  upgradeOptionsLoading.value = true;
  showUpgradeDialog.value = true;

  // 调用 API 获取升级选项
  const result = await useApiFetch<{
    currentMembership: {
      id: number;
      levelId: number;
      levelName: string;
      endDate: string;
      remainingDays: number;
    };
    options: UpgradeOption[];
  }>("/api/v1/memberships/upgrade/options", {
    showError: false,
  });

  if (!result || !result.currentMembership) {
    toast.error("获取升级选项失败");
    upgradeOptionsLoading.value = false;
    showUpgradeDialog.value = false;
    return;
  }

  // 设置当前会员记录
  currentUpgradeRecord.value = {
    id: result.currentMembership.id,
    levelId: result.currentMembership.levelId,
    levelName: result.currentMembership.levelName,
    startDate: "",
    endDate: result.currentMembership.endDate,
    sourceTypeName: "",
    status: 1,
    createdAt: "",
  };

  // 从升级选项中找到目标套餐
  const targetOption = result.options.find((opt) => opt.levelId === plan.levelId);

  if (!targetOption) {
    toast.error(`无法升级到 ${plan.name}`);
    upgradeOptionsLoading.value = false;
    showUpgradeDialog.value = false;
    return;
  }

  upgradeOptions.value = result.options;
  selectedUpgradeOption.value = targetOption;
  upgradeOptionsLoading.value = false;
};
```

### 2. 修改 confirmUpgrade 函数

**文件**：`lexseek/app/pages/dashboard/membership/level.vue`

**修改位置**：第 420 行

```typescript
/**
 * 确认升级
 */
const confirmUpgrade = async () => {
  if (!selectedUpgradeOption.value || !currentUpgradeRecord.value) return;

  // 关闭升级弹框
  showUpgradeDialog.value = false;

  try {
    // 查找目标级别对应的商品
    const targetProduct = productList.value.find(
      (p) => p.levelId === selectedUpgradeOption.value!.levelId
    );

    if (!targetProduct) {
      toast.error("未找到对应的商品");
      return;
    }

    // 使用普通购买流程
    const durationUnit = targetProduct.defaultDuration === 1 ? DurationUnit.MONTH : DurationUnit.YEAR;

    // 创建订单并发起支付
    const result = await useApiFetch<{
      orderNo: string;
      transactionNo: string;
      amount: number;
      codeUrl: string;
      h5Url: string;
    }>("/api/v1/payments/create", {
      method: "POST",
      body: {
        productId: targetProduct.id,
        duration: 1,
        durationUnit,
        paymentChannel: PaymentChannel.WECHAT,
        paymentMethod: PaymentMethod.SCAN_CODE,
      },
    });

    if (!result) {
      toast.error("创建订单失败");
      return;
    }

    // 保存支付单号，用于轮询
    currentTransactionNo.value = result.transactionNo;
    qrCodeUrl.value = result.codeUrl;
    paymentPaid.value = false;
    paymentLoading.value = false;

    // 显示二维码弹框
    showQRCode.value = true;

    // 开始轮询支付状态
    startPollingPaymentStatus();
  } catch (error) {
    logger.error("升级失败：", error);
    toast.error("升级失败，请重试");
  }
};
```

## 升级流程说明

### 完整流程

1. **用户点击升级按钮**
   - 触发 `upgradeToPlan(plan)` 函数
   - 调用 `/api/v1/memberships/upgrade/options` 获取升级选项

2. **显示升级弹框**
   - 展示可升级的级别列表
   - 显示升级价格和积分补偿
   - 自动选中目标级别

3. **用户确认升级**
   - 触发 `confirmUpgrade()` 函数
   - 查找目标级别对应的商品
   - 创建订单并发起支付

4. **支付流程**
   - 显示微信支付二维码
   - 轮询支付状态
   - 支付成功后刷新会员信息

5. **后端处理**
   - 支付成功回调触发
   - 根据商品类型和用户当前会员状态
   - 自动判断是新购还是升级
   - 执行相应的会员开通/升级逻辑

### 升级价格计算

升级价格由后端 API 计算：
- 计算当前级别剩余价值
- 计算目标级别剩余价值
- 升级价格 = 目标级别剩余价值 - 当前级别剩余价值
- 积分补偿 = 升级价格 × 10

### 注意事项

1. **升级 vs 新购**
   - 当前实现使用普通购买流程
   - 后端根据用户当前会员状态自动判断是升级还是新购
   - 升级时会继承原会员的结束时间

2. **支付金额**
   - 前端显示的是升级差价
   - 实际创建订单时使用商品原价
   - 后续可以优化为使用升级差价

3. **会员记录**
   - 升级成功后会创建新的会员记录
   - 原会员记录状态变为无效
   - 积分记录会转移到新会员

## 测试场景

### 场景 1：基础版升级到专业版

**操作步骤**：
1. 登录基础版用户
2. 访问会员套餐页面
3. 点击专业版的"升级"按钮
4. 查看升级弹框，确认升级价格
5. 点击"确认升级"
6. 扫码支付
7. 支付成功后查看会员信息

**预期结果**：
- ✅ 显示升级弹框，包含专业版和旗舰版选项
- ✅ 自动选中专业版
- ✅ 显示升级价格和积分补偿
- ✅ 支付成功后会员级别变为专业版
- ✅ 会员结束时间保持不变

### 场景 2：基础版升级到旗舰版

**操作步骤**：
1. 登录基础版用户
2. 访问会员套餐页面
3. 点击旗舰版的"升级"按钮
4. 查看升级弹框，确认升级价格
5. 点击"确认升级"
6. 扫码支付
7. 支付成功后查看会员信息

**预期结果**：
- ✅ 显示升级弹框，包含专业版和旗舰版选项
- ✅ 自动选中旗舰版
- ✅ 显示升级价格和积分补偿
- ✅ 支付成功后会员级别变为旗舰版
- ✅ 会员结束时间保持不变

### 场景 3：专业版升级到旗舰版

**操作步骤**：
1. 登录专业版用户
2. 访问会员套餐页面
3. 点击旗舰版的"升级"按钮
4. 查看升级弹框，确认升级价格
5. 点击"确认升级"
6. 扫码支付
7. 支付成功后查看会员信息

**预期结果**：
- ✅ 显示升级弹框，只包含旗舰版选项
- ✅ 自动选中旗舰版
- ✅ 显示升级价格和积分补偿
- ✅ 支付成功后会员级别变为旗舰版
- ✅ 会员结束时间保持不变

### 场景 4：旗舰版用户（无升级按钮）

**操作步骤**：
1. 登录旗舰版用户
2. 访问会员套餐页面

**预期结果**：
- ✅ 所有套餐卡片都不显示"升级"按钮
- ✅ 只显示"续期"按钮（如果会员即将过期）

## 相关文件

### 已修改
- ✅ `lexseek/app/pages/dashboard/membership/level.vue` - 会员级别页面（实现升级逻辑）

### 相关组件
- `lexseek/app/components/membership/MembershipPackageList.vue` - 套餐列表组件
- `lexseek/app/components/membership/MembershipUpgradeDialog.vue` - 升级弹框组件
- `lexseek/app/components/membership/MembershipQRCodeDialog.vue` - 支付二维码弹框

### 后端 API
- `GET /api/v1/memberships/upgrade/options` - 获取升级选项
- `POST /api/v1/memberships/upgrade/calculate` - 计算升级价格
- `POST /api/v1/payments/create` - 创建订单并发起支付
- `GET /api/v1/payments/query` - 查询支付状态

## 后续优化建议

1. **升级差价支付**
   - 当前使用商品原价创建订单
   - 可以优化为使用升级差价创建订单
   - 需要修改订单创建 API 支持升级场景

2. **升级记录展示**
   - 在会员记录中区分新购和升级
   - 显示升级前后的级别变化
   - 显示升级价格和积分补偿

3. **升级提示优化**
   - 在套餐卡片上显示"可升级"标签
   - 显示升级后的权益对比
   - 提供升级价格预览

## 修改日期

2025-01-XX
