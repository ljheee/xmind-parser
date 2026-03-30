/**
 * XMind 2020+ (JSON / content.json) → KityMinder JSON
 *
 * XMind 2020+ .xmind 文件是 ZIP 包，核心内容在 content.json。
 * content.json 是一个数组，每个元素代表一个画布（sheet）。
 *
 * 支持字段：
 *   ✅ 标题 (title)
 *   ✅ 备注 (notes.plain.content / notes.realHTML.content → data.note)
 *   ✅ 超链接 (href → data.hyperlink)
 *   ✅ 标签 (labels[] → data.label[])
 *   ✅ 优先级标记 (markers[].markerId = "priority-N" → data.priority)
 *   ✅ 进度标记 (markers[].markerId = "task-*" → data.progress)
 *   ✅ 其他标记 (→ data.markers[])
 *   ✅ 图片 (image.src / image.width / image.height → data.image 字符串 + data.imageSize)
 *   ✅ 样式 (style.id → data.style)
 *   ✅ 分支折叠 (branch = "folded" → data.expandState)
 *   ✅ 结构类型 (structureClass → data['xmind-structure'])
 *   ✅ callout 节点 (children.callout → data['xmind-callout'] = true)
 *   ✅ hideEmptyValue 配置选项（过滤空字段）
 *   ✅ 多画布（sheets）→ 返回数组
 */

import {
  XMIND_PRIORITY_MARKERS,
  XMIND_PROGRESS_MARKERS,
  KM_ROOT_TEMPLATE,
} from './constants.js';

/**
 * 将 content.json 字符串（或已解析的数组）转换为 KityMinder JSON 数组
 * @param {string | Array} contentJson
 * @param {object} [options]
 * @param {boolean} [options.firstSheetOnly=false]
 * @returns {Array<{root, template, theme, version, title}>}
 */
export function parseXmind2020Json(contentJson, options = {}) {
  const sheets = typeof contentJson === 'string'
    ? JSON.parse(contentJson)
    : contentJson;

  if (!Array.isArray(sheets)) {
    throw new Error('XMind 2020: content.json must be an array of sheets');
  }

  const hideEmptyValue = options.hideEmptyValue !== false; // 默认 true

  const results = [];
  for (const sheet of sheets) {
    const km = KM_ROOT_TEMPLATE();
    km.title = sheet.title || 'Sheet';

    const rootTopic = sheet.rootTopic;
    if (rootTopic) {
      km.root = convertTopic2020(rootTopic, hideEmptyValue);
    }

    results.push(km);
    if (options.firstSheetOnly) break;
  }

  return results;
}

/**
 * 递归转换 XMind 2020 topic 对象 → KityMinder 节点
 */
function convertTopic2020(topic, hideEmptyValue = true) {
  const node = { data: {}, children: [] };
  const data = node.data;

  // ── 标题 ──────────────────────────────────────────────────────────────────
  data.text = topic.title || '';

  // ── 超链接 ────────────────────────────────────────────────────────────────
  // XMind 2020: topic.href = "https://..." 或 "xmind:#topicId"
  if (topic.href) {
    data.hyperlink = topic.href;
  }

  // ── 备注 ──────────────────────────────────────────────────────────────────
  // XMind 2020: topic.notes = { plain: { content: "..." }, realHTML: { content: "<p>...</p>" } }
  if (topic.notes) {
    if (topic.notes.plain && topic.notes.plain.content) {
      data.note = topic.notes.plain.content;
    } else if (topic.notes.realHTML && topic.notes.realHTML.content) {
      // 降级：从 HTML 提取纯文本
      data.note = stripHtml(topic.notes.realHTML.content);
    }
  }

  // ── 标签 ──────────────────────────────────────────────────────────────────
  // XMind 2020: topic.labels = ["tag1", "tag2"]
  if (Array.isArray(topic.labels) && topic.labels.length > 0) {
    data.label = topic.labels.filter(Boolean);
  }

  // ── 标记（图标）──────────────────────────────────────────────────────────
  // XMind 2020: topic.markers = [{ markerId: "priority-1" }, { markerId: "task-done" }]
  if (Array.isArray(topic.markers) && topic.markers.length > 0) {
    const otherMarkers = [];
    for (const marker of topic.markers) {
      const markerId = marker.markerId || marker.id || '';
      if (!markerId) continue;

      if (XMIND_PRIORITY_MARKERS[markerId] !== undefined) {
        data.priority = XMIND_PRIORITY_MARKERS[markerId];
      } else if (XMIND_PROGRESS_MARKERS[markerId] !== undefined) {
        data.progress = XMIND_PROGRESS_MARKERS[markerId];
      } else {
        otherMarkers.push(markerId);
      }
    }
    if (otherMarkers.length > 0) {
      data.markers = otherMarkers;
    }
  }

  // ── 图片 ──────────────────────────────────────────────────────────────────
  // XMind 2020: topic.image = { src: "xap:resources/xxx.png", width: 100, height: 80 }
  // 或 topic.image = { url: "https://...", width: 100, height: 80 }
  // KityMinder 约定：data.image = URL字符串，data.imageSize = {width, height}
  if (topic.image) {
    const imgSrc = topic.image.src || topic.image.url || '';
    if (imgSrc) {
      data.image = imgSrc;
      const w = topic.image.width;
      const h = topic.image.height;
      if (w || h) {
        data.imageSize = {};
        if (w) data.imageSize.width  = w;
        if (h) data.imageSize.height = h;
      }
    }
  }

  // ── 样式 ──────────────────────────────────────────────────────────────────
  // XMind 2020: topic.style = { id: "xxx", properties: { ... } }
  // 或 topic.styleId = "xxx"
  const styleId = topic.styleId || (topic.style && topic.style.id);
  if (styleId) {
    data.style = { 'xmind-style-id': styleId };
  }
  // 保留内联样式属性（如颜色、字体）
  if (topic.style && topic.style.properties) {
    if (!data.style) data.style = {};
    const props = topic.style.properties;
    // 常见样式属性映射
    if (props['fo:color'])            data.style.color       = props['fo:color'];
    if (props['fo:background-color']) data.style.background  = props['fo:background-color'];
    if (props['fo:font-size'])        data.style.fontSize    = props['fo:font-size'];
    if (props['fo:font-weight'])      data.style.fontWeight  = props['fo:font-weight'];
    if (props['fo:font-style'])       data.style.fontStyle   = props['fo:font-style'];
    if (props['line-color'])          data.style.lineColor   = props['line-color'];
    if (props['line-width'])          data.style.lineWidth   = props['line-width'];
    if (props['shape-class'])         data.style.shapeClass  = props['shape-class'];
  }

  // ── 分支折叠 ──────────────────────────────────────────────────────────────
  // XMind 2020: topic.branch = "folded"
  if (topic.branch === 'folded') {
    data.expandState = 'collapse';
  }

  // ── 结构类型 ──────────────────────────────────────────────────────────────
  // XMind 2020: topic.structureClass = "org.xmind.ui.logic.right"
  if (topic.structureClass) {
    data['xmind-structure'] = topic.structureClass;
  }

  // ── 子节点 ────────────────────────────────────────────────────────────────
  // XMind 2020: topic.children = { attached: [...], detached: [...], summary: [...] }
  if (topic.children) {
    // attached: 主要子节点
    if (Array.isArray(topic.children.attached)) {
      for (const child of topic.children.attached) {
        node.children.push(convertTopic2020(child, hideEmptyValue));
      }
    }
    // detached: 浮动子节点（有损，记录但标记）
    if (Array.isArray(topic.children.detached)) {
      for (const child of topic.children.detached) {
        const childNode = convertTopic2020(child, hideEmptyValue);
        childNode.data['xmind-detached'] = true;
        node.children.push(childNode);
      }
    }
    // summary: 概要节点（有损，记录但标记）
    if (Array.isArray(topic.children.summary)) {
      for (const child of topic.children.summary) {
        const childNode = convertTopic2020(child, hideEmptyValue);
        childNode.data['xmind-summary'] = true;
        node.children.push(childNode);
      }
    }
    // callout: 标注节点（XMind 2020 Zen 特有）
    if (Array.isArray(topic.children.callout)) {
      for (const child of topic.children.callout) {
        const childNode = convertTopic2020(child, hideEmptyValue);
        childNode.data['xmind-callout'] = true;
        node.children.push(childNode);
      }
    }
  }

  // ── hideEmptyValue：过滤空字段（参考 tobyqin/xmindparser）————————————————
  if (hideEmptyValue) {
    for (const key of Object.keys(data)) {
      if (key === 'text') continue; // text 字段始终保留
      const val = data[key];
      if (val === null || val === undefined || val === '' ||
          (Array.isArray(val) && val.length === 0)) {
        delete data[key];
      }
    }
  }

  return node;
}

/**
 * 从 HTML 字符串中提取纯文本
 */
function stripHtml(html) {
  if (!html) return '';
  // 简单替换标签
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}
