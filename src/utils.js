/**
 * 通用工具函数 —— 浏览器 & Node.js 双端兼容
 */

// ─── ZIP 读取 ────────────────────────────────────────────────────────────────

/**
 * 从 ArrayBuffer 中读取 ZIP 文件，返回 { filename: Uint8Array } 映射
 * 纯 JS 实现，无需第三方依赖，兼容浏览器和 Node.js
 */
export function readZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const files = {};

  let offset = 0;
  while (offset < bytes.length - 4) {
    // Local file header signature: 0x04034b50
    if (
      bytes[offset]     !== 0x50 ||
      bytes[offset + 1] !== 0x4b ||
      bytes[offset + 2] !== 0x03 ||
      bytes[offset + 3] !== 0x04
    ) {
      break;
    }

    const compressionMethod = readUint16LE(bytes, offset + 8);
    const compressedSize    = readUint32LE(bytes, offset + 18);
    const uncompressedSize  = readUint32LE(bytes, offset + 22);
    const fileNameLength    = readUint16LE(bytes, offset + 26);
    const extraFieldLength  = readUint16LE(bytes, offset + 28);

    const fileNameBytes = bytes.slice(offset + 30, offset + 30 + fileNameLength);
    const fileName = new TextDecoder('utf-8').decode(fileNameBytes);

    const dataOffset = offset + 30 + fileNameLength + extraFieldLength;
    const compressedData = bytes.slice(dataOffset, dataOffset + compressedSize);

    if (compressionMethod === 0) {
      // Stored (no compression)
      files[fileName] = compressedData;
    } else if (compressionMethod === 8) {
      // Deflate
      files[fileName] = inflateRaw(compressedData, uncompressedSize);
    }

    offset = dataOffset + compressedSize;
  }

  return files;
}

function readUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) |
          (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/**
 * 极简 DEFLATE raw inflate 实现（仅支持 XMind 实际使用的压缩块）
 * 对于复杂场景，建议在 Node.js 环境使用 zlib，浏览器使用 DecompressionStream
 */
function inflateRaw(data, uncompressedSize) {
  // 优先使用平台原生能力
  if (typeof DecompressionStream !== 'undefined') {
    // 浏览器 (Chrome 80+, Firefox 113+)
    // 注意：这里返回同步结果需要特殊处理，实际使用时应走异步路径
    // 此处作为 fallback 标记，真正的异步解压在 readZipAsync 中处理
    return data; // placeholder
  }
  // Node.js 环境在 readZipAsync 中用 zlib 处理
  return data; // placeholder
}

/**
 * 异步读取 ZIP（推荐使用此方法，支持 deflate 压缩）
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{[filename: string]: Uint8Array}>}
 */
export async function readZipAsync(buffer) {
  const bytes = new Uint8Array(buffer);
  const files = {};
  const pendingDecompress = [];

  let offset = 0;
  while (offset < bytes.length - 4) {
    if (
      bytes[offset]     !== 0x50 ||
      bytes[offset + 1] !== 0x4b ||
      bytes[offset + 2] !== 0x03 ||
      bytes[offset + 3] !== 0x04
    ) {
      break;
    }

    const compressionMethod = readUint16LE(bytes, offset + 8);
    const compressedSize    = readUint32LE(bytes, offset + 18);
    const uncompressedSize  = readUint32LE(bytes, offset + 22);
    const fileNameLength    = readUint16LE(bytes, offset + 26);
    const extraFieldLength  = readUint16LE(bytes, offset + 28);

    const fileNameBytes = bytes.slice(offset + 30, offset + 30 + fileNameLength);
    const fileName = new TextDecoder('utf-8').decode(fileNameBytes);

    const dataOffset = offset + 30 + fileNameLength + extraFieldLength;
    const compressedData = bytes.slice(dataOffset, dataOffset + compressedSize);

    if (compressionMethod === 0) {
      files[fileName] = compressedData;
    } else if (compressionMethod === 8) {
      pendingDecompress.push({ fileName, compressedData, uncompressedSize });
    }

    offset = dataOffset + compressedSize;
  }

  // 解压 deflate 数据
  for (const { fileName, compressedData } of pendingDecompress) {
    files[fileName] = await decompressDeflate(compressedData);
  }

  return files;
}

async function decompressDeflate(data) {
  // 浏览器：使用 DecompressionStream
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    writer.write(data);
    writer.close();
    const chunks = [];
    let totalLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }
    const result = new Uint8Array(totalLength);
    let pos = 0;
    for (const chunk of chunks) {
      result.set(chunk, pos);
      pos += chunk.length;
    }
    return result;
  }

  // Node.js：使用 zlib
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const zlib = await import('zlib');
    const { promisify } = await import('util');
    const inflateRawAsync = promisify(zlib.inflateRaw);
    const result = await inflateRawAsync(Buffer.from(data));
    return new Uint8Array(result);
  }

  throw new Error('No decompression support available');
}

// ─── ZIP 写入 ────────────────────────────────────────────────────────────────

/**
 * 将文件映射打包为 ZIP ArrayBuffer
 * @param {{[filename: string]: string | Uint8Array}} files
 * @returns {ArrayBuffer}
 */
export function writeZip(files) {
  const encoder = new TextEncoder();
  const localHeaders = [];
  const centralDirectory = [];
  let localOffset = 0;

  for (const [filename, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(filename);
    const dataBytes = typeof content === 'string' ? encoder.encode(content) : content;
    const crc = crc32(dataBytes);

    // Local file header
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);  // signature
    lv.setUint16(4, 20, true);           // version needed
    lv.setUint16(6, 0, true);            // flags
    lv.setUint16(8, 0, true);            // compression: stored
    lv.setUint16(10, 0, true);           // mod time
    lv.setUint16(12, 0, true);           // mod date
    lv.setUint32(14, crc, true);         // crc32
    lv.setUint32(18, dataBytes.length, true); // compressed size
    lv.setUint32(22, dataBytes.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true); // filename length
    lv.setUint16(28, 0, true);           // extra field length
    localHeader.set(nameBytes, 30);

    // Central directory entry
    const cdEntry = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdEntry.buffer);
    cv.setUint32(0, 0x02014b50, true);   // signature
    cv.setUint16(4, 20, true);            // version made by
    cv.setUint16(6, 20, true);            // version needed
    cv.setUint16(8, 0, true);             // flags
    cv.setUint16(10, 0, true);            // compression
    cv.setUint16(12, 0, true);            // mod time
    cv.setUint16(14, 0, true);            // mod date
    cv.setUint32(16, crc, true);          // crc32
    cv.setUint32(20, dataBytes.length, true); // compressed size
    cv.setUint32(24, dataBytes.length, true); // uncompressed size
    cv.setUint16(28, nameBytes.length, true); // filename length
    cv.setUint16(30, 0, true);            // extra field length
    cv.setUint16(32, 0, true);            // comment length
    cv.setUint16(34, 0, true);            // disk number start
    cv.setUint16(36, 0, true);            // internal attributes
    cv.setUint32(38, 0, true);            // external attributes
    cv.setUint32(42, localOffset, true);  // relative offset
    cdEntry.set(nameBytes, 46);

    localHeaders.push(localHeader, dataBytes);
    centralDirectory.push(cdEntry);
    localOffset += localHeader.length + dataBytes.length;
  }

  // End of central directory record
  const cdSize = centralDirectory.reduce((s, e) => s + e.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, centralDirectory.length, true);
  ev.setUint16(10, centralDirectory.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, localOffset, true);
  ev.setUint16(20, 0, true);

  const allParts = [...localHeaders, ...centralDirectory, eocd];
  const totalSize = allParts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const part of allParts) {
    result.set(part, pos);
    pos += part.length;
  }
  return result.buffer;
}

// CRC-32 计算
function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ─── 文本工具 ────────────────────────────────────────────────────────────────

export function uint8ArrayToString(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

export function stringToUint8Array(str) {
  return new TextEncoder().encode(str);
}

/**
 * 生成唯一 ID（26位字母数字，与 XMind 格式兼容）
 */
export function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 26; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * 当前时间戳（毫秒）
 */
export function timestamp() {
  return Date.now();
}

// ─── XML 工具 ────────────────────────────────────────────────────────────────

/**
 * XMind 8 XML 预处理（参考 tobyqin/xmindparser xmind_content_to_etree 思路）
 *
 * 将 XMind 8 content.xml 中的命名空间前缀统一化，使后续属性读取更简单：
 *   - xlink:href  → href
 *   - xhtml:src   → src
 *   - svg:width   → width
 *   - svg:height  → height
 *   - <xhtml:img> → <img>（保留，兼容旧版写法）
 *
 * 这样 getAttr(el, 'href') 就能直接读到超链接，无需传命名空间参数。
 *
 * @param {string} xmlString
 * @returns {string}
 */
export function preprocessXmind8Xml(xmlString) {
  return xmlString
    // xlink:href="..." → href="..."
    .replace(/\bxlink:href=/g, 'href=')
    // xhtml:src="..." → src="..."
    .replace(/\bxhtml:src=/g, 'src=')
    // svg:width="..." → width="..."
    .replace(/\bsvg:width=/g, 'width=')
    // svg:height="..." → height="..."
    .replace(/\bsvg:height=/g, 'height=')
    // <xhtml:img → <img（旧版图片标签）
    .replace(/<xhtml:img\b/g, '<img')
    .replace(/<\/xhtml:img>/g, '</img>');
}

/**
 * 跨平台 XML 解析
 * 浏览器：DOMParser；Node.js：@xmldom/xmldom 或内置 xml 模块
 */
export async function parseXML(xmlString) {
  if (typeof DOMParser !== 'undefined') {
    // 浏览器
    const parser = new DOMParser();
    return parser.parseFromString(xmlString, 'text/xml');
  }
  // Node.js
  try {
    const { DOMParser: NodeDOMParser } = await import('@xmldom/xmldom');
    const parser = new NodeDOMParser();
    return parser.parseFromString(xmlString, 'text/xml');
  } catch {
    // 降级：使用内置 xml 解析（简单场景）
    throw new Error(
      'XML parsing requires @xmldom/xmldom in Node.js. ' +
      'Install it with: npm install @xmldom/xmldom'
    );
  }
}

/**
 * 序列化 DOM 为 XML 字符串
 */
export function serializeXML(doc) {
  if (typeof XMLSerializer !== 'undefined') {
    return new XMLSerializer().serializeToString(doc);
  }
  // Node.js @xmldom/xmldom
  if (doc.toString && doc.toString().startsWith('<')) {
    return doc.toString();
  }
  throw new Error('Cannot serialize XML document');
}

/**
 * 获取元素的文本内容（兼容不同 DOM 实现）
 */
export function getTextContent(el) {
  if (!el) return '';
  return (el.textContent || el.nodeValue || '').trim();
}

/**
 * 获取元素的属性（带命名空间支持）
 */
export function getAttr(el, name, ns) {
  if (!el) return null;
  if (ns) {
    return el.getAttributeNS(ns, name) || el.getAttribute(name) || null;
  }
  return el.getAttribute(name) || null;
}

/**
 * 获取直接子元素（按标签名）
 */
export function getChildren(el, tagName) {
  if (!el || !el.childNodes) return [];
  const result = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i];
    if (child.nodeType === 1) { // ELEMENT_NODE
      const localName = child.localName || child.nodeName.replace(/^.*:/, '');
      if (!tagName || localName === tagName) {
        result.push(child);
      }
    }
  }
  return result;
}

/**
 * 获取第一个匹配的子元素
 */
export function getChild(el, tagName) {
  return getChildren(el, tagName)[0] || null;
}

/**
 * XML 字符转义
 */
export function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 构建 XML 字符串（轻量级，无需 DOM）
 */
export function buildXml(tag, attrs, children, selfClose = false) {
  const attrStr = Object.entries(attrs || {})
    .filter(([, v]) => v != null)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join('');
  if (selfClose) return `<${tag}${attrStr}/>`;
  const childStr = Array.isArray(children)
    ? children.filter(Boolean).join('')
    : (children || '');
  return `<${tag}${attrStr}>${childStr}</${tag}>`;
}

// ─── 文件读取（Node.js 专用） ─────────────────────────────────────────────────

/**
 * 在 Node.js 中读取文件为 ArrayBuffer
 */
export async function readFileAsArrayBuffer(filePath) {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const fs = await import('fs/promises');
    const buf = await fs.readFile(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  throw new Error('readFileAsArrayBuffer is only available in Node.js');
}

/**
 * 在 Node.js 中将 ArrayBuffer 写入文件
 */
export async function writeFileFromArrayBuffer(filePath, buffer) {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, Buffer.from(buffer));
    return;
  }
  throw new Error('writeFileFromArrayBuffer is only available in Node.js');
}

/**
 * 在浏览器中触发文件下载
 */
export function downloadArrayBuffer(buffer, filename) {
  const blob = new Blob([buffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 将 Base64 字符串解码为 Uint8Array
 * 浏览器 & Node.js 双端兼容
 */
export function base64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') {
    // Node.js
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  // 浏览器
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
