# 需求文档

## 简介

管理后台兑换码管理功能，允许管理员生成兑换码、查看兑换码列表和状态、作废兑换码，以及查看兑换记录。兑换码可用于用户兑换会员时长和/或积分。

## 术语表

- **Redemption_Code_Manager**: 兑换码管理系统，负责兑换码的生成、查询、状态管理等功能
- **Admin_User**: 具有管理员权限的用户，可以操作兑换码管理功能
- **Redemption_Code**: 兑换码实体，包含码值、类型、关联会员级别、时长、积分数量、状态等信息
- **Redemption_Record**: 兑换记录实体，记录用户使用兑换码的历史
- **Code_Status**: 兑换码状态，包括有效(1)、已使用(2)、已过期(3)、已作废(4)
- **Code_Type**: 兑换码类型，包括仅会员(1)、仅积分(2)、会员和积分(3)

## 需求

### 需求 1：兑换码列表查询

**用户故事：** 作为管理员，我希望能够查看所有兑换码的列表，以便了解兑换码的整体情况和使用状态。

#### 验收标准

1. WHEN 管理员访问兑换码管理页面 THEN Redemption_Code_Manager SHALL 显示兑换码列表，包含码值、类型、会员级别、时长、积分数量、状态、创建时间等信息
2. WHEN 管理员按状态筛选兑换码 THEN Redemption_Code_Manager SHALL 返回符合筛选条件的兑换码列表
3. WHEN 管理员按兑换码类型筛选 THEN Redemption_Code_Manager SHALL 返回符合类型条件的兑换码列表
4. WHEN 管理员输入兑换码进行搜索 THEN Redemption_Code_Manager SHALL 返回匹配的兑换码
5. WHEN 兑换码列表数据量较大 THEN Redemption_Code_Manager SHALL 支持分页显示

### 需求 2：批量生成兑换码

**用户故事：** 作为管理员，我希望能够批量生成兑换码，以便快速创建多个兑换码用于营销活动或用户奖励。

#### 验收标准

1. WHEN 管理员选择生成仅会员类型的兑换码 THEN Redemption_Code_Manager SHALL 要求填写会员级别和时长，并生成指定数量的兑换码
2. WHEN 管理员选择生成仅积分类型的兑换码 THEN Redemption_Code_Manager SHALL 要求填写积分数量，并生成指定数量的兑换码
3. WHEN 管理员选择生成会员和积分类型的兑换码 THEN Redemption_Code_Manager SHALL 要求填写会员级别、时长和积分数量，并生成指定数量的兑换码
4. WHEN 管理员设置兑换码过期时间 THEN Redemption_Code_Manager SHALL 在生成的兑换码中记录过期时间
5. WHEN 管理员填写备注信息 THEN Redemption_Code_Manager SHALL 在生成的兑换码中记录备注
6. WHEN 生成数量超过 1000 THEN Redemption_Code_Manager SHALL 拒绝请求并提示数量限制
7. WHEN 兑换码生成成功 THEN Redemption_Code_Manager SHALL 返回生成的兑换码列表
8. THE Redemption_Code_Manager SHALL 生成唯一的、格式为 XXXXXXXX-XXXXXXXX 的兑换码

### 需求 3：作废兑换码

**用户故事：** 作为管理员，我希望能够作废未使用的兑换码，以便在兑换码泄露或不再需要时使其失效。

#### 验收标准

1. WHEN 管理员对有效状态的兑换码执行作废操作 THEN Redemption_Code_Manager SHALL 将兑换码状态更新为已作废
2. WHEN 管理员对已使用状态的兑换码执行作废操作 THEN Redemption_Code_Manager SHALL 拒绝操作并提示已使用的兑换码不能作废
3. WHEN 管理员对已作废状态的兑换码执行作废操作 THEN Redemption_Code_Manager SHALL 提示兑换码已经是作废状态
4. WHEN 兑换码作废成功 THEN Redemption_Code_Manager SHALL 更新列表显示最新状态

### 需求 4：兑换记录查询

**用户故事：** 作为管理员，我希望能够查看兑换记录，以便追踪兑换码的使用情况和用户兑换历史。

#### 验收标准

1. WHEN 管理员访问兑换记录页面 THEN Redemption_Code_Manager SHALL 显示兑换记录列表，包含用户信息、兑换码、兑换类型、兑换内容、兑换时间等信息
2. WHEN 管理员按用户搜索兑换记录 THEN Redemption_Code_Manager SHALL 返回该用户的所有兑换记录
3. WHEN 管理员按兑换码搜索兑换记录 THEN Redemption_Code_Manager SHALL 返回使用该兑换码的记录
4. WHEN 兑换记录列表数据量较大 THEN Redemption_Code_Manager SHALL 支持分页显示

### 需求 5：兑换码导出

**用户故事：** 作为管理员，我希望能够按筛选条件导出兑换码，以便进行线下分发或存档。

#### 验收标准

1. WHEN 管理员在兑换码列表页面点击导出按钮 THEN Redemption_Code_Manager SHALL 按当前筛选条件导出兑换码数据
2. WHEN 导出兑换码时 THEN Redemption_Code_Manager SHALL 生成包含码值、类型、会员级别、时长、积分数量、状态、过期时间、备注、创建时间的 CSV 文件
3. WHEN 导出数据量较大 THEN Redemption_Code_Manager SHALL 限制单次导出数量不超过 10000 条
4. WHEN 导出完成 THEN Redemption_Code_Manager SHALL 自动下载生成的 CSV 文件

### 需求 6：权限控制

**用户故事：** 作为系统管理员，我希望兑换码管理功能受到 RBAC 权限控制，以确保只有被授权的用户才能操作。

#### 验收标准

1. WHEN 未登录用户访问兑换码管理 API THEN Redemption_Code_Manager SHALL 返回 401 未授权错误
2. WHEN 用户未被分配兑换码管理相关权限时访问 API THEN Redemption_Code_Manager SHALL 返回 403 禁止访问错误
3. WHEN 用户被分配了兑换码管理权限时访问 API THEN Redemption_Code_Manager SHALL 允许访问并返回相应数据
4. THE Redemption_Code_Manager SHALL 将兑换码管理相关 API 路由注册到系统权限表中，以便通过角色分配权限
