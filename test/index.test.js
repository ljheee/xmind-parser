/**
 * xmind-kityminder 测试套件
 * 运行：node test/index.test.js
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { parseXmind8Xml }    from '../src/xmind8-to-km.js';
import { parseXmind2020Json } from '../src/xmind2020-to-km.js';
import { kmToXmind8 }        from '../src/km-to-xmind8.js';
import { kmToXmind2020 }     from '../src/km-to-xmind2020.js';
import { xmindBufferToKm, kmToXmindBuffer } from '../src/index.js';
import { readZipAsync, uint8ArrayToString, writeZip } from '../src/utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES  = join(__dirname, 'fixtures');

// ─── 简单测试框架 ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message}\n  Expected: ${e}\n  Actual:   ${a}`);
  }
}

function assertDeepIncludes(obj, path, expectedValue, message) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      throw new Error(`${message}: path "${path}" not found at "${part}"`);
    }
    current = current[part];
  }
  const a = JSON.stringify(current);
  const e = JSON.stringify(expectedValue);
  if (a !== e) {
    throw new Error(`${message}\n  Path: ${path}\n  Expected: ${e}\n  Actual:   ${a}`);
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failed++;
    errors.push({ name, error: err });
  }
}

function describe(suiteName, fn) {
  console.log(`\n📋 ${suiteName}`);
  return fn();
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

async function runTests() {
  // ── XMind 8 XML → KityMinder ──────────────────────────────────────────────
  await describe('XMind 8 (XML) → KityMinder JSON', async () => {
    const xmlContent = await readFile(join(FIXTURES, 'sample-xmind8.xml'), 'utf-8');
    let sheets;

    await test('解析成功，返回数组', async () => {
      sheets = await parseXmind8Xml(xmlContent);
      assert(Array.isArray(sheets), 'should return array');
      assertEqual(sheets.length, 2, 'should have 2 sheets');
    });

    await test('多画布：第一个画布标题正确', async () => {
      assertEqual(sheets[0].title, 'Test Sheet', 'sheet title');
    });

    await test('根节点文本', async () => {
      assertDeepIncludes(sheets[0], 'root.data.text', 'Root Topic', 'root text');
    });

    await test('超链接 (xlink:href)', async () => {
      assertDeepIncludes(sheets[0], 'root.data.hyperlink', 'https://example.com', 'hyperlink');
    });

    await test('备注 (notes/plain)', async () => {
      const note = sheets[0].root.data.note;
      assert(note && note.includes('This is a note'), 'note content');
      assert(note.includes('Multi-line'), 'multi-line note');
    });

    await test('标签 (labels)', async () => {
      assertDeepIncludes(sheets[0], 'root.data.label', ['tag1', 'tag2'], 'labels');
    });

    await test('优先级标记 (priority-1 → 1)', async () => {
      assertDeepIncludes(sheets[0], 'root.data.priority', 1, 'priority');
    });

    await test('进度标记 (task-half → 5，50%)', async () => {
      // 10级映射：task-half = 5（50%）
      assertDeepIncludes(sheets[0], 'root.data.progress', 5, 'progress');
    });

    await test('其他标记 (smiley-happy)', async () => {
      assertDeepIncludes(sheets[0], 'root.data.markers', ['smiley-happy'], 'other markers');
    });

    await test('图片 (<image xlink:href> 或 <xhtml:img>)', async () => {
      // KityMinder 约定：data.image = URL字符串，data.imageSize = {width, height}
      const img = sheets[0].root.data.image;
      assert(typeof img === 'string' && img === 'xap:attachments/image1.png', 'image is string URL');
      const imgSize = sheets[0].root.data.imageSize;
      assert(imgSize && imgSize.width === 200, 'imageSize.width');
      assert(imgSize && imgSize.height === 150, 'imageSize.height');
    });

    await test('样式 ID (style-id)', async () => {
      const style = sheets[0].root.data.style;
      assert(style && style['xmind-style-id'] === 'style-root', 'style id');
    });

    await test('子节点数量（attached + detached）', async () => {
      const children = sheets[0].root.children;
      assertEqual(children.length, 4, '3 attached + 1 detached');
    });

    await test('折叠状态 (branch=folded)', async () => {
      const child1 = sheets[0].root.children[0];
      assertDeepIncludes(child1, 'data.expandState', 'collapse', 'folded state');
    });

    await test('浮动节点标记 (xmind-detached)', async () => {
      const detached = sheets[0].root.children.find(c => c.data['xmind-detached']);
      assert(detached, 'detached node exists');
      assertEqual(detached.data.text, 'Detached Topic', 'detached text');
    });

    await test('结构类型 (structure-class)', async () => {
      const child3 = sheets[0].root.children.find(c => c.data.text === 'Child 3 (with structure)');
      assert(child3, 'child3 exists');
      assertEqual(child3.data['xmind-structure'], 'org.xmind.ui.logic.right', 'structure class');
    });

    await test('内部链接 (xmind:#)', async () => {
      const child2 = sheets[0].root.children.find(c => c.data.text === 'Child 2 (internal link)');
      assert(child2, 'child2 exists');
      assertEqual(child2.data.hyperlink, 'xmind:#root1', 'internal link');
    });

    await test('嵌套子节点（孙节点）', async () => {
      const child1 = sheets[0].root.children[0];
      assert(child1.children.length > 0, 'child1 has children');
      assertEqual(child1.children[0].data.text, 'Grandchild 1', 'grandchild text');
    });

    await test('孙节点优先级 (priority-3 → 3)', async () => {
      const grandchild = sheets[0].root.children[0].children[0];
      assertDeepIncludes(grandchild, 'data.priority', 3, 'grandchild priority');
    });

    await test('第二个画布', async () => {
      assertEqual(sheets[1].title, 'Second Sheet', 'second sheet title');
      assertDeepIncludes(sheets[1], 'root.data.text', 'Second Root', 'second root text');
    });

    await test('firstSheetOnly 选项', async () => {
      const single = await parseXmind8Xml(xmlContent, { firstSheetOnly: true });
      assertEqual(single.length, 1, 'only one sheet');
    });
  });

  // ── XMind 2020 JSON → KityMinder ─────────────────────────────────────────
  await describe('XMind 2020+ (JSON) → KityMinder JSON', async () => {
    const jsonContent = await readFile(join(FIXTURES, 'sample-xmind2020.json'), 'utf-8');
    let sheets;

    await test('解析成功，返回数组', async () => {
      sheets = parseXmind2020Json(jsonContent);
      assert(Array.isArray(sheets), 'should return array');
      assertEqual(sheets.length, 2, 'should have 2 sheets');
    });

    await test('画布标题', async () => {
      assertEqual(sheets[0].title, 'Test Sheet 2020', 'sheet title');
    });

    await test('根节点文本', async () => {
      assertDeepIncludes(sheets[0], 'root.data.text', 'Root Topic 2020', 'root text');
    });

    await test('超链接 (href)', async () => {
      assertDeepIncludes(sheets[0], 'root.data.hyperlink', 'https://example.com', 'hyperlink');
    });

    await test('备注 (notes.plain.content)', async () => {
      const note = sheets[0].root.data.note;
      assert(note && note.includes('This is a note'), 'note content');
    });

    await test('标签 (labels[])', async () => {
      assertDeepIncludes(sheets[0], 'root.data.label', ['tag1', 'tag2'], 'labels');
    });

    await test('优先级标记 (priority-2 → 2)', async () => {
      assertDeepIncludes(sheets[0], 'root.data.priority', 2, 'priority');
    });

    await test('进度标记 (task-quarter → 3，25%)', async () => {
      // 10级映射：task-quarter = 3（25%）
      assertDeepIncludes(sheets[0], 'root.data.progress', 3, 'progress');
    });

    await test('其他标记 (flag-red)', async () => {
      assertDeepIncludes(sheets[0], 'root.data.markers', ['flag-red'], 'other markers');
    });

    await test('图片 (image.src/width/height → data.image 字符串 + data.imageSize)', async () => {
      // KityMinder 约定：data.image = URL字符串，data.imageSize = {width, height}
      const img = sheets[0].root.data.image;
      assert(typeof img === 'string' && img === 'xap:resources/image1.png', 'image is string URL');
      const imgSize = sheets[0].root.data.imageSize;
      assert(imgSize && imgSize.width === 200, 'imageSize.width');
      assert(imgSize && imgSize.height === 150, 'imageSize.height');
    });

    await test('样式 ID', async () => {
      const style = sheets[0].root.data.style;
      assert(style && style['xmind-style-id'] === 'style-root', 'style id');
    });

    await test('样式属性 (fo:color → color)', async () => {
      const style = sheets[0].root.data.style;
      assertEqual(style.color, '#FF0000', 'color');
      assertEqual(style.background, '#FFFF00', 'background');
      assertEqual(style.fontWeight, 'bold', 'fontWeight');
      assertEqual(style.lineColor, '#0000FF', 'lineColor');
    });

    await test('结构类型 (structureClass)', async () => {
      assertDeepIncludes(sheets[0], 'root.data.xmind-structure', 'org.xmind.ui.logic.right', 'structure');
    });

    await test('折叠状态 (branch=folded)', async () => {
      const child1 = sheets[0].root.children[0];
      assertDeepIncludes(child1, 'data.expandState', 'collapse', 'folded');
    });

    await test('浮动节点 (detached)', async () => {
      const detached = sheets[0].root.children.find(c => c.data['xmind-detached']);
      assert(detached, 'detached exists');
      assertEqual(detached.data.text, 'Detached Topic', 'detached text');
    });

    await test('概要节点 (summary)', async () => {
      const summary = sheets[0].root.children.find(c => c.data['xmind-summary']);
      assert(summary, 'summary exists');
      assertEqual(summary.data.text, 'Summary Topic', 'summary text');
    });

    await test('子节点数量（attached + detached + summary）', async () => {
      const children = sheets[0].root.children;
      assertEqual(children.length, 5, '3 attached + 1 detached + 1 summary');
    });
  });

  // ── KityMinder → XMind 8 (XML) ───────────────────────────────────────────
  await describe('KityMinder JSON → XMind 8 (XML)', async () => {
    const kmData = {
      root: {
        data: {
          text: 'Root',
          hyperlink: 'https://test.com',
          note: 'A note',
          label: ['l1', 'l2'],
          priority: 2,
          progress: 5,
          markers: ['flag-red'],
          image: 'xap:attachments/img.png',
          imageSize: { width: 100, height: 80 },
          style: { 'xmind-style-id': 'sid1' },
          expandState: 'collapse',
          'xmind-structure': 'org.xmind.ui.logic.right',
        },
        children: [
          {
            data: { text: 'Child A', priority: 1 },
            children: [],
          },
          {
            data: { text: 'Detached', 'xmind-detached': true },
            children: [],
          },
        ],
      },
      template: 'default',
      theme: 'fresh-blue',
      version: '1.4.43',
      title: 'My Sheet',
    };

    let zipBuffer;
    let files;

    await test('生成 ZIP ArrayBuffer', async () => {
      zipBuffer = kmToXmind8(kmData);
      assert(zipBuffer instanceof ArrayBuffer, 'should be ArrayBuffer');
      assert(zipBuffer.byteLength > 0, 'should not be empty');
    });

    await test('ZIP 包含必要文件（含 Thumbnails）', async () => {
      files = await readZipAsync(zipBuffer);
      assert(files['content.xml'], 'content.xml exists');
      assert(files['styles.xml'], 'styles.xml exists');
      assert(files['meta.xml'], 'meta.xml exists');
      assert(files['META-INF/manifest.xml'], 'manifest.xml exists');
      assert(files['Thumbnails/thumbnail.png'], 'Thumbnails/thumbnail.png exists');
    });

    await test('content.xml 包含根节点文本', async () => {
      const xml = uint8ArrayToString(files['content.xml']);
      assert(xml.includes('Root'), 'root text in xml');
    });

    await test('content.xml 包含超链接', async () => {
      const xml = uint8ArrayToString(files['content.xml']);
      assert(xml.includes('https://test.com'), 'hyperlink in xml');
    });

    await test('content.xml 包含备注', async () => {
      const xml = uint8ArrayToString(files['content.xml']);
      assert(xml.includes('A note'), 'note in xml');
    });

    await test('content.xml 包含标签', async () => {
      const xml = uint8ArrayToString(files['content.xml']);
      assert(xml.includes('<label>l1</label>'), 'label l1');
      assert(xml.includes('<label>l2</label>'), 'label l2');
    });

    await test('content.xml 包含优先级标记', async () => {
      const xml = uint8ArrayToString(files['content.xml']);
      assert(xml.includes('marker-id="priority-2"'), 'priority marker');
    });

    await test('content.xml 包含进度标记', async () => {
      const xml = uint8ArrayToString(files['content.xml']);
      // 10级映射：5 = task-half（50%）
      assert(xml.includes('marker-id="task-half"'), 'progress marker (5=task-half 50%)');
    });

    await test('content.xml 包含其他标记', async () => {
      const xml = uint8ArrayToString(files['content.xml']);
      assert(xml.includes('marker-id="flag-red"'), 'other marker');
    });

    await test('content.xml 包含图片 (<image xlink:href>)', async () => {
      const xml = uint8ArrayToString(files['content.xml']);
      assert(xml.includes('xap:attachments/img.png'), 'image src in xml');
      // 新版写法：<image xlink:href="..."> 而非 <xhtml:img>
      assert(xml.includes('<image '), 'uses <image> tag not <xhtml:img>');
    });

    await test('content.xml 包含折叠状态', async () => {
      const xml = uint8ArrayToString(files['content.xml']);
      assert(xml.includes('branch="folded"'), 'folded branch');
    });

    await test('content.xml 包含结构类型', async () => {
      const xml = uint8ArrayToString(files['content.xml']);
      assert(xml.includes('structure-class="org.xmind.ui.logic.right"'), 'structure class');
    });

    await test('content.xml 包含浮动节点（detached）', async () => {
      const xml = uint8ArrayToString(files['content.xml']);
      assert(xml.includes('type="detached"'), 'detached topics');
      assert(xml.includes('Detached'), 'detached text');
    });

    await test('多画布输出', async () => {
      const multiKm = [
        { ...kmData, title: 'Sheet 1' },
        { root: { data: { text: 'Root 2' }, children: [] }, title: 'Sheet 2' },
      ];
      const buf = kmToXmind8(multiKm);
      const f = await readZipAsync(buf);
      const xml = uint8ArrayToString(f['content.xml']);
      assert(xml.includes('Sheet 1'), 'sheet 1 title');
      assert(xml.includes('Sheet 2'), 'sheet 2 title');
    });
  });

  // ── KityMinder → XMind 2020+ (JSON) ──────────────────────────────────────
  await describe('KityMinder JSON → XMind 2020+ (JSON)', async () => {
    const kmData = {
      root: {
        data: {
          text: 'Root 2020',
          hyperlink: 'https://test.com',
          note: 'A note',
          label: ['l1', 'l2'],
          priority: 3,
          progress: 2,
          markers: ['flag-blue'],
          image: 'xap:resources/img.png',
          imageSize: { width: 120, height: 90 },
          style: {
            'xmind-style-id': 'sid2',
            color: '#FF0000',
            background: '#00FF00',
            fontWeight: 'bold',
            lineColor: '#0000FF',
            shapeClass: 'org.xmind.topicShape.roundedRect',
          },
          expandState: 'collapse',
          'xmind-structure': 'org.xmind.ui.logic.right',
        },
        children: [
          {
            data: { text: 'Child B', progress: 5 },
            children: [],
          },
          {
            data: { text: 'Detached 2020', 'xmind-detached': true },
            children: [],
          },
          {
            data: { text: 'Summary 2020', 'xmind-summary': true },
            children: [],
          },
        ],
      },
      title: 'My 2020 Sheet',
    };

    let zipBuffer;
    let files;
    let contentJson;

    await test('生成 ZIP ArrayBuffer', async () => {
      zipBuffer = kmToXmind2020(kmData);
      assert(zipBuffer instanceof ArrayBuffer, 'should be ArrayBuffer');
    });

    await test('ZIP 包含必要文件（含 Thumbnails）', async () => {
      files = await readZipAsync(zipBuffer);
      assert(files['content.json'], 'content.json exists');
      assert(files['metadata.json'], 'metadata.json exists');
      assert(files['META-INF/manifest.json'], 'manifest.json exists');
      assert(files['Thumbnails/thumbnail.png'], 'Thumbnails/thumbnail.png exists');
    });

    await test('content.json 可解析', async () => {
      const jsonStr = uint8ArrayToString(files['content.json']);
      contentJson = JSON.parse(jsonStr);
      assert(Array.isArray(contentJson), 'should be array');
    });

    await test('画布标题', async () => {
      assertEqual(contentJson[0].title, 'My 2020 Sheet', 'sheet title');
    });

    await test('根节点文本', async () => {
      assertEqual(contentJson[0].rootTopic.title, 'Root 2020', 'root title');
    });

    await test('超链接', async () => {
      assertEqual(contentJson[0].rootTopic.href, 'https://test.com', 'href');
    });

    await test('备注 (notes.plain.content)', async () => {
      assertEqual(contentJson[0].rootTopic.notes.plain.content, 'A note', 'note');
    });

    await test('标签', async () => {
      assertEqual(contentJson[0].rootTopic.labels, ['l1', 'l2'], 'labels');
    });

    await test('优先级标记 (3 → priority-3)', async () => {
      const markers = contentJson[0].rootTopic.markers;
      assert(markers.some(m => m.markerId === 'priority-3'), 'priority marker');
    });

    await test('进度标记 (2 → task-oct，12.5%)', async () => {
      // 10级映射：2 = task-oct（12.5%）
      const markers = contentJson[0].rootTopic.markers;
      assert(markers.some(m => m.markerId === 'task-oct'), 'progress marker');
    });

    await test('其他标记', async () => {
      const markers = contentJson[0].rootTopic.markers;
      assert(markers.some(m => m.markerId === 'flag-blue'), 'other marker');
    });

    await test('图片 (data.image 字符串 → image.src/width/height)', async () => {
      const img = contentJson[0].rootTopic.image;
      assertEqual(img.src, 'xap:resources/img.png', 'image src');
      assertEqual(img.width, 120, 'image width');
      assertEqual(img.height, 90, 'image height');
    });

    await test('样式 ID', async () => {
      assertEqual(contentJson[0].rootTopic.style.id, 'sid2', 'style id');
    });

    await test('样式属性反向映射', async () => {
      const props = contentJson[0].rootTopic.style.properties;
      assertEqual(props['fo:color'], '#FF0000', 'fo:color');
      assertEqual(props['fo:background-color'], '#00FF00', 'fo:background-color');
      assertEqual(props['fo:font-weight'], 'bold', 'fo:font-weight');
      assertEqual(props['line-color'], '#0000FF', 'line-color');
      assertEqual(props['shape-class'], 'org.xmind.topicShape.roundedRect', 'shape-class');
    });

    await test('折叠状态', async () => {
      assertEqual(contentJson[0].rootTopic.branch, 'folded', 'branch folded');
    });

    await test('结构类型', async () => {
      assertEqual(contentJson[0].rootTopic.structureClass, 'org.xmind.ui.logic.right', 'structureClass');
    });

    await test('attached 子节点', async () => {
      const attached = contentJson[0].rootTopic.children.attached;
      assert(Array.isArray(attached) && attached.length === 1, 'one attached child');
      assertEqual(attached[0].title, 'Child B', 'child title');
    });

    await test('detached 子节点', async () => {
      const detached = contentJson[0].rootTopic.children.detached;
      assert(Array.isArray(detached) && detached.length === 1, 'one detached child');
      assertEqual(detached[0].title, 'Detached 2020', 'detached title');
    });

    await test('summary 子节点', async () => {
      const summary = contentJson[0].rootTopic.children.summary;
      assert(Array.isArray(summary) && summary.length === 1, 'one summary child');
      assertEqual(summary[0].title, 'Summary 2020', 'summary title');
    });
  });

  // ── 往返转换（Round-trip）────────────────────────────────────────────────
  await describe('往返转换（Round-trip）', async () => {
    await test('KM → XMind2020 → KM 字段保真', async () => {
      const original = {
        root: {
          data: {
            text: 'Round-trip Root',
            hyperlink: 'https://roundtrip.com',
            note: 'Round-trip note',
            label: ['rt1', 'rt2'],
            priority: 4,
            progress: 3,
            markers: ['smiley-happy'],
            image: 'xap:resources/rt.png',
            imageSize: { width: 50, height: 50 },
          },
          children: [
            { data: { text: 'Child RT' }, children: [] },
          ],
        },
        title: 'RT Sheet',
      };

      // KM → XMind 2020
      const xmindBuf = kmToXmind2020(original);

      // XMind 2020 → KM
      const restored = await xmindBufferToKm(xmindBuf);

      assertEqual(restored[0].title, 'RT Sheet', 'title preserved');
      assertDeepIncludes(restored[0], 'root.data.text', 'Round-trip Root', 'text');
      assertDeepIncludes(restored[0], 'root.data.hyperlink', 'https://roundtrip.com', 'hyperlink');
      assertDeepIncludes(restored[0], 'root.data.note', 'Round-trip note', 'note');
      assertDeepIncludes(restored[0], 'root.data.label', ['rt1', 'rt2'], 'labels');
      assertDeepIncludes(restored[0], 'root.data.priority', 4, 'priority');
      assertDeepIncludes(restored[0], 'root.data.progress', 3, 'progress');
      assertDeepIncludes(restored[0], 'root.data.markers', ['smiley-happy'], 'markers');
      // KityMinder 约定：data.image 是字符串
      assertEqual(restored[0].root.data.image, 'xap:resources/rt.png', 'image src string');
      assertEqual(restored[0].root.children.length, 1, 'child count');
      assertDeepIncludes(restored[0], 'root.children.0.data.text', 'Child RT', 'child text');
    });

    await test('KM → XMind8 → KM 字段保真', async () => {
      const original = {
        root: {
          data: {
            text: 'XMind8 Round-trip',
            hyperlink: 'https://xmind8.com',
            note: 'XMind8 note',
            label: ['x8'],
            priority: 2,
            progress: 5,
          },
          children: [],
        },
        title: 'X8 Sheet',
      };

      const xmindBuf = kmToXmind8(original);
      const restored = await xmindBufferToKm(xmindBuf);

      assertDeepIncludes(restored[0], 'root.data.text', 'XMind8 Round-trip', 'text');
      assertDeepIncludes(restored[0], 'root.data.hyperlink', 'https://xmind8.com', 'hyperlink');
      assertDeepIncludes(restored[0], 'root.data.note', 'XMind8 note', 'note');
      assertDeepIncludes(restored[0], 'root.data.label', ['x8'], 'labels');
      assertDeepIncludes(restored[0], 'root.data.priority', 2, 'priority');
      assertDeepIncludes(restored[0], 'root.data.progress', 5, 'progress');
    });
  });

  // ── 边界情况 ──────────────────────────────────────────────────────────────
  await describe('边界情况', async () => {
    await test('空子节点', async () => {
      const km = { root: { data: { text: 'Empty' }, children: [] } };
      const buf = kmToXmind2020(km);
      const restored = await xmindBufferToKm(buf);
      assertEqual(restored[0].root.children.length, 0, 'no children');
    });

    await test('特殊字符转义（XML）', async () => {
      const km = {
        root: {
          data: { text: '<Hello & "World">', note: "It's a <test> & 'more'" },
          children: [],
        },
      };
      const buf = kmToXmind8(km);
      const restored = await xmindBufferToKm(buf);
      assertEqual(restored[0].root.data.text, '<Hello & "World">', 'special chars in text');
      assert(restored[0].root.data.note.includes("It's a"), 'special chars in note');
    });

    await test('无标记时不生成 markers 字段', async () => {
      const km = { root: { data: { text: 'No markers' }, children: [] } };
      const buf = kmToXmind2020(km);
      const restored = await xmindBufferToKm(buf);
      assert(restored[0].root.data.markers === undefined, 'no markers field');
      assert(restored[0].root.data.priority === undefined, 'no priority field');
      assert(restored[0].root.data.progress === undefined, 'no progress field');
    });

    await test('XMind 2020 JSON 直接传入数组（非字符串）', async () => {
      const arr = [{ id: 'x', title: 'Direct Array', rootTopic: { id: 'r', title: 'Root', class: 'topic' } }];
      const result = parseXmind2020Json(arr);
      assertEqual(result[0].title, 'Direct Array', 'direct array input');
    });

    await test('深层嵌套节点', async () => {
      function makeDeep(depth) {
        if (depth === 0) return { data: { text: `Level ${depth}` }, children: [] };
        return { data: { text: `Level ${depth}` }, children: [makeDeep(depth - 1)] };
      }
      const km = { root: makeDeep(10) };
      const buf = kmToXmind2020(km);
      const restored = await xmindBufferToKm(buf);
      let node = restored[0].root;
      for (let i = 10; i >= 0; i--) {
        assertEqual(node.data.text, `Level ${i}`, `depth ${i}`);
        if (i > 0) node = node.children[0];
      }
    });
  });

  // ── 真实文件双向转化（naotu.km & naoTu.xmind）────────────────────────────
  await describe('真实文件双向转化', async () => {

    // ── naoTu.xmind → KM ──────────────────────────────────────────────────
    await describe('naoTu.xmind (XMind 2020+) → KityMinder JSON', async () => {
      const xmindBuf = await readFile(join(FIXTURES, 'naoTu.xmind'));
      const xmindAb  = xmindBuf.buffer.slice(xmindBuf.byteOffset, xmindBuf.byteOffset + xmindBuf.byteLength);
      let sheets;

      await test('解析成功，返回数组', async () => {
        sheets = await xmindBufferToKm(xmindAb);
        assert(Array.isArray(sheets) && sheets.length > 0, 'should return non-empty array');
      });

      await test('画布标题', async () => {
        assert(typeof sheets[0].title === 'string' && sheets[0].title.length > 0, 'title is non-empty string');
        console.log(`     title = "${sheets[0].title}"`);
      });

      await test('根节点文本非空', async () => {
        const text = sheets[0].root.data.text;
        assert(typeof text === 'string' && text.length > 0, `root text should be non-empty, got: ${JSON.stringify(text)}`);
        console.log(`     root.text = "${text}"`);
      });

      await test('子节点存在', async () => {
        const children = sheets[0].root.children;
        assert(Array.isArray(children) && children.length > 0, 'root should have children');
        console.log(`     children count = ${children.length}`);
      });

      await test('超链接节点被正确解析', async () => {
        // naoTu.xmind 中有一个带 href 的节点（JSON.cn）
        function findHyperlink(node) {
          if (node.data.hyperlink) return node;
          for (const c of node.children || []) {
            const found = findHyperlink(c);
            if (found) return found;
          }
          return null;
        }
        const linkNode = findHyperlink(sheets[0].root);
        assert(linkNode !== null, 'should find a node with hyperlink');
        assert(linkNode.data.hyperlink.startsWith('http'), `hyperlink should be a URL, got: ${linkNode.data.hyperlink}`);
        console.log(`     hyperlink = "${linkNode.data.hyperlink}"`);
      });

      await test('图片节点被正确解析（data.image 为字符串）', async () => {
        // naoTu.xmind 中有一个带图片的节点
        function findImage(node) {
          if (node.data.image) return node;
          for (const c of node.children || []) {
            const found = findImage(c);
            if (found) return found;
          }
          return null;
        }
        const imgNode = findImage(sheets[0].root);
        assert(imgNode !== null, 'should find a node with image');
        assert(typeof imgNode.data.image === 'string', `data.image should be string, got: ${typeof imgNode.data.image}`);
        assert(imgNode.data.image.length > 0, 'data.image should be non-empty');
        console.log(`     image = "${imgNode.data.image.slice(0, 60)}..."`);
      });

      await test('callout 节点被正确解析（xmind-callout 标记）', async () => {
        // naoTu.xmind 中有一个 callout 子节点
        function findCallout(node) {
          if (node.data['xmind-callout']) return node;
          for (const c of node.children || []) {
            const found = findCallout(c);
            if (found) return found;
          }
          return null;
        }
        const calloutNode = findCallout(sheets[0].root);
        assert(calloutNode !== null, 'should find a callout node');
        assert(calloutNode.data['xmind-callout'] === true, 'xmind-callout should be true');
        console.log(`     callout text = "${calloutNode.data.text}"`);
      });

      await test('KM 结构完整（root/template/theme/version）', async () => {
        assert(sheets[0].root, 'root exists');
        assert(sheets[0].template, 'template exists');
        assert(sheets[0].theme, 'theme exists');
        assert(sheets[0].version, 'version exists');
      });
    });

    // ── naotu.km → XMind 2020 → KM 往返 ──────────────────────────────────
    await describe('naotu.km → XMind 2020+ → KityMinder JSON（往返）', async () => {
      const kmRaw = await readFile(join(FIXTURES, 'naotu.km'), 'utf-8');
      let originalKm;
      let restoredSheets;

      await test('naotu.km 可解析为合法 KM 对象', async () => {
        originalKm = JSON.parse(kmRaw);
        assert(originalKm.root, 'root exists');
        assert(originalKm.root.data.text, 'root text exists');
        console.log(`     root.text = "${originalKm.root.data.text}"`);
        console.log(`     children count = ${originalKm.root.children.length}`);
      });

      await test('KM → XMind 2020 生成合法 ZIP', async () => {
        const buf = kmToXmind2020(originalKm);
        assert(buf instanceof ArrayBuffer, 'should be ArrayBuffer');
        assert(buf.byteLength > 100, 'ZIP should not be trivially small');
        const files = await readZipAsync(buf);
        assert(files['content.json'], 'content.json exists');
        assert(files['Thumbnails/thumbnail.png'], 'thumbnail exists');
      });

      await test('往返后根节点文本保真', async () => {
        const buf = kmToXmind2020(originalKm);
        restoredSheets = await xmindBufferToKm(buf);
        assertEqual(restoredSheets[0].root.data.text, originalKm.root.data.text, 'root text preserved');
      });

      await test('往返后子节点数量保真', async () => {
        assertEqual(
          restoredSheets[0].root.children.length,
          originalKm.root.children.length,
          'children count preserved'
        );
      });

      await test('往返后超链接保真', async () => {
        // naotu.km 第一个子节点有 hyperlink
        const origChild = originalKm.root.children.find(c => c.data.hyperlink);
        const restChild = restoredSheets[0].root.children.find(c => c.data.hyperlink);
        assert(origChild, 'original has hyperlink child');
        assert(restChild, 'restored has hyperlink child');
        assertEqual(restChild.data.hyperlink, origChild.data.hyperlink, 'hyperlink preserved');
        console.log(`     hyperlink = "${restChild.data.hyperlink}"`);
      });

      await test('往返后备注保真', async () => {
        // naotu.km 第二个子节点有 note
        const origChild = originalKm.root.children.find(c => c.data.note);
        const restChild = restoredSheets[0].root.children.find(c => c.data.note);
        assert(origChild, 'original has note child');
        assert(restChild, 'restored has note child');
        assertEqual(restChild.data.note, origChild.data.note, 'note preserved');
        console.log(`     note = "${restChild.data.note}"`);
      });

      await test('往返后图片 URL 保真', async () => {
        // naotu.km 第三个子节点有 image（URL 字符串）
        const origChild = originalKm.root.children.find(c => c.data.image);
        const restChild = restoredSheets[0].root.children.find(c => c.data.image);
        assert(origChild, 'original has image child');
        assert(restChild, 'restored has image child');
        assert(typeof restChild.data.image === 'string', 'restored image is string');
        assertEqual(restChild.data.image, origChild.data.image, 'image URL preserved');
        console.log(`     image = "${restChild.data.image.slice(0, 60)}..."`);
      });

      await test('往返后图片尺寸保真', async () => {
        const origChild = originalKm.root.children.find(c => c.data.imageSize);
        const restChild = restoredSheets[0].root.children.find(c => c.data.imageSize);
        assert(origChild, 'original has imageSize child');
        assert(restChild, 'restored has imageSize child');
        assertEqual(restChild.data.imageSize.width,  origChild.data.imageSize.width,  'imageSize.width preserved');
        assertEqual(restChild.data.imageSize.height, origChild.data.imageSize.height, 'imageSize.height preserved');
        console.log(`     imageSize = ${JSON.stringify(restChild.data.imageSize)}`);
      });
    });

    // ── naotu.km → XMind 8 → KM 往返 ─────────────────────────────────────
    await describe('naotu.km → XMind 8 → KityMinder JSON（往返）', async () => {
      const kmRaw = await readFile(join(FIXTURES, 'naotu.km'), 'utf-8');
      const originalKm = JSON.parse(kmRaw);
      let restoredSheets;

      await test('KM → XMind 8 生成合法 ZIP', async () => {
        const buf = kmToXmind8(originalKm);
        assert(buf instanceof ArrayBuffer, 'should be ArrayBuffer');
        const files = await readZipAsync(buf);
        assert(files['content.xml'], 'content.xml exists');
        assert(files['Thumbnails/thumbnail.png'], 'thumbnail exists');
      });

      await test('往返后根节点文本保真', async () => {
        const buf = kmToXmind8(originalKm);
        restoredSheets = await xmindBufferToKm(buf);
        assertEqual(restoredSheets[0].root.data.text, originalKm.root.data.text, 'root text preserved');
      });

      await test('往返后子节点数量保真', async () => {
        assertEqual(
          restoredSheets[0].root.children.length,
          originalKm.root.children.length,
          'children count preserved'
        );
      });

      await test('往返后超链接保真', async () => {
        const origChild = originalKm.root.children.find(c => c.data.hyperlink);
        const restChild = restoredSheets[0].root.children.find(c => c.data.hyperlink);
        assert(origChild && restChild, 'both have hyperlink child');
        assertEqual(restChild.data.hyperlink, origChild.data.hyperlink, 'hyperlink preserved');
      });

      await test('往返后备注保真', async () => {
        const origChild = originalKm.root.children.find(c => c.data.note);
        const restChild = restoredSheets[0].root.children.find(c => c.data.note);
        assert(origChild && restChild, 'both have note child');
        assertEqual(restChild.data.note, origChild.data.note, 'note preserved');
      });

      await test('往返后图片 URL 保真', async () => {
        const origChild = originalKm.root.children.find(c => c.data.image);
        const restChild = restoredSheets[0].root.children.find(c => c.data.image);
        assert(origChild && restChild, 'both have image child');
        assert(typeof restChild.data.image === 'string', 'restored image is string');
        assertEqual(restChild.data.image, origChild.data.image, 'image URL preserved');
      });

      await test('往返后图片尺寸保真', async () => {
        const origChild = originalKm.root.children.find(c => c.data.imageSize);
        const restChild = restoredSheets[0].root.children.find(c => c.data.imageSize);
        assert(origChild && restChild, 'both have imageSize child');
        assertEqual(restChild.data.imageSize.width,  origChild.data.imageSize.width,  'width preserved');
        assertEqual(restChild.data.imageSize.height, origChild.data.imageSize.height, 'height preserved');
      });
    });

    // ── naoTu.xmind → KM → XMind 2020 往返 ──────────────────────────────
    await describe('naoTu.xmind → KM → XMind 2020（往返）', async () => {
      const xmindBuf = await readFile(join(FIXTURES, 'naoTu.xmind'));
      const xmindAb  = xmindBuf.buffer.slice(xmindBuf.byteOffset, xmindBuf.byteOffset + xmindBuf.byteLength);

      await test('xmind → KM → xmind2020 → KM 根节点文本保真', async () => {
        const sheets1 = await xmindBufferToKm(xmindAb);
        const buf2    = kmToXmind2020(sheets1);
        const sheets2 = await xmindBufferToKm(buf2);
        assertEqual(sheets2[0].root.data.text, sheets1[0].root.data.text, 'root text preserved through double conversion');
      });

      await test('xmind → KM → xmind2020 → KM 子节点数量保真', async () => {
        const sheets1 = await xmindBufferToKm(xmindAb);
        const buf2    = kmToXmind2020(sheets1);
        const sheets2 = await xmindBufferToKm(buf2);
        // callout 节点会被合并进 children，数量应一致
        assertEqual(sheets2[0].root.children.length, sheets1[0].root.children.length, 'children count preserved');
      });

      await test('xmind → KM → xmind8 → KM 根节点文本保真', async () => {
        const sheets1 = await xmindBufferToKm(xmindAb);
        const buf2    = kmToXmind8(sheets1);
        const sheets2 = await xmindBufferToKm(buf2);
        assertEqual(sheets2[0].root.data.text, sheets1[0].root.data.text, 'root text preserved through xmind8 conversion');
      });
    });
  });

  // ── 汇总 ──────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log(`\n📊 测试结果: ${passed} 通过, ${failed} 失败\n`);

  if (failed > 0) {
    console.log('❌ 失败的测试:');
    for (const { name, error } of errors) {
      console.log(`  - ${name}: ${error.message}`);
    }
    process.exit(1);
  } else {
    console.log('🎉 所有测试通过！\n');
  }
}

runTests().catch(err => {
  console.error('测试运行出错:', err);
  process.exit(1);
});
