# 实现计划: Markdown Front Matter 格式保留

## 概述

实现 RichTextEditor 组件对 YAML front matter 的格式保留功能，确保用户粘贴的 Markdown 内容在保存时保持原始格式。

## 任务

- [x] 1. 创建 Front Matter 解析工具函数
  - [x] 1.1 创建 `shared/utils/markdownFrontMatter.ts` 文件
    - 实现 `FrontMatterResult` 接口定义
    - 实现 `extractFrontMatter` 函数，从 Markdown 中提取 front matter
    - 实现 `mergeFrontMatter` 函数，合并 front matter 和正文
    - 导出函数供组件使用
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.2 编写 Front Matter 工具函数单元测试
    - 测试有效 front matter 的提取
    - 测试无 front matter 的内容处理
    - 测试不完整 front matter 的处理
    - 测试包含中文字符和特殊符号的 front matter
    - _需求: 1.1, 1.3, 1.4, 1.5_

  - [x] 1.3 编写 Front Matter 往返一致性属性测试
    - **Property 2: Front Matter 往返一致性**
    - **验证: 需求 1.2, 4.3**

- [x] 2. 修改 RichTextEditor 组件
  - [x] 2.1 添加 front matter 状态管理
    - 添加 `frontMatter` ref 存储提取的 front matter
    - 导入 `extractFrontMatter` 和 `mergeFrontMatter` 函数
    - _需求: 2.1_

  - [x] 2.2 修改内容获取逻辑
    - 修改 `getEditorContent` 函数，在输出时拼接 front matter
    - 确保 markdown 格式输出时自动合并 front matter
    - _需求: 1.2, 2.2_

  - [x] 2.3 修改内容设置逻辑
    - 修改编辑器初始化时的内容处理
    - 在设置内容时提取 front matter
    - 只将正文内容传递给 Tiptap 编辑器
    - _需求: 1.1, 2.1_

  - [x] 2.4 修改 v-model 同步逻辑
    - 修改 `watch` 监听器，处理外部内容更新
    - 在更新时正确提取和存储 front matter
    - _需求: 4.1_

  - [x] 2.5 修改源码模式切换逻辑
    - 修改 `toggleSourceMode` 函数
    - 切换到源码模式时显示完整内容（front matter + 正文）
    - 切换回所见即所得模式时重新解析 front matter
    - _需求: 2.3, 3.1, 3.2, 3.3_

- [x] 3. 检查点 - 确保所有测试通过
  - 运行单元测试验证工具函数
  - 手动测试编辑器功能
  - 如有问题请询问用户

- [x] 4. 编写组件集成测试
  - [x] 4.1 编写正文编辑不影响 Front Matter 的属性测试
    - **Property 3: 正文编辑不影响 Front Matter**
    - **验证: 需求 2.2**

  - [x] 4.2 编写源码模式内容完整性测试
    - **Property 4: 源码模式内容完整性**
    - **验证: 需求 2.3, 3.1**

## 备注

- 每个任务都引用了具体的需求以便追溯
- 检查点用于确保增量验证
- 属性测试验证通用的正确性属性
- 单元测试验证具体的示例和边界情况
