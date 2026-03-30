/**
 * XMind marker (图标) ID → KityMinder priority/progress 映射
 *
 * XMind 8 XML 中 marker-ref 的 marker-id 属性值
 * XMind 2020 JSON 中 markers[].markerId 值
 */

// 优先级标记 priority-1 ~ priority-9
// KityMinder 用 data.priority = 1..9
export const XMIND_PRIORITY_MARKERS = {
  'priority-1': 1,
  'priority-2': 2,
  'priority-3': 3,
  'priority-4': 4,
  'priority-5': 5,
  'priority-6': 6,
  'priority-7': 7,
  'priority-8': 8,
  'priority-9': 9,
};

// 进度标记完整10级映射（与 xmindparser utils.js task 数组对齐）
// task = ['start','oct','quarter','3oct','half','5oct','3quar','7oct','done','pause']
// KityMinder 用 data.progress = 1..10
export const XMIND_PROGRESS_MARKERS = {
  'task-start':   1,   // 0%
  'task-oct':     2,   // 12.5%
  'task-quarter': 3,   // 25%
  'task-3oct':    4,   // 37.5%
  'task-half':    5,   // 50%
  'task-5oct':    6,   // 62.5%
  'task-3quar':   7,   // 75%
  'task-7oct':    8,   // 87.5%
  'task-done':    9,   // 100%
  'task-pause':   10,  // 暂停
};

// 反向映射
export const KM_PRIORITY_TO_XMIND = Object.fromEntries(
  Object.entries(XMIND_PRIORITY_MARKERS).map(([k, v]) => [v, k])
);
export const KM_PROGRESS_TO_XMIND = Object.fromEntries(
  Object.entries(XMIND_PROGRESS_MARKERS).map(([k, v]) => [v, k])
);

// XMind 8 XML 命名空间
export const NS_XMAP    = 'urn:xmind:xmap:xmlns:content:2.0';
export const NS_XLINK   = 'http://www.w3.org/1999/xlink';
export const NS_SVG     = 'http://www.w3.org/2000/svg';
export const NS_FO      = 'http://www.w3.org/1999/XSL/Format';
export const NS_XHTML   = 'http://www.w3.org/1999/xhtml';

// XMind 2020 ZIP 内文件路径
export const XMIND_CONTENT_JSON = 'content.json';
export const XMIND_CONTENT_XML  = 'content.xml';
export const XMIND_MANIFEST     = 'META-INF/manifest.xml';

// 1×1 透明 PNG，用作 Thumbnails/thumbnail.png 占位（XMind 2020+ 需要此文件才能正常打开）
export const DEFAULT_THUMBNAIL_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8/5+hHgAHggJ/Pj7KxQAAAABJRU5ErkJggg==';

// KityMinder 根节点结构模板
export const KM_ROOT_TEMPLATE = () => ({
  root: {
    data: { text: '' },
    children: [],
  },
  template: 'default',
  theme: 'fresh-blue',
  version: '1.4.43',
});
