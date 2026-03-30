/**
 * KityMinder JSON → XMind 8 (XML / content.xml)
 *
 * 生成合法的 XMind 8 ZIP 结构，包含：
 *   - content.xml           (主要内容)
 *   - styles.xml            (样式，最小化)
 *   - meta.xml              (元数据)
 *   - META-INF/manifest.xml (文件清单)
 *   - Thumbnails/thumbnail.png (缩略图占位，XMind 需要此文件)
 *
 * 支持字段：
 *   ✅ 标题 (data.text → title)
 *   ✅ 备注 (data.note → notes/plain，CDATA 包裹)
 *   ✅ 超链接 (data.hyperlink → xlink:href)
 *   ✅ 标签 (data.label[] → labels/label)
 *   ✅ 优先级 (data.priority → marker-ref priority-N)
 *   ✅ 进度 (data.progress → marker-ref task-*)
 *   ✅ 其他标记 (data.markers[] → marker-ref)
 *   ✅ 图片 (data.image 字符串 + data.imageSize → <image xlink:href>)
 *   ✅ 样式 (data.style → style-id)
 *   ✅ 折叠 (data.expandState → branch="folded")
 *
 * KityMinder 图片字段约定：
 *   data.image     = "https://..." 或 "xap:attachments/xxx.png"  （URL 字符串）
 *   data.imageSize = { width: 200, height: 150 }                  （尺寸对象，可选）
 */

import {
  buildXml,
  escapeXml,
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
 * 将 KityMinder JSON 转换为 XMind 8 ZIP 的 ArrayBuffer
 * @param {object | Array} kmData  单个 km 对象或数组（多画布）
 * @param {object} [options]
 * @param {string} [options.sheetName] 画布名称（单画布时使用）
 * @returns {ArrayBuffer}
 */
export function kmToXmind8(kmData, options = {}) {
  const sheets = Array.isArray(kmData) ? kmData : [kmData];
  const contentXml  = buildContentXml(sheets, options);
  const stylesXml   = buildStylesXml();
  const metaXml     = buildMetaXml();
  const manifestXml = buildManifestXml();

  const files = {
    'content.xml':              contentXml,
    'styles.xml':               stylesXml,
    'meta.xml':                 metaXml,
    'META-INF/manifest.xml':    manifestXml,
    'Thumbnails/thumbnail.png': base64ToBytes(DEFAULT_THUMBNAIL_B64),
  };

  return writeZip(files);
}

// ─── content.xml ─────────────────────────────────────────────────────────────

function buildContentXml(sheets, options) {
  const sheetXmls = sheets.map((km, i) => {
    const sheetName = km.title || options.sheetName || `Sheet ${i + 1}`;
    const sheetId = generateId();
    const rootTopicXml = buildTopicXml(km.root, true);
    return buildXml('sheet', {
      id: sheetId,
      'timestamp': timestamp(),
    }, [
      buildXml('title', {}, escapeXml(sheetName)),
      rootTopicXml,
    ]);
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"
  xmlns:fo="http://www.w3.org/1999/XSL/Format"
  xmlns:svg="http://www.w3.org/2000/svg"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  version="2.0">
${sheetXmls.join('\n')}
</xmap-content>`;
}

function buildTopicXml(node, isRoot = false) {
  if (!node) return '';
  const data = node.data || {};
  const children = node.children || [];

  const attrs = {
    id: generateId(),
    timestamp: timestamp(),
  };

  // 超链接
  if (data.hyperlink) {
    attrs['xlink:href'] = data.hyperlink;
  }

  // 样式 ID
  if (data.style && data.style['xmind-style-id']) {
    attrs['style-id'] = data.style['xmind-style-id'];
  }

  // 折叠
  if (data.expandState === 'collapse') {
    attrs['branch'] = 'folded';
  }

  // 结构类型
  if (data['xmind-structure']) {
    attrs['structure-class'] = data['xmind-structure'];
  }

  const innerParts = [];

  // 标题
  innerParts.push(buildXml('title', {}, escapeXml(data.text || '')));

  // 图片
  // KityMinder: data.image = URL字符串，data.imageSize = {width, height}
  // XMind 8 新版写法：<image xlink:href="xap:attachments/xxx.png" width="200" height="150"/>
  if (data.image && typeof data.image === 'string') {
    const imgAttrs = { 'xlink:href': data.image };
    if (data.imageSize) {
      if (data.imageSize.width)  imgAttrs['width']  = String(data.imageSize.width);
      if (data.imageSize.height) imgAttrs['height'] = String(data.imageSize.height);
    }
    innerParts.push(buildXml('image', imgAttrs, null, true));
  }

  // 备注（使用 CDATA 包裹，避免特殊字符转义问题）
  if (data.note) {
    const cdataNote = `<![CDATA[${data.note.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
    innerParts.push(buildXml('notes', {}, [
      buildXml('plain', {}, cdataNote),
      buildXml('xhtml:div', { 'xmlns:xhtml': 'http://www.w3.org/1999/xhtml' }, [
        buildXml('xhtml:p', {}, escapeXml(data.note)),
      ]),
    ]));
  }

  // 标签
  if (Array.isArray(data.label) && data.label.length > 0) {
    const labelXmls = data.label.map(l => buildXml('label', {}, escapeXml(l)));
    innerParts.push(buildXml('labels', {}, labelXmls));
  }

  // 标记（优先级 + 进度 + 其他）
  const markerRefs = [];
  if (data.priority && KM_PRIORITY_TO_XMIND[data.priority]) {
    markerRefs.push(buildXml('marker-ref', { 'marker-id': KM_PRIORITY_TO_XMIND[data.priority] }, null, true));
  }
  if (data.progress && KM_PROGRESS_TO_XMIND[data.progress]) {
    markerRefs.push(buildXml('marker-ref', { 'marker-id': KM_PROGRESS_TO_XMIND[data.progress] }, null, true));
  }
  if (Array.isArray(data.markers)) {
    for (const markerId of data.markers) {
      markerRefs.push(buildXml('marker-ref', { 'marker-id': markerId }, null, true));
    }
  }
  if (markerRefs.length > 0) {
    innerParts.push(buildXml('marker-refs', {}, markerRefs));
  }

  // 子节点
  if (children.length > 0) {
    const attachedChildren = children.filter(c => !c.data?.['xmind-detached']);
    const detachedChildren = children.filter(c => c.data?.['xmind-detached']);

    const topicsGroups = [];
    if (attachedChildren.length > 0) {
      topicsGroups.push(
        buildXml('topics', { type: 'attached' },
          attachedChildren.map(c => buildTopicXml(c))
        )
      );
    }
    if (detachedChildren.length > 0) {
      topicsGroups.push(
        buildXml('topics', { type: 'detached' },
          detachedChildren.map(c => buildTopicXml(c))
        )
      );
    }
    innerParts.push(buildXml('children', {}, topicsGroups));
  }

  return buildXml('topic', attrs, innerParts);
}

// ─── styles.xml ──────────────────────────────────────────────────────────────

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<xmap-styles xmlns="urn:xmind:xmap:xmlns:style:2.0"
  xmlns:fo="http://www.w3.org/1999/XSL/Format"
  xmlns:svg="http://www.w3.org/2000/svg"
  version="2.0">
<styles/>
</xmap-styles>`;
}

// ─── meta.xml ────────────────────────────────────────────────────────────────

function buildMetaXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<meta xmlns="urn:xmind:xmap:xmlns:meta:2.0" version="2.0">
<Author><name>xmind-kityminder</name></Author>
<Create><time>${new Date().toISOString()}</time></Create>
</meta>`;
}

// ─── META-INF/manifest.xml ───────────────────────────────────────────────────

function buildManifestXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<manifest xmlns="urn:xmind:xmap:xmlns:manifest:1.0">
<file-entry full-path="content.xml" media-type="text/xml"/>
<file-entry full-path="styles.xml" media-type="text/xml"/>
<file-entry full-path="meta.xml" media-type="text/xml"/>
<file-entry full-path="Thumbnails/" media-type=""/>
<file-entry full-path="Thumbnails/thumbnail.png" media-type="image/png"/>
<file-entry full-path="META-INF/" media-type=""/>
</manifest>`;
}
