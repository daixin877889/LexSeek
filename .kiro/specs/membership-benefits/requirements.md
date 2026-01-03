# 需求文档

## 简介

会员权益管理系统用于管理不同会员级别的权益配置，以及用户的权益记录。本阶段先实现云盘空间权益的管理和校验功能，后续再扩展案件分析相关权益。

## 术语表

- **Benefits**: 系统权益定义表，定义系统中所有可用的权益类型
- **Membership_Benefits**: 会员级别权益关联表，定义每个会员级别拥有的权益及其值
- **User_Benefits**: 用户权益记录表，记录用户实际拥有的权益
- **Benefit_Code**: 权益类型标识码，如 `storage_space`
- **Consumption_Mode**: 权益计算模式，累加型（SUM）或取最大值型（MAX）

## 需求

### 需求 1：权益类型定义

**用户故事：** 作为系统管理员，我希望能够定义系统中的权益类型，以便为不同会员级别配置不同的权益。

#### 验收标准

1. THE Benefits 表 SHALL 包含权益的唯一标识码（code）、名称、描述、单位类型、最小单位、计算模式和默认值字段
2. WHEN 创建权益类型时，THE System SHALL 验证权益标识码的唯一性
3. THE System SHALL 支持云盘空间权益类型：
   - `storage_space`：云盘空间，单位为 Byte，计算模式为累加型（SUM）
4. THE Benefits 表 SHALL 包含 `default_value` 字段，用于定义无会员用户的默认权益值

### 需求 2：会员级别权益配置

**用户故事：** 作为系统管理员，我希望能够为每个会员级别配置不同的权益值，以便区分不同级别会员的服务。

#### 验收标准

1. THE Membership_Benefits 表 SHALL 关联会员级别和权益，并存储该级别对应的权益值
2. WHEN 管理员配置会员权益时，THE System SHALL 允许为同一会员级别配置多个不同的权益
3. THE System SHALL 在后台管理界面提供会员权益配置页面
4. WHEN 保存会员权益配置时，THE System SHALL 验证权益值的有效性（非负数）

### 需求 3：用户权益记录

**用户故事：** 作为系统，我希望能够记录每个用户的权益，以便追踪用户的权益来源和有效期。

#### 验收标准

1. THE User_Benefits 表 SHALL 记录用户ID、权益ID、权益值、来源类型、来源ID、生效时间、过期时间
2. WHEN 用户获得新权益时（购买会员、购买权益包、兑换码等），THE System SHALL 创建对应的用户权益记录
3. WHEN 用户会员到期时，THE System SHALL 将对应的会员权益记录标记为过期
4. THE System SHALL 支持以下权益来源类型：
   - 会员赠送（membership_gift）
   - 权益包购买（benefit_package）
   - 兑换码兑换（redemption_code）
   - 管理员赠送（admin_gift）
   - 系统默认（system_default）

### 需求 4：用户云盘空间权益计算

**用户故事：** 作为用户，我希望系统能够正确计算我当前可用的云盘空间，以便我了解自己的存储额度。

#### 验收标准

1. WHEN 计算用户云盘空间权益时，THE System SHALL 累加（SUM）所有生效中的云盘空间权益记录的权益值
2. IF 用户没有任何会员且没有购买权益包，THEN THE System SHALL 使用权益定义表中的默认值作为用户的云盘空间权益
3. THE System SHALL 只计算当前时间在生效时间和过期时间范围内的权益记录
4. WHEN 查询用户云盘空间使用量时，THE System SHALL 通过聚合 ossFiles 表中该用户的文件大小来计算

### 需求 5：权益单位转换

**用户故事：** 作为用户，我希望系统能够以易读的方式展示我的云盘空间，以便我更好地理解自己的存储额度。

#### 验收标准

1. WHEN 展示云盘空间权益时，THE System SHALL 将 Byte 转换为合适的单位（KB、MB、GB、TB）进行展示
2. THE System SHALL 使用项目中已有的 `formatByteSize` 函数进行单位转换
3. WHEN 存储权益值时，THE System SHALL 统一使用 Byte 作为存储单位

### 需求 6：后台权益管理

**用户故事：** 作为系统管理员，我希望能够在后台管理界面管理权益配置，以便灵活调整系统的权益设置。

#### 验收标准

1. THE System SHALL 提供权益类型管理页面，支持查看、创建、编辑、删除权益类型
2. THE System SHALL 提供会员级别权益配置页面，支持为每个会员级别配置权益值
3. WHEN 编辑权益类型时，THE System SHALL 显示该权益在各会员级别的配置情况
4. THE System SHALL 在权益配置页面提供单位转换提示，帮助管理员正确输入权益值（如输入 GB 自动转换为 Byte）

### 需求 7：用户权益查询 API

**用户故事：** 作为前端开发者，我希望能够通过 API 查询用户的权益信息，以便在界面上展示用户的权益状态。

#### 验收标准

1. THE System SHALL 提供 `GET /api/v1/users/benefits` 接口，返回当前用户的所有有效权益
2. THE System SHALL 在返回的权益信息中包含：权益名称、权益总额、已使用量、剩余量、单位
3. WHEN 查询用户权益时，THE System SHALL 按权益类型分组返回，并计算每种权益的汇总值
4. THE System SHALL 提供 `GET /api/v1/users/benefits/:benefitCode` 接口，返回指定权益类型的详细信息

### 需求 8：权益自动发放

**用户故事：** 作为系统，我希望能够在用户获得会员时自动发放对应的权益，以便用户立即享受会员服务。

#### 验收标准

1. WHEN 用户购买会员或通过兑换码获得会员时，THE System SHALL 自动创建该会员级别对应的所有权益记录
2. THE System SHALL 将会员权益的生效时间设置为会员开始时间，过期时间设置为会员结束时间
3. WHEN 用户会员升级时，THE System SHALL 结算旧会员的权益记录，并创建新会员级别的权益记录
4. IF 用户购买独立的权益包，THEN THE System SHALL 创建独立的权益记录，不受会员状态影响

### 需求 9：云盘上传权益校验

**用户故事：** 作为用户，我希望在上传文件前能够知道是否有足够的存储空间，以便避免上传失败。

#### 验收标准

1. WHEN 用户请求生成上传签名时，THE System SHALL 校验用户的云盘空间权益是否足够容纳待上传的文件
2. THE System SHALL 计算用户当前已使用空间（ossFiles 表聚合）和权益总额（user_benefits 表聚合）
3. IF 已使用空间 + 待上传文件大小 > 权益总额，THEN THE System SHALL 拒绝生成上传签名并返回错误信息
4. THE System SHALL 在错误信息中包含：当前已使用空间、权益总额、剩余可用空间、待上传文件大小
5. THE System SHALL 将错误信息中的空间大小转换为易读的单位格式（如 "已使用 1.5 GB / 总共 5 GB"）

### 需求 10：云盘空间页面展示

**用户故事：** 作为用户，我希望在云盘空间页面能够直观地看到我的存储空间使用情况，以便了解剩余可用空间。

#### 验收标准

1. THE System SHALL 在 `/dashboard/disk-space` 页面顶部展示云盘空间使用概览
2. THE System SHALL 展示已使用空间，格式为易读的单位（如 "1.5 GB"）
3. THE System SHALL 展示总容量，格式为易读的单位（如 "5 GB"）
4. THE System SHALL 展示使用率进度条，进度条长度与使用率成正比
5. THE System SHALL 展示使用率百分比（如 "30%"）
6. WHEN 使用率超过 80% 时，THE System SHALL 将进度条颜色变为警告色（黄色）
7. WHEN 使用率超过 95% 时，THE System SHALL 将进度条颜色变为危险色（红色）
8. THE System SHALL 在页面加载时调用权益查询 API 获取最新的空间使用数据
