---
name: minimax-xlsx
title: excel 编辑
description: "打开、创建、读取、分析、编辑或验证 Excel/电子表格文件（.xlsx、.xlsm、.csv、.tsv）。当用户要求创建、构建、修改、分析、读取、验证或格式化任何 Excel 电子表格、财务模型、数据透视表或表格数据文件时使用。涵盖：从头创建新 xlsx、读取和分析现有文件、编辑现有 xlsx（零格式损失）、公式重算和验证、以及应用专业财务格式标准。触发条件：'spreadsheet'（电子表格）、'Excel'、'.xlsx'、'.csv'、'pivot table'（数据透视表）、'financial model'（财务模型）、'formula'（公式）或任何要求以 Excel 格式生成表格数据的请求。"
license: MIT
metadata:
  version: "1.0"
  category: 生产力
  sources:
    - ECMA-376 Office Open XML 文件格式
    - Microsoft Open XML SDK 文档
---

# MiniMax XLSX 技能

直接处理请求。不要生成子代理。始终生成用户请求的输出文件。

## 任务路由

| 任务 | 方法 | 指南 |
|------|--------|-------|
| **读取** — 分析现有数据 | `xlsx_reader.py` + pandas | `references/read-analyze.md` |
| **创建** — 从头新建 xlsx | XML 模板 | `references/create.md` + `references/format.md` |
| **编辑** — 修改现有 xlsx | XML 解包→编辑→打包 | `references/edit.md`（如需样式则 + `format.md`） |
| **修复** — 修复现有 xlsx 中的损坏公式 | XML 解包→修复 `<f>` 节点→打包 | `references/fix.md` |
| **验证** — 检查公式 | `formula_check.py` | `references/validate.md` |

## 读取 — 分析数据（先读 `references/read-analyze.md`）

从 `xlsx_reader.py` 开始进行结构发现，然后使用 pandas 进行自定义分析。永远不要修改源文件。

**格式化规则**：当用户指定小数位数（例如"2 个小数位"）时，对所有数值应用该格式 — 对每个数字使用 `f'{v:.2f}'`。当需要 `12875.00` 时，永远不要输出 `12875`。

**聚合规则**：始终直接从 DataFrame 列计算总和/平均值/计数 — 例如 `df['Revenue'].sum()`。聚合前永远不要重新推导列值。

## 创建 — XML 模板（读 `references/create.md` + `references/format.md`）

复制 `templates/minimal_xlsx/` → 直接编辑 XML → 用 `xlsx_pack.py` 打包。每个推导值必须是 Excel 公式（`<f>SUM(B2:B9)</f>`），不能是硬编码数字。根据 `format.md` 应用字体颜色。

## 编辑 — XML 直接编辑（先读 `references/edit.md`）

**关键 — 编辑完整性规则：**
1. **对于编辑任务，永远不要创建新的 `Workbook()`**。始终加载原始文件。
2. 输出必须包含与输入**相同的工作表**（相同的名称、相同的数据）。
3. 仅修改任务要求的特定单元格 — 其他所有内容必须保持不变。
4. **保存 output.xlsx 后，验证它**：用 `xlsx_reader.py` 或 `pandas` 打开，确认原始工作表名称和原始数据样本存在。如果验证失败，说明你写了错误的文件 — 交付前修复。

永远不要对现有文件进行 openpyxl 往返（会损坏 VBA、数据透视表、迷你图）。改为：解包 → 使用辅助脚本 → 重新打包。

**"填充单元格" / "向现有单元格添加公式" = 编辑任务。** 如果输入文件已存在，且被告知填充、更新或向特定单元格添加公式，必须使用 XML 编辑路径。永远不要创建新的 `Workbook()`。示例 — 用跨工作表 SUM 公式填充 B3：
```bash
python3 SKILL_DIR/scripts/xlsx_unpack.py input.xlsx /tmp/xlsx_work/
# 通过 xl/workbook.xml → xl/_rels/workbook.xml.rels 找到目标工作表 XML
# 然后使用 Edit 工具向目标 <c> 元素内添加 <f>：
#   <c r="B3"><f>SUM('Sales Data'!D2:D13)</f><v></v></c>
python3 SKILL_DIR/scripts/xlsx_pack.py /tmp/xlsx_work/ output.xlsx
```

**添加列**（公式、数字格式、样式自动从相邻列复制）：
```bash
python3 SKILL_DIR/scripts/xlsx_unpack.py input.xlsx /tmp/xlsx_work/
python3 SKILL_DIR/scripts/xlsx_add_column.py /tmp/xlsx_work/ --col G \
    --sheet "Sheet1" --header "占总数的百分比" \
    --formula '=F{row}/$F$10' --formula-rows 2:9 \
    --total-row 10 --total-formula '=SUM(G2:G9)' --numfmt '0.0%' \
    --border-row 10 --border-style medium
python3 SKILL_DIR/scripts/xlsx_pack.py /tmp/xlsx_work/ output.xlsx
```
`--border-row` 标志向该行中的所有单元格应用顶部边框（不仅是新列）。当任务需要总行上的会计风格边框时使用。

**插入行**（移动现有行、更新 SUM 公式、修复循环引用）：
```bash
python3 SKILL_DIR/scripts/xlsx_unpack.py input.xlsx /tmp/xlsx_work/
# 重要：通过搜索工作表 XML 中的标签文本找到正确的 --at 行，
# 不是使用提示中的行号。
# 提示可能说"第 5 行（办公室租赁）"，但办公室租赁可能实际上
# 在第 4 行。始终先通过其文本标签定位行。
python3 SKILL_DIR/scripts/xlsx_insert_row.py /tmp/xlsx_work/ --at 5 \
    --sheet "预算 FY2025" --text A=公用事业 \
    --values B=3000 C=3000 D=3500 E=3500 \
    --formula 'F=SUM(B{row}:E{row})' --copy-style-from 4
python3 SKILL_DIR/scripts/xlsx_pack.py /tmp/xlsx_work/ output.xlsx
```
**行查找规则**：当任务说"在第 N 行（标签）之后"时，总是通过在工作表 XML 中搜索"标签"来查找该行（`grep -n "Label" /tmp/xlsx_work/xl/worksheets/sheet*.xml` 或检查 sharedStrings.xml）。对 `--at` 使用实际行号 + 1。不要单独调用 `xlsx_shift_rows.py` — `xlsx_insert_row.py` 在内部调用它。

**应用行宽边框**（例如总行上的会计线）：
运行辅助脚本后，向目标行中的所有单元格应用边框，而不仅仅是新添加的单元格。在 `xl/styles.xml` 中，附加一个带所需样式的新 `<border>`，然后在 `<cellXfs>` 中附加一个新 `<xf>`，该 `<xf>` 克隆每个单元格的现有 `<xf>` 但设置新的 `borderId`。通过 `s` 属性将新样式索引应用到行中的每个 `<c>`：
```xml
<!-- 在 xl/styles.xml 中，附加到 <borders>: -->
<border>
  <left/><right/><top style="medium"/><bottom/><diagonal/>
</border>
<!-- 然后附加到 <cellXfs> 一个为每个现有样式克隆新 borderId 的 xf -->
```
**关键规则**：当任务说"向行 N 添加边框"时，遍历从 A 到最后一列的所有单元格，而不仅仅是新添加的单元格。

**手动 XML 编辑**（对于辅助脚本不涵盖的任何内容）：
```bash
python3 SKILL_DIR/scripts/xlsx_unpack.py input.xlsx /tmp/xlsx_work/
# ... 使用 Edit 工具编辑 XML ...
python3 SKILL_DIR/scripts/xlsx_pack.py /tmp/xlsx_work/ output.xlsx
```

## 修复 — 修复损坏的公式（先读 `references/fix.md`）

这是一个编辑任务。解包 → 修复损坏的 `<f>` 节点 → 打包。保留所有原始工作表和数据。

## 验证 — 检查公式（先读 `references/validate.md`）

运行 `formula_check.py` 进行静态验证。在可用时使用 `libreoffice_recalc.py` 进行动态重算。

## 财务颜色标准

| 单元格角色 | 字体颜色 | 十六进制代码 |
|-----------|-----------|----------|
| 硬编码输入 / 假设 | 蓝色 | `0000FF` |
| 公式 / 计算结果 | 黑色 | `000000` |
| 跨工作表引用公式 | 绿色 | `00B050` |

## 关键规则

1. **公式优先**：每个计算单元格必须使用 Excel 公式，而不是硬编码数字
2. **创建 → XML 模板**：复制最小模板、直接编辑 XML、用 `xlsx_pack.py` 打包
3. **编辑 → XML**：永远不要 openpyxl 往返。使用解包/编辑/打包脚本
4. **始终生成输出文件** — 这是第 1 优先级
5. **交付前验证**：`formula_check.py` 退出代码 0 = 安全

## 实用脚本

```bash
python3 SKILL_DIR/scripts/xlsx_reader.py input.xlsx                 # 结构发现
python3 SKILL_DIR/scripts/formula_check.py file.xlsx --json         # 公式验证
python3 SKILL_DIR/scripts/formula_check.py file.xlsx --report      # 标准化报告
python3 SKILL_DIR/scripts/xlsx_unpack.py in.xlsx /tmp/work/         # 解包以进行 XML 编辑
python3 SKILL_DIR/scripts/xlsx_pack.py /tmp/work/ out.xlsx          # 编辑后重新打包
python3 SKILL_DIR/scripts/xlsx_shift_rows.py /tmp/work/ insert 5 1  # 为插入移动行
python3 SKILL_DIR/scripts/xlsx_add_column.py /tmp/work/ --col G ... # 添加带公式的列
python3 SKILL_DIR/scripts/xlsx_insert_row.py /tmp/work/ --at 6 ...  # 插入带数据的行
```
