---
name: litigation-visualization
description: 诉讼可视化 skill，提供案件事实图和法律关系图的可视化分析，使用 Mermaid 生成图表代码块
---

# 诉讼可视化 Skill

## 概述

诉讼可视化是将复杂的法律事实和法律关系，用简单明了的图表方式呈现出来，帮助法官和客户更好地理解诉讼诉求的一种工作方法。

---

## 核心方法论

### 一、两张图工作法

**基础框架**：每个案件至少应画两张核心图表：

| 图表类型 | 核心要素 | 表达重点 | 呈送对象 |
|---------|---------|---------|---------|
| 案件事实图 | 时间 | 客观事实 | 法官为主 |
| 法律关系图 | 关系 | 法律分析 | 客户、团队为主 |

**注意**：两张图是基础框架，不是上限。根据案情复杂程度，可以增加其他图表：
- 交易流程图（Flowchart）
- 多方交互序列图（Sequence）
- 股权架构图（Graph）
- 工程进度图（Gantt）
- 证据思维导图（Mindmap）
- 状态变化图（StateDiagram）

当案件涉及多个维度时，应主动建议用户增加相应的图表。

#### 案件事实图

**定义**：以时间线为基础，客观、真实地反映案件中各主体行为、事件发生先后顺序及相互关系。

**主要特点**：
1. 客观性：以客观事实为基础，避免主观判断
2. 时间导向：以时间轴为核心框架
3. 行为主体分层：将不同主体的行为在空间上区分开来
4. 关键事实突出：突出与案件争议相关的核心事实

**适用场景**：
- 事件发生的先后顺序对案件定性有重要影响
- 需要梳理复杂的程序性事实
- 需要对比不同主体在同一时间段的行为
- 需要展示时间区间概念（保证期间、诉讼时效等）

#### 法律关系图

**定义**：以主体间的关系为核心，反映各方当事人在法律层面上的权利义务关系、交易结构、股权架构等。

**主要特点**：
1. 关系导向：以主体间的关系为表达核心
2. 结构化：通过图表结构体现关系性质
3. 主观观点融入：可融入对案件的法律分析和论证
4. 逻辑清晰：通过箭头、连线等表达关系方向和性质

**适用场景**：
- 案件主体数量较多（三个以上）
- 各主体之间的法律关系复杂
- 关系本身是案件的争议焦点
- 需要展示交易结构、股权架构

#### 两张图的配合使用

**制作顺序**：
1. 先画案件事实图：客观梳理事实，确保准确性
2. 后画法律关系图：在事实基础上进行法律分析
3. 交叉验证：两张图应相互印证，避免矛盾

**配色一致性**：两张图中相同主体应使用相同颜色，相同类型的行为或关系应使用相同的颜色编码。

---

### 二、图表说话原则

"用图表说话"是诉讼可视化的核心理念，即通过图表本身的结构、设计和布局，让图表直接传达核心观点。

#### 实现方式

| 方式 | 说明 | 示例 |
|-----|------|------|
| 结构说话 | 通过整体结构体现论证思路 | 闭环结构展示融资性贸易特征 |
| 位置说话 | 通过元素位置体现重要性 | 核心争议置于视觉中心 |
| 线条说话 | 通过线条类型表达含义 | 实线=确定关系，虚线=待证事实 |
| 颜色说话 | 通过颜色编码传递信息和情感 | 红色=违约/争议，绿色=正常履行 |

#### 突出观点的方法

- **位置突出**：核心观点置于视觉中心或显著位置
- **大小突出**：放大核心元素，缩小次要元素
- **颜色突出**：醒目颜色标注核心内容
- **线条突出**：核心关系用粗线，次要关系用细线
- **框线突出**：用框线圈出核心内容

---

### 三、良性循环价值

诉讼可视化构建律师与法官之间的良性循环：

```
律师运用图表充分说理 → 法官理解并认可 → 律师获得正向反馈 → 更投入钻研诉讼技术 → 法官期待更多专业律师
```

**核心启示**：
- 改变从自己开始，不要等待环境改变
- 专业能力和专业态度是建立信任的基础
- 诉讼技术比想象中更有影响力

---

## 图表选择决策指南

### 一、核心要素判断

根据案件核心要素选择图表类型：

| 核心要素 | 推荐图表 | 说明 |
|---------|---------|------|
| 时间 | Timeline、Gantt | 关键事件的时间点或先后顺序 |
| 关系 | Graph、Flowchart | 法律关系、交易结构、股权架构 |
| 数据 | 表格/图表 | 金额、数量等数据对比（非Mermaid） |
| 流程 | Flowchart、Sequence | 程序性事项、交互过程 |
| 状态 | StateDiagram | 法律状态变化、条件触发 |
| 证据/思路 | Mindmap | 证据整理、分析框架 |

### 二、呈送对象判断

不同呈送对象的图表选择：

| 呈送对象 | 推荐图表 | 内容侧重 | 注意事项 |
|---------|---------|---------|---------|
| 法官 | 案件事实图优先 | 客观事实、有利证据 | 保持客观，避免主观评价 |
| 客户 | 法律关系图优先 | 完整事实、法律分析、策略 | 让客户理解律师价值 |
| 团队内部 | 两张图并用 | 尽量翔实、标注待核实信息 | 全面性优先 |

### 三、案件类型推荐表

| 案件类型 | 推荐图表组合 | 说明 |
|----------|--------------|------|
| 借款合同纠纷 | Timeline + Graph | 展示借款期限、还款节点、担保关系 |
| 买卖合同纠纷 | Timeline + Flowchart | 展示履约时间节点、违约流程 |
| 担保合同纠纷 | Graph + Flowchart | 展示三方担保关系、保证责任认定路径 |
| 融资性贸易 | Graph + Mindmap | 展示贸易闭环结构、法律关系分析 |
| 建设工程纠纷 | Gantt + Graph | 展示工程进度、合同关系 |
| 股权转让纠纷 | Graph + Mindmap | 展示股权结构、交易流程 |
| 对赌协议纠纷 | Timeline + Flowchart | 展示投资对赌时间线、效力认定路径 |
| 公司决议纠纷 | Flowchart + Timeline | 展示决议效力认定、除斥期间 |
| 劳动争议 | Timeline + StateDiagram | 展示劳动关系变化状态 |
| 执行异议 | Flowchart + Sequence | 展示执行异议流程、交互过程 |

### 四、决策流程

**重要**：如果用户明确说出"思维导图"，直接使用 `flowchart LR` 树状结构（兼容性最好，所有 Mermaid 渲染器都支持），无需走决策流程。

```
用户输入案情
    │
    ├─ 用户明确说了"思维导图"？
    │   └─ 是 → 使用 flowchart LR 树状结构（默认）
    │           仅在用户明确说"用原生 mindmap 格式"时才用 mindmap 类型
    │
    ├─ 主体数量 ≥ 3？
    │   └─ 是 → 关系图（Graph）
    │
    ├─ 涉及时间序列/先后顺序？
    │   └─ 是 → Timeline 或 Gantt
    │
    ├─ 涉及程序流转/决策分支？
    │   └─ 是 → 流程图（Flowchart）
    │
    ├─ 涉及多方交互/时序？
    │   └─ 是 → 序列图（Sequence）
    │
    ├─ 涉及状态变化？
    │   └─ 是 → 状态图（StateDiagram）
    │
    └─ 需要梳理证据/思路？
        └─ 是 → 思维导图（Mindmap）
```

**思维导图的独立触发逻辑**：

当用户明确使用以下表达时，**使用 `flowchart LR`（或 `flowchart TD`）树状结构来模拟思维导图**，因为原生 `mindmap` 类型在 GitHub、多数文档平台和 Markdown 编辑器中不支持渲染，会导致图表完全不可见：

- "画一个思维导图" → flowchart LR 树状结构
- "帮我用思维导图梳理一下 XX" → flowchart LR 树状结构
- "做个 XX 的思维导图" → flowchart LR 树状结构
- "用导图展示" → flowchart LR 树状结构
- "XX 的证据导图" → flowchart LR 树状结构

**仅在用户明确说"用 Mermaid 原生 mindmap 格式"或"用 mindmap 语法"时**，才使用 `mindmap` 类型。

**用 flowchart 模拟思维导图的结构特征**：
- 只有一个中心根节点，用圆角矩形 `()` 包裹，置于最左（LR）或最顶（TD）
- 从根节点用 `---` 连线连接到一级分支节点
- 一级分支用箭头 `-->` 连接到子节点
- 用颜色区分不同分支，但中心根节点用最深色突出

**模板：flowchart 模拟思维导图（推荐）**：
```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E8F0FE',
  'primaryTextColor': '#333333',
  'lineColor': '#1C3A5E'
}}}%%
flowchart LR
    ROOT(中心主题):::root

    ROOT --- A(分支A):::branchA
    ROOT --- B(分支B):::branchB
    ROOT --- C(分支C):::branchC

    A --> A1(子项A1):::leaf
    A --> A2(子项A2):::leaf
    B --> B1(子项B1):::leaf
    B --> B2(子项B2):::leaf
    C --> C1(子项C1):::leaf
    C --> C2(子项C2):::leaf

    classDef root fill:#1C3A5E,stroke:#0F2440,color:#FFFFFF,stroke-width:3px
    classDef branchA fill:#4A90E2,stroke:#2E5C8A,color:#FFFFFF,stroke-width:2px
    classDef branchB fill:#50C878,stroke:#2E7D32,color:#FFFFFF,stroke-width:2px
    classDef branchC fill:#F39C12,stroke:#B7950B,color:#FFFFFF,stroke-width:2px
    classDef leaf fill:#F8F9FA,stroke:#BDC3C7,color:#333333,stroke-width:1px
```

---

## 制作方法论

### 三步法

#### 第一步：收集素材

**全面罗列**：将所有可能相关的信息先罗列出来，不要急于筛选。

罗列内容包括：
- 当事人的所有行为和事件
- 时间节点
- 涉及的金额、数量等数据
- 相关法律规定和司法解释

**注意**：暂时不判断信息重要性，先罗列再说。

#### 第二步：设计结构

**逻辑整合**：按照一定逻辑对信息归类整理。

整合方式：
- 按时间顺序整合：适用于时间要素重要的案件
- 按主体分类整合：适用于主体较多的案件
- 按事件性质整合：如"申请行为"和"裁判行为"
- 按争议焦点整合：围绕核心争议组织信息

**图表结构设计**：

**时间图结构**：
- 确定时间轴方向（横向或纵向）
- 纵向划分：表达对比关系或行为分层
- 横向划分：用括号/箭头/颜色变换表达时间区间

**关系图结构**：
- 以主体为节点
- 用箭头表示关系方向（资金流向、权利义务方向）
- 通过连线标注关系性质
- 保持布局均衡，避免交叉混乱

#### 第三步：确定配色

**配色原则**：
1. 主体区分：不同主体使用不同颜色
2. 突出重点：关键内容使用醒目颜色
3. 表达情感：争议/违约用警示色（红色），正常履行用安全色（绿色/蓝色）
4. 保持一致性：同一案件中多张图表配色一致
5. 色彩限制：不超过 5-6 种主色
6. **禁止使用深黑色或深灰色作为填充背景色**：确保黑色文字清晰可读

**禁止使用的背景色**：
- 深黑色：#1A1A1A, #2C2C2C, #333333, #1C1C1C, #0D0D0D, #000000
- 深灰色：#2C3E50, #34495E, #3D3D3D, #4A4A4A, #505050, #595959

**推荐替代颜色**：
- 深蓝替代 → 天蓝 #4A90E2 或 浅蓝 #5DADE2
- 深灰替代 → 浅灰 #B0BEC5 或 淡灰 #CFD8DC

---

## Mermaid 图表类型指南

### 一、Timeline（时间线图）

**适用场景**：
- 核心要素为时间的案件
- 事件先后顺序对案件定性有重要影响
- 需要梳理程序性事实

**语法**：
```mermaid
timeline
    title 图表标题
    section 阶段名称
        事件描述
        事件描述
```

**模板**：
```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E6F3FF',
  'primaryTextColor': '#000000'
}}}%%
timeline
    title 案件事实时间线
    section 第一阶段
        事件A : 关键事实描述
        事件B : 关键事实描述
    section 第二阶段
        事件C : 关键事实描述
        事件D : 关键事实描述
```

**设计要点**：
- 时间轴清晰易读
- 事件位置准确反映时间关系
- 用 section 进行阶段划分
- 颜色区分不同性质的事件
- **文字长度控制**：事件描述控制在10字以内，过长会导致底部文字重叠超出色块
- **事件数量控制**：每个 section 事件不超过4个，过多会造成布局拥挤
- **分拆建议**：若事件过多，建议分拆为多张时间线图（如"签约阶段时间线"、"履约阶段时间线"）

**Timeline 文字重叠的解决方案**：
```
❌ 避免写法（文字过长，底部重叠）：
    2024-01-01 : 签订买卖合同约定标的物100台交货期限60天违约责任为双倍返还定金

✅ 推荐写法（简洁，分拆）：
    2024-01-01 : 签订买卖合同（标的100台）
    2024-01-01 : 约定交货期限60天

✅ 或分拆为多张图：
    第一张图：签约阶段时间线
    第二张图：履约阶段时间线
```

---

### 二、Gantt（甘特图）

**适用场景**：
- 需要展示时间区间（合同履行期限、保证期间）
- 需要展示进度和阶段
- 建设工程、长期合同等案件

**语法**：
```mermaid
gantt
    title 图表标题
    dateFormat  YYYY-MM-DD
    section 阶段
        任务名称 :a1, 2024-01-01, 10d
        任务名称 :a2, after a1, 5d
```

**模板**：
```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E6F3FF',
  'primaryTextColor': '#000000',
  'sectionBkgColor': '#4A90E2',
  'altSectionBkgColor': '#50C878'
}}}%%
gantt
    title 合同履行进度
    dateFormat  YYYY-MM-DD
    
    section 签约阶段
    签订合同     :sign, 2024-01-01, 1d
    
    section 履约阶段
    甲方付款     :pay1, after sign, 5d
    乙方交货     :deliver, after pay1, 10d
    
    section 验收阶段
    验收确认     :accept, after deliver, 3d
```

**时间区间表达技巧**：
- 用不同颜色区分不同性质的时间段
- 用 milestone 标注关键时间节点
- 用依赖关系（after）表达先后顺序

---

### 三、Graph（关系图）

**适用场景**：
- 案件主体数量较多（≥3）
- 法律关系复杂
- 关系本身是争议焦点
- 需要展示交易结构、股权架构

**语法**：
```mermaid
flowchart TD
    A[主体A]:::styleA
    B[主体B]:::styleB
    A -->|关系类型| B
    
    classDef styleA fill:#颜色,stroke:#边框色,color:#000000,stroke-width:2px
```

**模板**：
```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E3F2FD',
  'primaryTextColor': '#000000',
  'primaryBorderColor': '#2196F3',
  'lineColor': '#757575'
}}}%%
flowchart TD
    A[主体A]:::partyA
    B[主体B]:::partyB
    C[合同/文件]:::contract
    
    A -->|权利义务| C
    B -->|权利义务| C
    A -->|资金流向| B
    
    classDef partyA fill:#4A90E2,stroke:#2E5C8A,color:#000000,stroke-width:3px
    classDef partyB fill:#50C878,stroke:#2E7D32,color:#000000,stroke-width:3px
    classDef contract fill:#B0BEC5,stroke:#7F8C8D,color:#000000,stroke-width:2px,stroke-dasharray: 5 5
```

**关系要素表达**：

| 元素 | 表达方式 | 说明 |
|-----|---------|------|
| 主体节点 | 矩形/圆形 | 不同颜色区分主体性质 |
| 关系连线 | 实线/虚线 | 实线=确定关系，虚线=待证事实 |
| 连线粗细 | 粗/细 | 粗线=主要关系，细线=次要关系 |
| 箭头方向 | 指向 | 资金流向、权利方向、控制方向 |

**设计要点**：
- 核心主体置于中心位置
- 避免连线交叉过多
- 保持视觉平衡
- 标注关系性质和关键细节

---

### 四、Flowchart（流程图）

**适用场景**：
- 程序性事项说明（再审流程、执行异议流程）
- 多种路径选择展示
- 决策过程展示
- 不需要具体时间节点的事项

**语法**：
```mermaid
flowchart TD
    A[开始]:::start
    B{决策点}:::decision
    C[结果A]:::resultA
    D[结果B]:::resultB
    
    A --> B
    B -->|条件A| C
    B -->|条件B| D
    
    classDef start fill:#颜色,stroke:#边框色,color:#000000
```

**模板**：
```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E6F3FF',
  'primaryTextColor': '#000000',
  'primaryBorderColor': '#007AFF',
  'lineColor': '#666666'
}}}%%
flowchart TD
    A[合同签订]:::start
    B{是否违约?}:::decision
    C[正常履行完毕]:::normal
    D[违约发生]:::alert
    E[解除合同]:::stop
    F[赔偿损失]:::stop
    
    A --> B
    B -->|否| C
    B -->|是| D
    D --> E
    D --> F
    
    classDef start fill:#007AFF,stroke:#0056b3,color:#000000,stroke-width:3px
    classDef decision fill:#FFB84D,stroke:#e68a00,color:#000000,stroke-width:2px
    classDef normal fill:#50C878,stroke:#2e7d32,color:#000000,stroke-width:2px
    classDef alert fill:#FF6B6B,stroke:#c92a2a,color:#000000,stroke-width:3px
    classDef stop fill:#FFB84D,stroke:#e68a00,color:#000000,stroke-width:2px
```

**设计要点**：
- 给不熟悉领域的人看，要简单易懂
- 统一入口、根据不同情形分支
- 避免过于复杂，不要展示过多分支
- 用颜色区分不同性质的结果

---

### 五、Sequence（序列图）

**适用场景**：
- 多方交互过程展示
- 程序流转、时序关系
- 诉讼程序各阶段交互

**语法**：
```mermaid
sequenceDiagram
    participant A as 主体A
    participant B as 主体B
    
    A->>B: 动作描述
    B-->>A: 回应描述
```

**模板**：
```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E8F5E9',
  'primaryTextColor': '#000000',
  'primaryBorderColor': '#4CAF50',
  'noteBkgColor': '#FFF9C4',
  'noteBorderColor': '#FBC02D',
  'noteTextColor': '#000000'
}}}%%
sequenceDiagram
    participant 原告
    participant 被告
    participant 法院
    
    原告->>被告: 发送催告函
    被告-->>原告: 拒不履行
    原告->>法院: 提起诉讼
    法院->>被告: 送达起诉状
    被告-->>法院: 提交答辩状
    法院->>法院: 开庭审理
    法院->>原告: 宣布判决
    法院->>被告: 宣布判决
```

**箭头类型**：
- `->>`：实线箭头（请求/动作）
- `-->>`：虚线箭头（回应/返回）
- `->`：实线无箭头（单向通知/无返回）

---

### 六、StateDiagram（状态图）

**适用场景**：
- 法律状态变化展示
- 条件触发关系
- 合同履行状态变化
- 劳动关系状态变化

**语法**：
```mermaid
stateDiagram-v2
    [*] --> 初始状态
    状态A --> 状态B : 触发条件
    状态B --> [*]
```

**模板**：
```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E1F5FE',
  'primaryTextColor': '#000000',
  'primaryBorderColor': '#03A9F4'
}}}%%
stateDiagram-v2
    [*] --> 合同有效
    合同有效 --> 履行中 : 签订合同
    合同有效 --> 合同无效 : 违反强制性规定
    履行中 --> 正常履行 : 按约履行
    履行中 --> 违约 : 一方违约
    正常履行 --> 合同终止 : 履行完毕
    违约 --> 解除合同 : 解除条件成就
    解除合同 --> 合同终止
    合同终止 --> [*]
    合同无效 --> [*]
```

---

### 七、Mindmap（思维导图）

**重要**：当用户说"思维导图"时，**默认使用 `flowchart LR` 树状结构**，而非原生 `mindmap` 类型。原因：
- 原生 `mindmap` 在 GitHub、Confluence、多数 Markdown 编辑器、部分法院电子诉讼平台中**完全不渲染**，图表会直接消失
- `flowchart` 树状结构在所有 Mermaid 渲染器中都稳定支持，视觉上同样可以实现思维导图的层级效果
- 律师制作的图表最终要嵌入代理词、答辩状等正式文书，兼容性优先

仅在用户明确说"用 Mermaid 原生 mindmap 格式"时才使用原生 `mindmap`。

**适用场景**：
- **用户明确说"思维导图"或"导图"时 → 使用 `flowchart LR` 树状结构**
- 证据整理和分类
- 案件分析框架梳理
- 法律争议要点归纳
- 案情要素分层展示
- 法律关系多维度分析

**思维导图 vs 其他图表的区别**：
| 特征 | 思维导图（flowchart 模拟） | Graph/Flowchart 关系图 |
|-----|-------------------------|-----------------|
| 结构 | 单根节点，放射状分支 | 多节点，网状/流向连接 |
| 节点关系 | 层级包含（`---` 连分支，`-->` 连叶子） | 箭头/连线关系 |
| 适用场景 | 思路梳理、知识整理 | 主体关系、流程展示 |
| 视觉特点 | 树状展开、层次清晰 | 网络结构、路径展示 |

---

#### A. 用 flowchart 模拟思维导图（默认方案）

**设计原则**：
- 中心节点用圆角矩形 `()` 包裹，置于最左（LR）或最顶（TD）
- 中心节点用 `---` 无箭头连线连接一级分支（表示从属关系）
- 一级分支用 `-->` 箭头连接到子节点和叶子节点
- 中心节点用最深色突出，不同分支用不同颜色区分

**模板：案件全景图（LR 横向布局）**：
```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E8F0FE',
  'primaryTextColor': '#333333',
  'lineColor': '#1C3A5E'
}}}%%
flowchart LR
    ROOT(案件全景图):::root

    ROOT --- A(基本信息):::branch1
    ROOT --- B(案件事实):::branch2
    ROOT --- C(法律关系):::branch3
    ROOT --- D(争议焦点):::branch4
    ROOT --- E(证据情况):::branch5

    A --> A1["案号"]:::leaf
    A --> A2["审理法院"]:::leaf
    A --> A3["当事人"]:::leaf
    B --> B1["签约阶段"]:::leaf
    B --> B2["履约阶段"]:::leaf
    B --> B3["争议发生"]:::leaf
    C --> C1["主体关系"]:::leaf
    C --> C2["权利义务"]:::leaf
    D --> D1["主要争议"]:::leaf
    D --> D2["次要争议"]:::leaf
    E --> E1["核心证据"]:::leaf
    E --> E2["待补证据"]:::leaf

    classDef root fill:#1C3A5E,stroke:#0F2440,color:#FFFFFF,stroke-width:3px
    classDef branch1 fill:#4A90E2,stroke:#2E5C8A,color:#FFFFFF,stroke-width:2px
    classDef branch2 fill:#50C878,stroke:#2E7D32,color:#FFFFFF,stroke-width:2px
    classDef branch3 fill:#F39C12,stroke:#B7950B,color:#FFFFFF,stroke-width:2px
    classDef branch4 fill:#E74C3C,stroke:#A93226,color:#FFFFFF,stroke-width:2px
    classDef branch5 fill:#9B59B6,stroke:#7D3C98,color:#FFFFFF,stroke-width:2px
    classDef leaf fill:#F8F9FA,stroke:#BDC3C7,color:#333333,stroke-width:1px
```

**模板：案件全景图（TD 纵向布局，适合分支较少的情况）**：
```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E8F0FE',
  'primaryTextColor': '#333333',
  'lineColor': '#1C3A5E'
}}}%%
flowchart TD
    ROOT(争议焦点分析):::root

    ROOT --- A(合同效力争议):::branch1
    ROOT --- B(违约责任争议):::branch2
    ROOT --- C(损害赔偿争议):::branch3

    A --> A1["合同是否有效"]:::leaf
    A --> A2["是否已合法解除"]:::leaf
    B --> B1["违约金标准"]:::leaf
    B --> B2["违约金起算日"]:::leaf
    C --> C1["损失范围认定"]:::leaf
    C --> C2["因果关系"]:::leaf

    classDef root fill:#1C3A5E,stroke:#0F2440,color:#FFFFFF,stroke-width:3px
    classDef branch1 fill:#E74C3C,stroke:#A93226,color:#FFFFFF,stroke-width:2px
    classDef branch2 fill:#F39C12,stroke:#B7950B,color:#FFFFFF,stroke-width:2px
    classDef branch3 fill:#4A90E2,stroke:#2E5C8A,color:#FFFFFF,stroke-width:2px
    classDef leaf fill:#F8F9FA,stroke:#BDC3C7,color:#333333,stroke-width:1px
```

**分支节点文本含特殊字符时**（如括号、冒号），叶子节点用 `["..."]` 双引号包裹，分支节点避免放特殊字符。

---

#### B. 原生 Mindmap（仅在用户明确指定时使用）

**语法**：
```mermaid
mindmap
  root((中心主题))
    分支A
      子项1
      子项2
    分支B
      子项1
```

```
兼容性提醒：
原生 mindmap 在以下环境不支持渲染：
  - GitHub README / Issues / PR
  - 部分 Markdown 编辑器（Typora 旧版本等）
  - 部分法院电子诉讼平台
  - Confluence（需额外插件）

如果用户需要在上述环境中使用，建议改用 flowchart 模拟方案。
```

---

## 配色系统

### 一、标准配色方案

#### 主体色

| 角色 | 颜色名称 | 色值 | 用途 |
|-----|---------|------|------|
| 权利人/债权人/己方 | 蓝色 | #4A90E2 | 出借人、买方、原告等 |
| 义务人/债务人/对方 | 绿色 | #50C878 | 借款人、卖方、被告等 |
| 第三人/担保人 | 橙色 | #F39C12 | 保证人、担保人、第三人 |
| 政府/机关 | 蓝紫 | #9B59B6 | 法院、行政机关 |

#### 行为色

| 行为性质 | 颜色名称 | 值 | 用途 |
|---------|---------|------|------|
| 正常履行 | 浅蓝 | #E6F3FF | 合规行为 |
| 违约/争议 | 红色 | #FF6B6B | 违约行为、争议事项 |
| 待定/待证 | 黄色 | #FFF3CD | 待证事实、待定状态 |
| 关键节点 | 深蓝 | #007AFF | 关键时间点、关键行为 |

#### 文件/状态色

| 类型 | 颜色名称 | 色值 | 用途 |
|-----|---------|------|------|
| 合同/文件 | 浅灰 | #B0BEC5 | 合同、协议、判决书等 |
| 背景信息 | 浅灰 | #F5F5F5 | 次要内容、背景信息 |
| 完成/结束 | 灰蓝 | #607D8B | 终止状态、完成状态 |

---

### 二、线条样式规范

| 线条类型 | 语法 | 用途 |
|---------|------|------|
| 实线箭头 | `-->` | 确定的关系、确定的行为 |
| 虚线箭头 | `-.->` | 潜在关系、待证事实 |
| 无箭头连线 | `---` | 平行关系、关联关系 |
| 粗线 | `stroke-width:3px` | 主要关系、重点内容 |
| 细线 | `stroke-width:1px` | 次要关系、辅助内容 |

---

### 三、色盲友好方案

为色盲用户提供形状区分替代方案：

| 角色 | 形状 | 备注 |
|-----|------|------|
| 权利人 | 圆角矩形 | `([内容])` |
| 义务人 | 矩形 | `[内容]` |
| 第三人 | 圆形 | `((内容))` |
| 合同/文件 | 虚线框 | `stroke-dasharray: 5 5` |

---

### 四、classDef 快速定义模板

```mermaid
classDef partyA fill:#4A90E2,stroke:#2E5C8A,color:#000000,stroke-width:3px
classDef partyB fill:#50C878,stroke:#2E7D32,color:#000000,stroke-width:3px
classDef partyC fill:#F39C12,stroke:#B7950B,color:#000000,stroke-width:3px
classDef contract fill:#B0BEC5,stroke:#7F8C8D,color:#000000,stroke-width:2px,stroke-dasharray: 5 5
classDef alert fill:#FF6B6B,stroke:#C0392B,color:#000000,stroke-width:3px
classDef normal fill:#E6F3FF,stroke:#007AFF,color:#000000,stroke-width:2px
```

---

## 典型案件可视化模板

### 一、借款合同纠纷

#### 案情特征
- 借款期限、还款节点明确
- 可能涉及担保关系
- 利息计算是常见争议

#### 推荐图表组合
- Timeline：展示借款发放、还款、逾期时间线
- Graph：展示借款人、出借人、担保人关系

#### Timeline 示例

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E6F3FF',
  'primaryTextColor': '#000000'
}}}%%
timeline
    title 张三诉李四借款合同纠纷时间线
    section 合同签订
        2023-01-01 : 签订借款合同（本金100万元）
        2023-01-01 : 签订保证合同（连带责任）
    section 履行过程
        2023-01-05 : 出借人放款100万元
        2023-06-01 : 借款人付息（按期支付）
        2023-12-01 : 借款人付息（逾期未付）
    section 催收与诉讼
        2024-01-15 : 出借人发送催收函
        2024-02-01 : 借款人承诺还款但未履行
        2024-03-01 : 出借人提起诉讼
```

#### Graph 示例

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E3F2FD',
  'primaryTextColor': '#000000',
  'lineColor': '#757575'
}}}%%
flowchart TD
    A[张三（出借人）]:::creditor
    B[李四（借款人）]:::borrower
    C[王五（保证人）]:::guarantor
    D[借款合同：本金100万/年利率12%]:::contract
    E[保证合同：连带责任保证]:::contract
    
    A --出借本金--> D
    B --借款--> D
    C --提供担保--> E
    E -.担保主债权.-> D
    
    classDef creditor fill:#4A90E2,stroke:#2E5C8A,color:#000000,stroke-width:3px
    classDef borrower fill:#E74C3C,stroke:#A93226,color:#000000,stroke-width:3px
    classDef guarantor fill:#F39C12,stroke:#B7950B,color:#000000,stroke-width:3px
    classDef contract fill:#B0BEC5,stroke:#7F8C8D,color:#000000,stroke-width:2px,stroke-dasharray: 5 5
```

---

### 二、买卖合同纠纷

#### 案情特征
- 交货与付款的双务关系
- 履约时间节点明确
- 违约责任认定是常见争议

#### 推荐图表组合
- Timeline：展示合同签订、交货、付款、违约时间线
- Flowchart：展示违约认定流程和后果

#### Timeline 示例

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E6F3FF',
  'primaryTextColor': '#000000'
}}}%%
timeline
    title 买卖合同纠纷案件事实
    section 合同签订
        2024-01-01 : 签订买卖合同（标的物100台）
        2024-01-01 : 约定交货期限60天
    section 履约过程
        2024-01-05 : 买方支付首付款30%
        2024-02-15 : 卖方开始生产
        2024-03-01 : 卖方应交货（到期）
        2024-03-20 : 卖方实际交货（逾期20天）
        2024-03-25 : 买方验收发现质量问题
    section 争议处理
        2024-04-01 : 买方发函要求退货退款
        2024-04-15 : 卖方拒绝退款
        2024-05-01 : 买方提起诉讼
```

#### Flowchart 示例（违约认定）

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E6F3FF',
  'primaryTextColor': '#000000',
  'lineColor': '#666666'
}}}%%
flowchart TD
    A[合同签订]:::start
    B{卖方是否按期交货?}:::decision
    C[正常履行]:::normal
    D[逾期交货]:::alert
    E{货物是否符合质量约定?}:::decision
    F[买方付款验收]:::normal
    G[质量违约]:::alert
    H[买方主张违约责任]:::action
    
    A --> B
    B -->|是| E
    B -->|否| D
    D --> E
    E -->|符合| F
    E -->|不符合| G
    G --> H
    D --> H
    
    classDef start fill:#007AFF,stroke:#0056b3,color:#000000,stroke-width:3px
    classDef decision fill:#FFB84D,stroke:#e68a00,color:#000000,stroke-width:2px
    classDef normal fill:#50C878,stroke:#2e7d32,color:#000000,stroke-width:2px
    classDef alert fill:#FF6B6B,stroke:#c92a2a,color:#000000,stroke-width:3px
    classDef action fill:#4A90E2,stroke:#2E5C8A,color:#000000,stroke-width:2px
```

---

### 三、融资性贸易案件

#### 案情特征
- 形成贸易闭环
- 货物不存在或仅以提货单代替
- 同一时间段缔结合约，一方高买低卖

#### 推荐图表组合
- Graph：展示贸易闭环结构
- Mindmap：展示融资性贸易认定要点

#### Graph 示例（贸易闭环）

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E3F2FD',
  'primaryTextColor': '#000000',
  'lineColor': '#757575'
}}}%%
flowchart LR
    A[托盘方A（资金提供方）]:::trader
    B[融资方B（实际用款方）]:::borrower
    C[过桥方C]:::bridge
    D[过桥方D]:::bridge
    
    A --签订买卖合同：卖出货物110万--> B
    B --签订买卖合同：卖出货物110万--> C
    C --签订买卖合同：卖出货物110万--> D
    D --签订买卖合同：卖出货物100万--> A
    
    A -.资金100万实际流向.-> B
    
    classDef trader fill:#4A90E2,stroke:#2E5C8A,color:#000000,stroke-width:3px
    classDef borrower fill:#E74C3C,stroke:#A93226,color:#000000,stroke-width:3px
    classDef bridge fill:#F39C12,stroke:#B7950B,color:#000000,stroke-width:2px
```

#### Mindmap 示例（认定要点）

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#F3E5F5',
  'primaryTextColor': '#000000'
}}}%%
mindmap
  root((融资性贸易认定))
    形式特征
      贸易闭环
      同时间段签约
      一方高买低卖
    实质特征
      货物不存在
      仅提货单流转
      资金实际流向融资方
    法律后果
      名为买卖实为借贷
      托盘方无权主张货款
      按借贷关系处理
```

---

### 四、建设工程纠纷

#### 案情特征
- 工程周期长，进度复杂
- 涉及多阶段付款
- 工程量认定是常见争议

#### 推荐图表组合
- Gantt：展示工程进度和付款节点
- Graph：展示发包方、承包方、分包方关系

#### Gantt 示例

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E6F3FF',
  'primaryTextColor': '#000000',
  'sectionBkgColor': '#4A90E2',
  'altSectionBkgColor': '#50C878'
}}}%%
gantt
    title 建设工程项目进度
    dateFormat  YYYY-MM-DD
    
    section 施工准备
    签订施工合同 :contract, 2024-01-01, 1d
    进场准备 :prepare, after contract, 7d
    
    section 主体施工
    基础工程 :foundation, after prepare, 30d
    主体结构 :structure, after foundation, 60d
    
    section 付款节点
    预付款30% :milestone, pay1, 2024-01-05, 0d
    进度款40% :milestone, pay2, 2024-03-15, 0d
    完工款25% :milestone, pay3, 2024-06-01, 0d
    
    section 验收结算
    竣工验收 :accept, after structure, 15d
    工程结算 :settle, after accept, 30d
```

#### Graph 示例（合同关系）

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E3F2FD',
  'primaryTextColor': '#000000',
  'lineColor': '#757575'
}}}%%
flowchart TD
    A[发包方（业主）]:::owner
    B[承包方（施工企业）]:::contractor
    C[分包方A（劳务分包）]:::subcontractor
    D[分包方B（专业分包）]:::subcontractor
    E[监理单位]:::supervisor
    F[施工合同]:::contract
    G[分包合同A]:::contract
    H[分包合同B]:::contract
    
    A --发包--> F
    B --承包--> F
    B --分包--> G
    B --分包--> H
    C --分包施工--> G
    D --分包施工--> H
    E --监理--> F
    
    classDef owner fill:#4A90E2,stroke:#2E5C8A,color:#000000,stroke-width:3px
    classDef contractor fill:#50C878,stroke:#2E7D32,color:#000000,stroke-width:3px
    classDef subcontractor fill:#F39C12,stroke:#B7950B,color:#000000,stroke-width:2px
    classDef supervisor fill:#9B59B6,stroke:#7D3C98,color:#000000,stroke-width:2px
    classDef contract fill:#B0BEC5,stroke:#7F8C8D,color:#000000,stroke-width:2px,stroke-dasharray: 5 5
```

---

### 五、股权转让纠纷

#### 案情特征
- 股权结构复杂
- 可能涉及代持、多层持股
- 实际控制人与名义持股人不一致

#### 推荐图表组合
- Graph：展示股权结构和控制关系
- Mindmap：展示股权转让争议要点

#### Graph 示例（股权结构）

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E3F2FD',
  'primaryTextColor': '#000000',
  'lineColor': '#757575'
}}}%%
flowchart TD
    A[实际控制人（张三）]:::controller
    B[名义股东A（李四持股60%）]:::nominee
    C[名义股东B（王五持股40%）]:::nominee
    D[目标公司]:::company
    E[代持协议]:::contract
    
    A -.实际控制.-> B
    A -.实际控制.-> C
    B --名义持股60%--> D
    C --名义持股40%--> D
    A --代持安排--> E
    B --代持确认--> E
    C --代持确认--> E
    
    classDef controller fill:#E74C3C,stroke:#A93226,color:#000000,stroke-width:3px
    classDef nominee fill:#4A90E2,stroke:#2E5C8A,color:#000000,stroke-width:2px
    classDef company fill:#50C878,stroke:#2E7D32,color:#000000,stroke-width:3px
    classDef contract fill:#B0BEC5,stroke:#7F8C8D,color:#000000,stroke-width:2px,stroke-dasharray: 5 5
```

---

### 六、劳动争议案件

#### 案情特征
- 劳动关系状态变化明确
- 涉及入职、在职、离职等阶段
- 劳动合同解除条件是常见争议

#### 推荐图表组合
- StateDiagram：展示劳动关系状态变化
- Timeline：展示劳动争议处理时间线

#### StateDiagram 示例

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E1F5FE',
  'primaryTextColor': '#000000',
  'primaryBorderColor': '#03A9F4'
}}}%%
stateDiagram-v2
    [*] --> 招聘阶段
    招聘阶段 --> 劳动关系建立 : 签订劳动合同
    劳动关系建立 --> 在职期间 : 正常入职
    在职期间 --> 合同续签 : 合同到期续签
    在职期间 --> 合同解除 : 解除条件成就
    合同解除 --> 协商解除 : 双方协商一致
    合同解除 --> 单方解除 : 一方提出解除
    单方解除 --> 合法解除 : 符合法定条件
    单方解除 --> 违法解除 : 违反法定程序
    协商解除 --> 劳动关系终止
    合法解除 --> 劳动关系终止
    违法解除 --> 劳动关系终止 : 支付赔偿金
    劳动关系终止 --> [*]
```

---

### 七、担保合同纠纷

#### 案情特征
- 涉及主合同和担保合同的从属关系
- 保证方式（一般保证/连带保证）是常见争议核心
- 保证期间和诉讼时效交叉
- 混合担保中多方责任划分复杂

#### 推荐图表组合
- Graph：展示主债务人、债权人、保证人三方关系
- Flowchart：展示保证责任认定流程

#### Graph 示例（三方担保关系）

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E3F2FD',
  'primaryTextColor': '#000000',
  'lineColor': '#757575'
}}}%%
flowchart TD
    A["债权人（银行）"]:::creditor
    B["债务人（借款人）"]:::debtor
    C["保证人（担保公司）"]:::guarantor
    D["抵押人（第三方）"]:::mortgagor
    E["主合同：借款合同"]:::contract
    F["保证合同：连带责任保证"]:::contract
    G["抵押合同：不动产抵押"]:::contract

    A --出借本金--> E
    B --借款--> E
    A --保证关系--> F
    C --提供保证--> F
    F -.从属于.-> E
    A --抵押权--> G
    D --提供抵押物--> G
    G -.从属于.-> E

    classDef creditor fill:#4A90E2,stroke:#2E5C8A,color:#FFFFFF,stroke-width:3px
    classDef debtor fill:#E74C3C,stroke:#A93226,color:#FFFFFF,stroke-width:3px
    classDef guarantor fill:#F39C12,stroke:#B7950B,color:#FFFFFF,stroke-width:2px
    classDef mortgagor fill:#9B59B6,stroke:#7D3C98,color:#FFFFFF,stroke-width:2px
    classDef contract fill:#F5F5F5,stroke:#BFBFBF,color:#333333,stroke-width:2px,stroke-dasharray: 5 5
```

#### Flowchart 示例（保证责任认定）

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E6F3FF',
  'primaryTextColor': '#000000',
  'lineColor': '#666666'
}}}%%
flowchart TD
    A["主债务到期"]:::start
    B{"保证方式？"}:::decision
    C["一般保证"]:::normal
    D["连带责任保证"]:::normal
    E{"债权人是否已<br/>起诉主债务人？"}:::decision
    F{"保证期间是否届满？"}:::decision
    G["保证人免责"]:::alert
    H["保证人承担保证责任"]:::action
    I{"保证期间是否届满？"}:::decision
    J["债权人可直接要求<br/>保证人承担责任"]:::action

    A --> B
    B -->|约定为一般保证| C
    B -->|约定为连带| D
    C --> E
    E -->|是| F
    E -->|否| G
    F -->|否| G
    F -->|是| H
    D --> I
    I -->|否| G
    I -->|是| J

    classDef start fill:#007AFF,stroke:#0056b3,color:#FFFFFF,stroke-width:3px
    classDef decision fill:#FFB84D,stroke:#e68a00,color:#333333,stroke-width:2px
    classDef normal fill:#4A90E2,stroke:#2E5C8A,color:#FFFFFF,stroke-width:2px
    classDef alert fill:#F8CECC,stroke:#B85450,color:#333333,stroke-width:3px
    classDef action fill:#50C878,stroke:#2E7D32,color:#FFFFFF,stroke-width:2px
```

---

### 八、对赌协议纠纷

#### 案情特征
- 投资方与融资方签订估值调整协议
- 业绩补偿、股权回购是核心争议
- 涉及合同效力和履行可行性双重审查
- 最高院"海富案"后规则演变复杂

#### 推荐图表组合
- Timeline：展示投资、对赌条件触发、争议时间线
- Flowchart：展示对赌协议效力认定和履行路径

#### Timeline 示例

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E6F3FF',
  'primaryTextColor': '#000000'
}}}%%
timeline
    title 对赌协议纠纷时间线
    section 投资阶段
        2018-03-01 : 签订增资协议（投资2亿）
        2018-03-01 : 签订对赌协议（业绩+回购条款）
        2018-03-15 : 投资方支付增资款2亿
    section 对赌期间
        2018-12-31 : 第一年业绩未达标
        2019-12-31 : 连续两年业绩未达标
    section 争议阶段
        2020-03-01 : 投资方发函要求回购
        2020-04-01 : 融资方拒绝履行
        2020-05-01 : 投资方提起诉讼
```

#### Flowchart 示例（对赌协议效力认定）

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E6F3FF',
  'primaryTextColor': '#000000',
  'lineColor': '#666666'
}}}%%
flowchart TD
    A["签订对赌协议"]:::start
    B{"与谁对赌？"}:::decision
    C["与目标公司对赌"]:::branch1
    D["与股东/实控人对赌"]:::branch2
    E{"目标公司是否<br/>完成减资程序？"}:::decision
    F["投资方可主张</br>目标公司回购"]:::action
    G["投资方不可主张</br>目标公司回购"]:::alert
    H["对赌协议有效"]:::normal
    I{"是否可履行？"}:::decision
    J["投资方可主张</br>股东回购或补偿"]:::action
    K["审查是否违反</br>资本维持原则"]:::alert

    A --> B
    B -->|目标公司| C
    B -->|股东/实控人| D
    C --> E
    E -->|是| F
    E -->|否| G
    D --> H
    H --> I
    I -->|可履行| J
    I -->|不可履行| K

    classDef start fill:#1C3A5E,stroke:#0F2440,color:#FFFFFF,stroke-width:3px
    classDef decision fill:#FFB84D,stroke:#e68a00,color:#333333,stroke-width:2px
    classDef branch1 fill:#9B59B6,stroke:#7D3C98,color:#FFFFFF,stroke-width:2px
    classDef branch2 fill:#4A90E2,stroke:#2E5C8A,color:#FFFFFF,stroke-width:2px
    classDef action fill:#50C878,stroke:#2E7D32,color:#FFFFFF,stroke-width:2px
    classDef alert fill:#F8CECC,stroke:#B85450,color:#333333,stroke-width:3px
    classDef normal fill:#D5E8D4,stroke:#82B366,color:#333333,stroke-width:2px
```

---

### 九、公司决议纠纷

#### 案情特征
- 涉及股东会/董事会决议的效力
- 程序瑕疵和内容违法分开审查
- 三类效力形态：无效、可撤销、不成立
- 原告资格和除斥期间是程序要点

#### 推荐图表组合
- Flowchart：展示决议效力认定路径
- Timeline：展示决议作出到诉讼的时间线（突出除斥期间）

#### Flowchart 示例（决议效力认定路径）

```mermaid
%%{init: {'themeVariables': {
  'primaryColor': '#E6F3FF',
  'primaryTextColor': '#000000',
  'lineColor': '#666666'
}}}%%
flowchart TD
    A["公司决议"]:::start
    B{"是否召开会议？"}:::decision
    C{"是否表决通过？"}:::decision
    D{"召集程序/表决方式<br/>是否违法？"}:::decision
    E{"决议内容是否<br/>违反强制性规定？"}:::decision
    F["决议不成立"]:::alert
    G["决议可撤销"]:::alert_warn
    H["决议无效"]:::alert
    I["决议有效"]:::normal
    J{"是否在60日内<br/>提出撤销之诉？"}:::decision

    A --> B
    B -->|未召开| F
    B -->|已召开| C
    C -->|未通过| F
    C -->|已通过| D
    D -->|程序违法| J
    D -->|程序合法| E
    J -->|是| G
    J -->|否| I
    E -->|内容违法| H
    E -->|内容合法| I

    classDef start fill:#1C3A5E,stroke:#0F2440,color:#FFFFFF,stroke-width:3px
    classDef decision fill:#FFB84D,stroke:#e68a00,color:#333333,stroke-width:2px
    classDef alert fill:#F8CECC,stroke:#B85450,color:#333333,stroke-width:3px
    classDef alert_warn fill:#FFF2CC,stroke:#D6B656,color:#333333,stroke-width:2px
    classDef normal fill:#D5E8D4,stroke:#82B366,color:#333333,stroke-width:2px
```

---

## 多图输出组织规范

当一次输出多张图表时，按以下规范组织：

### 输出顺序

1. **案件事实图/时间线**（如有）：先呈示客观事实
2. **法律关系图**（如有）：在事实基础上展开法律分析
3. **争议焦点图/思维导图**（如有）：最后呈示分析结论

### 每张图之间的格式

每张图用以下结构分隔和标注：

```
### 图1：[图表标题]

[一句话说明这张图表达的核心观点]

```mermaid
...
```

---

### 图2：[图表标题]

[一句话说明这张图表达的核心观点]

```mermaid
...
```
```

### 规则

- 每张图前有**中文小标题**（用 `###`），说明图名
- 每张图前有**一句说明**，点出该图的核心信息（帮助读者在最短时间内理解图表目的）
- 多张图之间用 `---` 分隔线
- 如果只有一张图，不需要加小标题层级，直接输出即可
- 相同案件的多张图中，同一主体使用相同的配色（配色一致性）

---

## 质量检查清单

### 输出前自检

```
□ 核心检查
  □ 图表是否清晰表达了核心事实/关系？
  □ 图表类型是否适合案件核心要素？
  □ 图表类型是否适合呈送对象？

□ 配色检查
  □ 配色是否一致（同主体同色）？
  □ 文字是否清晰可读（深色文字 color:#333333 或 #1C3A5E）？
  □ 背景色亮度是否 ≥ 70%（打印安全）？
  □ 颜色是否不超过5-6种？

□ 结构检查
  □ 元素是否过多（建议≤15个节点）？
  □ 连线是否交叉过多？
  □ 布局是否平衡？

□ 语法检查
  □ 节点标签含 ()、[]、{}、： 等特殊字符时，是否用双引号包裹？
  □ 是否避免了 `<br>` 非自闭合标签？
  □ 连线标注是否去掉了多余的双引号？
  □ 时间线方向是否一致？
  □ 箭头方向是否正确（资金流向、权利方向）？
  □ 是否标注了关系性质？
  □ 是否需要分拆为多张图？

□ 输出检查
  □ 是否绝对没有 emoji 表情符号？
  □ 思维导图是否使用了 flowchart 模拟（而非原生 mindmap，除非用户明确要求）？
  □ 多张图之间是否用小标题和 `---` 分隔线组织？

□ 受众检查
  □ 是否适合呈送对象（法官→客观/客户→分析）？
  □ 是否包含不必要的主观评价（法官图表）？
  □ 是否能让不了解案件的人理解？
  □ 黑白打印时图表是否仍然可读？
```

---

## 自动触发场景

当用户输入包含以下关键词时，自动激活本 skill：

### 直接请求类
- "帮我画一个XX关系图"
- "画一个XX案件事实图"
- "用可视化的方式梳理一下XX的关系"
- "制作一张时间线图"
- "设计一个流程图"
- "可视化XX案情"
- **"帮我做一个XX思维导图" → 直接使用 Mindmap 类型**
- **"画一个XX导图" → 直接使用 Mindmap 类型**
- **"用思维导图梳理XX" → 直接使用 Mindmap 类型**

### 分析描述类
- "这个案件关系复杂，梳理一下"
- "主体太多，画图说明"
- "时间线很乱，可视化一下"
- "交易结构复杂，画图展示"

### 结合场景类
- "需要准备庭审图表"
- "向法官/客户展示这个关系"
- "两张图工作法"

---

## 使用场景

- 案件事实可视化
- 法律关系分析
- 庭审准备
- 合同风险可视化（与合同审查/起草结合）
- 案件分析框架梳理
- 证据整理

---

## 注意事项

### 零、输出格式强制规则

**绝对禁止在输出中使用任何 emoji 表情符号**。包括但不限于：⚠️ ✅ ❌ 🔴 🟢 📌 🚫 ⭐ 💡 📋 🔍 ✏️ ❗ 等。

无论是在 mermaid 代码块内还是代码块外的说明文字中，都不得出现 emoji。

### 一、Mermaid 语法规范（必须遵守）

#### 1. 节点标签引用规范（最高优先级）

**Mermaid 解析器会将节点标签中的 `()` `[]` `{}` `<>` 识别为形状语法。当节点文本包含这些特殊字符时，必须用双引号包裹整个标签，否则会导致解析错误。**

**典型错误案例**（用户实际遇到的）：
```
Parse error: ...案号：(2019)最高法民终960号 审理法院...
                         ^--- 此处 (2019) 被误解析为圆角矩形语法
```

**正确与错误对照**：
```
❌ 错误（括号/方括号被误解析为形状语法）：
A[案号：(2019)最高法民终960号]
B[审理法院：最高人民法院]
C[原告：张三（买方）]
D[标的物：设备[型号A]]
E[被告：甲公司{上海}分公司]

✅ 正确（用双引号包裹）：
A["案号：(2019)最高法民终960号"]
B["审理法院：最高人民法院"]
C["原告：张三（买方）"]
D["标的物：设备[型号A]"]
E["被告：甲公司{上海}分公司"]
```

**必须用双引号包裹节点标签的情况**：
| 节点文本含 | 示例 | 正确写法 |
|-----------|------|---------|
| `(` `)` 括号 | 案号：(2019)民终960号 | `A["案号：(2019)民终960号"]` |
| `[` `]` 方括号 | 依据[2024]第3号判决 | `B["依据[2024]第3号判决"]` |
| `{` `}` 花括号 | 价款{含税}100万 | `C["价款{含税}100万"]` |
| `：` 中文冒号 | 法院：最高人民法院 | `D["法院：最高人民法院"]` |
| `「」【】` 中文括号 | 原告【甲公司】 | `E["原告【甲公司】"]` |

**重要说明**：
- 双引号包裹节点标签是 Mermaid 官方推荐的处理特殊字符的方式，不会导致解析错误
- 这个规则仅适用于 graph/flowchart 类型的节点标签，timeline/mindmap 等类型不受影响
- 如果你不确定节点文本是否包含特殊字符，养成用双引号包裹的习惯：`A["节点文本"]`

#### 2. 换行标签规范

- `<br>`：**禁止使用**，会导致解析错误（非自闭合）
- `<br/>`：自闭合标签，多数渲染器支持，但部分环境可能有问题
- **推荐方案**：避免换行，将内容简化或分拆为多个节点

```
❌ 错误写法：
F[朱某意识到条款违法<br>以社保为由<br>解除合同]

✅ 推荐写法：
F["朱某以社保问题为由解除合同"]
或分拆为多个节点
```

#### 3. 连线标注规范

连线上标注文字中不要使用双引号，直接写纯文本即可：

```
❌ 错误写法：
A -->|"未依法缴纳社保"| B

✅ 正确写法：
A -->|未依法缴纳社保| B
A -->|以社保问题为由| B
```

#### 4. 其他禁止/注意事项

| 禁止用法 | 错误原因 | 正确替代方案 |
|---------|---------|-------------|
| 节点文本含未引用的 `()` | 被解析为圆角矩形形状语法 | 用双引号包裹：`["文本(内容)"]` |
| 节点文本含未引用的 `[]` | 被解析为矩形形状语法 | 用双引号包裹：`["文本[内容]"]` |
| 节点文本含 `：`（未引用时） | 可能干扰解析 | 用双引号包裹 |
| `<br>` 非自闭合标签 | 解析器不支持 | 使用 `<br/>` 或简化文字 |
| `<` `>` 尖括号 | 被解析为 HTML 标签 | 用双引号包裹或避免使用 |
| 节点内容过长（>25字） | 超出渲染宽度 | 控制在15字以内，或分拆节点 |

### 二、庭审打印兼容性

律师制作的图表最终需要嵌入代理词、答辩状、证据清单等正式法律文书，打印提交法院。以下规则确保图表在黑白打印和电子阅卷系统中清晰可读：

1. **背景色使用浅色**：填充色（fill）的亮度值应在 70% 以上（HSL 中 L > 70），确保黑白打印时背景不会变成一团黑
2. **文字与背景高对比度**：浅色背景上的文字用 `#333333` 或 `#1C3A5E`（深色但非纯黑），深色背景上的文字用 `#FFFFFF`
3. **边框用深色**：所有边框（stroke）使用深色且 `stroke-width >= 2px`，确保打印时线条不消失
4. **避免依赖颜色传递唯一信息**：关键区分信息也通过形状（矩形/圆角矩形/菱形）或线条类型（实线/虚线）传达，不要仅靠颜色
5. **节点文字简洁**：控制在 15 字以内，确保在 A4 纸打印时字号仍然可读

**打印友好的配色参考**：
| 用途 | 推荐配色 | 说明 |
|-----|---------|------|
| 中心/根节点 | fill:#D5E8D4,stroke:#82B366,color:#333333 | 浅绿底，打印时呈浅灰 |
| 主体节点（原告方） | fill:#DAE8FC,stroke:#6C8EBF,color:#333333 | 浅蓝底，打印时呈浅灰 |
| 主体节点（被告方） | fill:#F8CECC,stroke:#B85450,color:#333333 | 浅红底，打印时呈浅灰 |
| 争议/违约 | fill:#FFF2CC,stroke:#D6B656,color:#333333 | 浅黄底，打印时仍可区分 |
| 文件/合同 | fill:#F5F5F5,stroke:#BFBFBF,color:#333333 | 极浅灰底，虚线边框 |

### 三、设计规范

1. **文字可读性**：所有节点必须设置黑色或深色文字 `color:#333333` 或 `color:#1C3A5E`
2. **打印安全**：背景色亮度 ≥ 70%（见上方"庭审打印兼容性"）
2. **配色一致性**：同一案件中多张图表使用统一配色
3. **节点简洁**：每个节点文字控制在15字以内，过长时分拆
4. **节点引用**：graph/flowchart 节点文本含 `()`、`[]`、`：` 等特殊字符时，必须用双引号包裹：`["文本"]`
5. **输出格式**：输出直接是 mermaid 代码块，不写入文件
6. **绝对禁止 emoji**：输出内容中不得出现任何 emoji 表情符号（包括但不限于 ⚠️ ✅ ❌ 📌 🔴 🟢 等）
6. **图表类型选择**：根据案件核心要素选择合适的图表类型；用户说"思维导图"时使用 Mindmap
7. **避免过度复杂**：节点数量建议≤15个，保持简洁
8. **图表数量**：两张图是基础，案情复杂时可增加其他图表
9. **受众导向**：根据呈送对象调整内容和表达方式

---

## 部署路径

```
/Users/leslie/Desktop/程子洋0424Macbook备份/contract review/.claude/skills/litigation-visualization
```

本 skill 是独立 skill，可单独部署调用，不依赖其他 skill。