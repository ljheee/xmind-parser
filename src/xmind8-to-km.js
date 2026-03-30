/**
 * XMind 8 (XML / content.xml) → KityMinder JSON
 *
 * XMind 8 .xmind 文件是 ZIP 包，核心内容在 content.xml，注释在 comments.xml。
 * 本模块负责将解析后的 XML DOM 转换为 KityMinder JSON 格式。
 *
 * 优化参考：tobyqin/xmindparser（Python 实现）
 *   - XML 预处理：统一命名空间前缀，简化属性读取
 *   - 附件链接识别：xap:attachments 前缀 → [Attachment] 标记
 *   - 内部链接识别：xmind:# 前缀 → [InternalLink] 标记
 *   - comments.xml 支持：读取批注并附加到对应节点
 *   - callout 类型节点支持
 *   - hideEmptyValue 配置选项
 *
 * KityMinder 图片字段约定（与 xmindparser / baidu-naotu-plugin 一致）：
 *   data.image     = "https://..." 或 "xap:attachments/xxx.png"  （URL 字符串）
 *   data.imageSize = { width: 200, height: 150 }                  （尺寸对象，可选）
 *
 * 支持字段：
 *   ✅ 标题 (title)
 *   ✅ 备注 (notes → data.note)
 *   ✅ 超链接 (xlink:href → data.hyperlink)
 *   ✅ 附件链接 (xap:attachments → data.hyperlink + data.attachment = true)
 *   ✅ 内部链接 (xmind:# → data.hyperlink + data.internalLink = true)
 *   ✅ 标签 (label → data.label[])
 *   ✅ 优先级标记 (priority-N → data.priority)
 *   ✅ 进度标记 (task-* → data.progress，完整10级)
 *   ✅ 其他标记 (→ data.markers[])
 *   ✅ 图片 (<image xlink:href> 或 <img> → data.image + data.imageSize)
 *   ✅ 样式 (style-id → data.style)
 *   ✅ 分支折叠 (branch="folded" → data.expandState)
 *   ✅ 批注 (comments.xml → data.comment[])
 *   ✅ callout 节点 (type="callout" → data['xmind-callout'] = true)
 *   ✅ 多画布（sheets）→ 返回数组
 */

import {
  parseXML,
  preprocessXmind8Xml,
  getChildren,
  getChild,
  getAttr,
  getTextContent,
} from './utils.js';
import {
  XMIND_PRIORITY_MARKERS,
  XMIND_PROGRESS_MARKERS,
  KM_ROOT_TEMPLATE,
} from './constants.js';

/**
 * 将 content.xml 字符串解析为 KityMinder JSON 数组（每个 sheet 一个）
 * @param {string} xmlString
 * @param {object} [options]
 * @param {boolean} [options.firstSheetOnly=false] 只返回第一个画布
 * @param {boolean} [options.hideEmptyValue=true] 过滤空字段（减少体积）
 * @param {string} [options.commentsXml] comments.xml 内容（可选）
 * @returns {Promise<Array<{root, template, theme, version}>>}
 */
export async function parseXmind8Xml(xmlString, options = {}) {
  const hideEmptyValue = options.hideEmptyValue !== false; // 默认 true

  // ── XML 预处理：统一命名空间前缀（参考 tobyqin/xmindparser）──────────────
  const processedXml = preprocessXmind8Xml(xmlString);
  const doc = await parseXML(processedXml);
  const workbook = doc.documentElement; // xmap-content

  const sheets = getChildren(workbook, 'sheet');
  if (sheets.length === 0) {
    throw new Error('XMind 8: No sheets found in content.xml');
  }

  // ── 解析 comments.xml（如果提供）────────────────────────────────────────
  let commentsMap = null;
  if (options.commentsXml) {
    commentsMap = await parseCommentsXml(options.commentsXml);
  }

  const results = [];
  for (const sheet of sheets) {
    const km = KM_ROOT_TEMPLATE();
    km.title = getAttr(sheet, 'name') || getTextContent(getChild(sheet, 'title')) || 'Sheet';

    const rootTopicEl = getChild(sheet, 'topic');
    if (rootTopicEl) {
      km.root = convertTopic8(rootTopicEl, commentsMap, hideEmptyValue);
    }

    results.push(km);
    if (options.firstSheetOnly) break;
  }

  return results;
}

/**
 * 递归转换 XMind 8 topic 元素 → KityMinder 节点
 */
function convertTopic8(topicEl, commentsMap, hideEmptyValue) {
  const node = { data: {}, children: [] };
  const data = node.data;

  // ── 节点 ID（用于匹配 comments）────────────────────────────────────────
  const topicId = getAttr(topicEl, 'id');

  // ── 标题 ──────────────────────────────────────────────────────────────────
  const titleEl = getChild(topicEl, 'title');
  data.text = getTextContent(titleEl) || '';

  // ── 超链接 ────────────────────────────────────────────────────────────────
  // 预处理后 xlink:href 已变为 href，直接读取
  // 参考 tobyqin/xmindparser：区分附件链接、内部链接、普通链接
  const href = getAttr(topicEl, 'href');
  if (href) {
    if (href.startsWith('xap:attachments') || href.startsWith('xap:resources')) {
      // 附件链接：保留原始路径，标记为附件
      data.hyperlink = href;
      data.attachment = true;
    } else if (href.startsWith('xmind:') || href.startsWith('#')) {
      // 内部链接（跳转到另一个 topic）
      data.hyperlink = href;
      data.internalLink = true;
    } else {
      data.hyperlink = href;
    }
  }

  // ── 备注 ──────────────────────────────────────────────────────────────────
  // XMind 8: <notes><plain><![CDATA[...]]></plain></notes>
  const notesEl = getChild(topicEl, 'notes');
  if (notesEl) {
    const plainEl = getChild(notesEl, 'plain');
    if (plainEl) {
      data.note = getTextContent(plainEl);
    } else {
      data.note = extractNotesText(notesEl);
    }
  }

  // ── 标签 ──────────────────────────────────────────────────────────────────
  // XMind 8: <labels><label>tag1</label></labels>
  const labelsEl = getChild(topicEl, 'labels');
  if (labelsEl) {
    const labelEls = getChildren(labelsEl, 'label');
    if (labelEls.length > 0) {
      data.label = labelEls.map(el => getTextContent(el)).filter(Boolean);
    }
  }

  // ── 标记（图标）──────────────────────────────────────────────────────────
  // XMind 8: <marker-refs><marker-ref marker-id="priority-1"/></marker-refs>
  const markerRefsEl = getChild(topicEl, 'marker-refs');
  if (markerRefsEl) {
    const markerRefs = getChildren(markerRefsEl, 'marker-ref');
    const otherMarkers = [];
    for (const ref of markerRefs) {
      const markerId = getAttr(ref, 'marker-id');
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
  // 预处理后：
  //   新版 <image href="xap:attachments/xxx.png" width="200" height="150"/>
  //   旧版 <img src="xap:attachments/xxx.png" width="200" height="150"/>（已由预处理转换）
  // KityMinder 约定：data.image = URL字符串，data.imageSize = {width, height}
  const imgInfo = findImageElement(topicEl);
  if (imgInfo) {
    data.image = imgInfo.src;
    if (imgInfo.width || imgInfo.height) {
      data.imageSize = {};
      if (imgInfo.width)  data.imageSize.width  = imgInfo.width;
      if (imgInfo.height) data.imageSize.height = imgInfo.height;
    }
  }

  // ── 样式 ──────────────────────────────────────────────────────────────────
  const styleId = getAttr(topicEl, 'style-id');
  if (styleId) {
    data.style = { 'xmind-style-id': styleId };
  }

  // ── 分支折叠 ──────────────────────────────────────────────────────────────
  const branch = getAttr(topicEl, 'branch');
  if (branch === 'folded') {
    data.expandState = 'collapse';
  }

  // ── 结构类型 ──────────────────────────────────────────────────────────────
  const structureClass = getAttr(topicEl, 'structure-class');
  if (structureClass) {
    data['xmind-structure'] = structureClass;
  }

  // ── 批注（来自 comments.xml）────────────────────────────────────────────
  // 参考 tobyqin/xmindparser comments_of() 实现
  if (commentsMap && topicId && commentsMap[topicId]) {
    data.comment = commentsMap[topicId];
  }

  // ── 子节点 ────────────────────────────────────────────────────────────────
  const childrenEl = getChild(topicEl, 'children');
  if (childrenEl) {
    const topicsEls = getChildren(childrenEl, 'topics');
    for (const topicsEl of topicsEls) {
      const type = getAttr(topicsEl, 'type');
      if (type === 'attached' || type === null) {
        for (const childTopic of getChildren(topicsEl, 'topic')) {
          node.children.push(convertTopic8(childTopic, commentsMap, hideEmptyValue));
        }
      } else if (type === 'detached') {
        for (const childTopic of getChildren(topicsEl, 'topic')) {
          const child = convertTopic8(childTopic, commentsMap, hideEmptyValue);
          child.data['xmind-detached'] = true;
          node.children.push(child);
        }
      } else if (type === 'callout') {
        // callout：标注节点（XMind 8 也有此类型）
        for (const childTopic of getChildren(topicsEl, 'topic')) {
          const child = convertTopic8(childTopic, commentsMap, hideEmptyValue);
          child.data['xmind-callout'] = true;
          node.children.push(child);
        }
      }
    }
  }

  // ── hideEmptyValue：过滤空字段（参考 tobyqin/xmindparser）────────────────
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
 * 从 notes 元素中提取纯文本（处理 xhtml 格式）
 */
function extractNotesText(notesEl) {
  const texts = [];
  function walk(el) {
    if (!el) return;
    if (el.nodeType === 3) {
      const t = (el.nodeValue || '').trim();
      if (t) texts.push(t);
    }
    if (el.childNodes) {
      for (let i = 0; i < el.childNodes.length; i++) walk(el.childNodes[i]);
    }
  }
  walk(notesEl);
  return texts.join('\n').trim();
}

/**
 * 在 topic 元素中查找图片，返回 { src, width, height } 或 null
 *
 * 预处理后的两种写法（命名空间前缀已统一）：
 *   1. <image href="xap:attachments/xxx.png" width="200" height="150"/>
 *   2. <img src="xap:attachments/xxx.png" width="200" height="150"/>（旧版，已由预处理转换）
 */
function findImageElement(topicEl) {
  for (const child of getChildren(topicEl)) {
    const localName = (child.localName || child.nodeName || '').replace(/^.*:/, '');

    if (localName === 'image') {
      // 新版写法（预处理后 xlink:href → href）
      const src = getAttr(child, 'href') || getAttr(child, 'src');
      if (!src) continue;
      const w = parseInt(getAttr(child, 'width')  || '', 10) || undefined;
      const h = parseInt(getAttr(child, 'height') || '', 10) || undefined;
      return { src, width: w, height: h };
    }

    if (localName === 'img') {
      // 旧版写法（预处理后 xhtml:src → src，svg:width → width）
      const src = getAttr(child, 'src');
      if (!src) continue;
      const w = parseInt(getAttr(child, 'width')  || '', 10) || undefined;
      const h = parseInt(getAttr(child, 'height') || '', 10) || undefined;
      return { src, width: w, height: h };
    }
  }
  return null;
}

/**
 * 解析 comments.xml，返回 { topicId: [{author, content}] } 映射
 * 参考 tobyqin/xmindparser comments_of() 实现
 *
 * comments.xml 结构：
 *   <comments>
 *     <comment object-id="topicId" author="user" time="...">
 *       <content>comment text</content>
 *     </comment>
 *   </comments>
 */
async function parseCommentsXml(commentsXmlStr) {
  if (!commentsXmlStr || !commentsXmlStr.trim()) return null;
  try {
    const doc = await parseXML(commentsXmlStr);
    const root = doc.documentElement;
    const commentEls = getChildren(root, 'comment');
    const map = {};
    for (const el of commentEls) {
      const objectId = getAttr(el, 'object-id');
      if (!objectId) continue;
      const author  = getAttr(el, 'author') || '';
      const contentEl = getChild(el, 'content');
      const content = getTextContent(contentEl);
      if (!map[objectId]) map[objectId] = [];
      map[objectId].push({ author, content });
    }
    return map;
  } catch {
    return null;
  }
}
