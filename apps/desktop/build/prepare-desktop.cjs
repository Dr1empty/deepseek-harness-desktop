'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const BUILD_DIR = path.join(ROOT, 'build')
const RUNTIME_DIR = path.join(BUILD_DIR, 'desktop-harness')
const PROFILE_DIR = path.join(BUILD_DIR, 'desktop-profile')
const PROFILE_WEB_DIR = path.join(PROFILE_DIR, 'profiles', 'web')
const DOWNLOAD_DIR = path.join(BUILD_DIR, 'downloads')
const VENDOR_DIR = path.join(ROOT, 'vendor')
const NODE_VERSION = '24.18.0'
const DSH_VERSION = '0.1.1-rc.2'

const artifacts = {
  node: {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`,
    sha256: '0AE68406B42D7725661DA979B1403EC9926DA205C6770827F33AAC9D8F26E821',
    file: path.join(VENDOR_DIR, `node-v${NODE_VERSION}-win-x64.zip`),
  },
  skin: {
    url: 'https://github.com/kingOfSoySauce/dsh-liang-skin/releases/download/v0.1.4/dsh-client-liang-intensity-skin-0.1.4.tgz',
    gitSpec: 'git+https://github.com/kingOfSoySauce/dsh-liang-skin.git#75692c83c3c8219736a607c1089dffafda310e7a',
    sha256: '68B3C100773CDCC40814782A7EE63648E73593F5A502B72CEB744973980B1FAA',
    name: 'dsh-client-liang-intensity-skin-0.1.4.tgz',
  },
  injector: {
    url: 'https://github.com/yjh051108/dsh-super-injector/releases/download/v0.3.3/dsh-external-dsh-super-injector-0.3.3.tgz',
    sha256: '355238FA8E51BC45C0801066AF51E0E122F3B21411B193F601EE54E534391F48',
    name: 'dsh-external-dsh-super-injector-0.3.3.tgz',
    localFile: path.join(ROOT, 'third_party', 'packages', 'dsh-external-dsh-super-injector-0.3.3.tgz'),
  },
}

function sha256(file) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(file))
  return hash.digest('hex').toUpperCase()
}

function isVerified(file, expected) {
  return fs.existsSync(file) && sha256(file) === expected
}

async function download(artifact, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  if (isVerified(destination, artifact.sha256)) {
    console.log('已验证缓存:', path.relative(ROOT, destination))
    return
  }
  if (artifact.localFile && isVerified(artifact.localFile, artifact.sha256)) {
    fs.copyFileSync(artifact.localFile, destination)
    console.log('已验证内置第三方归档:', path.relative(ROOT, artifact.localFile))
    return
  }

  const temporary = `${destination}.${process.pid}.download`
  fs.rmSync(temporary, { force: true })
  try {
    console.log('下载:', artifact.url)
    const response = await fetch(artifact.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok || !response.body) {
      throw new Error(`下载失败 (${response.status}): ${artifact.url}`)
    }
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary))
    const actual = sha256(temporary)
    if (actual !== artifact.sha256) {
      throw new Error(`SHA-256 不匹配: ${path.basename(destination)}\n期望 ${artifact.sha256}\n实际 ${actual}`)
    }
    fs.rmSync(destination, { force: true })
    fs.renameSync(temporary, destination)
    return
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    if (!artifact.gitSpec) throw error
    console.warn('Release 下载不可用，改从固定 Git 提交打包:', error.message)
    fs.rmSync(destination, { force: true })
    runNpm(['pack', artifact.gitSpec, '--pack-destination', path.dirname(destination), '--ignore-scripts'], ROOT)
    if (!isVerified(destination, artifact.sha256)) {
      throw new Error(`Git 归档 SHA-256 不匹配: ${path.basename(destination)}`)
    }
  }
}

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} 退出码 ${result.status}`)
}

function runNpm(args, cwd) {
  const npmCli = process.env.npm_execpath
  if (npmCli && fs.existsSync(npmCli)) {
    run(process.execPath, [npmCli, ...args], cwd)
    return
  }
  if (process.platform === 'win32') {
    run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args], cwd)
    return
  }
  run('npm', args, cwd)
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function copyTemplate(sourceName, destination) {
  fs.copyFileSync(path.join(BUILD_DIR, sourceName), destination)
}

function prepareRuntime() {
  const packageTemplate = path.join(BUILD_DIR, 'desktop-runtime.package.json')
  const lockTemplate = path.join(BUILD_DIR, 'desktop-runtime.package-lock.json')
  const recipeHash = sha256(packageTemplate) + sha256(lockTemplate)
  const markerFile = path.join(RUNTIME_DIR, '.dsh-runtime-complete.json')
  const marker = readJson(markerFile)
  const cliFile = path.join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (marker?.version === DSH_VERSION && marker?.recipeHash === recipeHash && fs.existsSync(cliFile)) {
    console.log('已验证 Harness 运行时:', DSH_VERSION)
    return
  }

  console.log('准备 Harness 运行时:', DSH_VERSION)
  fs.rmSync(RUNTIME_DIR, { recursive: true, force: true })
  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  copyTemplate('desktop-runtime.package.json', path.join(RUNTIME_DIR, 'package.json'))
  copyTemplate('desktop-runtime.package-lock.json', path.join(RUNTIME_DIR, 'package-lock.json'))
  runNpm(['ci', '--omit=dev', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund'], RUNTIME_DIR)
  fs.writeFileSync(markerFile, JSON.stringify({
    package: '@deepseek-ai/dsh',
    version: DSH_VERSION,
    recipeHash,
    installedAt: new Date().toISOString(),
  }, null, 2) + '\n')
}

async function prepareProfile() {
  const profileTemplate = path.join(BUILD_DIR, 'desktop-profile.package.json')
  const recipeHash = sha256(profileTemplate) + artifacts.skin.sha256 + artifacts.injector.sha256
  const markerFile = path.join(PROFILE_DIR, '.desktop-profile-complete.json')
  const marker = readJson(markerFile)
  const skinEntry = path.join(PROFILE_WEB_DIR, 'node_modules', 'dsh-client-liang-intensity-skin', 'lib', 'client.js')
  const injectorEntry = path.join(PROFILE_WEB_DIR, 'node_modules', '@dsh-external', 'dsh-super-injector', 'lib', 'index.js')
  if (marker?.recipeHash === recipeHash && fs.existsSync(skinEntry) && fs.existsSync(injectorEntry)) {
    console.log('已验证 Desktop 插件配置')
    return
  }

  console.log('准备 Desktop 插件配置')
  const skinArchive = path.join(DOWNLOAD_DIR, artifacts.skin.name)
  const injectorArchive = path.join(DOWNLOAD_DIR, artifacts.injector.name)
  await download(artifacts.skin, skinArchive)
  await download(artifacts.injector, injectorArchive)
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true })
  const packagesDir = path.join(PROFILE_WEB_DIR, 'packages')
  fs.mkdirSync(packagesDir, { recursive: true })
  copyTemplate('desktop-profile.package.json', path.join(PROFILE_WEB_DIR, 'package.json'))
  copyTemplate('desktop-profile.pnpm-workspace.yaml', path.join(PROFILE_WEB_DIR, 'pnpm-workspace.yaml'))
  fs.copyFileSync(skinArchive, path.join(packagesDir, artifacts.skin.name))
  fs.copyFileSync(injectorArchive, path.join(packagesDir, artifacts.injector.name))
  runNpm(['install', '--omit=dev', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund'], PROFILE_WEB_DIR)
  fs.writeFileSync(markerFile, JSON.stringify({ recipeHash, installedAt: new Date().toISOString() }, null, 2) + '\n')
}

function prepareNode() {
  const nodeDir = path.join(VENDOR_DIR, 'node')
  const nodeExe = path.join(nodeDir, 'node.exe')
  if (fs.existsSync(nodeExe)) {
    const version = spawnSync(nodeExe, ['--version'], { encoding: 'utf8' }).stdout?.trim()
    if (version === `v${NODE_VERSION}`) {
      console.log('已验证便携 Node:', version)
      return
    }
  }

  console.log('解压便携 Node:', NODE_VERSION)
  const extractRoot = path.join(VENDOR_DIR, `.node-extract-${process.pid}`)
  fs.rmSync(extractRoot, { recursive: true, force: true })
  fs.mkdirSync(extractRoot, { recursive: true })
  run('tar', ['-xf', artifacts.node.file, '-C', extractRoot])
  const extracted = path.join(extractRoot, `node-v${NODE_VERSION}-win-x64`)
  if (!fs.existsSync(path.join(extracted, 'node.exe'))) throw new Error('Node 压缩包目录结构无效')
  fs.rmSync(nodeDir, { recursive: true, force: true })
  fs.renameSync(extracted, nodeDir)
  fs.rmSync(extractRoot, { recursive: true, force: true })
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Desktop 发行版当前只支持 Windows x64 构建')
  await download(artifacts.node, artifacts.node.file)
  prepareNode()
  prepareRuntime()
  await prepareProfile()
  console.log('\nDesktop 构建依赖准备完成。')
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error))
  process.exitCode = 1
})
