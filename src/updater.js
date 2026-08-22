'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const PACKAGE_NAME = '@deepseek-ai/dsh'
const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const POINTER_FILE = 'current-runtime.json'
const NODE_TOOLS_VERSION = '24.18.0'

function parseVersion(raw) {
  const match = String(raw).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) throw new Error(`无法识别版本号：${raw}`)
  return {
    raw: String(raw).replace(/^v/, ''),
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1
  const length = Math.max(a.pre.length, b.pre.length)
  for (let i = 0; i < length; i++) {
    if (a.pre[i] === undefined) return -1
    if (b.pre[i] === undefined) return 1
    if (a.pre[i] === b.pre[i]) continue
    const aNumber = /^\d+$/.test(a.pre[i])
    const bNumber = /^\d+$/.test(b.pre[i])
    if (aNumber && bNumber) return Number(a.pre[i]) > Number(b.pre[i]) ? 1 : -1
    if (aNumber !== bNumber) return aNumber ? -1 : 1
    return a.pre[i] > b.pre[i] ? 1 : -1
  }
  return 0
}

function runtimeBase(userDataPath) {
  return path.join(userDataPath, 'runtime')
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function verifyRuntime(runtimeRoot, expectedVersion) {
  try {
    const packageRoot = path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh')
    const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
    const binPath = path.join(packageRoot, 'lib', 'bin.js')
    const marker = JSON.parse(fs.readFileSync(path.join(runtimeRoot, '.dsh-runtime-complete.json'), 'utf8'))
    if (packageJson.version !== expectedVersion || marker.version !== expectedVersion || !fs.existsSync(binPath)) return null
    return { version: packageJson.version, harnessRoot: runtimeRoot, binPath }
  } catch (_) {
    return null
  }
}

function verifyRuntimeFiles(runtimeRoot, expectedVersion) {
  try {
    const packageRoot = path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh')
    const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
    const binPath = path.join(packageRoot, 'lib', 'bin.js')
    return packageJson.version === expectedVersion && fs.existsSync(binPath)
  } catch (_) {
    return false
  }
}

function packagePathParts(packageName) {
  return packageName.startsWith('@') ? packageName.split('/') : [packageName]
}

function peerIsAccessible(packageRoot, runtimeRoot, peerName) {
  let cursor = packageRoot
  const boundary = path.resolve(runtimeRoot)
  while (cursor.startsWith(boundary)) {
    const candidate = path.join(cursor, 'node_modules', ...packagePathParts(peerName), 'package.json')
    if (fs.existsSync(candidate)) return true
    if (path.resolve(cursor) === boundary) break
    cursor = path.dirname(cursor)
  }
  return false
}

function discoverMissingPeers(runtimeRoot) {
  const nodeModulesRoot = path.join(runtimeRoot, 'node_modules')
  if (!fs.existsSync(nodeModulesRoot)) return new Map()
  const missing = new Map()
  const pending = [nodeModulesRoot]
  while (pending.length > 0) {
    const directory = pending.pop()
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch (_) {
      continue
    }
    const packageJsonPath = path.join(directory, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
        for (const [peerName, range] of Object.entries(manifest.peerDependencies || {})) {
          if (manifest.peerDependenciesMeta?.[peerName]?.optional === true) continue
          if (!peerIsAccessible(directory, runtimeRoot, peerName) && !missing.has(peerName)) {
            missing.set(peerName, String(range))
          }
        }
      } catch (_) {
        // 损坏的第三方 package.json 会在实际模块加载时给出更具体错误。
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.bin') continue
      const child = path.join(directory, entry.name)
      // 包目录下只继续进入嵌套 node_modules；scope 与 node_modules 根则正常展开。
      if (entry.name === 'node_modules' || path.basename(directory) === 'node_modules' || path.basename(directory).startsWith('@')) {
        pending.push(child)
      }
    }
  }
  return missing
}

function loadInstalledRuntime(userDataPath, nodePath) {
  try {
    const pointer = JSON.parse(fs.readFileSync(path.join(userDataPath, POINTER_FILE), 'utf8'))
    if (typeof pointer.relativePath !== 'string' || typeof pointer.version !== 'string') return null
    parseVersion(pointer.version)
    const base = runtimeBase(userDataPath)
    const root = path.resolve(userDataPath, pointer.relativePath)
    if (!isInside(base, root)) return null
    const verified = verifyRuntime(root, pointer.version)
    return verified === null ? null : { ...verified, nodePath, source: 'updated' }
  } catch (_) {
    return null
  }
}

async function fetchLatestVersion(fetchImpl, registry = DEFAULT_REGISTRY) {
  const base = registry.replace(/\/$/, '')
  const packagePath = encodeURIComponent(PACKAGE_NAME)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetchImpl(`${base}/${packagePath}/latest`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`更新服务器返回 HTTP ${response.status}`)
    const metadata = await response.json()
    if (typeof metadata.version !== 'string') throw new Error('更新服务器没有返回有效版本号')
    return parseVersion(metadata.version).raw
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('检查更新超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function runNpmInstall({ nodePath, npmCliPath, prefix, version, packages }) {
  return new Promise((resolve, reject) => {
    const args = [
      npmCliPath,
      'install',
      '--prefix', prefix,
      '--omit=dev',
      '--legacy-peer-deps',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--save-exact',
      ...(packages || [`${PACKAGE_NAME}@${version}`]),
    ]
    const child = spawn(nodePath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, npm_config_update_notifier: 'false' },
    })
    let output = ''
    const append = chunk => {
      output += chunk.toString()
      if (output.length > 12000) output = output.slice(-12000)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`npm 安装失败（退出码 ${code}）：\n${output.trim().slice(-3000)}`))
    })
  })
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env || process.env,
    })
    let output = ''
    const append = chunk => {
      output += chunk.toString()
      if (output.length > 8000) output = output.slice(-8000)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`更新工具解压失败（退出码 ${code}）：\n${output.trim().slice(-2000)}`))
    })
  })
}

function nodeToolsAt(root) {
  const nodePath = path.join(root, 'node.exe')
  const npmCliPath = path.join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return fs.existsSync(nodePath) && fs.existsSync(npmCliPath) ? { nodePath, npmCliPath } : null
}

async function extractNodeArchive(archivePath, destinationPath) {
  // Windows 10+ 自带 bsdtar，直接传 argv 能可靠处理空格路径，也不依赖
  // Microsoft.PowerShell.Archive（部分系统的该模块可能无法自动加载）。
  try {
    await runProcess('tar.exe', ['-xf', archivePath, '-C', destinationPath])
    return
  } catch (tarError) {
    try {
      await runProcess('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Expand-Archive -LiteralPath $env:DSH_NODE_ARCHIVE -DestinationPath $env:DSH_NODE_DESTINATION -Force',
      ], {
        env: {
          ...process.env,
          DSH_NODE_ARCHIVE: archivePath,
          DSH_NODE_DESTINATION: destinationPath,
        },
      })
    } catch (powershellError) {
      throw new Error(`更新工具解压失败。tar: ${tarError.message}\nPowerShell: ${powershellError.message}`)
    }
  }
}

async function ensureNodeTools(archivePath, userDataPath, extractArchive = extractNodeArchive) {
  if (!archivePath || !fs.existsSync(archivePath)) throw new Error('应用内更新工具包缺失，请重新安装桌面应用')
  const toolsBase = path.join(userDataPath, 'update-tools')
  const targetRoot = path.join(toolsBase, `node-${NODE_TOOLS_VERSION}`)
  const existing = nodeToolsAt(targetRoot)
  if (existing) return existing
  // 该目录只属于桌面更新器。上次解压或升级中断留下的无效缓存应当
  // 自动修复，不能让用户永久卡在“目录已存在但内容无效”。
  if (fs.existsSync(targetRoot)) fs.rmSync(targetRoot, { recursive: true, force: true })

  fs.mkdirSync(toolsBase, { recursive: true })
  const stagingRoot = path.join(toolsBase, `.extract-${process.pid}-${Date.now()}`)
  fs.mkdirSync(stagingRoot, { recursive: true })
  try {
    // 不把路径作为 -Command 后面的裸参数传入。Windows PowerShell 对这种
    // 调用的脚本块参数绑定并不稳定，曾出现命令返回 0、实际却没有解压到
    // stagingRoot 的情况。环境变量既能保留空格，也不会参与命令解析。
    await extractArchive(archivePath, stagingRoot)
    const candidates = [stagingRoot, ...fs.readdirSync(stagingRoot).map(name => path.join(stagingRoot, name))]
    const extractedRoot = candidates.find(candidate => nodeToolsAt(candidate) !== null)
    if (!extractedRoot) {
      const entries = fs.readdirSync(stagingRoot).slice(0, 8).join(', ') || '(空目录)'
      throw new Error(`更新工具包内容校验失败；解压顶层内容：${entries}`)
    }
    if (extractedRoot === stagingRoot) {
      fs.renameSync(stagingRoot, targetRoot)
    } else {
      fs.renameSync(extractedRoot, targetRoot)
      fs.rmSync(stagingRoot, { recursive: true, force: true })
    }
    return nodeToolsAt(targetRoot)
  } finally {
    if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true })
  }
}

class DshUpdater {
  constructor(options) {
    this.currentVersion = options.currentVersion
    this.userDataPath = options.userDataPath
    this.nodePath = options.nodePath
    this.npmCliPath = options.npmCliPath
    this.nodeArchivePath = options.nodeArchivePath || null
    this.fetchImpl = options.fetchImpl || globalThis.fetch
    this.registry = options.registry || process.env.DSH_UPDATE_REGISTRY || DEFAULT_REGISTRY
    this.installPackage = options.installPackage || runNpmInstall
    this.installing = false
    parseVersion(this.currentVersion)
  }

  async checkForUpdates() {
    const latestVersion = await fetchLatestVersion(this.fetchImpl, this.registry)
    return {
      currentVersion: this.currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, this.currentVersion) > 0,
    }
  }

  async installLatest() {
    if (this.installing) throw new Error('更新正在进行中，请稍候')
    this.installing = true
    let stagingRoot = null
    try {
      const check = await this.checkForUpdates()
      if (!check.updateAvailable) return { ...check, updated: false }

      const safeVersion = parseVersion(check.latestVersion).raw
      const base = runtimeBase(this.userDataPath)
      const targetRoot = path.join(base, `dsh-${safeVersion}`)
      fs.mkdirSync(base, { recursive: true })

      let verified = verifyRuntime(targetRoot, safeVersion)
      if (verified === null) {
        if (fs.existsSync(targetRoot)) {
          throw new Error(`更新目录已存在但内容无效：${targetRoot}`)
        }
        stagingRoot = path.join(base, `.install-${safeVersion}-${process.pid}-${Date.now()}`)
        fs.mkdirSync(stagingRoot, { recursive: true })
        const installTools = this.nodeArchivePath
          ? await ensureNodeTools(this.nodeArchivePath, this.userDataPath)
          : { nodePath: this.nodePath, npmCliPath: this.npmCliPath }
        if (!installTools || !fs.existsSync(installTools.npmCliPath)) {
          throw new Error('找不到 npm 更新工具，请重新安装桌面应用')
        }
        await this.installPackage({
          nodePath: installTools.nodePath,
          npmCliPath: installTools.npmCliPath,
          prefix: stagingRoot,
          version: safeVersion,
        })
        if (!verifyRuntimeFiles(stagingRoot, safeVersion)) {
          throw new Error('新版下载完成，但基础运行时完整性校验失败')
        }
        for (let round = 0; round < 6; round++) {
          const missingPeers = discoverMissingPeers(stagingRoot)
          if (missingPeers.size === 0) break
          await this.installPackage({
            nodePath: installTools.nodePath,
            npmCliPath: installTools.npmCliPath,
            prefix: stagingRoot,
            packages: [...missingPeers].map(([name, range]) => `${name}@${range}`),
          })
        }
        const unresolvedPeers = discoverMissingPeers(stagingRoot)
        if (unresolvedPeers.size > 0) {
          throw new Error(`新版依赖不完整：仍缺少 ${[...unresolvedPeers.keys()].slice(0, 8).join(', ')}`)
        }
        fs.writeFileSync(path.join(stagingRoot, '.dsh-runtime-complete.json'), JSON.stringify({
          package: PACKAGE_NAME,
          version: safeVersion,
          installedAt: new Date().toISOString(),
        }, null, 2), 'utf8')
        verified = verifyRuntime(stagingRoot, safeVersion)
        if (verified === null) throw new Error('新版下载完成，但最终运行时校验失败')
        fs.renameSync(stagingRoot, targetRoot)
        stagingRoot = null
      }

      const pointer = {
        version: safeVersion,
        relativePath: path.relative(this.userDataPath, targetRoot),
        updatedAt: new Date().toISOString(),
      }
      const pointerPath = path.join(this.userDataPath, POINTER_FILE)
      const temporaryPointer = `${pointerPath}.tmp-${process.pid}`
      fs.writeFileSync(temporaryPointer, JSON.stringify(pointer, null, 2), 'utf8')
      try {
        fs.renameSync(temporaryPointer, pointerPath)
      } catch (error) {
        if (!['EEXIST', 'EPERM'].includes(error.code)) throw error
        fs.rmSync(pointerPath, { force: true })
        fs.renameSync(temporaryPointer, pointerPath)
      }
      this.currentVersion = safeVersion
      return { ...check, currentVersion: safeVersion, updated: true }
    } finally {
      this.installing = false
      if (stagingRoot && fs.existsSync(stagingRoot)) {
        fs.rmSync(stagingRoot, { recursive: true, force: true })
      }
    }
  }
}

module.exports = {
  DshUpdater,
  PACKAGE_NAME,
  compareVersions,
  discoverMissingPeers,
  fetchLatestVersion,
  ensureNodeTools,
  loadInstalledRuntime,
  parseVersion,
  verifyRuntime,
}
