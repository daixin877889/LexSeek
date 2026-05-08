# 请求权基础分析方法论

## 简介

本skill提供民事请求权基础的系统分析方法论，用于：

- 分析民事案件中请求权是否成立
- 寻找和识别请求权基础规范
- 确定请求权检视顺序
- 分配举证责任
- 处理多项规范竞合
- 规范法律分析写作格式

## 核心方法

| 方法 | 用途 | 文档 |
|------|------|------|
| 规范分类法 | 判断法条属性（主要/辅助/防御） | [references/guifan-fenlei.md](./references/guifan-fenlei.md) |
| 三层四步法 | 系统检视请求权成立要件 | [references/sanceng-sibu.md](./references/sanceng-sibu.md) |
| 预选排序法 | 确定多项请求权检视顺序 | [references/yuxuan-paixu.md](./references/yuxuan-paixu.md) |
| 举证分配法 | 确定要件举证主体 | [references/juzheng-fenpei.md](./references/juzheng-fenpei.md) |
| 鉴定体裁法 | 规范法律分析写作格式 | [references/jianding-ticai.md](./references/jianding-ticai.md) |
| 法庭报告技术 | 组织诉讼审理流程 | [references/fating-baogao.md](./references/fating-baogao.md) |
| 竞合处理法 | 处理多项规范同时适用 | [references/guifan-jinghe.md](./references/guifan-jinghe.md) |

## 专门应用

| 应用 | 用途 | 文档 |
|------|------|------|
| 不作为侵权 | 四要件合并判断的简化检视 | 见 [references/zhuanti-yingyong.md](./references/zhuanti-yingyong.md) |
| 合同效力 | 有效推定原则 | 见 [references/zhuanti-yingyong.md](./references/zhuanti-yingyong.md) |
| 法律漏洞 | 类推填补方法 | 见 [references/zhuanti-yingyong.md](./references/zhuanti-yingyong.md) |
| 体系构建 | 公因式展开方法 | 见 [references/zhuanti-yingyong.md](./references/zhuanti-yingyong.md) |

## 使用场景

**适用场景**：
- 律师分析案件诉讼路径和法条依据
- 法官系统审查请求权和分配举证
- 法律工作者撰写结构化法律分析
- 法学生做案例分析练习

**不适用场景**：
- 刑事案件分析（民事方法论不适用）
- 程序法问题（举证时限等程序规则）
- 纯事实调查（无请求权基础时）

## 方法依赖关系

```
guifan-fenlei (规范分类)
    │
    ├──→ sanceng-sibu (三层四步检视)
    │       │
    │       ├──→ juzheng-fenpei (举证分配)
    │       └──→ jianding-ticai (鉴定体裁)
    │
    └──→ yuxuan-paixu (预选排序)
            │
            ├──→ fating-baogao (法庭报告技术)
            └──→ guifan-jinghe (竞合处理)
```

## 快速使用指南

### 最简流程（个案分析）

1. 提出假设："甲得否依第X条向乙请求Y？"
2. 列出构成要件（大前提）
3. 逐一涵摄事实到要件
4. 得出结论

### 完整流程（复杂案件）

1. 预选所有可能的请求权基础
2. 按标准顺序排列检视顺序
3. 对每项请求权做三层四步检视
4. 确定举证分配
5. 处理竞合问题
6. 以鉴定体裁输出

## 工具调用规范

### 必须调用的工具

| 工具名称 | 用途 | 调用时机 |
|----------|------|----------|
| search_law | 检索法律规范条文 | 规范检索阶段，在案情分析完成后调用 |

### 调用流程

```
案情分析 → [调用 search_law] → 规范分类 → 预选排序 → 三层四步检视 → ...
```

### search_law 使用说明

**输入**：争议焦点 + 案情特征标签

**输出处理**：
1. 对返回法条进行规范分类（主要/辅助/防御/参引）
2. 排除明显不成立的候选规范
3. 按预选排序原则排列检视顺序

## 与其他工具配合

本skill必须配合 search_law 工具使用：
1. 案情分析后，调用 search_law 检索相关法条
2. 根据检索结果进行方法论分析
3. 输出案情特征标签供案由模块使用