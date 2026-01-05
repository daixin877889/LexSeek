# 需求文档

## 简介

富文本编辑器（RichTextEditor）在处理包含 YAML front matter 的 Markdown 内容时，会破坏原始格式并转义特殊符号。本功能旨在让编辑器能够正确保留 Markdown 文档头部的 YAML 元数据格式，确保保存后的内容与原始输入一致。

## 术语表

- **RichTextEditor**: 基于 Tiptap 的富文本编辑器组件
- **YAML_Front_Matter**: Markdown 文档头部由 `---` 包裹的 YAML 格式元数据块
- **Tiptap_Markdown**: tiptap-markdown 扩展，用于 Markdown 输入输出转换
- **Source_Mode**: 编辑器的源码模式，直接编辑原始 Markdown 文本

## 需求

### 需求 1：YAML Front Matter 格式保留

**用户故事：** 作为法律文档编辑者，我希望在编辑包含元数据的 Markdown 文档时，YAML front matter 能够保持原始格式，以便文档的元数据信息不会丢失或损坏。

#### 验收标准

1. WHEN 用户输入包含 YAML front matter 的 Markdown 内容 THEN RichTextEditor SHALL 识别并保留 `---` 分隔符包裹的元数据块
2. WHEN 用户保存或获取编辑器内容 THEN RichTextEditor SHALL 输出与原始输入格式一致的 YAML front matter
3. WHEN YAML front matter 包含中文字符、特殊符号（如 `〔〕`）THEN RichTextEditor SHALL 保留这些字符不进行转义
4. WHEN YAML front matter 包含冒号、连字符等 YAML 语法字符 THEN RichTextEditor SHALL 保持其原始格式不被破坏
5. IF YAML front matter 格式不完整（缺少结束 `---`）THEN RichTextEditor SHALL 将其作为普通内容处理

### 需求 2：所见即所得模式下的 Front Matter 处理

**用户故事：** 作为编辑者，我希望在所见即所得模式下，YAML front matter 能够以合适的方式展示，同时不影响正文内容的编辑体验。

#### 验收标准

1. WHEN 编辑器处于所见即所得模式 THEN RichTextEditor SHALL 将 YAML front matter 与正文内容分离处理
2. WHEN 用户编辑正文内容 THEN RichTextEditor SHALL 不影响 YAML front matter 的完整性
3. WHEN 用户切换到源码模式 THEN RichTextEditor SHALL 显示完整的原始 Markdown 内容（包含 front matter）

### 需求 3：源码模式下的完整内容编辑

**用户故事：** 作为高级用户，我希望在源码模式下能够直接编辑完整的 Markdown 内容，包括 YAML front matter。

#### 验收标准

1. WHEN 用户切换到源码模式 THEN RichTextEditor SHALL 显示完整的原始 Markdown 文本
2. WHEN 用户在源码模式下编辑 YAML front matter THEN RichTextEditor SHALL 保存用户的修改
3. WHEN 用户从源码模式切换回所见即所得模式 THEN RichTextEditor SHALL 正确解析更新后的 front matter

### 需求 4：内容同步与数据完整性

**用户故事：** 作为系统使用者，我希望编辑器在各种操作下都能保证数据完整性，不会丢失或损坏 YAML front matter。

#### 验收标准

1. WHEN 外部通过 v-model 更新编辑器内容 THEN RichTextEditor SHALL 正确处理包含 front matter 的内容
2. WHEN 用户复制粘贴包含 front matter 的内容 THEN RichTextEditor SHALL 保留 front matter 格式
3. FOR ALL 包含有效 YAML front matter 的 Markdown 内容，输入后再获取输出 SHALL 产生等价的 front matter 内容（往返一致性）
