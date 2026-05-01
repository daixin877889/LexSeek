---
name: docx
title: word 编辑
description: "只要用户想创建、读取、编辑或操纵 Word 文档（.docx 文件），就使用此技能。触发器包括：任何提及'Word doc'、'word 文档'、'.docx'，或请求生成具有目录、标题、页码或信头等格式的专业文档。也用于从 .docx 文件提取或重新组织内容、在文档中插入或替换图像、在 Word 文件中执行查找和替换、处理跟踪的更改或评论，或将内容转换为精美的 Word 文档。如果用户要求以 Word 或 .docx 文件形式提供'报告'、'备忘录'、'信件'、'模板'或类似的可交付成果，使用此技能。不要用于 PDF、电子表格、Google Docs 或与文档生成无关的常规编码任务。"
license: Proprietary. LICENSE.txt has complete terms
---

# DOCX 创建、编辑和分析

## 概述

.docx 文件是包含 XML 文件的 ZIP 存档。

## 快速参考

| 任务 | 方法 |
|------|----------|
| 读取/分析内容 | `pandoc` 或解包原始 XML |
| 创建新文档 | 使用 `docx-js` - 见下面的创建新文档 |
| 编辑现有文档 | 解包 → 编辑 XML → 重新打包 - 见下面的编辑现有文档 |

### 将 .doc 转换为 .docx

旧的 `.doc` 文件必须在编辑前转换：

```bash
python scripts/office/soffice.py --headless --convert-to docx document.doc
```

### 读取内容

```bash
# 带跟踪更改的文本提取
pandoc --track-changes=all document.docx -o output.md

# 原始 XML 访问
python scripts/office/unpack.py document.docx unpacked/
```

### 转换为图像

```bash
python scripts/office/soffice.py --headless --convert-to pdf document.docx
pdftoppm -jpeg -r 150 document.pdf page
```

### 接受跟踪的更改

生成一个已接受所有跟踪更改的干净文档（需要 LibreOffice）：

```bash
python scripts/accept_changes.py input.docx output.docx
```

---

## 创建新文档

使用 JavaScript 生成 .docx 文件，然后验证。安装：`npm install -g docx`

### 设置
```javascript
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
        Header, Footer, AlignmentType, PageOrientation, LevelFormat, ExternalHyperlink,
        InternalHyperlink, Bookmark, FootnoteReferenceRun, PositionalTab,
        PositionalTabAlignment, PositionalTabRelativeTo, PositionalTabLeader,
        TabStopType, TabStopPosition, Column, SectionType,
        TableOfContents, HeadingLevel, BorderStyle, WidthType, ShadingType,
        VerticalAlign, PageNumber, PageBreak } = require('docx');

const doc = new Document({ sections: [{ children: [/* content */] }] });
Packer.toBuffer(doc).then(buffer => fs.writeFileSync("doc.docx", buffer));
```

### 验证
创建文件后，验证它。如果验证失败，解包、修复 XML、重新打包。
```bash
python scripts/office/validate.py doc.docx
```

### 页面大小

```javascript
// 重要：docx-js 默认为 A4，不是美国信件尺寸
// 始终明确设置页面大小以获得一致的结果
sections: [{
  properties: {
    page: {
      size: {
        width: 12240,   // 8.5 英寸（DXA 单位）
        height: 15840   // 11 英寸（DXA 单位）
      },
      margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } // 1 英寸边距
    }
  },
  children: [/* content */]
}]
```

**常见页面大小（DXA 单位，1440 DXA = 1 英寸）：**

| 纸张 | 宽度 | 高度 | 内容宽度（1" 边距） |
|-------|-------|--------|---------------------------|
| 美国信件 | 12,240 | 15,840 | 9,360 |
| A4（默认） | 11,906 | 16,838 | 9,026 |

**横向方向：** docx-js 内部交换宽度/高度，所以传递纵向尺寸并让它处理交换：
```javascript
size: {
  width: 12240,   // 传递短边作为宽度
  height: 15840,  // 传递长边作为高度
  orientation: PageOrientation.LANDSCAPE  // docx-js 在 XML 中交换它们
},
// 内容宽度 = 15840 - 左边距 - 右边距（使用长边）
```

### 样式（覆盖内置标题）

使用 Arial 作为默认字体（通用支持）。标题保持黑色以便阅读。

```javascript
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 24 } } }, // 12pt 默认
    paragraphStyles: [
      // 重要：使用精确的 ID 覆盖内置样式
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 } }, // TOC 需要 outlineLevel
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 180, after: 180 }, outlineLevel: 1 } },
    ]
  },
  sections: [{
    children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("标题")] }),
    ]
  }]
});
```

### 列表（永远不要使用 Unicode 项目符号）

```javascript
// ❌ 错误 - 永远不要手动插入项目符号字符
new Paragraph({ children: [new TextRun("• 项目")] })  // 不好
new Paragraph({ children: [new TextRun("\u2022 Item")] })  // BAD

// ✅ 正确 - 使用带 LevelFormat.BULLET 的编号配置
const doc = new Document({
  numbering: {
    config: [
      { reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbers",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ]
  },
  sections: [{
    children: [
      new Paragraph({ numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("项目符号项")] }),
      new Paragraph({ numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("编号项")] }),
    ]
  }]
});

// ⚠️ 每个引用创建独立编号
// 相同引用 = 继续（1,2,3 然后 4,5,6）
// 不同引用 = 重启（1,2,3 然后 1,2,3）
```

### 表格

**重要：表格需要双宽度** - 在表格上设置 `columnWidths` 和在每个单元格上设置 `width`。没有两者，表格在某些平台上会呈现不正确。

```javascript
// 重要：始终设置表格宽度以保证一致的渲染
// 重要：使用 ShadingType.CLEAR（不是 SOLID）以防止黑色背景
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };

new Table({
  width: { size: 9360, type: WidthType.DXA }, // 始终使用 DXA（百分比在 Google Docs 中会断裂）
  columnWidths: [4680, 4680], // 必须求和为表格宽度（DXA：1440 = 1 英寸）
  rows: [
    new TableRow({
      children: [
        new TableCell({
          borders,
          width: { size: 4680, type: WidthType.DXA }, // 也在每个单元格上设置
          shading: { fill: "D5E8F0", type: ShadingType.CLEAR }, // CLEAR 不是 SOLID
          margins: { top: 80, bottom: 80, left: 120, right: 120 }, // 单元格填充（内部，不添加到宽度）
          children: [new Paragraph({ children: [new TextRun("单元格")] })]
        })
      ]
    })
  ]
})
```

**表格宽度计算：**

始终使用 `WidthType.DXA` — `WidthType.PERCENTAGE` 在 Google Docs 中会断裂。

```javascript
// 表格宽度 = columnWidths 的总和 = 内容宽度
// 美国信件纸张，1" 边距：12240 - 2880 = 9360 DXA
width: { size: 9360, type: WidthType.DXA },
columnWidths: [7000, 2360]  // 必须求和为表格宽度
```

**宽度规则：**
- **始终使用 `WidthType.DXA`** — 永远不要 `WidthType.PERCENTAGE`（与 Google Docs 不兼容）
- 表格宽度必须等于 `columnWidths` 的总和
- 单元格 `width` 必须与相应的 `columnWidth` 匹配
- 单元格 `margins` 是内部填充 - 它们减少内容区域，不添加到单元格宽度
- 对于全宽表格：使用内容宽度（页面宽度减去左右边距）

### 图像

```javascript
// 重要：type 参数是必需的
new Paragraph({
  children: [new ImageRun({
    type: "png", // 必需：png、jpg、jpeg、gif、bmp、svg
    data: fs.readFileSync("image.png"),
    transformation: { width: 200, height: 150 },
    altText: { title: "标题", description: "描述", name: "名称" } // 全部三个必需
  })]
})
```

### 页面中断

```javascript
// 重要：PageBreak 必须在 Paragraph 内部
new Paragraph({ children: [new PageBreak()] })

// 或使用 pageBreakBefore
new Paragraph({ pageBreakBefore: true, children: [new TextRun("新页面")] })
```

### 超链接

```javascript
// 外部链接
new Paragraph({
  children: [new ExternalHyperlink({
    children: [new TextRun({ text: "点击这里", style: "Hyperlink" })],
    link: "https://example.com",
  })]
})

// 内部链接（书签 + 引用）
// 1. 在目标处创建书签
new Paragraph({ heading: HeadingLevel.HEADING_1, children: [
  new Bookmark({ id: "chapter1", children: [new TextRun("第 1 章")] }),
]})
// 2. 链接到它
new Paragraph({ children: [new InternalHyperlink({
  children: [new TextRun({ text: "见第 1 章", style: "Hyperlink" })],
  anchor: "chapter1",
})]})
```

### 脚注

```javascript
const doc = new Document({
  footnotes: {
    1: { children: [new Paragraph("来源：2024 年年度报告")] },
    2: { children: [new Paragraph("查看附录以了解方法论")] },
  },
  sections: [{
    children: [new Paragraph({
      children: [
        new TextRun("收入增长了 15%"),
        new FootnoteReferenceRun(1),
        new TextRun(" 使用调整后的指标"),
        new FootnoteReferenceRun(2),
      ],
    })]
  }]
});
```

### 制表位

```javascript
// 在同一行右对齐文本（例如日期与标题相对）
new Paragraph({
  children: [
    new TextRun("公司名称"),
    new TextRun("\t2025 年 1 月"),
  ],
  tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
})

// 点领导（例如目录风格）
new Paragraph({
  children: [
    new TextRun("简介"),
    new TextRun({ children: [
      new PositionalTab({
        alignment: PositionalTabAlignment.RIGHT,
        relativeTo: PositionalTabRelativeTo.MARGIN,
        leader: PositionalTabLeader.DOT,
      }),
      "3",
    ]}),
  ],
})
```

### 多列布局

```javascript
// 等宽列
sections: [{
  properties: {
    column: {
      count: 2,          // 列数
      space: 720,        // 列之间的间隙（DXA）（720 = 0.5 英寸）
      equalWidth: true,
      separate: true,    // 列之间的竖线
    },
  },
  children: [/* 内容在列中自然流动 */]
}]

// 自定义宽度列（equalWidth 必须为 false）
sections: [{
  properties: {
    column: {
      equalWidth: false,
      children: [
        new Column({ width: 5400, space: 720 }),
        new Column({ width: 3240 }),
      ],
    },
  },
  children: [/* content */]
}]
```

使用 `type: SectionType.NEXT_COLUMN` 的新分节强制列中断。

### 目录

```javascript
// 重要：标题必须仅使用 HeadingLevel - 没有自定义样式
new TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-3" })
```

### 页眉/页脚

```javascript
sections: [{
  properties: {
    page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } // 1440 = 1 英寸
  },
  headers: {
    default: new Header({ children: [new Paragraph({ children: [new TextRun("页眉")] })] })
  },
  footers: {
    default: new Footer({ children: [new Paragraph({
      children: [new TextRun("第 "), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun(" 页")]
    })] })
  },
  children: [/* content */]
}]
```

### docx-js 的关键规则

- **明确设置页面大小** - docx-js 默认为 A4；对于美国文档使用美国信件尺寸（12240 x 15840 DXA）
- **横向：传递纵向尺寸** - docx-js 内部交换宽度/高度；传递短边作为 `width`、长边作为 `height`，并设置 `orientation: PageOrientation.LANDSCAPE`
- **永远不要使用 `\n`** - 使用单独的 Paragraph 元素
- **永远不要使用 Unicode 项目符号** - 使用带编号配置的 `LevelFormat.BULLET`
- **PageBreak 必须在 Paragraph 内** - 独立的会创建无效的 XML
- **ImageRun 需要 `type`** - 始终指定 png/jpg 等
- **始终使用 DXA 设置表格 `width`** - 永远不要使用 `WidthType.PERCENTAGE`（在 Google Docs 中断裂）
- **表格需要双宽度** - `columnWidths` 数组和单元格 `width`，两者都必须匹配
- **表格宽度 = columnWidths 的总和** - 对于 DXA，确保它们相加完全相等
- **始终添加单元格边距** - 使用 `margins: { top: 80, bottom: 80, left: 120, right: 120 }` 以获得可读的填充
- **使用 `ShadingType.CLEAR`** - 永远不要 SOLID 用于表格着色
- **永远不要使用表格作为分隔线/规则** - 单元格有最小高度并呈现为空框（包括在页眉/页脚中）；改用 `border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "2E75B6", space: 1 } }` 在 Paragraph 上。对于两列页脚，使用制表位（见制表位部分），不要使用表格
- **TOC 仅需要 HeadingLevel** - 标题段落上没有自定义样式
- **覆盖内置样式** - 使用精确的 ID："Heading1"、"Heading2" 等
- **包括 `outlineLevel`** - TOC 需要（H1 为 0，H2 为 1，等等）

---

## 编辑现有文档

**按顺序遵循所有 3 个步骤。**

### 第 1 步：解包
```bash
python scripts/office/unpack.py document.docx unpacked/
```
提取 XML、格式化打印、合并相邻运行，并将智能引号转换为 XML 实体（`&#x201C;` 等）以便在编辑时保留。使用 `--merge-runs false` 跳过运行合并。

### 第 2 步：编辑 XML

编辑 `unpacked/word/` 中的文件。下面的 XML 参考中查看模式。

**为跟踪的更改和评论使用”Claude”作为作者**，除非用户明确要求使用不同的名称。

**直接使用 Edit 工具进行字符串替换。不要写 Python 脚本。** 脚本会引入不必要的复杂性。Edit 工具准确显示正在被替换的内容。

**重要：为新内容使用智能引号。** 添加带撇号或引号的文本时，使用 XML 实体来生成智能引号：
```xml
<!-- 为专业排版使用这些实体 -->
<w:t>Here&#x2019;s a quote: &#x201C;Hello&#x201D;</w:t>
```
| 实体 | 字符 |
|--------|-----------|
| `&#x2018;` | ‘ （左单引号） |
| `&#x2019;` | ‘ （右单引号/撇号） |
| `&#x201C;` | “ （左双引号） |
| `&#x201D;` | “ （右双引号） |

**添加评论：** 使用 `comment.py` 处理多个 XML 文件中的样板（文本必须预转义的 XML）：
```bash
python scripts/comment.py unpacked/ 0 “评论文本 with &amp; and &#x2019;”
python scripts/comment.py unpacked/ 1 “回复文本” --parent 0  # 回复评论 0
python scripts/comment.py unpacked/ 0 “文本” --author “自定义作者”  # 自定义作者名
```
然后将标记添加到 document.xml（见 XML 参考中的评论）。

### 第 3 步：打包
```bash
python scripts/office/pack.py unpacked/ output.docx --original document.docx
```
使用自动修复验证、压缩 XML 并创建 DOCX。使用 `--validate false` 跳过。

**自动修复将修复：**
- `durableId` >= 0x7FFFFFFF（重新生成有效的 ID）
- `<w:t>` 上缺失的 `xml:space=”preserve”`（有空白的）

**自动修复不会修复：**
- 格式错误的 XML、无效的元素嵌套、缺失的关系、模式违规

### 常见陷阱

- **替换整个 `<w:r>` 元素**：添加跟踪的更改时，用 `<w:del>...<w:ins>...` 作为兄弟元素替换整个 `<w:r>...</w:r>` 块。不要在运行内注入跟踪更改标签。
- **保留 `<w:rPr>` 格式**：将原始运行的 `<w:rPr>` 块复制到你的跟踪更改运行中以维持加粗、字体大小等。

---

## XML 参考

### 模式合规

- **`<w:pPr>` 中的元素顺序**：`<w:pStyle>`、`<w:numPr>`、`<w:spacing>`、`<w:ind>`、`<w:jc>`、最后 `<w:rPr>`
- **空白**：将 `xml:space="preserve"` 添加到带前导/尾随空格的 `<w:t>`
- **RSIDs**：必须是 8 位十六进制（例如 `00AB1234`）

### 跟踪的更改

**插入：**
```xml
<w:ins w:id="1" w:author="Claude" w:date="2025-01-01T00:00:00Z">
  <w:r><w:t>插入的文本</w:t></w:r>
</w:ins>
```

**删除：**
```xml
<w:del w:id="2" w:author="Claude" w:date="2025-01-01T00:00:00Z">
  <w:r><w:delText>删除的文本</w:delText></w:r>
</w:del>
```

**在 `<w:del>` 内部**：使用 `<w:delText>` 而不是 `<w:t>`，使用 `<w:delInstrText>` 而不是 `<w:instrText>`。

**最小编辑** - 仅标记更改的内容：
```xml
<!-- 将"30 天"改为"60 天"-->
<w:r><w:t>期限是 </w:t></w:r>
<w:del w:id="1" w:author="Claude" w:date="...">
  <w:r><w:delText>30</w:delText></w:r>
</w:del>
<w:ins w:id="2" w:author="Claude" w:date="...">
  <w:r><w:t>60</w:t></w:r>
</w:ins>
<w:r><w:t> 天。</w:t></w:r>
```

**删除整个段落/列表项** - 删除段落中的所有内容时，也将段落标记标记为删除以便与下一段合并。在 `<w:pPr><w:rPr>` 内添加 `<w:del/>`：
```xml
<w:p>
  <w:pPr>
    <w:numPr>...</w:numPr>  <!-- 如果存在列表编号 -->
    <w:rPr>
      <w:del w:id="1" w:author="Claude" w:date="2025-01-01T00:00:00Z"/>
    </w:rPr>
  </w:pPr>
  <w:del w:id="2" w:author="Claude" w:date="2025-01-01T00:00:00Z">
    <w:r><w:delText>正在删除的整个段落内容...</w:delText></w:r>
  </w:del>
</w:p>
```
如果没有 `<w:pPr><w:rPr>` 中的 `<w:del/>`，接受更改会留下一个空段落/列表项。

**拒绝另一个作者的插入** - 在他们的插入内嵌套删除：
```xml
<w:ins w:author="Jane" w:id="5">
  <w:del w:author="Claude" w:id="10">
    <w:r><w:delText>他们插入的文本</w:delText></w:r>
  </w:del>
</w:ins>
```

**恢复另一个作者的删除** - 在后面添加插入（不要修改他们的删除）：
```xml
<w:del w:author="Jane" w:id="5">
  <w:r><w:delText>删除的文本</w:delText></w:r>
</w:del>
<w:ins w:author="Claude" w:id="10">
  <w:r><w:t>删除的文本</w:t></w:r>
</w:ins>
```

### 评论

运行 `comment.py` 后（见第 2 步），将标记添加到 document.xml。对于回复，使用 `--parent` 标志并在父级内嵌套标记。

**重要：`<w:commentRangeStart>` 和 `<w:commentRangeEnd>` 是 `<w:r>` 的兄弟元素，永远不要在 `<w:r>` 内部。**

```xml
<!-- 评论标记是 w:p 的直接子元素，永远不要在 w:r 内部 -->
<w:commentRangeStart w:id="0"/>
<w:del w:id="1" w:author="Claude" w:date="2025-01-01T00:00:00Z">
  <w:r><w:delText>已删除</w:delText></w:r>
</w:del>
<w:r><w:t> 更多文本</w:t></w:r>
<w:commentRangeEnd w:id="0"/>
<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r>

<!-- 评论 0 with 回复 1 嵌套在内部 -->
<w:commentRangeStart w:id="0"/>
  <w:commentRangeStart w:id="1"/>
  <w:r><w:t>文本</w:t></w:r>
  <w:commentRangeEnd w:id="1"/>
<w:commentRangeEnd w:id="0"/>
<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r>
<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>
```

### 图像

1. 将图像文件添加到 `word/media/`
2. 将关系添加到 `word/_rels/document.xml.rels`：
```xml
<Relationship Id="rId5" Type=".../image" Target="media/image1.png"/>
```
3. 将内容类型添加到 `[Content_Types].xml`：
```xml
<Default Extension="png" ContentType="image/png"/>
```
4. 在 document.xml 中引用：
```xml
<w:drawing>
  <wp:inline>
    <wp:extent cx="914400" cy="914400"/>  <!-- EMUs：914400 = 1 英寸 -->
    <a:graphic>
      <a:graphicData uri=".../picture">
        <pic:pic>
          <pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing>
```

---

## 依赖

- **pandoc**：文本提取
- **docx**：`npm install -g docx`（新文档）
- **LibreOffice**：PDF 转换（通过 `scripts/office/soffice.py` 为沙盒环境自动配置）
- **Poppler**：`pdftoppm` 用于图像
