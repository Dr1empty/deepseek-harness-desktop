'use strict'

const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { Backend, PREFERRED_PORT } = require('./backend')
const { DeepSeekPaymentService } = require('./payment')
const { DshUpdater } = require('./updater')
const { DEEPSEEK_PRICING_URL, DEEPSEEK_TOP_UP_URL, UsageService } = require('./usage')

// 打包版始终写入本地日志。由快捷方式或父进程启动时，继承的 stdout/stderr
// 可能在应用仍运行时被关闭；吞掉 EPIPE，避免一次普通日志导致主进程崩溃。
const LOG_FILE = path.join(require('node:os').tmpdir(), 'dsh-desktop.log')
function guardOutputStream(stream) {
  if (!stream || typeof stream.on !== 'function') return
  stream.on('error', error => {
    if (error && error.code === 'EPIPE') return
    try {
      fs.appendFileSync(LOG_FILE, `[dsh-desktop] 输出流错误：${error && error.message ? error.message : String(error)}\n`)
    } catch (_) {}
  })
}
guardOutputStream(process.stdout)
guardOutputStream(process.stderr)

function log(...args) {
  const line = '[dsh-desktop] ' + args.map(String).join(' ') + '\n'
  try { fs.appendFileSync(LOG_FILE, line) } catch (_) {}
  if (!app.isPackaged) console.log('[dsh-desktop]', ...args)
}

let win = null
let backend = null
let updater = null
let usageService = null
let paymentService = null
let quitting = false

function loadDistributionConfig() {
  if (!app.isPackaged) return {}
  try {
    const file = path.join(process.resourcesPath, 'distribution.json')
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    return value && typeof value === 'object' ? value : {}
  } catch (_) {
    return {}
  }
}

const distribution = loadDistributionConfig()
if (typeof distribution.userDataFolder === 'string' && distribution.userDataFolder.trim() !== '') {
  const appDataPath = app.getPath('appData')
  const userDataPath = path.join(appDataPath, distribution.userDataFolder.trim())
  if (!fs.existsSync(userDataPath) && Array.isArray(distribution.legacyUserDataFolders)) {
    for (const folder of distribution.legacyUserDataFolders) {
      if (typeof folder !== 'string' || folder.trim() === '') continue
      const legacyPath = path.join(appDataPath, folder.trim())
      if (!fs.existsSync(legacyPath)) continue
      try {
        fs.cpSync(legacyPath, userDataPath, { recursive: true, force: false, errorOnExist: false })
        log('已从旧发行名称迁移用户数据:', folder.trim(), '→', distribution.userDataFolder.trim())
      } catch (error) {
        log('旧用户数据迁移失败，将使用新的 Desktop 目录:', error && error.message ? error.message : String(error))
      }
      break
    }
  }
  app.setPath('userData', userDataPath)
}

// The lock is intentionally acquired after applying the distribution-specific
// userData path. Different editions may run side-by-side, while a
// second launch of the same edition only raises the existing window.
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  log('检测到同版本已有实例，当前启动请求退出')
  app.quit()
} else {
  app.on('second-instance', () => {
    log('收到重复启动请求，聚焦现有窗口')
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  })
}

function ensureIsolatedDshHome(dshHome) {
  fs.mkdirSync(dshHome, { recursive: true })
  const markerPath = path.join(dshHome, '.desktop-distribution-initialized')
  if (!fs.existsSync(markerPath) && app.isPackaged) {
    const templatePath = path.join(process.resourcesPath, 'desktop-profile')
    if (fs.existsSync(templatePath)) {
      // 首次启动只补入发行模板中缺少的文件，不覆盖用户已经写入的内容。
      // 完成后写标记；用户日后主动卸载插件时不会在重启后被自动装回。
      fs.cpSync(templatePath, dshHome, {
        recursive: true,
        force: false,
        errorOnExist: false,
      })
    }
    fs.writeFileSync(markerPath, 'desktop-profile-v1\n', 'utf8')
  }
  const settingsPath = path.join(dshHome, 'settings.yaml')
  if (!fs.existsSync(settingsPath)) {
    // 只写非敏感的模型默认值。DeepSeek 凭据仍由用户在设置页录入；
    // 不复制普通安装中的智谱、Vision Router 或任何个人配置。
    fs.writeFileSync(settingsPath, [
      'agent-default-model:',
      '  provider: deepseek-official',
      '  model: deepseek-v4-flash-vision-exp',
      '  reasoningEffort: high',
      '',
    ].join('\n'), 'utf8')
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'DeepSeek Harness Desktop',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    backgroundColor: '#151515',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => {
    win.show()
    log('窗口已显示')
  })
  win.on('closed', () => {
    win = null
    log('窗口已关闭')
  })
  win.webContents.on('did-fail-load', (event, code, desc) => {
    log('页面加载失败:', code, desc)
  })

  // Show a tiny local loading surface immediately. The Harness backend needs a
  // few seconds to warm up on some machines; keeping a live renderer visible
  // prevents Windows from presenting the process as a frozen/empty launch.
  const loadingHtml = `<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
        <style>
          :root { color-scheme: dark; font-family: "Microsoft YaHei UI", system-ui, sans-serif; }
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #151515; color: #f5f5f5; }
          main { display: grid; justify-items: center; gap: 14px; }
          .mark { width: 34px; height: 34px; border: 3px solid #555; border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; }
          strong { font-size: 18px; }
          span { color: #aaa; font-size: 13px; }
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
      </head>
      <body><main><div class="mark" aria-hidden="true"></div><strong>DeepSeek Harness</strong><span>正在启动本地服务…</span></main></body>
    </html>`
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml)}`)
  log('启动窗口已创建')
}

async function boot() {
  log('启动，isPackaged =', app.isPackaged)
  createWindow()
  paymentService = new DeepSeekPaymentService({
    BrowserWindow,
    session,
    shell,
    log,
    parentWindow: () => win,
  })
  paymentService.initialize()
  const userDataPath = app.getPath('userData')
  const runtime = Backend.resolveRuntime(app.isPackaged, userDataPath)
  if (distribution.isolatedDshHome === true) {
    runtime.dshHome = path.join(userDataPath, 'dsh-home')
    ensureIsolatedDshHome(runtime.dshHome)
  }
  const dshHome = runtime.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  usageService = new UsageService({ dshHome })
  const bundledNodeRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'node')
    : path.join(__dirname, '..', 'vendor', 'node')
  const npmCliPath = app.isPackaged
    ? path.join(bundledNodeRoot, 'npm', 'bin', 'npm-cli.js')
    : path.join(bundledNodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  updater = new DshUpdater({
    currentVersion: runtime.version,
    userDataPath,
    nodePath: app.isPackaged ? path.join(bundledNodeRoot, 'node.exe') : runtime.nodePath,
    npmCliPath,
    nodeArchivePath: app.isPackaged ? path.join(process.resourcesPath, 'update-tools', 'node.zip') : null,
  })
  log('node:', runtime.nodePath, '| harness:', runtime.harnessRoot, '| version:', runtime.version, '| source:', runtime.source)

  backend = new Backend(runtime)
  backend.onUnexpectedExit = (code, logs) => {
    if (!quitting) {
      dialog.showErrorBox(
        'DeepSeek Harness 后端异常退出',
        `退出码 ${code}\n\n${logs}`
      )
      app.quit()
    }
  }

  try {
    log('启动 backend 子进程（首选固定端口', PREFERRED_PORT, '）...')
    backend.start()
    log('等待就绪信号...')
    let port
    try {
      port = await backend.waitReady()
    } catch (err) {
      // 首选端口被占用（例如另一个实例还开着）时子进程会在就绪前退出：
      // 静默回退到 OS 分配端口，仅本次会话端口不同（localStorage 只在
      // 这次会话里不跨重启）。
      if (backend.canFallback()) {
        const reason = err && err.message ? err.message : String(err)
        log('首选端口不可用，回退到系统分配端口：', reason)
        backend.start(0)
        port = await backend.waitReady()
      } else {
        throw err
      }
    }
    log('backend 就绪，端口 =', port)
    const url = `http://127.0.0.1:${port}`
    await win.loadURL(url)
    log('开始加载', url)
  } catch (err) {
    const msg = err && err.message ? err.message : String(err)
    log('启动失败:', msg)
    backend.stop()
    dialog.showErrorBox('DeepSeek Harness 启动失败', msg)
    app.quit()
  }
}

ipcMain.handle('dsh-update:check', async () => {
  try {
    return { ok: true, value: await updater.checkForUpdates() }
  } catch (error) {
    log('检查更新失败:', error && error.message ? error.message : String(error))
    return { ok: false, error: error && error.message ? error.message : String(error) }
  }
})

ipcMain.handle('dsh-update:state', () => ({
  ok: true,
  value: {
    desktopVersion: app.getVersion(),
    currentVersion: updater ? updater.currentVersion : null,
  },
}))

ipcMain.handle('dsh-update:install', async () => {
  try {
    const value = await updater.installLatest()
    if (value.updated) {
      log('内核更新成功，准备重启到', value.currentVersion)
      setTimeout(() => {
        app.relaunch()
        app.quit()
      }, 900)
    }
    return { ok: true, value }
  } catch (error) {
    log('立即更新失败:', error && error.message ? error.message : String(error))
    return { ok: false, error: error && error.message ? error.message : String(error) }
  }
})

ipcMain.handle('dsh-usage:state', async () => {
  try {
    if (!usageService) throw new Error('使用情况服务尚未就绪')
    return { ok: true, value: await usageService.snapshot() }
  } catch (error) {
    log('读取使用情况失败:', error && error.message ? error.message : String(error))
    return { ok: false, error: error && error.message ? error.message : String(error) }
  }
})

ipcMain.handle('dsh-usage:balance', async () => {
  try {
    if (!usageService) throw new Error('使用情况服务尚未就绪')
    return { ok: true, value: await usageService.queryBalance() }
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) }
  }
})

ipcMain.handle('dsh-usage:open-official', async (_event, target) => {
  const urls = { topUp: DEEPSEEK_TOP_UP_URL, pricing: DEEPSEEK_PRICING_URL }
  const url = urls[target]
  if (!url) return { ok: false, error: '不支持的官方页面' }
  try {
    await shell.openExternal(url)
    return { ok: true }
  } catch (error) {
    log('打开 DeepSeek 官方页面失败:', error && error.message ? error.message : String(error))
    return { ok: false, error: error && error.message ? error.message : String(error) }
  }
})

ipcMain.handle('dsh-payment:create-order', async (_event, input) => {
  try {
    if (!paymentService) throw new Error('支付服务尚未就绪')
    const value = await paymentService.createOrder(input)
    log('DeepSeek 付款二维码已生成，方式 =', value.method, '，金额 =', value.amount)
    return { ok: true, value }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    log('生成 DeepSeek 付款二维码失败:', message)
    return { ok: false, error: message, code: error && error.code ? error.code : 'PAYMENT_ERROR' }
  }
})

ipcMain.handle('dsh-payment:login', async () => {
  try {
    if (!paymentService) throw new Error('支付服务尚未就绪')
    await paymentService.loginInteractively()
    log('DeepSeek 支付账户重新登录成功')
    return { ok: true }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    log('DeepSeek 支付账户登录失败:', message)
    return { ok: false, error: message, code: error && error.code ? error.code : 'AUTH_ERROR' }
  }
})

ipcMain.handle('dsh-payment:status', async (_event, orderId) => {
  try {
    if (!paymentService) throw new Error('支付服务尚未就绪')
    return { ok: true, value: await paymentService.getStatus(orderId) }
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error),
      code: error && error.code ? error.code : 'PAYMENT_ERROR',
    }
  }
})

if (hasSingleInstanceLock) app.whenReady().then(boot)

app.on('before-quit', () => {
  log('before-quit')
  quitting = true
  if (paymentService) paymentService.destroy()
  if (backend) backend.stop()
})

app.on('window-all-closed', () => {
  log('window-all-closed')
  if (backend) backend.stop()
  app.quit()
})
