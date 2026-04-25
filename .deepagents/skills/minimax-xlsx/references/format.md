# 财务格式化与输出标准 — 完整代理指南

> 本文档是代理在对 xlsx 文件应用专业财务格式化时的完整参考手册。所有操作针对对 `xl/styles.xml` 的直接 XML 手术，不使用 openpyxl。每个操作步骤都提供现成可用的 XML 片段。

---

## 1. 何时使用此路径

本文档（FORMAT 路径）适用于以下两种情景：

**情景 A — 现有文件的专用格式化**
用户提供现有 xlsx 文件，并要求应用或统一财务建模格式化标准。起点是解包文件、审计现有 `styles.xml`、追加缺失样式并批量更新单元格 `s` 属性。不修改任何单元格值或公式。

**情景 B — 在 CREATE/EDIT 后应用格式化标准**
完成数据输入或公式编写后，格式化作为最后一步应用。此时，`styles.xml` 可能来自 minimal_xlsx 模板（预定义 13 个样式槽位）或用户文件。无论哪种情况，遵循"仅追加，永不修改现有 xf 条目"的原则。

**不适用**：仅读取或分析文件内容（使用 READ 路径）；修改公式或数据（使用 EDIT 路径）。

---

## 2. 财务格式化语义系统

### 2.1 字体颜色 = 单元格角色（颜色 = 角色）

财务建模的主要约定：**字体颜色编码单元格的角色，而不是装饰**。审查者可以一眼看出颜色来判断哪些单元格是可调整的参数，哪些是模型计算的结果。这是行业范围的约定（投资银行、四大会计师事务所和企业财务团队都遵循）。

| 角色 | 字体颜色 | AARRGGBB | 用例 |
|------|-----------|----------|----------|
| 硬编码输入 / 假设 | 蓝色 | `000000FF` | 增长率、折现率、税率以及其他用户可修改的参数 |
| 公式 / 计算结果 | 黑色 | `00000000` | 所有包含 `<f>` 元素的单元格 |
| 相同工作簿跨工作表引用 | 绿色 | `00008000` | 公式以 `SheetName!` 开头的单元格 |
| 外部文件链接 | 红色 | `00FF0000` | 公式包含 `[FileName.xlsx]` 的单元格（标记为脆弱链接） |
| 标签 / 文本 | 黑色（默认） | 主题颜色 | 行标签、分类标题 |
| 需要审查的关键假设 | 蓝色字体 + 黄色填充 | 字体 `000000FF` / 填充 `00FFFF00` | 临时值、待确认参数 |

**决策树**：
```
单元格包含 <f> 元素吗？
  +-- 是 -> 公式以 [FileName] 开头吗？
  |         +-- 是 -> 红色（外部链接）
  |         +-- 否 -> 公式包含 SheetName! 吗？
  |                   +-- 是 -> 绿色（跨工作表引用）
  |                   +-- 否 -> 黑色（相同工作表公式）
  +-- 否 -> 值是用户可调整的参数吗？
            +-- 是 -> 蓝色（输入/假设）
            +-- 否 -> 黑色默认（标签）
```

**严格禁止**：蓝色字体 + `<f>` 元素并存（颜色角色矛盾 — 必须纠正）。

### 2.2 数字格式矩阵

| 数据类型 | formatCode | numFmtId | 显示示例 | 适用场景 |
|-----------|-----------|----------|-----------------|---------------------|
| 标准货币（整数美元） | `$#,##0;($#,##0);"-"` | 164 | $1,234 / ($1,234) / - | P&L、资产负债表金额行 |
| 标准货币（含美分） | `$#,##0.00;($#,##0.00);"-"` | 169 | $1,234.56 / ($1,234.56) / - | 单位价格、详细成本 |
| 千位（K） | `#,##0,"K"` | 171 | 1,234K | 管理报告简化显示 |
| 百万位（M） | `#,##0,,"M"` | 172 | 1M | 宏观级汇总行 |
| 百分比（1 位小数） | `0.0%` | 165 | 12.5% | 增长率、毛利率 |
| 百分比（2 位小数） | `0.00%` | 170 | 12.50% | IRR、精确利率 |
| 倍数 / 估值倍数 | `0.0x` | 166 | 8.5x | EV/EBITDA、P/E |
| 整数（千位分隔符） | `#,##0` | 167 | 12,345 | 员工数、单位数量 |
| 年份 | `0` | 1（内置，无需声明） | 2024 | 列标题年份，防止 2,024 |
| 日期 | `m/d/yyyy` | 14（内置，无需声明） | 3/21/2026 | 时间表 |
| 常规文本 | General | 0（内置，无需声明） | — | 标签行、无格式要求的单元格 |

numFmtId 169–172 是自定义格式，需要在 minimal_xlsx 模板预定义的 4 个格式（164–167）之外追加。追加时，按照规则分配 ID（参阅第 3.4 节）。

**内置格式 ID 不需要在 `<numFmts>` 中声明**（ID 0–163 内置于 Excel/LibreOffice 中；只需在 `<xf>` 中引用 numFmtId）：

| numFmtId | formatCode | 说明 |
|----------|-----------|-------------|
| 0 | General | 常规格式 |
| 1 | `0` | 整数，无千位分隔符（用此 ID 代表年份） |
| 3 | `#,##0` | 千位分隔整数（无小数位） |
| 9 | `0%` | 百分比整数 |
| 10 | `0.00%` | 两位小数百分比 |
| 14 | `m/d/yyyy` | 短日期 |

### 2.3 负数显示标准

财务报告对负数有两种主流约定 — 选择一种并**在整个工作簿中保持一致**：

**括号风格（投资银行标准，推荐用于外部交付物）**

```
正数：$1,234    负数：($1,234)    零：-
formatCode: $#,##0;($#,##0);"-"
```

**红色减号风格（适用于内部运营分析报告）**

```
正数：$1,234    负数：-$1,234（红色）
formatCode: $#,##0;[Red]-$#,##0;"-"
```

规则：一旦确定风格，在整个工作簿中保持。不要在同一工作簿中混用两种负数显示风格。

### 2.4 零值显示标准

在财务模型中，"0"和"无数据"有不同的语义，应该在视觉上区分：

| 场景 | 推荐显示 | formatCode 第三段 |
|----------|-------------------|--------------------------|
| 稀疏矩阵（大多数行有零值周期） | 破折号 `-` | `"-"` |
| 数量计数（零本身有意义） | `0` | `0` 或省略 |
| 占位符行（显式空） | 留空 | 不向单元格写入 |

四段格式语法：`正数格式;负数格式;零值格式;文本格式`

零作为破折号：`$#,##0;($#,##0);"-"`
零保留为 0：`#,##0;(#,##0);0`

---

## 3. styles.xml 手术操作

### 3.1 审计现有样式：理解 cellXfs 间接引用链

单元格的 `s` 属性指向 `cellXfs` 中的位置索引（0 索引），`cellXfs` 中的每个 `<xf>` 条目通过 `fontId`、`fillId`、`borderId` 和 `numFmtId` 引用其各自的定义库。

参考链图：

```
单元格 <c s="6">
    | 按 0 索引查找 cellXfs
cellXfs[6] -> numFmtId="164" fontId="2" fillId="0" borderId="0"
    |            |               |          |
numFmts         fonts[2]      fills[0]   borders[0]
id=164          color=00000000  (无填充)  (无边框)
$#,##0...       black
```

审计步骤：

**步骤 1**：读 `<numFmts>` 并记录所有声明的自定义格式及其 ID：
```xml
<numFmts count="4">
  <numFmt numFmtId="164" formatCode="$#,##0;($#,##0);&quot;-&quot;"/>
  <numFmt numFmtId="165" formatCode="0.0%"/>
  <numFmt numFmtId="166" formatCode="0.0x"/>
  <numFmt numFmtId="167" formatCode="#,##0"/>
</numFmts>
```
记录：当前最大自定义 numFmtId = 167，下一个可用 ID = 168。

**步骤 2**：读 `<fonts>` 并按 0 索引列出每个 `<font>` 及其颜色和样式：
```
fontId=0 -> 无显式颜色（主题默认黑色）
fontId=1 -> color rgb="000000FF"（蓝色，输入角色）
fontId=2 -> color rgb="00000000"（黑色，公式角色）
fontId=3 -> color rgb="00008000"（绿色，跨工作表引用角色）
fontId=4 -> <b/> + color rgb="00000000"（粗体黑色，标题）
```

**步骤 3**：读 `<fills>` 并确认 fills[0] 和 fills[1] 是规范规定的保留条目（永不删除）：
```
fillId=0 -> patternType="none"（规范规定）
fillId=1 -> patternType="gray125"（规范规定）
fillId=2 -> 黄色高亮（如存在）
```

**步骤 4**：读 `<cellXfs>` 并按 0 索引列出每个 `<xf>` 条目及其组合：
```
索引 0 -> numFmtId=0,   fontId=0, fillId=0 -> 默认样式
索引 1 -> numFmtId=0,   fontId=1, fillId=0 -> 蓝色字体常规（输入）
索引 5 -> numFmtId=164, fontId=1, fillId=0 -> 蓝色字体货币（货币输入）
索引 6 -> numFmtId=164, fontId=2, fillId=0 -> 黑色字体货币（货币公式）
...
```

**步骤 5**：验证所有 count 属性与实际元素数量匹配（count 不匹配会导致 Excel 拒绝打开文件）。

### 3.2 Safely Appending New Styles (Golden Rule: Append Only, Never Modify Existing xf)

**Never modify existing `<xf>` entries**. Modifications will affect all cells that already reference that index, breaking existing formatting. Only append new entries at the end.

Complete atomic operation sequence for appending new styles (all 5 steps must be executed):

**Step 1**: Determine if a new `<numFmt>` is needed

Built-in formats (ID 0–163) skip this step. Custom formats are appended to the end of `<numFmts>`:
```xml
<numFmts count="5">  <!-- count +1 -->
  <!-- Keep existing entries unchanged -->
  <numFmt numFmtId="164" formatCode="$#,##0;($#,##0);&quot;-&quot;"/>
  <numFmt numFmtId="165" formatCode="0.0%"/>
  <numFmt numFmtId="166" formatCode="0.0x"/>
  <numFmt numFmtId="167" formatCode="#,##0"/>
  <!-- Newly appended -->
  <numFmt numFmtId="168" formatCode="$#,##0.00;($#,##0.00);&quot;-&quot;"/>
</numFmts>
```

**Step 2**: Determine if a new `<font>` is needed

Check whether the existing fonts already contain a matching color+style combination. If not, append to the end of `<fonts>`:
```xml
<fonts count="6">  <!-- count +1 -->
  <!-- Keep existing entries unchanged -->
  ...
  <!-- Newly appended: red font (external link role), new fontId = 5 -->
  <font>
    <sz val="11"/>
    <name val="Calibri"/>
    <color rgb="00FF0000"/>
  </font>
</fonts>
```
New fontId = the count value before appending (when original count=5, new fontId=5).

**Step 3**: Determine if a new `<fill>` is needed

If a new background color is needed, append to the end of `<fills>` (note: fills[0] and fills[1] must never be modified):
```xml
<fills count="4">  <!-- count +1 -->
  <fill><patternFill patternType="none"/></fill>       <!-- 0: spec-mandated -->
  <fill><patternFill patternType="gray125"/></fill>    <!-- 1: spec-mandated -->
  <fill>                                               <!-- 2: yellow highlight -->
    <patternFill patternType="solid">
      <fgColor rgb="00FFFF00"/>
      <bgColor indexed="64"/>
    </patternFill>
  </fill>
  <!-- Newly appended: light gray fill (projection period distinction), new fillId = 3 -->
  <fill>
    <patternFill patternType="solid">
      <fgColor rgb="00D3D3D3"/>
      <bgColor indexed="64"/>
    </patternFill>
  </fill>
</fills>
```

**Step 4**: Append a new `<xf>` combination at the end of `<cellXfs>`
```xml
<cellXfs count="14">  <!-- count +1 -->
  <!-- Keep existing entries 0-12 unchanged -->
  ...
  <!-- Newly appended index=13: currency with cents formula (black font + numFmtId=168) -->
  <xf numFmtId="168" fontId="2" fillId="0" borderId="0" xfId="0"
      applyFont="1" applyNumberFormat="1"/>
</cellXfs>
```
New style index = the count value before appending (when original count=13, new index=13).

**Step 5**: Record the new style index; subsequently set the `s` attribute of corresponding cells in the sheet XML to this value.

### 3.3 AARRGGBB Color Format Explanation

OOXML's `rgb` attribute uses **8-digit hexadecimal AARRGGBB** format (not HTML's 6-digit RRGGBB):

```
AA  RR  GG  BB
|   |   |   |
Alpha Red Green Blue
```

- Alpha channel: `00` = fully opaque (normal use value); `FF` = fully transparent (invisible, never use this)
- Financial color standards always use `00` as the Alpha prefix

| Color | AARRGGBB | Corresponding Role |
|-------|----------|-------------------|
| Blue (input) | `000000FF` | Hard-coded assumptions |
| Black (formula) | `00000000` | Calculated results |
| Green (cross-sheet reference) | `00008000` | Same-workbook cross-sheet |
| Red (external link) | `00FF0000` | References to other files |
| Yellow (review-required fill) | `00FFFF00` | Key assumption highlight |
| Light gray (projection period fill) | `00D3D3D3` | Distinguishing historical vs. forecast periods |
| White | `00FFFFFF` | Pure white fill |

**Common mistake**: Mistakenly writing HTML format `#0000FF` as `FF0000FF` (Alpha=FF makes the color fully transparent and invisible). Correct format: `000000FF`.

### 3.4 numFmtId Assignment Rules

```
ID 0-163    -> Excel/LibreOffice built-in formats, no declaration needed in <numFmts>, reference directly in <xf>
ID 164+     -> Custom formats, must be explicitly declared as <numFmt> elements in <numFmts>
```

Rules for assigning new IDs:
1. Read all `numFmtId` attribute values in the current `<numFmts>`
2. Take the maximum value + 1 as the next custom format ID
3. Do not reuse existing IDs; do not skip numbers

The minimal_xlsx template pre-defines IDs: 164, 165, 166, 167. The next available ID is 168.

---

## 4. Pre-defined Style Index Complete Reference Table (13 Slots)

The following are the 13 style slots (cellXfs index 0–12) pre-defined in the minimal_xlsx template's `styles.xml`, which can be directly referenced in the cell `s` attribute in sheet XML:

| Index | Semantic Role | Font Color | Fill | numFmtId | Format Display | Typical Use |
|-------|--------------|------------|------|----------|---------------|-------------|
| **0** | Default style | Theme black | None | 0 | General | Cells requiring no special formatting |
| **1** | Input / assumption (general) | Blue `000000FF` | None | 0 | General | Text-type assumptions, flags |
| **2** | Formula / calculated result (general) | Black `00000000` | None | 0 | General | Text concatenation formulas, non-numeric calculations |
| **3** | Cross-sheet reference (general) | Green `00008000` | None | 0 | General | Values pulled from cross-sheet (general format) |
| **4** | Header (bold) | Bold black | None | 0 | General | Row/column headings |
| **5** | Currency input | Blue `000000FF` | None | 164 | $1,234 / ($1,234) / - | Amount inputs in the assumptions area |
| **6** | Currency formula | Black `00000000` | None | 164 | $1,234 / ($1,234) / - | Amount calculations in the model area (revenue, EBITDA) |
| **7** | Percentage input | Blue `000000FF` | None | 165 | 12.5% | Rate inputs in the assumptions area (growth rate, gross margin assumptions) |
| **8** | Percentage formula | Black `00000000` | None | 165 | 12.5% | Rate calculations in the model area (actual gross margin) |
| **9** | Integer (comma) input | Blue `000000FF` | None | 167 | 12,345 | Quantity inputs in the assumptions area (employee count) |
| **10** | Integer (comma) formula | Black `00000000` | None | 167 | 12,345 | Quantity calculations in the model area |
| **11** | Year input | Blue `000000FF` | None | 1 | 2024 | Column header years (no thousands separator) |
| **12** | Key assumption highlight | Blue `000000FF` | Yellow `00FFFF00` | 0 | General | Key parameters pending review or confirmation |

**Selection guide**:
- Determine "input" vs. "formula" -> Choose odd-numbered (input/blue) or even-numbered (formula/black) paired slots
- Determine data type -> Choose the corresponding currency (5/6) / percentage (7/8) / integer (9/10) / year (11) slot
- Cross-sheet reference needing number format -> Append a new green + number format combination (see Section 5.4)
- Parameter pending review -> index 12

---

## 5. Assumption Separation Principle: XML-Level Implementation

### 5.1 Structural Design

Assumption separation principle: **Input assumptions are centralized in a dedicated area (sheet or block); the model calculation area contains only formulas, no hard-coded values**.

Recommended structure:
```
Workbook sheet layout
  sheet 1 "Assumptions"  -> All blue-font cells (style 1/5/7/9/11/12)
  sheet 2 "Model"        -> All black or green-font cells (style 2/3/4/6/8/10)
```

Same-sheet zoning approach for simple models:
```
Rows 1-5:   [Assumptions block - blue font]
Row 6:      [Empty row separator]
Rows 7+:    [Model block - black/green font formulas referencing assumptions area]
```

### 5.2 Assumptions Area XML Example

```xml
<!-- Assumptions sheet (sheet1.xml) example -->

<!-- Row 1: Block title -->
<row r="1">
  <c r="A1" s="4" t="inlineStr"><is><t>Model Assumptions</t></is></c>
</row>

<!-- Row 2: Growth rate assumption - blue font percentage input, s="7" -->
<row r="2">
  <c r="A2" t="inlineStr"><is><t>Revenue Growth Rate</t></is></c>
  <c r="B2" s="7"><v>0.08</v></c>
</row>

<!-- Row 3: Gross margin assumption - blue font percentage input, s="7" -->
<row r="3">
  <c r="A3" t="inlineStr"><is><t>Gross Margin</t></is></c>
  <c r="B3" s="7"><v>0.65</v></c>
</row>

<!-- Row 4: Base revenue - blue font currency input, s="5" -->
<row r="4">
  <c r="A4" t="inlineStr"><is><t>Base Revenue (Year 0)</t></is></c>
  <c r="B4" s="5"><v>1000000</v></c>
</row>

<!-- Row 5: Key assumption (pending review) - blue font yellow fill, s="12" -->
<row r="5">
  <c r="A5" t="inlineStr"><is><t>Terminal Growth Rate</t></is></c>
  <c r="B5" s="12"><v>0.03</v></c>
</row>
```

### 5.3 Model Area XML Example (Referencing Assumptions Area)

```xml
<!-- Model sheet (sheet2.xml) example -->

<!-- Row 1: Column headers (years) - bold header, s="4"; year cells, s="11" -->
<row r="1">
  <c r="A1" s="4" t="inlineStr"><is><t>Metric</t></is></c>
  <c r="B1" s="11"><v>2024</v></c>
  <c r="C1" s="11"><v>2025</v></c>
  <c r="D1" s="11"><v>2026</v></c>
</row>

<!-- Row 2: Revenue row -->
<row r="2">
  <c r="A2" t="inlineStr"><is><t>Revenue</t></is></c>
  <!-- B2: Base year revenue, cross-sheet reference from Assumptions, green, s="3" (general format) -->
  <!-- If currency format is needed, append new style s="13" (see Section 5.4) -->
  <c r="B2" s="3"><f>Assumptions!B4</f><v></v></c>
  <!-- C2, D2: Next year revenue = prior year * (1 + growth rate), black font currency formula, s="6" -->
  <c r="C2" s="6"><f>B2*(1+Assumptions!B2)</f><v></v></c>
  <c r="D2" s="6"><f>C2*(1+Assumptions!B2)</f><v></v></c>
</row>

<!-- Row 3: Gross profit row - black font currency formula, s="6" -->
<row r="3">
  <c r="A3" t="inlineStr"><is><t>Gross Profit</t></is></c>
  <c r="B3" s="6"><f>B2*Assumptions!B3</f><v></v></c>
  <c r="C3" s="6"><f>C2*Assumptions!B3</f><v></v></c>
  <c r="D3" s="6"><f>D2*Assumptions!B3</f><v></v></c>
</row>

<!-- Row 4: Gross margin row - black font percentage formula, s="8" -->
<row r="4">
  <c r="A4" t="inlineStr"><is><t>Gross Margin %</t></is></c>
  <c r="B4" s="8"><f>B3/B2</f><v></v></c>
  <c r="C4" s="8"><f>C3/C2</f><v></v></c>
  <c r="D4" s="8"><f>D3/D2</f><v></v></c>
</row>
```

### 5.4 Appending "Green + Number Format" Combinations

Pre-defined index 3 is green font + general format. If a cross-sheet reference involves a currency amount, a green style with a number format must be appended:

```xml
<!-- Append at the end of <cellXfs> in styles.xml (assuming current count=13, new index=13) -->
<!-- index 13: cross-sheet reference + currency format (green font + $#,##0) -->
<xf numFmtId="164" fontId="3" fillId="0" borderId="0" xfId="0"
    applyFont="1" applyNumberFormat="1"/>
<!-- Update count to 14 -->
```

After appending, cross-sheet reference currency cells use `s="13"`.

---

## 6. Complete Operational Workflow

### 6.1 Workflow Overview

```
[Existing xlsx or file after CREATE/EDIT]
        |
  Step 1: Unpack (extract to temporary directory)
        |
  Step 2: Audit styles.xml (review existing styles, build index mapping table)
        |
  Step 3: Audit sheet XML (identify cells needing formatting and their semantic roles)
        |
  Step 4: Append missing styles (numFmt -> font -> fill -> xf, update counts)
        |
  Step 5: Batch-update the s attribute of each cell in the sheet XML
        |
  Step 6: XML validity + style reference integrity verification
        |
  Step 7: Pack (recompress as xlsx)
```

### 6.2 Step 1 — Unpack

```bash
python3 SKILL_DIR/scripts/xlsx_unpack.py input.xlsx /tmp/xlsx_fmt/
```

If the script is unavailable, unpack manually:
```bash
mkdir -p /tmp/xlsx_fmt && cp input.xlsx /tmp/xlsx_fmt/input.xlsx
cd /tmp/xlsx_fmt && unzip input.xlsx -d unpacked/
```

### 6.3 Step 2 — Audit styles.xml

Execute according to the method in Section 3.1. Quick check for minimal_xlsx template initial state:
- `<cellXfs count="13">` and `<numFmts count="4">` -> Template initial state, all 13 pre-defined slots can be used directly
- Otherwise -> A complete review of the existing index mapping is required

### 6.4 Step 3 — Audit Sheet XML, Build Formatting Plan

Read `xl/worksheets/sheet*.xml` and evaluate each cell:
1. Does it contain a `<f>` element (formula)? -> Requires black/green/red style
2. Is it a hard-coded numeric parameter? -> Requires blue style
3. Is the data type currency/percentage/integer/year? -> Select the corresponding number format slot
4. Is it a header? -> Bold style (index 4)

Build a formatting mapping table: `{cell coordinate: target style index}`

### 6.5 Step 4 — Append Styles

Execute according to the atomic operation sequence in Section 3.2. Update the corresponding count attribute immediately after appending each component.

### 6.6 Step 5 — Batch-Update Cell s Attributes

```xml
<!-- Before formatting: no style -->
<c r="B5"><v>0.08</v></c>

<!-- After formatting: growth rate assumption, blue font percentage, s="7" -->
<c r="B5" s="7"><v>0.08</v></c>
```

```xml
<!-- Before formatting: formula without style -->
<c r="C10"><f>B10*(1+Assumptions!B2)</f><v></v></c>

<!-- After formatting: currency formula, black font, s="6" -->
<c r="C10" s="6"><f>B10*(1+Assumptions!B2)</f><v></v></c>
```

For consecutive rows of the same type, row-level default styles can be used to reduce repetition:
```xml
<!-- Entire row uses style=6, only override for exception cells -->
<row r="5" s="6" customFormat="1">
  <c r="A5" s="0" t="inlineStr"><is><t>Operating Income</t></is></c>  <!-- Text overridden to default -->
  <c r="B5"><f>B3-B4</f><v></v></c>   <!-- Inherits row-level s=6 -->
  <c r="C5"><f>C3-C4</f><v></v></c>
</row>
```

### 6.7 Step 6 — Verification

```bash
# XML validity verification is handled automatically by xlsx_pack.py, no need to manually run xmllint
# The pack script validates styles.xml and sheet XML legality before packaging; it aborts and reports on errors

# Style audit (optional, audit the entire unpacked directory after formatting is complete)
python3 SKILL_DIR/scripts/style_audit.py /tmp/xlsx_fmt/unpacked/

# Formula error static scan (must specify a single .xlsx file, does not accept directories)
# Pack first, then scan:
python3 SKILL_DIR/scripts/xlsx_pack.py /tmp/xlsx_fmt/unpacked/ /tmp/output.xlsx
python3 SKILL_DIR/scripts/formula_check.py /tmp/output.xlsx
```

Manual style reference integrity check:
```bash
# Find the maximum s attribute value in the sheet XML
grep -o 's="[0-9]*"' /tmp/xlsx_fmt/unpacked/xl/worksheets/sheet1.xml \
  | grep -o '[0-9]*' | sort -n | tail -1

# Compare with the cellXfs count attribute (max s value must be < count)
grep 'cellXfs count' /tmp/xlsx_fmt/unpacked/xl/styles.xml
```

### 6.8 Step 7 — Pack

```bash
python3 SKILL_DIR/scripts/xlsx_pack.py /tmp/xlsx_fmt/unpacked/ output.xlsx
```

If the script is unavailable, pack manually:
```bash
cd /tmp/xlsx_fmt/unpacked/
zip -r ../output.xlsx . -x "*.DS_Store"
```

---

## 7. Formatting Completeness Checklist

Verify each item before delivery:

### Color Role Consistency
- [ ] All numeric cells containing `<f>` elements: fontId corresponds to black (formula) or green (cross-sheet reference)
- [ ] All hard-coded numeric values that are user-adjustable parameters: fontId corresponds to blue (input)
- [ ] Cross-sheet references (formula contains `SheetName!`): fontId corresponds to green
- [ ] External file references (formula contains `[FileName.xlsx]`): fontId corresponds to red
- [ ] No cell simultaneously contains a `<f>` element and uses blue font (color role contradiction)

### Number Format Correctness
- [ ] Year columns: numFmtId="1" (`0` format), displays as 2024 not 2,024
- [ ] Currency rows: numFmtId="164" or variant, negative numbers display as ($1,234) not -$1,234
- [ ] Percentage rows: values stored as decimals (0.08 = 8%), format numFmtId="165", displays as 8.0%
- [ ] Zero values: displayed as `-` in sparse matrices rather than `0` (formatCode third segment contains `"-"`)
- [ ] Multiple rows (EV/EBITDA, etc.): numFmtId="166" (`0.0x` format)
- [ ] Negative number display style is consistent throughout the entire workbook (parenthetical or red minus sign)

### styles.xml Structural Integrity
- [ ] `<numFmts count>` = actual number of `<numFmt>` elements
- [ ] `<fonts count>` = actual number of `<font>` elements
- [ ] `<fills count>` = actual number of `<fill>` elements (including spec-mandated fills[0] and fills[1])
- [ ] `<cellXfs count>` = actual number of `<xf>` elements
- [ ] fills[0] is `patternType="none"`, fills[1] is `patternType="gray125"` (spec-mandated)
- [ ] All `<xf>` referenced fontId / fillId / borderId are within the valid range of their respective collections
- [ ] All cell `s` attribute values < `cellXfs count` (no out-of-bounds references)

### Assumption Separation Verification
- [ ] No black-font numeric cells in the assumptions area/sheet (black numeric = formula, should not be in assumptions)
- [ ] No blue-font non-year numeric cells in the model area/sheet (blue numeric = hard-coded, should be in assumptions)
- [ ] Input parameters in the model area reference the assumptions area via formulas, not by directly copying values

### Formula and Format Linkage
- [ ] All cells with `<f>` elements have an explicit `s` attribute (must not use default style=0, whose font color is not explicitly black)
- [ ] SUM summary rows: style uses black font + corresponding number format (e.g., s="6" for currency summaries)
- [ ] Percentage formulas: values stored as decimals, format is `0.0%`; do not multiply values by 100 before applying percentage format

### Visual Hierarchy
- [ ] Header rows (years/metric names): style=4 (bold black)
- [ ] Summary rows (Total/EBITDA/Net Income): bold + corresponding number format (append style if needed)
- [ ] Unit description rows (e.g., "$ thousands"): use style=0 or style=2 (blue not needed)

---

## 8. Prohibited Actions (What You Must NOT Do)

- **Do not modify existing `<xf>` entries**: This will batch-change the style of all cells referencing that index
- **Do not delete fills[0] and fills[1]**: Required by OOXML specification; deletion causes file corruption
- **Do not modify cell values or formulas**: The FORMAT path only changes styles, not content
- **Do not use openpyxl for formatting**: openpyxl rewrites the entire styles.xml on save, losing unsupported features
- **Do not apply global override styles**: Do not cover the entire workbook with a single style; assign precisely by semantic role
- **Do not write FF in the Alpha channel**: `rgb="FF0000FF"` makes the color fully transparent; the correct format is `rgb="000000FF"`

---

## 9. Common Errors and Fixes

### Error 1: Year displays as 2,024

Cause: The year cell's `s` attribute uses a format with thousands separator (e.g., numFmtId="3" or numFmtId="167").

```xml
<!-- Incorrect -->
<c r="B1" s="9"><v>2024</v></c>

<!-- Fix: Change to s="11" (numFmtId="1", format 0) -->
<c r="B1" s="11"><v>2024</v></c>
```

### Error 2: Percentage displays as 800% (value was multiplied by 100)

Cause: 8% was stored as `<v>8</v>` instead of `<v>0.08</v>`. Excel's `%` format automatically multiplies the value by 100 for display.

```xml
<!-- Incorrect -->
<c r="B2" s="7"><v>8</v></c>

<!-- Fix: Value must be stored in decimal form -->
<c r="B2" s="7"><v>0.08</v></c>
```

### Error 3: File corruption after appending styles without updating count

Cause: A `<font>` or `<xf>` element was appended but the count attribute was not updated; Excel reads beyond bounds using the old count.

Fix: Update the corresponding count immediately after appending each element:
```xml
<!-- After appending the 6th font, count must be changed from 5 to 6 -->
<fonts count="6">
  ...
</fonts>
```

### Error 4: Blue font + formula (color role contradiction)

Cause: A formula cell mistakenly uses an input style (e.g., s="5" for currency input).

```xml
<!-- Incorrect: Formula cell uses blue input style -->
<c r="C5" s="5"><f>B5*1.08</f><v></v></c>

<!-- Fix: Change formula cell to corresponding black formula style (5->6, 7->8, 9->10) -->
<c r="C5" s="6"><f>B5*1.08</f><v></v></c>
```

### Error 5: AARRGGBB color missing Alpha (only 6 digits)

```xml
<!-- Incorrect: 6-digit format, behavior depends on implementation, usually causes wrong color -->
<color rgb="0000FF"/>

<!-- Fix: Always use 8-digit AARRGGBB, Alpha fixed at 00 -->
<color rgb="000000FF"/>
```

### Error 6: Modifying existing xf (affects all cells referencing that index)

Cause: Directly modifying attributes of the Nth `<xf>` in cellXfs, causing all cells with `s="N"` to be batch-changed.

Fix: Keep existing entries unchanged, append a new entry at the end, and only change the `s` attribute of cells that need the new style to the new index:
```xml
<!-- Incorrect: Modified the existing xf at index=6 -->
<xf numFmtId="164" fontId="2" fillId="0" borderId="0" xfId="0"
    applyFont="1" applyNumberFormat="1" applyAlignment="1">
  <alignment horizontal="right"/>  <!-- New attribute added, affects ALL cells already using s="6" -->
</xf>

<!-- Fix: Append new index (when original count=13, new index=13), only change the s attribute of cells needing right alignment -->
<!-- Keep index=6 as-is -->
<xf numFmtId="164" fontId="2" fillId="0" borderId="0" xfId="0"
    applyFont="1" applyNumberFormat="1" applyAlignment="1">
  <alignment horizontal="right"/>
</xf>  <!-- New index=13 -->
```

---

## 10. Financial Model Structure Conventions

### 10.1 Header Rows

- Bold font (corresponds to style index 4 in this skill's template)
- Year columns: use number format `0` (numFmtId="1", no thousands separator) to prevent 2024 from displaying as 2,024
- A unit description row may be added below headers: gray or italic text, e.g., "$ thousands" or "% of Revenue"

### 10.2 Row Type Standards

| Row Type | Style Recommendation | Example |
|----------|---------------------|---------|
| Category heading row | Bold, optionally with fill color | "Revenue" |
| Line item row | Normal style | "Product A", "Product B" |
| Subtotal row | Bold + top border | "Total Revenue" |
| Operating metric row | Normal style | "Gross Margin %" |
| Separator row | Empty row | (empty) |

### 10.3 Multi-Year Model Column Layout

```
Col A: Label column          (width 28, left-aligned text, s="4" for headers or s="0" for labels)
Col B: FY2022 Actual         (width 12, year header s="11", data cells styled by semantic role)
Col C: FY2023 Actual
Col D: FY2024E               (forecast period - can use light gray fill fillId=3 to differentiate)
Col E: FY2025E
Col F: FY2026E
```

### 10.4 Cross-Sheet Reference Patterns

Complete XML example of parameters passing from assumptions sheet to model sheet:

```xml
<!-- Assumptions sheet, cell B5: 8% growth rate, blue percentage input -->
<c r="B5" s="7"><v>0.08</v></c>

<!-- Model sheet, cell C10: references assumption area growth rate, green percentage formula -->
<!-- Requires appending index=13: green + percentage format (fontId=3, numFmtId=165) -->
<c r="C10" s="13"><f>Assumptions!B5</f><v></v></c>
```

---

## 11. Assumption Categories

In the assumptions area (Assumptions sheet or assumptions block), organize assumptions in the following standard order for ease of review and maintenance:

1. **Revenue assumptions**: Growth rates, pricing, sales volume
2. **Cost assumptions**: Gross margin, fixed/variable cost ratios
3. **Working capital**: DSO (Days Sales Outstanding), DPO (Days Payable Outstanding), inventory days
4. **Capital expenditures (CapEx)**: As a percentage of revenue or absolute amounts
5. **Financing assumptions**: Interest rates, debt repayment schedules
6. **Tax and other**: Effective tax rate, depreciation & amortization (D&A)

---

## 12. Audit Trail Best Practices

- Use `s="12"` (blue font + yellow fill highlight) to mark cells requiring review or pending changes, making them immediately visible to reviewers
- In sensitivity analysis rows or a separate Sensitivity tab, show the impact of +/-1% changes in key assumptions on results
- **Do not hide rows containing assumptions**: Assumption rows must be visible to reviewers; do not use the `hidden="1"` attribute
- Note a "Last Updated" date at the top of the assumptions area or in a dedicated cell, recording the last modification time of the model

---

## 13. Pre-Delivery Checklist (Common Financial Model Checklist)

Before outputting the final file, confirm each item:

- [ ] Formula rows contain no hard-coded values (can use `formula_check.py` to scan the packaged `.xlsx` file)
- [ ] Year columns display as 2024 not 2,024 (numFmtId="1", format `0`)
- [ ] Negative numbers display as (1,234) not -1,234 (use parenthetical style for externally delivered financial reports)
- [ ] Zero values display as `-` in sparse rows rather than `0` (formatCode third segment is `"-"`)
- [ ] Growth rates and percentages are stored as decimals (0.08 = 8%), format is `0.0%`
- [ ] All cross-sheet reference cells use green font (style index 3 or an appended green + number format combination)
- [ ] Assumptions block and model block are clearly separated (different sheets or separated by empty rows within the same sheet)
- [ ] Summary rows use `SUM()` formulas, not manually hard-coded totals
- [ ] Balance verification: summary rows = sum of their respective line items (a check row can be added at the end of the model to verify)
