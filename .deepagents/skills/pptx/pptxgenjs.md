# PptxGenJS 教程

## 设置和基本结构

```javascript
const pptxgen = require("pptxgenjs");

let pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';  // 或 'LAYOUT_16x10', 'LAYOUT_4x3', 'LAYOUT_WIDE'
pres.author = '你的名字';
pres.title = '演示文稿标题';

let slide = pres.addSlide();
slide.addText("你好世界!", { x: 0.5, y: 0.5, fontSize: 36, color: "363636" });

pres.writeFile({ fileName: "Presentation.pptx" });
```

## 布局尺寸

幻灯片尺寸（坐标单位：英寸）：
- `LAYOUT_16x9`：10" × 5.625"（默认）
- `LAYOUT_16x10`：10" × 6.25"
- `LAYOUT_4x3`：10" × 7.5"
- `LAYOUT_WIDE`：13.3" × 7.5"

---

## 文本和格式

```javascript
// 基本文本
slide.addText("简单文本", {
  x: 1, y: 1, w: 8, h: 2, fontSize: 24, fontFace: "Arial",
  color: "363636", bold: true, align: "center", valign: "middle"
});

// 字符间距（使用 charSpacing，不是 letterSpacing，后者会被无声忽略）
slide.addText("间距文本", { x: 1, y: 1, w: 8, h: 1, charSpacing: 6 });

// 富文本数组
slide.addText([
  { text: "加粗 ", options: { bold: true } },
  { text: "斜体 ", options: { italic: true } }
], { x: 1, y: 3, w: 8, h: 1 });

// 多行文本（需要 breakLine: true）
slide.addText([
  { text: "第 1 行", options: { breakLine: true } },
  { text: "第 2 行", options: { breakLine: true } },
  { text: "第 3 行" }  // 最后一项不需要 breakLine
], { x: 0.5, y: 0.5, w: 8, h: 2 });

// 文本框边距（内部填充）
slide.addText("标题", {
  x: 0.5, y: 0.3, w: 9, h: 0.6,
  margin: 0  // 当需要将文本与形状或图标等其他元素在同一 x 位置精确对齐时使用 0
});
```

**提示：** 文本框默认有内部边距。当需要文本与形状、线条或图标在同一 x 位置精确对齐时，设置 `margin: 0`。

---

## 列表和项目符号

```javascript
// ✅ 正确：多个项目符号
slide.addText([
  { text: "第一项", options: { bullet: true, breakLine: true } },
  { text: "第二项", options: { bullet: true, breakLine: true } },
  { text: "第三项", options: { bullet: true } }
], { x: 0.5, y: 0.5, w: 8, h: 3 });

// ❌ 错误：永远不要使用 Unicode 项目符号
slide.addText("• 第一项", { ... });  // 创建双项目符号

// 子项和编号列表
{ text: "子项", options: { bullet: true, indentLevel: 1 } }
{ text: "第一个", options: { bullet: { type: "number" }, breakLine: true } }
```

---

## 形状

```javascript
slide.addShape(pres.shapes.RECTANGLE, {
  x: 0.5, y: 0.8, w: 1.5, h: 3.0,
  fill: { color: "FF0000" }, line: { color: "000000", width: 2 }
});

slide.addShape(pres.shapes.OVAL, { x: 4, y: 1, w: 2, h: 2, fill: { color: "0000FF" } });

slide.addShape(pres.shapes.LINE, {
  x: 1, y: 3, w: 5, h: 0, line: { color: "FF0000", width: 3, dashType: "dash" }
});

// 带透明度
slide.addShape(pres.shapes.RECTANGLE, {
  x: 1, y: 1, w: 3, h: 2,
  fill: { color: "0088CC", transparency: 50 }
});

// 圆角矩形（rectRadius 仅适用于 ROUNDED_RECTANGLE，不适用于 RECTANGLE）
// ⚠️ 不要与矩形强调覆盖层配对 — 它们不会覆盖圆角。使用 RECTANGLE 代替。
slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 1, y: 1, w: 3, h: 2,
  fill: { color: "FFFFFF" }, rectRadius: 0.1
});

// 带阴影
slide.addShape(pres.shapes.RECTANGLE, {
  x: 1, y: 1, w: 3, h: 2,
  fill: { color: "FFFFFF" },
  shadow: { type: "outer", color: "000000", blur: 6, offset: 2, angle: 135, opacity: 0.15 }
});
```

阴影选项：

| 属性 | 类型 | 范围 | 注释 |
|----------|------|-------|-------|
| `type` | 字符串 | `"outer"`、`"inner"` | |
| `color` | 字符串 | 6 字符十六进制（如 `"000000"`） | 无 `#` 前缀，无 8 字符十六进制 — 见常见陷阱 |
| `blur` | 数字 | 0-100 pt | |
| `offset` | 数字 | 0-200 pt | **必须为非负** — 负值会损坏文件 |
| `angle` | 数字 | 0-359 度 | 阴影落下的方向（135 = 右下，270 = 向上） |
| `opacity` | 数字 | 0.0-1.0 | 用于透明度，永远不要在颜色字符串中编码 |

要在向上投射阴影（例如在页脚栏上），使用 `angle: 270` 和正偏移量 — **不要**使用负偏移量。

**注意**：原生不支持渐变填充。改为使用渐变图像作为背景。

---

## 图像

### 图像来源

```javascript
// 从文件路径
slide.addImage({ path: "images/chart.png", x: 1, y: 1, w: 5, h: 3 });

// 从 URL
slide.addImage({ path: "https://example.com/image.jpg", x: 1, y: 1, w: 5, h: 3 });

// 从 base64（更快，无文件 I/O）
slide.addImage({ data: "image/png;base64,iVBORw0KGgo...", x: 1, y: 1, w: 5, h: 3 });
```

### 图像选项

```javascript
slide.addImage({
  path: "image.png",
  x: 1, y: 1, w: 5, h: 3,
  rotate: 45,              // 0-359 度
  rounding: true,          // 圆形裁剪
  transparency: 50,        // 0-100
  flipH: true,             // 水平翻转
  flipV: false,            // 垂直翻转
  altText: "描述",          // 无障碍
  hyperlink: { url: "https://example.com" }
});
```

### 图像尺寸模式

```javascript
// 包含 - 适应内部，保持比例
{ sizing: { type: 'contain', w: 4, h: 3 } }

// 覆盖 - 填充区域，保持比例（可能裁剪）
{ sizing: { type: 'cover', w: 4, h: 3 } }

// 裁剪 - 切割特定部分
{ sizing: { type: 'crop', x: 0.5, y: 0.5, w: 2, h: 2 } }
```

### 计算尺寸（保持纵横比）

```javascript
const origWidth = 1978, origHeight = 923, maxHeight = 3.0;
const calcWidth = maxHeight * (origWidth / origHeight);
const centerX = (10 - calcWidth) / 2;

slide.addImage({ path: "image.png", x: centerX, y: 1.2, w: calcWidth, h: maxHeight });
```

### 支持的格式

- **标准格式**：PNG、JPG、GIF（动画 GIF 在 Microsoft 365 中可用）
- **SVG**：在现代 PowerPoint/Microsoft 365 中可用

---

## 图标

使用 react-icons 生成 SVG 图标，然后光栅化为 PNG 以获得通用兼容性。

### 设置

```javascript
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const { FaCheckCircle, FaChartLine } = require("react-icons/fa");

function renderIconSvg(IconComponent, color = "#000000", size = 256) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color, size: String(size) })
  );
}

async function iconToBase64Png(IconComponent, color, size = 256) {
  const svg = renderIconSvg(IconComponent, color, size);
  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + pngBuffer.toString("base64");
}
```

### 向幻灯片添加图标

```javascript
const iconData = await iconToBase64Png(FaCheckCircle, "#4472C4", 256);

slide.addImage({
  data: iconData,
  x: 1, y: 1, w: 0.5, h: 0.5  // 大小单位：英寸
});
```

**注意**：使用大小 256 或更高以获得清晰的图标。size 参数控制光栅化分辨率，而不是幻灯片上的显示大小（由 `w` 和 `h` 以英寸为单位设置）。

### 图标库

安装：`npm install -g react-icons react react-dom sharp`

react-icons 中流行的图标集：
- `react-icons/fa` - Font Awesome
- `react-icons/md` - Material Design
- `react-icons/hi` - Heroicons
- `react-icons/bi` - Bootstrap Icons

---

## 幻灯片背景

```javascript
// 纯色
slide.background = { color: "F1F1F1" };

// 有透明度的颜色
slide.background = { color: "FF3399", transparency: 50 };

// 从 URL 加载图像
slide.background = { path: "https://example.com/bg.jpg" };

// 从 base64 加载图像
slide.background = { data: "image/png;base64,iVBORw0KGgo..." };
```

---

## 表格

```javascript
slide.addTable([
  ["标题 1", "标题 2"],
  ["单元格 1", "单元格 2"]
], {
  x: 1, y: 1, w: 8, h: 2,
  border: { pt: 1, color: "999999" }, fill: { color: "F1F1F1" }
});

// 高级用法：合并单元格
let tableData = [
  [{ text: "标题", options: { fill: { color: "6699CC" }, color: "FFFFFF", bold: true } }, "单元格"],
  [{ text: "合并", options: { colspan: 2 } }]
];
slide.addTable(tableData, { x: 1, y: 3.5, w: 8, colW: [4, 4] });
```

---

## 图表

```javascript
// 柱状图
slide.addChart(pres.charts.BAR, [{
  name: "销售", labels: ["Q1", "Q2", "Q3", "Q4"], values: [4500, 5500, 6200, 7100]
}], {
  x: 0.5, y: 0.6, w: 6, h: 3, barDir: 'col',
  showTitle: true, title: '季度销售额'
});

// 折线图
slide.addChart(pres.charts.LINE, [{
  name: "温度", labels: ["1月", "2月", "3月"], values: [32, 35, 42]
}], { x: 0.5, y: 4, w: 6, h: 3, lineSize: 3, lineSmooth: true });

// 饼图
slide.addChart(pres.charts.PIE, [{
  name: "份额", labels: ["A", "B", "其他"], values: [35, 45, 20]
}], { x: 7, y: 1, w: 5, h: 4, showPercent: true });
```

### 更好看的图表

默认图表看起来过时。应用这些选项以获得现代、清洁的外观：

```javascript
slide.addChart(pres.charts.BAR, chartData, {
  x: 0.5, y: 1, w: 9, h: 4, barDir: "col",

  // 自定义颜色（匹配你的演示文稿调色板）
  chartColors: ["0D9488", "14B8A6", "5EEAD4"],

  // 清洁背景
  chartArea: { fill: { color: "FFFFFF" }, roundedCorners: true },

  // 柔和的坐标轴标签
  catAxisLabelColor: "64748B",
  valAxisLabelColor: "64748B",

  // 细微的网格线（仅值坐标轴）
  valGridLine: { color: "E2E8F0", size: 0.5 },
  catGridLine: { style: "none" },

  // 柱子上的数据标签
  showValue: true,
  dataLabelPosition: "outEnd",
  dataLabelColor: "1E293B",

  // 隐藏单个系列的图例
  showLegend: false,
});
```

**关键样式选项：**
- `chartColors: [...]` - 系列/段的十六进制颜色
- `chartArea: { fill, border, roundedCorners }` - 图表背景
- `catGridLine/valGridLine: { color, style, size }` - 网格线（`style: "none"` 隐藏）
- `lineSmooth: true` - 曲线（折线图）
- `legendPos: "r"` - 图例位置："b"、"t"、"l"、"r"、"tr"

---

## 幻灯片母版

```javascript
pres.defineSlideMaster({
  title: 'TITLE_SLIDE', background: { color: '283A5E' },
  objects: [{
    placeholder: { options: { name: 'title', type: 'title', x: 1, y: 2, w: 8, h: 2 } }
  }]
});

let titleSlide = pres.addSlide({ masterName: "TITLE_SLIDE" });
titleSlide.addText("我的标题", { placeholder: "title" });
```

---

## 常见陷阱

⚠️ 这些问题会导致文件损坏、视觉 bug 或输出破损。避免它们。

1. **永远不要使用 "#" 配合十六进制颜色** - 会导致文件损坏
   ```javascript
   color: "FF0000"      // ✅ 正确
   color: "#FF0000"     // ❌ 错误
   ```

2. **永远不要在十六进制颜色字符串中编码不透明度** - 8 字符颜色（如 `"00000020"`）会损坏文件。改用 `opacity` 属性。
   ```javascript
   shadow: { type: "outer", blur: 6, offset: 2, color: "00000020" }          // ❌ 损坏文件
   shadow: { type: "outer", blur: 6, offset: 2, color: "000000", opacity: 0.12 }  // ✅ 正确
   ```

3. **使用 `bullet: true`** - 永远不要用 Unicode 符号如 "•"（会产生双项目符号）

4. **在数组项之间使用 `breakLine: true`** 否则文本会连在一起

5. **避免与项目符号一起使用 `lineSpacing`** - 会造成过度间隙；改用 `paraSpaceAfter`

6. **每个演示文稿都需要新实例** - 不要重用 `pptxgen()` 对象

7. **永远不要在多次调用间重用选项对象** - PptxGenJS 会原位改变对象（例如将阴影值转换为 EMU）。在多次调用间共享一个对象会损坏第二个形状。
   ```javascript
   const shadow = { type: "outer", blur: 6, offset: 2, color: "000000", opacity: 0.15 };
   slide.addShape(pres.shapes.RECTANGLE, { shadow, ... });  // ❌ 第二次调用获得已转换的值
   slide.addShape(pres.shapes.RECTANGLE, { shadow, ... });

   const makeShadow = () => ({ type: "outer", blur: 6, offset: 2, color: "000000", opacity: 0.15 });
   slide.addShape(pres.shapes.RECTANGLE, { shadow: makeShadow(), ... });  // ✅ 每次都是新对象
   slide.addShape(pres.shapes.RECTANGLE, { shadow: makeShadow(), ... });
   ```

8. **不要使用 `ROUNDED_RECTANGLE` 配合强调边框** - 矩形覆盖条不会覆盖圆角。改用 `RECTANGLE`。
   ```javascript
   // ❌ 错误：强调条不覆盖圆角
   slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1, y: 1, w: 3, h: 1.5, fill: { color: "FFFFFF" } });
   slide.addShape(pres.shapes.RECTANGLE, { x: 1, y: 1, w: 0.08, h: 1.5, fill: { color: "0891B2" } });

   // ✅ 正确：使用 RECTANGLE 以获得清洁对齐
   slide.addShape(pres.shapes.RECTANGLE, { x: 1, y: 1, w: 3, h: 1.5, fill: { color: "FFFFFF" } });
   slide.addShape(pres.shapes.RECTANGLE, { x: 1, y: 1, w: 0.08, h: 1.5, fill: { color: "0891B2" } });
   ```

---

## 快速参考

- **形状**：RECTANGLE、OVAL、LINE、ROUNDED_RECTANGLE
- **图表**：BAR、LINE、PIE、DOUGHNUT、SCATTER、BUBBLE、RADAR
- **布局**：LAYOUT_16x9（10"×5.625"）、LAYOUT_16x10、LAYOUT_4x3、LAYOUT_WIDE
- **对齐**："left"、"center"、"right"
- **图表数据标签**："outEnd"、"inEnd"、"center"
