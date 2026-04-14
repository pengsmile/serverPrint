/**
 * 环境感知打包脚本
 * 用法：node scripts/build.js test | production
 *
 * 打包前将 .env.{env} 覆盖到 .env，打包完成后自动还原，
 * electron-builder 始终打包 .env，无需改动其他配置。
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const env = process.argv[2];
if (!env || !['test', 'production'].includes(env)) {
  console.error('用法: node scripts/build.js test | production');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const envSource = path.join(rootDir, `.env.${env}`);
const envTarget = path.join(rootDir, '.env');

if (!fs.existsSync(envSource)) {
  console.error(`找不到环境配置文件: .env.${env}`);
  process.exit(1);
}

// 备份当前 .env
const originalEnv = fs.existsSync(envTarget)
  ? fs.readFileSync(envTarget, 'utf-8')
  : null;

console.log(`[build] 环境: ${env}`);

try {
  // 用目标环境的配置覆盖 .env
  fs.copyFileSync(envSource, envTarget);

  // 构建渲染层
  execSync('npm run build:renderer', { stdio: 'inherit', cwd: rootDir });

  // 打包 Electron
  execSync('electron-builder --win --x64', { stdio: 'inherit', cwd: rootDir });

  console.log(`[build] 打包完成（${env}）`);
} finally {
  // 还原原始 .env
  if (originalEnv !== null) {
    fs.writeFileSync(envTarget, originalEnv, 'utf-8');
    console.log('[build] .env 已还原');
  }
}
