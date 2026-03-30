/**
 * xmind-parser
 * 完整的 XMind ↔ KityMinder JSON 双向转换库
 *
 * 浏览器 & Node.js 双端兼容
 *
 * 用法（Node.js）：
 *   import { xmindToKm, kmToXmind } from 'xmind-parser';
 *   const km = await xmindToKm('/path/to/file.xmind');
 *   await kmToXmind(km, '/path/to/output.xmind', { format: 'xmind2020' });
 *
 * 用法（浏览器）：
 *   import { xmindBufferToKm, kmToXmindBuffer } from 'xmind-parser';
 *   // file: File 对象（来自 <input type="file">）
 *   const buffer = await file.arrayBuffer();
 *   const km = await xmindBufferToKm(buffer);
 *   const outBuffer = kmToXmindBuffer(km, { format: 'xmind2020' });
 *   downloadArrayBuffer(outBuffer, 'output.xmind');
 */

import { readZipAsync, uint8ArrayToString, readFileAsArrayBuffer, writeFileFromArrayBuffer, downloadArrayBuffer } from './utils.js';
import { parseXmind8Xml }    from './xmind8-to-km.js';
import { parseXmind2020Json } from './xmind2020-to-km.js';
import { kmToXmind8 }        from './km-to-xmind8.js';
import { kmToXmind2020 }     from './km-to-xmind2020.js';
import { XMIND_CONTENT_JSON, XMIND_CONTENT_XML } from './constants.js';

export { downloadArrayBuffer };

// ─── 核心：从 ArrayBuffer 解析 ────────────────────────────────────────────────

/**
 * 从 .xmind 文件的 ArrayBuffer 解析为 KityMinder JSON 数组
 * 自动检测 XMind 8 (XML) 或 XMind 2020+ (JSON) 格式
 *
 * @param {ArrayBuffer} buffer
 * @param {object} [options]
 * @param {boolean} [options.firstSheetOnly=false] 只返回第一个画布
 * @returns {Promise<Array<KmDocument>>}
 */
export async function xmindBufferToKm(buffer, options = {}) {
  const files = await readZipAsync(buffer);

  // 检测格式：优先 content.json（XMind 2020+），其次 content.xml（XMind 8）
  if (files[XMIND_CONTENT_JSON]) {
    const jsonStr = uint8ArrayToString(files[XMIND_CONTENT_JSON]);
    return parseXmind2020Json(jsonStr, options);
  }

  if (files[XMIND_CONTENT_XML]) {
    const xmlStr = uint8ArrayToString(files[XMIND_CONTENT_XML]);
    return parseXmind8Xml(xmlStr, options);
  }

  // 兼容：有些文件可能用不同大小写
  const keys = Object.keys(files);
  const jsonKey = keys.find(k => k.toLowerCase() === 'content.json');
  const xmlKey  = keys.find(k => k.toLowerCase() === 'content.xml');

  if (jsonKey) {
    const jsonStr = uint8ArrayToString(files[jsonKey]);
    return parseXmind2020Json(jsonStr, options);
  }
  if (xmlKey) {
    const xmlStr = uint8ArrayToString(files[xmlKey]);
    return parseXmind8Xml(xmlStr, options);
  }

  throw new Error(
    'Cannot parse .xmind file: neither content.json nor content.xml found in ZIP. ' +
    `Found files: ${keys.join(', ')}`
  );
}

/**
 * 将 KityMinder JSON 转换为 .xmind 文件的 ArrayBuffer
 *
 * @param {KmDocument | Array<KmDocument>} kmData
 * @param {object} [options]
 * @param {'xmind8' | 'xmind2020'} [options.format='xmind2020'] 输出格式
 * @param {string} [options.sheetName] 画布名称
 * @returns {ArrayBuffer}
 */
export function kmToXmindBuffer(kmData, options = {}) {
  const format = options.format || 'xmind2020';
  if (format === 'xmind8') {
    return kmToXmind8(kmData, options);
  }
  return kmToXmind2020(kmData, options);
}

// ─── Node.js 便捷 API ─────────────────────────────────────────────────────────

/**
 * 从文件路径读取 .xmind 并解析为 KityMinder JSON 数组（Node.js 专用）
 *
 * @param {string} filePath
 * @param {object} [options]
 * @returns {Promise<Array<KmDocument>>}
 */
export async function xmindToKm(filePath, options = {}) {
  const buffer = await readFileAsArrayBuffer(filePath);
  return xmindBufferToKm(buffer, options);
}

/**
 * 将 KityMinder JSON 写入 .xmind 文件（Node.js 专用）
 *
 * @param {KmDocument | Array<KmDocument>} kmData
 * @param {string} outputPath
 * @param {object} [options]
 * @param {'xmind8' | 'xmind2020'} [options.format='xmind2020']
 * @returns {Promise<void>}
 */
export async function kmToXmind(kmData, outputPath, options = {}) {
  const buffer = kmToXmindBuffer(kmData, options);
  await writeFileFromArrayBuffer(outputPath, buffer);
}

// ─── 低层 API（直接操作字符串/对象）─────────────────────────────────────────

/**
 * 将 XMind 8 content.xml 字符串解析为 KityMinder JSON 数组
 * @param {string} xmlString
 * @param {object} [options]
 * @returns {Promise<Array<KmDocument>>}
 */
export { parseXmind8Xml };

/**
 * 将 XMind 2020 content.json 字符串或数组解析为 KityMinder JSON 数组
 * @param {string | Array} contentJson
 * @param {object} [options]
 * @returns {Array<KmDocument>}
 */
export { parseXmind2020Json };

/**
 * 将 KityMinder JSON 转换为 XMind 8 ZIP ArrayBuffer
 * @param {KmDocument | Array<KmDocument>} kmData
 * @param {object} [options]
 * @returns {ArrayBuffer}
 */
export { kmToXmind8 };

/**
 * 将 KityMinder JSON 转换为 XMind 2020+ ZIP ArrayBuffer
 * @param {KmDocument | Array<KmDocument>} kmData
 * @param {object} [options]
 * @returns {ArrayBuffer}
 */
export { kmToXmind2020 };

// ─── 类型定义（JSDoc）────────────────────────────────────────────────────────

/**
 * @typedef {object} KmDocument
 * @property {KmNode} root - 根节点
 * @property {string} [template] - 布局模板
 * @property {string} [theme] - 主题
 * @property {string} [version] - 版本
 * @property {string} [title] - 画布标题
 */

/**
 * @typedef {object} KmNode
 * @property {KmNodeData} data - 节点数据
 * @property {KmNode[]} children - 子节点
 */

/**
 * @typedef {object} KmNodeData
 * @property {string} text - 节点文本
 * @property {string} [hyperlink] - 超链接 URL
 * @property {string} [note] - 备注文本
 * @property {string[]} [label] - 标签数组
 * @property {number} [priority] - 优先级 1-9
 * @property {number} [progress] - 进度 1-10（完整10级：1=0%, 5=50%, 9=100%, 10=暂停）
 * @property {string[]} [markers] - 其他标记 ID 数组
 * @property {string} [image] - 图片 URL 字符串（"https://..." 或 "xap:attachments/xxx.png"）
 * @property {{width?: number, height?: number}} [imageSize] - 图片尺寸
 * @property {object} [style] - 样式对象
 * @property {'collapse'} [expandState] - 折叠状态
 * @property {Array<{author: string, content: string}>} [comment] - 批注（来自 comments.xml）
 * @property {boolean} [attachment] - 是否为附件链接（hyperlink 为 xap: 路径时为 true）
 * @property {boolean} [internalLink] - 是否为内部链接（hyperlink 为 xmind:# 时为 true）
 * @property {string} ['xmind-structure'] - XMind 结构类型（保留字段）
 * @property {boolean} ['xmind-detached'] - 是否为浮动节点（有损标记）
 * @property {boolean} ['xmind-summary'] - 是否为概要节点（有损标记）
 * @property {boolean} ['xmind-callout'] - 是否为标注节点（有损标记）
 */
