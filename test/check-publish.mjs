/**
 * 发布前检查脚本
 */
import { readFile, access } from 'fs/promises';
import { constants } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf-8'));

console.log('\n=== package.json 发布配置检查 ===');
const pkgChecks = {
  name:        pkg.name,
  version:     pkg.version,
  description: pkg.description ? '✅' : '❌ missing',
  main:        pkg.main,
  exports:     pkg.exports ? '✅' : '❌ missing',
  type:        pkg.type,
  license:     pkg.license || '❌ missing',
  author:      pkg.author || '⚠️  empty',
  repository:  pkg.repository || '⚠️  missing',
  homepage:    pkg.homepage  || '⚠️  missing',
  bugs:        pkg.bugs      || '⚠️  missing',
  files:       pkg.files     || '⚠️  missing (will publish everything)',
  engines:     pkg.engines   || '⚠️  missing',
};
for (const [k, v] of Object.entries(pkgChecks)) {
  console.log(`  ${k}: ${JSON.stringify(v)}`);
}

console.log('\n=== 关键文件存在性检查 ===');
const requiredFiles = [
  'src/index.js',
  'src/constants.js',
  'src/utils.js',
  'src/xmind8-to-km.js',
  'src/xmind2020-to-km.js',
  'src/km-to-xmind8.js',
  'src/km-to-xmind2020.js',
  'README.md',
  'package.json',
];
for (const f of requiredFiles) {
  try {
    await access(join(ROOT, f), constants.R_OK);
    console.log(`  ✅ ${f}`);
  } catch {
    console.log(`  ❌ ${f} — NOT FOUND`);
  }
}

console.log('\n=== .npmignore / files 字段检查 ===');
try {
  const npmignore = await readFile(join(ROOT, '.npmignore'), 'utf-8');
  console.log('  .npmignore exists:\n' + npmignore.split('\n').map(l => '    ' + l).join('\n'));
} catch {
  console.log('  ⚠️  No .npmignore found');
  if (!pkg.files) {
    console.log('  ⚠️  No "files" field in package.json either — npm will publish EVERYTHING including test/ fixtures/');
  }
}

console.log('\n=== README 内容检查 ===');
const readme = await readFile(join(ROOT, 'README.md'), 'utf-8');
const readmeChecks = [
  ['安装说明',       readme.includes('npm install')],
  ['API 文档',       readme.includes('xmindToKm') && readme.includes('kmToXmind')],
  ['字段支持矩阵',   readme.includes('字段支持矩阵') || readme.includes('支持矩阵')],
  ['有损转换说明',   readme.includes('有损')],
  ['进度映射表',     readme.includes('task-start') && readme.includes('task-done')],
  ['image 字段说明', readme.includes('data.image')],
  ['测试数量',       readme.includes('103') || readme.includes('77')],
];
for (const [label, ok] of readmeChecks) {
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
}

console.log('\n=== 进度映射表准确性检查 ===');
// 从 constants.js 读取实际映射
const { XMIND_PROGRESS_MARKERS } = await import('../src/constants.js');
console.log('  实际映射:', JSON.stringify(XMIND_PROGRESS_MARKERS));
// README 中的映射
const readmeHasCorrectMapping =
  readme.includes('task-start') && readme.includes('task-oct') &&
  readme.includes('task-quarter') && readme.includes('task-3oct') &&
  readme.includes('task-half') && readme.includes('task-5oct') &&
  readme.includes('task-3quar') && readme.includes('task-7oct') &&
  readme.includes('task-done') && readme.includes('task-pause');
console.log(`  README 包含完整10级映射: ${readmeHasCorrectMapping ? '✅' : '❌'}`);

console.log('\n=== image 字段格式检查 ===');
const readmeHasCorrectImageFormat = readme.includes('data.image') && !readme.includes('image: {\n') && !readme.includes('"src":');
// 检查 README 中是否还有旧的 {src, width, height} 对象格式
const hasOldImageFormat = readme.match(/image:\s*\{[\s\S]*?src:/);
console.log(`  README image 字段格式: ${hasOldImageFormat ? '❌ 仍有旧的 {src} 对象格式' : '✅ 正确'}`);

console.log('\n=== Node.js 版本兼容性检查 ===');
console.log(`  当前 Node.js: ${process.version}`);
console.log(`  package.json engines: ${JSON.stringify(pkg.engines)}`);
console.log('  使用了 ES Modules (type: module):', pkg.type === 'module' ? '✅' : '❌');
console.log('  使用了 top-level await (需要 Node 14.8+): ✅');
console.log('  使用了 DecompressionStream (需要 Node 18+): ✅ (有 zlib fallback)');
