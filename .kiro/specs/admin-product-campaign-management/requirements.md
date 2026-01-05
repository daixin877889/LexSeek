# 需求文档

## 简介

本功能为管理后台添加产品管理和营销管理页面，允许管理员对系统中的商品和营销活动进行完整的 CRUD 操作。产品管理支持会员商品和积分商品两种类型，营销管理支持注册赠送、邀请奖励和活动奖励三种活动类型。

## 术语表

- **Product（产品/商品）**: 系统中可售卖的商品，包括会员商品和积分商品
- **Campaign（营销活动）**: 系统中的促销活动，用于赠送会员或积分
- **Admin_System（管理系统）**: 管理后台系统
- **Product_List_Page（产品列表页）**: 展示所有产品的管理页面
- **Campaign_List_Page（营销活动列表页）**: 展示所有营销活动的管理页面
- **MembershipLevel（会员级别）**: 系统中的会员等级

## 需求

### 需求 1：产品列表展示

**用户故事：** 作为管理员，我希望查看所有产品的列表，以便了解当前系统中的商品情况。

#### 验收标准

1. WHEN 管理员访问产品管理页面 THEN Admin_System SHALL 展示产品列表，包含名称、类型、价格、状态、排序等信息
2. WHEN 产品列表加载中 THEN Admin_System SHALL 显示加载状态指示器
3. WHEN 产品列表为空 THEN Admin_System SHALL 显示空状态提示信息
4. WHEN 管理员点击分页控件 THEN Admin_System SHALL 加载对应页码的产品数据
5. WHEN 管理员选择类型筛选 THEN Admin_System SHALL 仅显示对应类型的产品
6. WHEN 管理员选择状态筛选 THEN Admin_System SHALL 仅显示对应状态的产品

### 需求 2：产品创建

**用户故事：** 作为管理员，我希望创建新的产品，以便向用户提供新的商品选择。

#### 验收标准

1. WHEN 管理员点击新增产品按钮 THEN Admin_System SHALL 打开产品创建对话框
2. WHEN 管理员选择会员商品类型 THEN Admin_System SHALL 显示会员商品相关字段（月度价格、年度价格、关联会员级别等）
3. WHEN 管理员选择积分商品类型 THEN Admin_System SHALL 显示积分商品相关字段（单价、积分数量等）
4. WHEN 管理员提交有效的产品数据 THEN Admin_System SHALL 创建产品并刷新列表
5. IF 管理员提交的产品名称为空 THEN Admin_System SHALL 显示验证错误提示
6. WHEN 产品创建成功 THEN Admin_System SHALL 显示成功提示并关闭对话框

### 需求 3：产品编辑

**用户故事：** 作为管理员，我希望编辑现有产品的信息，以便更新商品配置。

#### 验收标准

1. WHEN 管理员点击编辑按钮 THEN Admin_System SHALL 打开产品编辑对话框并填充现有数据
2. WHEN 管理员修改产品信息并提交 THEN Admin_System SHALL 更新产品并刷新列表
3. WHEN 产品更新成功 THEN Admin_System SHALL 显示成功提示并关闭对话框

### 需求 4：产品状态切换

**用户故事：** 作为管理员，我希望切换产品的上下架状态，以便控制商品的可见性。

#### 验收标准

1. WHEN 管理员点击上架/下架按钮 THEN Admin_System SHALL 切换产品状态
2. WHEN 状态切换成功 THEN Admin_System SHALL 更新列表中的状态显示
3. WHEN 状态切换成功 THEN Admin_System SHALL 显示操作成功提示

### 需求 5：产品删除

**用户故事：** 作为管理员，我希望删除不需要的产品，以便保持商品列表整洁。

#### 验收标准

1. WHEN 管理员点击删除按钮 THEN Admin_System SHALL 显示删除确认对话框
2. WHEN 管理员确认删除 THEN Admin_System SHALL 软删除产品并刷新列表
3. WHEN 产品删除成功 THEN Admin_System SHALL 显示成功提示

### 需求 6：营销活动列表展示

**用户故事：** 作为管理员，我希望查看所有营销活动的列表，以便了解当前的促销活动情况。

#### 验收标准

1. WHEN 管理员访问营销管理页面 THEN Admin_System SHALL 展示营销活动列表，包含名称、类型、赠送内容、时间范围、状态等信息
2. WHEN 营销活动列表加载中 THEN Admin_System SHALL 显示加载状态指示器
3. WHEN 营销活动列表为空 THEN Admin_System SHALL 显示空状态提示信息
4. WHEN 管理员点击分页控件 THEN Admin_System SHALL 加载对应页码的营销活动数据
5. WHEN 管理员选择类型筛选 THEN Admin_System SHALL 仅显示对应类型的营销活动
6. WHEN 管理员选择状态筛选 THEN Admin_System SHALL 仅显示对应状态的营销活动

### 需求 7：营销活动创建

**用户故事：** 作为管理员，我希望创建新的营销活动，以便开展促销活动。

#### 验收标准

1. WHEN 管理员点击新增活动按钮 THEN Admin_System SHALL 打开营销活动创建对话框
2. WHEN 管理员填写活动信息并提交 THEN Admin_System SHALL 创建营销活动并刷新列表
3. IF 管理员提交的活动名称为空 THEN Admin_System SHALL 显示验证错误提示
4. IF 管理员提交的结束时间早于开始时间 THEN Admin_System SHALL 显示验证错误提示
5. WHEN 营销活动创建成功 THEN Admin_System SHALL 显示成功提示并关闭对话框

### 需求 8：营销活动编辑

**用户故事：** 作为管理员，我希望编辑现有营销活动的信息，以便调整活动配置。

#### 验收标准

1. WHEN 管理员点击编辑按钮 THEN Admin_System SHALL 打开营销活动编辑对话框并填充现有数据
2. WHEN 管理员修改活动信息并提交 THEN Admin_System SHALL 更新营销活动并刷新列表
3. WHEN 营销活动更新成功 THEN Admin_System SHALL 显示成功提示并关闭对话框

### 需求 9：营销活动状态切换

**用户故事：** 作为管理员，我希望切换营销活动的启用/禁用状态，以便控制活动的生效状态。

#### 验收标准

1. WHEN 管理员点击启用/禁用按钮 THEN Admin_System SHALL 切换营销活动状态
2. WHEN 状态切换成功 THEN Admin_System SHALL 更新列表中的状态显示
3. WHEN 状态切换成功 THEN Admin_System SHALL 显示操作成功提示

### 需求 10：营销活动删除

**用户故事：** 作为管理员，我希望删除不需要的营销活动，以便保持活动列表整洁。

#### 验收标准

1. WHEN 管理员点击删除按钮 THEN Admin_System SHALL 显示删除确认对话框
2. WHEN 管理员确认删除 THEN Admin_System SHALL 软删除营销活动并刷新列表
3. WHEN 营销活动删除成功 THEN Admin_System SHALL 显示成功提示

### 需求 11：管理后台导航集成

**用户故事：** 作为管理员，我希望通过侧边栏导航访问产品管理和营销管理页面，以便快速进入管理功能。

#### 验收标准

1. THE Admin_System SHALL 在管理后台侧边栏中显示产品管理和营销管理的导航入口
2. WHEN 管理员点击产品管理导航项 THEN Admin_System SHALL 跳转到产品管理页面
3. WHEN 管理员点击营销管理导航项 THEN Admin_System SHALL 跳转到营销管理页面
