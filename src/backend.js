'use strict'

/**
 * backend.js — 管理 deepseek-harness 的 web 后端子进程。
 *
 * 运行模型：Electron 主进程 spawn 一个标准 Node 进程跑
 * `node apps/cli/lib/bin.js web --port <port>`。默认用 PREFERRED_PORT
 * （固定首选端口，让 GUI 的 origin 跨重启稳定——浏览器 localStorage 按
 * origin 隔离，端口变来变去会导致插件的 localStorage 标记每次都丢），
 * 端口被占用时 main.js 自动回退到 `--port 0`（OS 分配空闲端口）。
 * 主进程监听子进程 stdout 里的就绪信号 `dsh web: http://127.0.0.1:<port>`
 * 拿到真实端口。这行日志只在 Loader 完全 settle（/api 路由已挂载）
 * 之后才打印，是可靠的就绪信号。
 */

const { spawn, execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { loadInstalledRuntime } = require('./updater')

// 首选固定端口：origin（127.0.0.1:PORT）跨启动稳定后，localStorage 等
// 按 origin 隔离的浏览器存储才能跨启动持久化（例如 dsh-vision-router
// 的首次引导「已看过」标记）。被占用时自动回退 OS 分配端口，见 main.js。
const PREFERRED_PORT = 64788

// 就绪信号：backend 打印 `dsh web: http://127.0.0.1:PORT`（见 harness
// packages/bundle/web-app/src/index.ts 的 printUrl 逻辑）
const READY_RE = /dsh web:\s*http:\/\/127\.0\.0\.1:(\d+)/

/**
 * 打包后的 harness 是 pnpm 结构，里面全是「绝对路径 junction」（本机 Developer Mode
 * 关闭，pnpm 只能建 junction）。junction 的 target 指向打包时的绝对根目录（记录在
 * harness/.dsh-junction-root 里）。若整个应用被解压/安装到别的路径，这些 junction 会
 * 全部悬空，需要在这里一次性把 target 前缀从「打包根」改写到「当前根」。幂等：改写过
 * 一次后 marker 与当前根一致，直接跳过。
 *
 * @param {string} harnessRoot
 */
function fixJunctions(harnessRoot) {
  const markerFile = path.join(harnessRoot, '.dsh-junction-root')
  if (!fs.existsSync(markerFile)) return 0 // 开发态或没有 junction 需要修

  const builtRoot = fs.readFileSync(markerFile, 'utf8').trim()
  const same = (a, b) => path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()
  if (same(builtRoot, harnessRoot)) return 0

  let fixed = 0
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (_) {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      let st
      try {
        st = fs.lstatSync(p)
      } catch (_) {
        continue
      }
      if (st.isSymbolicLink()) {
        const target = fs.readlinkSync(p)
        const rel = path.relative(builtRoot, target)
        // 只重写指向「打包根」内部、且确实需要改写的链接
        if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
          const newTarget = path.join(harnessRoot, rel)
          if (!same(newTarget, target)) {
            fs.unlinkSync(p) // 删除 junction（不影响 target）
            fs.symlinkSync(newTarget, p, 'junction')
            fixed++
          }
        }
      } else if (st.isDirectory()) {
        walk(p)
      }
    }
  }
  walk(harnessRoot)
  fs.writeFileSync(markerFile, harnessRoot, 'utf8')
  return fixed
}

/**
 * 按清单重建 junction（配合 build/make-dist.cjs 的「零 junction 分发」）。
 *
 * make-dist.cjs 打包前把全部 junction 删掉、把「链接路径 → 目标路径」的相对关系
 * 记进 harness/.dsh-junction-map.json。这里在启动时按清单用 type='junction' 现场
 * 重建（junction 不需要管理员权限，也不需要 Developer Mode）。target 用
 * path.resolve(harnessRoot, relTarget) 现算，所以任何路径下都正确。
 * 幂等：已存在的路径跳过（再次启动几乎 0 次创建）。
 *
 * @param {string} harnessRoot
 */
function restoreJunctions(harnessRoot) {
  const manifestFile = path.join(harnessRoot, '.dsh-junction-map.json')
  if (!fs.existsSync(manifestFile)) return 0

  let map
  try {
    map = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  } catch (e) {
    console.log('[backend] junction 清单解析失败:', e.message)
    return 0
  }

  let created = 0
  for (const [relPath, relTarget] of Object.entries(map)) {
    const absPath = path.join(harnessRoot, relPath)
    const absTarget = path.resolve(harnessRoot, relTarget)
    // 已存在（真实目录或已建好的 junction）就跳过
    try {
      fs.lstatSync(absPath)
      continue
    } catch (_) {
      /* 不存在，需要建 */
    }
    try {
      fs.mkdirSync(path.dirname(absPath), { recursive: true })
      fs.symlinkSync(absTarget, absPath, 'junction')
      created++
    } catch (e) {
      console.log('[backend] junction 重建失败', relPath, e.code)
    }
  }
  return created
}

/**
 * npm 运行时位于可更新目录，位置会与内嵌运行时不同。rc.1 的 profile
 * 修复器在 Windows 上用 unlinkSync 删除旧 junction 会得到 EPERM，因此在
 * 启动前只清理“新版 npm 顶层确实提供的包”所对应的旧 fallback junction。
 * 真实目录和第三方插件链接一律不碰，新内核随后会按自己的依赖闭包重建。
 */
function clearStaleProfileJunctions(runtime) {
  const installedModules = path.join(runtime.harnessRoot, 'node_modules')
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const fallbackModules = path.join(dshHome, 'profiles', 'node_modules')
  if (!fs.existsSync(installedModules) || !fs.existsSync(fallbackModules)) return 0

  const packages = []
  for (const entry of fs.readdirSync(installedModules, { withFileTypes: true })) {
    if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name === '.bin') continue
    if (!entry.name.startsWith('@')) {
      packages.push([entry.name, path.join(installedModules, entry.name)])
      continue
    }
    const scopeRoot = path.join(installedModules, entry.name)
    for (const scoped of fs.readdirSync(scopeRoot, { withFileTypes: true })) {
      if (scoped.isDirectory() || scoped.isSymbolicLink()) {
        packages.push([path.join(entry.name, scoped.name), path.join(scopeRoot, scoped.name)])
      }
    }
  }

  const same = (left, right) => path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase()
  let removed = 0
  for (const [name, expectedTarget] of packages) {
    const link = path.join(fallbackModules, name)
    try {
      const stat = fs.lstatSync(link)
      if (!stat.isSymbolicLink()) continue
      // pnpm 的顶层包本身也可能是 junction；比较最终真实路径，避免把
      // 已经正确的 fallback link 误判成旧链接。
      const resolvedExpectedTarget = fs.realpathSync(expectedTarget)
      if (same(fs.readlinkSync(link), resolvedExpectedTarget)) continue
      // Windows 的 recursive rm 可能沿 junction 删除目标内容；rmdirSync
      // 只移除 junction reparse point，不触碰它指向的真实包目录。
      fs.rmdirSync(link)
      removed++
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error
    }
  }
  return removed
}

class Backend {
  /**
   * @param {{ nodePath: string, harnessRoot: string, binPath: string, version: string, dshHome?: string }} runtime
   */
  constructor(runtime) {
    this.nodePath = runtime.nodePath
    this.harnessRoot = runtime.harnessRoot
    this.binPath = runtime.binPath
    this.version = runtime.version
    this.source = runtime.source
    this.dshHome = runtime.dshHome || null
    this.child = null
    this.port = null
    this.portArg = 0
    this._ready = false
    this.stdoutTail = ''
    this.stderrTail = ''
    // 非预期退出时的回调（由 main.js 注册，用于弹错误框）
    this.onUnexpectedExit = null
    this._stopped = false
  }

  /**
   * 按是否打包，解析 node 可执行文件与 harness 根目录的路径。
   * @param {boolean} isPackaged - Electron 的 app.isPackaged
   * @param {string} userDataPath - Electron 用户数据目录
   */
  static resolveRuntime(isPackaged, userDataPath) {
    if (isPackaged) {
      const nodePath = path.join(process.resourcesPath, 'node', 'node.exe')
      const updated = loadInstalledRuntime(userDataPath, nodePath)
      if (updated) return updated
      const harnessRoot = path.join(process.resourcesPath, 'harness')
      // Development/source bundles expose apps/cli directly. Clean distribution
      // embeds the published npm runtime, whose CLI lives under node_modules.
      // Support both layouts so the installer can ship a physical, junction-free
      // npm dependency tree downloaded by the verified desktop updater.
      const publishedRoot = path.join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh')
      const publishedManifest = path.join(publishedRoot, 'package.json')
      if (fs.existsSync(publishedManifest)) {
        const packageJson = JSON.parse(fs.readFileSync(publishedManifest, 'utf8'))
        return {
          nodePath,
          harnessRoot,
          binPath: path.join(publishedRoot, 'lib', 'bin.js'),
          version: packageJson.version,
          source: 'embedded-npm',
        }
      }
      const packageJson = JSON.parse(fs.readFileSync(path.join(harnessRoot, 'package.json'), 'utf8'))
      return {
        nodePath,
        harnessRoot,
        binPath: path.join(harnessRoot, 'apps', 'cli', 'lib', 'bin.js'),
        version: packageJson.version,
        source: 'embedded',
      }
    }
    // 开发态：用系统 node；harness 就在本项目上一级的兄弟目录里
    const harnessRoot = path.resolve(__dirname, '..', '..', 'deepseek-harness')
    const packageJson = JSON.parse(fs.readFileSync(path.join(harnessRoot, 'package.json'), 'utf8'))
    return {
      nodePath: 'node',
      harnessRoot,
      binPath: path.join(harnessRoot, 'apps', 'cli', 'lib', 'bin.js'),
      version: packageJson.version,
      source: 'development',
    }
  }

  /**
   * 启动后端子进程（不阻塞，之后调用 waitReady 等就绪）。
   * @param {number} port - 监听端口；默认 PREFERRED_PORT，0 表示 OS 分配。
   */
  start(port = PREFERRED_PORT) {
    const cleared = clearStaleProfileJunctions(this)
    if (cleared > 0) {
      console.log('[backend] 已清理', cleared, '个旧版 profile fallback junction')
    }
    // 打包后若应用被搬到别的路径，先重写 junction 指向（幂等，通常 0 次）
    const fixed = fixJunctions(this.harnessRoot)
    if (fixed > 0) {
      console.log('[backend] 已重写', fixed, '个 junction 指向当前目录')
    }
    // 若按清单分发（零 junction 树），现场重建全部 junction（幂等）
    const restored = restoreJunctions(this.harnessRoot)
    if (restored > 0) {
      console.log('[backend] 已按清单重建', restored, '个 junction')
    }
    const bin = this.binPath
    this.portArg = port
    this._ready = false
    this.stdoutTail = ''
    this.stderrTail = ''
    // --no-open: rc.8+ 的 web-app 默认会把 Web UI 交给系统默认浏览器；
    // 桌面壳自己就是浏览器窗口，禁止额外弹出外部浏览器。
    this.child = spawn(this.nodePath, [bin, 'web', '--no-open', '--port', String(port)], {
      cwd: this.harnessRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // dsh plugin forwards directly to the `pnpm` command. Packaged builds
        // ship Corepack and its pnpm.cmd next to node.exe, so make that
        // directory discoverable without relying on a system-wide pnpm.
        PATH: [path.dirname(this.nodePath), process.env.PATH || ''].filter(Boolean).join(path.delimiter),
        // 桌面应用里不需要遥测
        DSH_TELEMETRY_DISABLED: '1',
        // Clean 发行版使用独立配置目录，避免读取或改写普通安装的
        // ~/.dsh；普通发行版不设置，保持 DSH 的原生用户目录语义。
        ...(this.dshHome ? { DSH_HOME: this.dshHome } : {}),
      },
      windowsHide: true, // 隐藏 spawn 出的黑终端窗口
    })

    this.child.on('error', (err) => {
      console.log('[backend] spawn 错误:', err && err.message)
    })

    this.child.stdout.on('data', (chunk) => {
      this.stdoutTail += chunk.toString()
      if (this.stdoutTail.length > 8192) {
        this.stdoutTail = this.stdoutTail.slice(-8192)
      }
    })
    this.child.stderr.on('data', (chunk) => {
      this.stderrTail += chunk.toString()
      if (this.stderrTail.length > 8192) {
        this.stderrTail = this.stderrTail.slice(-8192)
      }
    })
    this.child.on('exit', (code, signal) => {
      console.log('[backend] 子进程退出 code=', code, 'signal=', signal)
      if (this._stopped) return
      // 首选端口还没就绪就退出（最常见：端口被占用）：不弹错误框，
      // 留给 main.js 改用 OS 分配端口重试；其余情况照旧。
      if (!this._ready && this.portArg !== 0) return
      if (this.onUnexpectedExit) {
        this.onUnexpectedExit(code, this.lastLogs())
      }
    })
    return this.child
  }

  /**
   * 首选端口失败后是否还能改用 OS 分配端口重试。
   * 仅当：未主动停止、本次用首选端口启动、尚未就绪、且子进程已退出。
   * @returns {boolean}
   */
  canFallback() {
    if (this._stopped || this.portArg === 0 || this._ready) return false
    if (!this.child) return false
    return this.child.exitCode !== null || this.child.signalCode !== null
  }

  /**
   * 等待后端就绪，返回真实端口号。
   * @param {number} timeoutMs
   * @returns {Promise<number>}
   */
  waitReady(timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const child = this.child
      if (!child) return reject(new Error('backend 尚未启动'))

      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error('后端启动超时，最近输出：\n' + this.lastLogs()))
        }
      }, timeoutMs)

      const check = () => {
        const m = this.stdoutTail.match(READY_RE)
        if (m) {
          this.port = Number(m[1])
          this._ready = true
          settled = true
          clearTimeout(timer)
          resolve(this.port)
        }
      }
      // 就绪信号可能在我们注册等待前就已经打到 stdoutTail 里了
      check()
      child.stdout.on('data', check)
      child.on('exit', (code, signal) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error(`后端进程提前退出 (code=${code}, signal=${signal})：\n` + this.lastLogs()))
        }
      })
    })
  }

  /** 终止后端进程树（幂等，同步确保杀干净）。 */
  stop() {
    this._stopped = true
    if (!this.child) return
    const pid = this.child.pid
    try {
      this.child.kill()
    } catch (_) {
      /* 已退出 */
    }
    // Windows 上兜底：同步杀掉可能残留的整个进程树（taskkill 必须完成，
    // 否则 Electron 主进程一退出，异步 execFile 来不及执行就丢掉了）
    if (process.platform === 'win32' && pid) {
      try {
        execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
      } catch (_) {
        /* 进程已不存在 */
      }
    }
    this.child = null
  }

  /** 最近的标准输出 + 标准错误日志，用于错误提示。 */
  lastLogs() {
    const out = this.stderrTail.trim() || this.stdoutTail.trim()
    return out.slice(-2000) || '(无输出)'
  }
}

module.exports = { Backend, PREFERRED_PORT, clearStaleProfileJunctions }
