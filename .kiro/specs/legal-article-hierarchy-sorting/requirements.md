# 需求文档：法律条文层级排序算法

## 简介

本功能为法律条文管理系统提供正确的层级排序算法。系统需要处理复杂的层级结构，包括非层级类型（notice、header、footer、annex）和层级类型（L1-L5），并支持跳级情况（如章直接包含条，没有节）。排序算法需要确保条文按照正确的层级关系和 order 字段进行排序。

## 术语表

- **System**: 法律条文排序系统
- **Article**: 法律条文
- **Hierarchy_Type**: 层级类型，包括 l1（编）、l2（分编）、l3（章）、l4（节）、l5（条）
- **Non_Hierarchy_Type**: 非层级类型，包括 notice（通知）、header（正文头部）、footer（正文尾部）、annex（附件）
- **Top_Level**: 顶层节点，指没有父级的条文
- **Parent_Path**: 父级路径，用于确定条文的归属关系
- **Node_Path**: 节点路径，用于唯一标识条文在层级树中的位置
- **Skip_Level**: 跳级，指层级结构中跳过某一层级的情况（如 L1 直接包含 L3，跳过 L2）
- **Order**: 排序字段，用于在同一层级内确定条文的顺序

## 需求

### 需求 1：非层级类型处理

**用户故事：** 作为系统，我需要正确处理非层级类型的条文，以便它们始终作为顶层节点显示。

#### 验收标准

1. WHEN 条文类型为 notice、header、footer 或 annex，THEN THE System SHALL 将其视为顶层节点
2. WHEN 非层级类型条文排序，THEN THE System SHALL 按照 order 字段排序
3. WHEN 非层级类型条文生成路径键，THEN THE System SHALL 使用其 ID 作为唯一标识
4. WHEN 非层级类型条文计算父级路径，THEN THE System SHALL 返回空字符串

### 需求 2：层级类型识别

**用户故事：** 作为系统，我需要正确识别层级类型的条文，以便确定它们的层级关系。

#### 验收标准

1. WHEN 条文类型为 l1，THEN THE System SHALL 识别为编（最高层级）
2. WHEN 条文类型为 l2，THEN THE System SHALL 识别为分编（第二层级）
3. WHEN 条文类型为 l3，THEN THE System SHALL 识别为章（第三层级）
4. WHEN 条文类型为 l4，THEN THE System SHALL 识别为节（第四层级）
5. WHEN 条文类型为 l5，THEN THE System SHALL 识别为条（第五层级）

### 需求 3：顶层节点自动检测

**用户故事：** 作为系统，我需要自动检测文档的顶层层级类型，以便正确处理不同结构的法律文档。

#### 验收标准

1. WHEN 文档包含 l1 类型条文，THEN THE System SHALL 将 l1 作为顶层层级类型
2. WHEN 文档不包含 l1 但包含 l2，THEN THE System SHALL 将 l2 作为顶层层级类型
3. WHEN 文档不包含 l1 和 l2 但包含 l3，THEN THE System SHALL 将 l3 作为顶层层级类型
4. WHEN 文档不包含 l1、l2 和 l3 但包含 l4，THEN THE System SHALL 将 l4 作为顶层层级类型
5. WHEN 文档不包含 l1、l2、l3 和 l4 但包含 l5，THEN THE System SHALL 将 l5 作为顶层层级类型
6. WHEN 文档只包含非层级类型，THEN THE System SHALL 将非层级类型作为顶层节点

### 需求 4：父级路径计算

**用户故事：** 作为系统，我需要正确计算条文的父级路径，以便确定条文的归属关系。

#### 验收标准

1. WHEN 条文类型为非层级类型，THEN THE System SHALL 返回空字符串作为父级路径
2. WHEN 条文类型为 l1，THEN THE System SHALL 返回空字符串作为父级路径
3. WHEN 条文类型为 l2，THEN THE System SHALL 使用 l1 字段构建父级路径
4. WHEN 条文类型为 l3，THEN THE System SHALL 使用 l1 和 l2 字段构建父级路径
5. WHEN 条文类型为 l4，THEN THE System SHALL 使用 l1、l2 和 l3 字段构建父级路径
6. WHEN 条文类型为 l5，THEN THE System SHALL 使用 l1、l2、l3 和 l4 字段构建父级路径
7. WHEN 父级路径中的字段为 null，THEN THE System SHALL 跳过该字段

### 需求 5：节点路径生成

**用户故事：** 作为系统，我需要为每个条文生成唯一的节点路径，以便在层级树中唯一标识条文。

#### 验收标准

1. WHEN 条文类型为非层级类型，THEN THE System SHALL 使用 `__${type}__${id}` 格式生成节点路径
2. WHEN 条文类型为 l1，THEN THE System SHALL 使用 l1 字段生成节点路径
3. WHEN 条文类型为 l2，THEN THE System SHALL 使用 `${l1}/${l2}` 格式生成节点路径
4. WHEN 条文类型为 l3，THEN THE System SHALL 使用 `${l1}/${l2}/${l3}` 格式生成节点路径
5. WHEN 条文类型为 l4，THEN THE System SHALL 使用 `${l1}/${l2}/${l3}/${l4}` 格式生成节点路径
6. WHEN 条文类型为 l5，THEN THE System SHALL 使用 `${l1}/${l2}/${l3}/${l4}/${l5}` 格式生成节点路径
7. WHEN 节点路径中的字段为 null，THEN THE System SHALL 跳过该字段

### 需求 6：父子关系判断

**用户故事：** 作为系统，我需要正确判断条文之间的父子关系，以便构建正确的层级树。

#### 验收标准

1. WHEN 条文的父级路径与另一条文的节点路径相同，THEN THE System SHALL 判定为父子关系
2. WHEN 条文的父级路径为空，THEN THE System SHALL 判定为顶层节点
3. WHEN 条文的父级路径不匹配任何节点路径，THEN THE System SHALL 判定为孤立节点

### 需求 7：跳级处理

**用户故事：** 作为系统，我需要正确处理跳级情况，以便支持灵活的法律文档结构。

#### 验收标准

1. WHEN l1 类型条文直接包含 l3 类型条文（l2 为 null），THEN THE System SHALL 识别为跳级关系
2. WHEN l3 类型条文直接包含 l5 类型条文（l4 为 null），THEN THE System SHALL 识别为跳级关系
3. WHEN 判断 l1 下的子节点，THEN THE System SHALL 包括 l2 和 l3 类型（l3 的 l2 必须为 null）
4. WHEN 判断 l3 下的子节点，THEN THE System SHALL 包括 l4 和 l5 类型（l5 的 l4 必须为 null）

### 需求 8：同层级排序

**用户故事：** 作为系统，我需要在同一层级内按 order 字段排序，以便保持条文的正确顺序。

#### 验收标准

1. WHEN 多个条文属于同一父级，THEN THE System SHALL 按照 order 字段升序排序
2. WHEN 条文的 order 字段为 null，THEN THE System SHALL 将其视为 0
3. WHEN 多个条文的 order 字段相同，THEN THE System SHALL 保持原有顺序

### 需求 9：深度优先遍历

**用户故事：** 作为系统，我需要使用深度优先遍历构建最终排序列表，以便保持层级结构的完整性。

#### 验收标准

1. WHEN 遍历层级树，THEN THE System SHALL 使用深度优先遍历算法
2. WHEN 访问一个节点，THEN THE System SHALL 先将该节点添加到结果列表
3. WHEN 访问一个节点，THEN THE System SHALL 递归访问其所有子节点
4. WHEN 访问子节点，THEN THE System SHALL 按照 order 字段升序访问

### 需求 10：排序结果正确性

**用户故事：** 作为系统，我需要确保排序结果符合预期，以便用户看到正确的条文顺序。

#### 验收标准

1. WHEN 排序完成，THEN THE System SHALL 确保所有顶层节点在前
2. WHEN 排序完成，THEN THE System SHALL 确保每个节点的子节点紧跟其后
3. WHEN 排序完成，THEN THE System SHALL 确保同层级节点按 order 排序
4. WHEN 排序完成，THEN THE System SHALL 确保所有条文都被包含在结果中
5. WHEN 排序完成，THEN THE System SHALL 确保没有重复的条文

### 需求 11：性能要求

**用户故事：** 作为系统，我需要确保排序算法的性能，以便处理大量条文时不会出现性能问题。

#### 验收标准

1. WHEN 处理 1000 条以内的条文，THEN THE System SHALL 在 100ms 内完成排序
2. WHEN 处理 10000 条以内的条文，THEN THE System SHALL 在 1s 内完成排序
3. WHEN 排序算法执行，THEN THE System SHALL 使用 O(n log n) 或更优的时间复杂度

### 需求 12：错误处理

**用户故事：** 作为系统，我需要优雅地处理异常情况，以便提供稳定的排序功能。

#### 验收标准

1. WHEN 条文数据为空数组，THEN THE System SHALL 返回空数组
2. WHEN 条文数据包含无效类型，THEN THE System SHALL 记录警告并跳过该条文
3. WHEN 条文数据包含循环引用，THEN THE System SHALL 检测并抛出错误
4. WHEN 排序过程中发生异常，THEN THE System SHALL 记录错误日志并返回原始顺序
