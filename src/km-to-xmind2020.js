/**
 * KityMinder JSON → XMind 2020+ (JSON / content.json)
 *
 * 生成合法的 XMind 2020+ ZIP 结构，包含：
 *   - content.json              (主要内容，JSON 格式)
 *   - metadata.json             (元数据)
 *   - META-INF/manifest.json    (文件清单)
 *   - Thumbnails/thumbnail.png  (缩略图占位，XMind 2020+ 需要此文件才能正常打开)
 *
 * 支持字段：
 *   ✅ 标题 (data.text → title)
 *   ✅ 备注 (data.note → notes.plain.content)
 *   ✅ 超链接 (data.hyperlink → href)
 *   ✅ 标签 (data.label[] → labels[])
 *   ✅ 优先级 (data.priority → markers[].markerId = "priority-N")
 *   ✅ 进度 (data.progress → markers[].markerId = "task-*")
 *   ✅ 其他标记 (data.markers[] → markers[])
 *   ✅ 图片 (data.image 字符串 + data.imageSize → image.src/width/height)
 *   ✅ 样式 (data.style → style)
 *   ✅ 折叠 (data.expandState → branch = "folded")
 *   ✅ 结构类型 (data['xmind-structure'] → structureClass)
 *
 * KityMinder 图片字段约定：
 *   data.image     = "https://..." 或 "xap:resources/xxx.png"  （URL 字符串）
 *   data.imageSize = { width: 200, height: 150 }                （尺寸对象，可选）
 */

import {
  generateId,
  timestamp,
  writeZip,
  base64ToBytes,
} from './utils.js';
import {
  KM_PRIORITY_TO_XMIND,
  KM_PROGRESS_TO_XMIND,
  DEFAULT_THUMBNAIL_B64,
} from './constants.js';

/**
 * 将 KityMinder JSON 转换为 XMind 2020+ ZIP 的 ArrayBuffer
 * @param {object | Array} kmData  单个 km 对象或数组（多画布）
 * @param {object} [options]
 * @param {string} [options.sheetName] 画布名称（单画布时使用）
 * @returns {ArrayBuffer}
 */
export function kmToXmind2020(kmData, options = {}) {
  const sheets = Array.isArray(kmData) ? kmData : [kmData];

  // resources 收集器：{ 'resources/xxx.png': Uint8Array }
  // buildContentJson 递归处理节点时，遇到 base64 data URL 图片会提取到这里
  const resourceFiles = {};

  const contentJson    = buildContentJson(sheets, options, resourceFiles);
  const contentXml     = buildContentXml(sheets, options, resourceFiles);
  const metadataJson   = buildMetadataJson();
  const metaXml        = buildMetaXml();
  const manifestJson   = buildRootManifestJson(resourceFiles);   // 根目录 manifest.json
  const manifestXml    = buildManifestXml(resourceFiles);        // META-INF/manifest.xml

  const files = {
    'content.json':             JSON.stringify(contentJson, null, 2),
    'content.xml':              contentXml,
    'metadata.json':            JSON.stringify(metadataJson, null, 2),
    'meta.xml':                 metaXml,
    'manifest.json':            JSON.stringify(manifestJson, null, 2),   // 根目录
    'META-INF/manifest.xml':    manifestXml,
    'Thumbnails/thumbnail.png': base64ToBytes(DEFAULT_THUMBNAIL_B64),
  };

  // 将提取出的图片资源写入 ZIP
  for (const [path, bytes] of Object.entries(resourceFiles)) {
    files[path] = bytes;
  }

  return writeZip(files);
}

// ─── content.json ─────────────────────────────────────────────────────────────

function buildContentJson(sheets, options, resourceFiles) {
  return sheets.map((km, i) => {
    const sheetName = km.title || options.sheetName || `Sheet ${i + 1}`;
    return {
      id: generateId(),
      class: 'sheet',
      title: sheetName,
      rootTopic: buildTopicJson(km.root, true, resourceFiles),
      relationships: [],
      summaries: [],
      extensions: [],
    };
  });
}

function buildTopicJson(node, isRoot = false, resourceFiles = {}) {
  if (!node) return null;
  const data = node.data || {};
  const children = node.children || [];

  const topic = {
    id: generateId(),
    class: 'topic',
    title: data.text || '',
  };

  // 超链接
  if (data.hyperlink) {
    topic.href = data.hyperlink;
  }

  // 备注
  if (data.note) {
    topic.notes = {
      plain: { content: data.note },
      realHTML: { content: `<p>${escapeHtml(data.note)}</p>` },
    };
  }

  // 标签
  if (Array.isArray(data.label) && data.label.length > 0) {
    topic.labels = data.label.filter(Boolean);
  }

  // 标记（优先级 + 进度 + 其他）
  const markers = [];
  if (data.priority && KM_PRIORITY_TO_XMIND[data.priority]) {
    markers.push({ markerId: KM_PRIORITY_TO_XMIND[data.priority] });
  }
  if (data.progress && KM_PROGRESS_TO_XMIND[data.progress]) {
    markers.push({ markerId: KM_PROGRESS_TO_XMIND[data.progress] });
  }
  if (Array.isArray(data.markers)) {
    for (const markerId of data.markers) {
      markers.push({ markerId });
    }
  }
  if (markers.length > 0) {
    topic.markers = markers;
  }

  // 图片
  // KityMinder: data.image = URL字符串（可能是 data URL 或 xap: 路径），data.imageSize = {width, height}
  // XMind 2020: topic.image = { src: "xap:resources/xxx.png", width: 200, height: 150 }
  // 若 data.image 是 base64 data URL，需提取为 resources/ 文件，src 改为 xap:resources/ 路径
  if (data.image && typeof data.image === 'string') {
    const imgSrc = resolveExportImageSrc(data.image, resourceFiles);
    topic.image = { src: imgSrc };
    if (data.imageSize) {
      if (data.imageSize.width)  topic.image.width  = data.imageSize.width;
      if (data.imageSize.height) topic.image.height = data.imageSize.height;
    }
  }

  // 样式
  if (data.style) {
    const style = {};
    if (data.style['xmind-style-id']) {
      style.id = data.style['xmind-style-id'];
    }
    // 反向映射样式属性
    const props = {};
    if (data.style.color)       props['fo:color']            = data.style.color;
    if (data.style.background)  props['fo:background-color'] = data.style.background;
    if (data.style.fontSize)    props['fo:font-size']        = data.style.fontSize;
    if (data.style.fontWeight)  props['fo:font-weight']      = data.style.fontWeight;
    if (data.style.fontStyle)   props['fo:font-style']       = data.style.fontStyle;
    if (data.style.lineColor)   props['line-color']          = data.style.lineColor;
    if (data.style.lineWidth)   props['line-width']          = data.style.lineWidth;
    if (data.style.shapeClass)  props['shape-class']         = data.style.shapeClass;
    if (Object.keys(props).length > 0) {
      style.properties = props;
    }
    if (Object.keys(style).length > 0) {
      topic.style = style;
    }
  }

  // 折叠
  if (data.expandState === 'collapse') {
    topic.branch = 'folded';
  }

  // 结构类型
  if (data['xmind-structure']) {
    topic.structureClass = data['xmind-structure'];
  }

  // 子节点
  if (children.length > 0) {
    const attached  = children.filter(c => !c.data?.['xmind-detached'] && !c.data?.['xmind-summary']);
    const detached  = children.filter(c => c.data?.['xmind-detached']);
    const summaries = children.filter(c => c.data?.['xmind-summary']);

    topic.children = {};
    if (attached.length > 0) {
      topic.children.attached = attached.map(c => buildTopicJson(c, false, resourceFiles));
    }
    if (detached.length > 0) {
      topic.children.detached = detached.map(c => buildTopicJson(c, false, resourceFiles));
    }
    if (summaries.length > 0) {
      topic.children.summary = summaries.map(c => buildTopicJson(c, false, resourceFiles));
    }
  }

  return topic;
}

// ─── 图片导出：base64 data URL → resources/ 文件 ────────────────────────────

/**
 * 将 data.image 转换为 XMind 2020 可识别的 src：
 *   - 若已是 xap: 路径，直接返回
 *   - 若是 base64 data URL，提取字节写入 resourceFiles，返回 xap:resources/xxx.png
 *   - 其他 URL（https://...）直接返回
 *
 * @param {string} src - data.image 的值
 * @param {Object<string, Uint8Array>} resourceFiles - 收集器，键为 ZIP 内路径
 * @returns {string} XMind topic.image.src 的值
 */
function resolveExportImageSrc(src, resourceFiles) {
  if (!src) return src;

  // 已经是 xap: 路径，直接使用
  if (src.startsWith('xap:')) return src;

  // base64 data URL：data:<mime>;base64,<data>
  const dataUrlMatch = src.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    const mime = dataUrlMatch[1];  // e.g. "image/png"
    const b64  = dataUrlMatch[2];

    // mime → 扩展名
    const mimeToExt = {
      'image/png':  'png',
      'image/jpeg': 'jpg',
      'image/gif':  'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp':  'bmp',
    };
    const ext = mimeToExt[mime] || 'png';

    // 用 base64 内容的哈希前缀生成唯一文件名，避免重复写入
    const key = b64.substring(0, 32).replace(/[^A-Za-z0-9]/g, '');
    const fileName = `img_${key}.${ext}`;
    const zipPath  = `resources/${fileName}`;

    if (!resourceFiles[zipPath]) {
      // base64 → Uint8Array
      const binary = atob(b64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      resourceFiles[zipPath] = bytes;
    }

    return `xap:${zipPath}`;
  }

  // 普通 URL（https://...），直接写入 src（XMind 支持外链图片）
  return src;
}

// ─── content.xml（XMind 8 兼容格式，XMind 2020 同时读取此文件） ──────────────

function buildContentXml(sheets, options, resourceFiles) {
  const idCounter = { n: 1 };  // 全局共享，确保所有 topic id 唯一
  const sheetXmls = sheets.map((km, i) => {
    const sheetName = km.title || options.sheetName || `Sheet ${i + 1}`;
    const sheetId   = `sheet-${i + 1}`;
    const topicXml  = buildTopicXml(km.root, 1, resourceFiles, idCounter);
    return `  <sheet id="${sheetId}">\n    <title>${escapeHtml(sheetName)}</title>\n${topicXml}  </sheet>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xap="http://www.xmind.net/xmap/1.0/attachments" version="2.0">',
    ...sheetXmls,
    '</xmap-content>',
  ].join('\n');
}

function buildTopicXml(node, depth, resourceFiles, idCounter) {
  if (!node) return '';
  const data     = node.data || {};
  const children = node.children || [];
  const id       = `topic-${idCounter.n++}`;
  const indent   = '  '.repeat(depth + 1);
  const i2       = indent + '  ';

  let xml = `${indent}<topic id="${id}">`;
  xml += `<title>${escapeHtml(data.text || '')}</title>`;

  // 图片
  if (data.image && typeof data.image === 'string') {
    const imgSrc = resolveExportImageSrc(data.image, resourceFiles);
    const w = data.imageSize?.width  ? ` width="${data.imageSize.width}"`  : '';
    const h = data.imageSize?.height ? ` height="${data.imageSize.height}"` : '';
    xml += `<image xlink:href="${imgSrc}"${w}${h}/>`;
  }

  // 超链接
  if (data.hyperlink) {
    xml += `<xlink:href>${escapeHtml(data.hyperlink)}</xlink:href>`;
  }

  // 子节点
  if (children.length > 0) {
    xml += `<children><topics type="attached">`;
    for (const child of children) {
      xml += '\n' + buildTopicXml(child, depth + 2, resourceFiles, idCounter);
    }
    xml += `\n${i2}</topics></children>`;
  }

  xml += `</topic>`;
  return xml;
}

// ─── meta.xml ────────────────────────────────────────────────────────────────

function buildMetaXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<meta xmlns="urn:xmind:xmap:xmlns:meta:2.0">',
    '  <Creator>',
    '    <name>@ljheee/xmind-parser</name>',
    '    <version>1.0</version>',
    '  </Creator>',
    '</meta>',
  ].join('\n');
}

// ─── metadata.json ───────────────────────────────────────────────────────────

function buildMetadataJson() {
  return {
    dataStructureVersion: '2',
    creator: {
      name: '@ljheee/xmind-parser',
      version: '1.0.0',
    },
    layoutEngineVersion: '4',
  };
}

// ─── 根目录 manifest.json（官方格式：对象，非数组） ──────────────────────────

function buildRootManifestJson(resourceFiles = {}) {
  const entries = {
    'content.json':           {},
    'content.xml':            {},
    'metadata.json':          {},
    'meta.xml':               {},
    'manifest.json':          {},
    'META-INF/manifest.xml':  {},
    'Thumbnails/thumbnail.png': {},
  };

  // 图片资源
  for (const zipPath of Object.keys(resourceFiles)) {
    entries[zipPath] = {};
  }

  return { 'file-entries': entries };
}

// ─── META-INF/manifest.xml（XML 格式，XMind 读取资源文件的关键） ──────────────

function buildManifestXml(resourceFiles = {}) {
  const resourcePaths = Object.keys(resourceFiles);
  const resourceEntries = resourcePaths.map(zipPath => {
    // 图片统一用 application/octet-stream，与官方一致
    return `  <file-entry full-path="${zipPath}" media-type="application/octet-stream"/>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<manifest xmlns="urn:xmind:xmap:xmlns:manifest:1.0">',
    '  <file-entry full-path="content.xml" media-type="text/xml"/>',
    '  <file-entry full-path="meta.xml" media-type="text/xml"/>',
    '  <file-entry full-path="META-INF/manifest.xml" media-type="text/xml"/>',
    ...resourceEntries,
    '  <file-entry full-path="Thumbnails/thumbnail.png" media-type="image/png"/>',
    '</manifest>',
  ].join('\n');
}

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
