/**
 * 模拟浏览器本地上传图片后的 km JSON 结构，验证导出是否正确
 * AttachmentToolbar 用 FileReader.readAsDataURL 读取图片，存为 data URL
 */
import { kmToXmind } from './src/index.js';
import { readZipAsync, uint8ArrayToString } from './src/utils.js';
import { readFileSync } from 'fs';

// 读取一张真实图片，转为 data URL（模拟 FileReader.readAsDataURL）
const imgBytes = readFileSync('./test/fixtures/naoTu.xmind');
// 用一个小的 PNG 测试（直接用 base64 硬编码一个 1x1 红色 PNG）
const tiny1x1RedPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
const dataUrl = `data:image/png;base64,${tiny1x1RedPng}`;

// 构造 km JSON（模拟本地上传图片后的结构）
const kmData = {
  root: {
    data: { text: '中心主题' },
    children: [
      {
        data: {
          text: '分支主题 1（有图片）',
          image: dataUrl,
          imageSize: { width: 100, height: 100 }
        },
        children: []
      },
      {
        data: { text: '分支主题 2（无图片）' },
        children: []
      }
    ]
  },
  template: 'default',
  theme: 'fresh-blue',
  version: '1.4.43'
};

// 导出
await kmToXmind(kmData, '/tmp/test-image-export.xmind', { format: 'xmind2020' });

// 验证
const buf = readFileSync('/tmp/test-image-export.xmind');
const files = await readZipAsync(buf.buffer);

console.log('ZIP 内文件列表:');
for (const [name, data] of Object.entries(files)) {
  console.log(`  ${name}  (${data.length} bytes)`);
}

const contentBytes = files['content.json'];
console.log('content.json 字节数:', contentBytes?.length);
console.log('content.json 末尾20字节(ASCII):', contentBytes ? String.fromCharCode(...contentBytes.slice(-20)) : 'N/A');

const contentStr = uint8ArrayToString(contentBytes);
console.log('content.json 字符串长度:', contentStr.length);
console.log('content.json 末尾50字符:', contentStr.slice(-50));
const content = JSON.parse(contentStr);

function findImages(topic, path) {
  if (topic.image) {
    console.log(`\n节点: ${topic.title} | path: ${path}`);
    console.log(`  image.src: ${topic.image.src}`);
    console.log(`  image.width: ${topic.image.width}, image.height: ${topic.image.height}`);
  }
  const ch = topic.children;
  if (ch) {
    for (const c of [...(ch.attached || [])]) {
      findImages(c, path + '>' + c.title);
    }
  }
}

for (const sheet of content) {
  findImages(sheet.rootTopic, sheet.title);
}
