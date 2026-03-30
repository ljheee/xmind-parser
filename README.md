# xmind-parser

XMind ↔ KityMinder JSON 完整双向转换库。

支持 **XMind 8**（XML 格式）和 **XMind 2020+**（JSON 格式）两个大版本，字段覆盖超链接、备注、图片、标签、优先级、进度、样式等，反向转换生成合法 ZIP 结构，浏览器和 Node.js 双端兼容，零额外依赖（Node.js 环境需要 `@xmldom/xmldom`）。

---

## 安装

```bash
npm install xmind-parser
```

Node.js 环境解析 XMind 8 XML 时需要：

```bash
npm install @xmldom/xmldom
```

---

## 快速上手

### Node.js

```js
import { xmindToKm, kmToXmind } from 'xmind-parser';

// XMind → KityMinder（自动检测 XMind 8 / 2020+）
const sheets = await xmindToKm('./my-map.xmind');
console.log(sheets[0].root.data.text); // 根节点文本

// KityMinder → XMind 2020+
await kmToXmind(sheets[0], './output.xmind', { format: 'xmind2020' });

// KityMinder → XMind 8
await kmToXmind(sheets[0], './output-v8.xmind', { format: 'xmind8' });
```

### 浏览器

```js
import { xmindBufferToKm, kmToXmindBuffer, downloadArrayBuffer } from 'xmind-parser';

// 读取用户上传的文件
const file = document.querySelector('input[type=file]').files[0];
const buffer = await file.arrayBuffer();

// 解析
const sheets = await xmindBufferToKm(buffer);
console.log(sheets[0].root.data.text);

// 导出并下载
const outBuffer = kmToXmindBuffer(sheets[0], { format: 'xmind2020' });
downloadArrayBuffer(outBuffer, 'output.xmind');
```

---

## API

### 高层 API

| 函数 | 说明 | 环境 |
|------|------|------|
| `xmindToKm(filePath, options?)` | 从文件路径读取并解析 | Node.js |
| `kmToXmind(kmData, outputPath, options?)` | 写入 .xmind 文件 | Node.js |
| `xmindBufferToKm(buffer, options?)` | 从 ArrayBuffer 解析 | 双端 |
| `kmToXmindBuffer(kmData, options?)` | 转换为 ArrayBuffer | 双端 |
| `downloadArrayBuffer(buffer, filename)` | 触发浏览器下载 | 浏览器 |

**options 参数：**

- `format`: `'xmind2020'`（默认）或 `'xmind8'`，控制输出格式
- `firstSheetOnly`: `true` 时只返回第一个画布

### 低层 API

```js
import {
  parseXmind8Xml,      // content.xml 字符串 → KM 数组
  parseXmind2020Json,  // content.json 字符串/数组 → KM 数组
  kmToXmind8,          // KM → XMind 8 ZIP ArrayBuffer
  kmToXmind2020,       // KM → XMind 2020+ ZIP ArrayBuffer
} from 'xmind-parser';
```

---

## KityMinder JSON 数据结构

```js
{
  root: {
    data: {
      text: "节点文本",           // 必填
      hyperlink: "https://...",   // 超链接
      note: "备注内容",           // 备注
      label: ["标签1", "标签2"],  // 标签数组
      priority: 1,                // 优先级 1-9
      progress: 3,                // 进度 1-10（见下表）
      markers: ["flag-red"],      // 其他标记 ID
      image: "xap:resources/img.png", // 图片路径字符串
      imageSize: { width: 200, height: 150 }, // 图片尺寸（可选）
      style: {
        "xmind-style-id": "xxx",  // XMind 样式 ID（保留字段）
        color: "#FF0000",
        background: "#FFFF00",
        fontSize: "14pt",
        fontWeight: "bold",
        fontStyle: "italic",
        lineColor: "#0000FF",
        lineWidth: "2",
        shapeClass: "org.xmind.topicShape.roundedRect",
      },
      expandState: "collapse",    // 折叠状态
      // 以下为 XMind 保留字段，往返转换时保持原样
      "xmind-structure": "org.xmind.ui.logic.right",
      "xmind-detached": true,     // 浮动节点（有损标记）
      "xmind-summary": true,      // 概要节点（有损标记）
    },
    children: [ /* 递归 KmNode */ ],
  },
  template: "default",
  theme: "fresh-blue",
  version: "1.4.43",
  title: "画布名称",
}
```

---

## 字段支持矩阵

### XMind → KityMinder

| 字段 | XMind 8 (XML) | XMind 2020+ (JSON) | KityMinder 字段 | 说明 |
|------|:---:|:---:|------|------|
| 节点文本 | ✅ | ✅ | `data.text` | |
| 超链接 | ✅ | ✅ | `data.hyperlink` | 含 `xmind:#` 内部链接 |
| 备注 | ✅ | ✅ | `data.note` | 纯文本；HTML 备注自动去标签 |
| 标签 | ✅ | ✅ | `data.label[]` | |
| 优先级 | ✅ | ✅ | `data.priority` | `priority-1`~`priority-9` → 1~9 |
| 进度 | ✅ | ✅ | `data.progress` | 见进度映射表 |
| 其他标记 | ✅ | ✅ | `data.markers[]` | 原始 markerId 字符串 |
| 图片 | ✅ | ✅ | `data.image` + `data.imageSize` | image 为路径字符串，imageSize 为 `{width, height}` |
| 样式 ID | ✅ | ✅ | `data.style['xmind-style-id']` | |
| 样式属性 | ❌ | ✅ | `data.style.*` | XMind 8 样式在 styles.xml，暂不解析 |
| 折叠状态 | ✅ | ✅ | `data.expandState` | `"collapse"` |
| 结构类型 | ✅ | ✅ | `data['xmind-structure']` | 保留字段 |
| 浮动节点 | ✅ | ✅ | `data['xmind-detached']` | 有损：位置信息丢失 |
| 概要节点 | ❌ | ✅ | `data['xmind-summary']` | 有损：范围信息丢失 |
| 多画布 | ✅ | ✅ | 返回数组 | |
| 关系连线 | ❌ | ❌ | — | 有损：暂不支持 |

### KityMinder → XMind

| KityMinder 字段 | XMind 8 (XML) | XMind 2020+ (JSON) | 说明 |
|------|:---:|:---:|------|
| `data.text` | ✅ | ✅ | |
| `data.hyperlink` | ✅ | ✅ | |
| `data.note` | ✅ | ✅ | XMind 8 同时写 plain + xhtml |
| `data.label[]` | ✅ | ✅ | |
| `data.priority` | ✅ | ✅ | |
| `data.progress` | ✅ | ✅ | |
| `data.markers[]` | ✅ | ✅ | |
| `data.image` | ✅ | ✅ | |
| `data.style` | ✅ | ✅ | XMind 2020 同时写 id + properties |
| `data.expandState` | ✅ | ✅ | |
| `data['xmind-structure']` | ✅ | ✅ | |
| `data['xmind-detached']` | ✅ | ✅ | 生成 `type="detached"` 分组 |
| `data['xmind-summary']` | ❌ | ✅ | XMind 8 不支持 summary 分组 |

---

## 进度标记映射

| XMind markerId | KityMinder progress | 含义 |
|---|:---:|---|
| `task-start` | 1 | 未开始 (0%) |
| `task-oct` | 2 | 12.5% |
| `task-quarter` | 3 | 25% |
| `task-3oct` | 4 | 37.5% |
| `task-half` | 5 | 50% |
| `task-5oct` | 6 | 62.5% |
| `task-3quar` | 7 | 75% |
| `task-7oct` | 8 | 87.5% |
| `task-done` | 9 | 完成 (100%) |
| `task-pause` | 10 | 暂停 |

---

## 有损转换说明

"有损"的含义：转换后再转回来，得到的结果与原始文件不完全一致。下面逐条说明每处丢失的**具体内容**和**根本原因**。

### XMind → KityMinder

**关系连线（relationships）—— 完全丢失**

XMind 支持在任意两个节点之间画一条带标签的连线（`<relationship>`），这是独立于树形结构之外的图结构数据。KityMinder 的数据模型是纯树，没有"节点间连线"这个概念，因此无处存放，转换时直接丢弃。

**浮动节点的坐标位置（detached topic position）—— 节点保留，位置丢失**

XMind 的浮动主题不挂在树上，而是用绝对坐标定位（XMind 8 用 `svg:x`/`svg:y` 属性，XMind 2020+ 用 `position.x`/`position.y`）。KityMinder 是自动布局引擎，所有节点位置由算法计算，没有"绝对坐标"字段。节点的文本、备注、标签等内容字段会完整保留，并打上 `xmind-detached: true` 标记，但坐标信息无法映射，反向写回 XMind 时浮动节点会出现在默认位置而非原位。

**概要节点的覆盖范围（summary range）—— 节点保留，范围丢失**

XMind 的概要节点（summary topic）会记录它概括的是父节点下第几个到第几个子节点（`startIndex`/`endIndex`）。KityMinder 没有"概要"这种节点类型，也没有存储范围索引的字段。节点本身的文本内容会保留并打上 `xmind-summary: true` 标记，但"它概括哪几个兄弟节点"这一语义信息丢失，反向写回 XMind 2020+ 时会生成一个没有范围绑定的孤立概要节点。

**XMind 8 的样式属性（styles.xml）—— 只保留 ID，不解析属性值**

XMind 8 把所有样式（颜色、字体、线条粗细、节点形状等）集中存放在 ZIP 内的 `styles.xml` 文件中，节点本身只记录一个 `style-id` 引用。本库目前只读取并保留这个 `style-id`（存入 `data.style['xmind-style-id']`），不去解析 `styles.xml` 的具体属性值。原因是 `styles.xml` 的 XSL-FO 格式较复杂，且 KityMinder 的样式字段与之不完全对应，解析后也难以无损还原。XMind 2020+ 的样式是内联在节点 JSON 里的，不受此限制，属性值完整支持。

**图片的二进制内容 —— 路径保留，文件不提取**

XMind 把图片文件打包在 ZIP 内的 `attachments/`（XMind 8）或 `resources/`（XMind 2020+）目录下，节点里只存路径引用（如 `xap:attachments/abc123.png`）。本库只读取这个路径字符串，不从 ZIP 中提取图片的二进制数据。如果你只使用转换后的 KityMinder JSON，图片路径会指向一个不存在的本地文件，图片无法显示。如需图片，需要自行从原始 ZIP 中提取 `attachments/` 目录的内容。

---

### KityMinder → XMind

**KityMinder 的布局与主题信息 —— 完全丢失**

KityMinder JSON 顶层的 `template`（布局模板，如 `"fish-bone"`、`"right"`）和 `theme`（配色主题，如 `"fresh-blue"`）描述的是整张脑图的视觉风格。XMind 有自己独立的主题和布局体系，两者的枚举值和语义不对应，无法直接映射。生成的 XMind 文件打开后会使用 XMind 的默认布局和主题。

**概要节点写入 XMind 8 —— 节点被跳过**

XMind 8 的 ZIP 格式（`content.xml`）没有 `type="summary"` 的 topics 分组，概要节点在 XMind 8 的数据模型中是通过 `<summaries>` 元素挂在 sheet 级别实现的，结构与普通子节点完全不同，本库暂未实现这一写入逻辑。因此，标记了 `xmind-summary: true` 的节点在生成 XMind 8 文件时会被忽略。XMind 2020+ 格式支持 `children.summary` 分组，不受此限制。

---

## 与 xmindparser 的对比

| 特性 | xmindparser | xmind-parser |
|------|:---:|:---:|
| XMind 8 (XML) 解析 | ✅ | ✅ |
| XMind 2020+ (JSON) 解析 | ✅ | ✅ |
| 反向转换（KM → XMind） | ✅ | ✅ |
| 超链接 | ❌ | ✅ |
| 备注 | 部分 | ✅ |
| 图片 | ❌ | ✅ |
| 标签 | ❌ | ✅ |
| 优先级标记 | ❌ | ✅ |
| 进度标记 | ❌ | ✅ |
| 其他标记 | ❌ | ✅ |
| 样式属性 | ❌ | ✅（2020+） |
| 折叠状态 | ❌ | ✅ |
| 浮动节点 | ❌ | ✅（有损） |
| 概要节点 | ❌ | ✅（有损） |
| 多画布 | ✅ | ✅ |
| 浏览器兼容 | ✅ | ✅ |
| 生成合法 ZIP | ✅ | ✅ |
| 零依赖（浏览器） | ✅ | ✅ |

---

## 项目结构

```
xmind-parser/
├── src/
│   ├── index.js           # 统一入口，高层 API
│   ├── constants.js       # 标记映射、命名空间常量
│   ├── utils.js           # ZIP 读写、XML 工具、文件 I/O
│   ├── xmind8-to-km.js    # XMind 8 (XML) → KityMinder
│   ├── xmind2020-to-km.js # XMind 2020+ (JSON) → KityMinder
│   ├── km-to-xmind8.js    # KityMinder → XMind 8 (XML)
│   └── km-to-xmind2020.js # KityMinder → XMind 2020+ (JSON)
├── test/
│   ├── index.test.js      # 测试套件（103 个测试用例）
│   └── fixtures/
│       ├── sample-xmind8.xml      # XMind 8 测试数据
│       └── sample-xmind2020.json  # XMind 2020+ 测试数据
└── package.json
```

---

## 运行测试

```bash
npm test
```

输出示例：

```
📋 XMind 8 (XML) → KityMinder JSON
  ✅ 解析成功，返回数组
  ✅ 超链接 (xlink:href)
  ...（20 个测试）

📋 XMind 2020+ (JSON) → KityMinder JSON
  ✅ 解析成功，返回数组
  ...（17 个测试）

📊 测试结果: 103 通过, 0 失败
🎉 所有测试通过！
```

---

## License

MIT
