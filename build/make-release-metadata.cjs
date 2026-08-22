'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const outputDir = path.join(ROOT, 'dist-desktop-installer')
const setupName = `DeepSeek-Harness-Desktop-Setup-${packageJson.version}.exe`
const names = [setupName, `${setupName}.blockmap`, 'latest.yml']

function digest(file) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(file))
  return hash.digest('hex').toUpperCase()
}

const files = names.map((name) => {
  const file = path.join(outputDir, name)
  if (!fs.existsSync(file)) throw new Error(`发布文件不存在: ${file}`)
  return { name, size: fs.statSync(file).size, sha256: digest(file) }
})

fs.writeFileSync(
  path.join(outputDir, 'SHA256SUMS.txt'),
  files.map((file) => `${file.sha256}  ${file.name}`).join('\n') + '\n',
)

fs.writeFileSync(
  path.join(outputDir, 'release-manifest.json'),
  JSON.stringify({
    schemaVersion: 1,
    product: 'DeepSeek Harness Desktop',
    version: packageJson.version,
    platform: 'windows',
    arch: 'x64',
    components: {
      harness: '0.1.1-rc.2',
      desktopShell: packageJson.version,
    },
    bundledExternalPlugins: [],
    excludedIntegrations: [
      'dsh-vision-router',
      'imessage',
      'mass-spectrometry',
      'dsh-client-liang-intensity-skin',
      '@dsh-external/dsh-super-injector',
    ],
    files,
  }, null, 2) + '\n',
)

console.log('已生成 SHA256SUMS.txt 与 release-manifest.json')
