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
  const contentJson  = buildContentJson(sheets, options);
  const metadataJson = buildMetadataJson();
  const manifestJson = buildManifestJson();

  const files = {
    'content.json':              JSON.stringify(contentJson, null, 2),
    'metadata.json':             JSON.stringify(metadataJson, null, 2),
    'META-INF/manifest.json':    JSON.stringify(manifestJson, null, 2),
    'Thumbnails/thumbnail.png':  base64ToBytes(DEFAULT_THUMBNAIL_B64),
  };

  return writeZip(files);
}

// ─── content.json ─────────────────────────────────────────────────────────────

function buildContentJson(sheets, options) {
  return sheets.map((km, i) => {
    const sheetName = km.title || options.sheetName || `Sheet ${i + 1}`;
    return {
      id: generateId(),
      class: 'sheet',
      title: sheetName,
      rootTopic: buildTopicJson(km.root, true),
      relationships: [],
      summaries: [],
      extensions: [],
    };
  });
}

function buildTopicJson(node, isRoot = false) {
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
  // KityMinder: data.image = URL字符串，data.imageSize = {width, height}
  // XMind 2020: topic.image = { src: "...", width: 200, height: 150 }
  if (data.image && typeof data.image === 'string') {
    topic.image = { src: data.image };
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
      topic.children.attached = attached.map(c => buildTopicJson(c));
    }
    if (detached.length > 0) {
      topic.children.detached = detached.map(c => buildTopicJson(c));
    }
    if (summaries.length > 0) {
      topic.children.summary = summaries.map(c => buildTopicJson(c));
    }
  }

  return topic;
}

// ─── metadata.json ───────────────────────────────────────────────────────────

function buildMetadataJson() {
  return {
    creator: {
      name: 'xmind-kityminder',
      version: '1.0.0',
    },
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
  };
}

// ─── META-INF/manifest.json ──────────────────────────────────────────────────

function buildManifestJson() {
  return {
    'file-entries': [
      { 'full-path': 'content.json',              'media-type': 'application/json' },
      { 'full-path': 'metadata.json',              'media-type': 'application/json' },
      { 'full-path': 'Thumbnails/',                'media-type': '' },
      { 'full-path': 'Thumbnails/thumbnail.png',   'media-type': 'image/png' },
      { 'full-path': 'META-INF/',                  'media-type': '' },
    ],
  };
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
