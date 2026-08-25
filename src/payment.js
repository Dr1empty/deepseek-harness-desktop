'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const qrcode = require('qrcode-generator')

const PLATFORM_ORIGIN = 'https://platform.deepseek.com'
const PLATFORM_TOP_UP_URL = `${PLATFORM_ORIGIN}/top_up`
const PLATFORM_SIGN_IN_URL = `${PLATFORM_ORIGIN}/sign_in`
const PLATFORM_SUMMARY_URL = `${PLATFORM_ORIGIN}/api/v0/users/get_user_summary`
const PLATFORM_PAYMENT_URL = `${PLATFORM_ORIGIN}/api/v1/payments`
const PLATFORM_PARTITION = 'persist:dsh-deepseek-payment'
const INVALID_TOKEN_CODES = new Set([40002, 40003])

class PaymentError extends Error {
  constructor(message, code = 'PAYMENT_ERROR') {
    super(message)
    this.name = 'PaymentError'
    this.code = code
  }
}

function normalizeAmount(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
    throw new PaymentError('充值金额需在 ¥1 至 ¥100000 之间', 'INVALID_AMOUNT')
  }
  if (Math.round(amount * 100) !== amount * 100) {
    throw new PaymentError('充值金额最多保留两位小数', 'INVALID_AMOUNT')
  }
  return amount.toFixed(Number.isInteger(amount) ? 0 : 2)
}

function normalizeMethod(value) {
  if (value === 'alipay' || value === 'wechat') return value
  throw new PaymentError('不支持的支付方式', 'INVALID_METHOD')
}

function createPaymentRequest(input, requestId = crypto.randomUUID()) {
  const method = normalizeMethod(input.method)
  return {
    order_info: {
      payment_method_type: 'CMB_UNIONPAY',
      fallback_method_type: method.toUpperCase(),
      amount: normalizeAmount(input.amount),
      currency: 'CNY',
      request_id: requestId,
    },
    terminal_type: 'WEB',
  }
}

function businessCode(payload) {
  if (payload?.data?.biz_code !== undefined && Number.isFinite(Number(payload.data.biz_code))) {
    return Number(payload.data.biz_code)
  }
  if (payload?.code !== undefined && Number.isFinite(Number(payload.code))) return Number(payload.code)
  return null
}

function validatePaymentUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) {
    throw new PaymentError('DeepSeek 未返回有效付款二维码', 'INVALID_QR_URL')
  }
  let protocol
  try {
    protocol = new URL(value).protocol.toLowerCase()
  } catch (_) {
    throw new PaymentError('DeepSeek 返回的付款二维码格式无效', 'INVALID_QR_URL')
  }
  if (!['https:', 'http:', 'alipays:', 'weixin:'].includes(protocol)) {
    throw new PaymentError('DeepSeek 返回了不受支持的付款二维码协议', 'INVALID_QR_URL')
  }
  return value
}

function isAuthenticationUrl(value) {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    if (hostname === 'accounts.google.com' || hostname === 'open.weixin.qq.com' || hostname === 'appleid.apple.com') return true
    if (hostname !== 'platform.deepseek.com' && !hostname.endsWith('.deepseek.com')) return false
    return /\/(?:sign[_-]?in|log[_-]?in|auth)(?:\/|$)/i.test(url.pathname)
  } catch (_) {
    return false
  }
}

function qrDataUrl(value) {
  const qr = qrcode(0, 'M')
  qr.addData(validatePaymentUrl(value), 'Byte')
  qr.make()
  return qr.createDataURL(6, 16)
}

function parsePaymentOrder(payload, method, amount) {
  const code = businessCode(payload)
  if (INVALID_TOKEN_CODES.has(code)) {
    throw new PaymentError('DeepSeek 开放平台登录已失效，请重新登录', 'AUTH_REQUIRED')
  }
  if (code !== 0) {
    const message = payload?.data?.biz_msg || payload?.message || payload?.msg
    throw new PaymentError(message || `DeepSeek 创建支付订单失败（${code ?? '未知状态'}）`, 'ORDER_FAILED')
  }
  const data = payload?.data?.biz_data
  const orderId = data?.payment_order_id
  if (typeof orderId !== 'string' || orderId.length < 4 || orderId.length > 160) {
    throw new PaymentError('DeepSeek 未返回有效支付订单号', 'INVALID_ORDER')
  }
  const paymentUrl = validatePaymentUrl(data?.url)
  return {
    orderId,
    method,
    amount: normalizeAmount(amount),
    qrDataUrl: qrDataUrl(paymentUrl),
  }
}

function parsePaymentStatus(payload) {
  const code = businessCode(payload)
  if (INVALID_TOKEN_CODES.has(code)) {
    throw new PaymentError('DeepSeek 开放平台登录已失效，请重新登录', 'AUTH_REQUIRED')
  }
  if (code !== 0) {
    throw new PaymentError(payload?.data?.biz_msg || '无法查询支付状态', 'STATUS_FAILED')
  }
  const status = String(payload?.data?.biz_data?.order?.status || '').toUpperCase()
  if (!['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'CHARGEBACK'].includes(status)) {
    return 'PENDING'
  }
  return status
}

class DeepSeekPaymentService {
  constructor(options) {
    this.BrowserWindow = options.BrowserWindow
    this.sessionApi = options.session
    this.shell = options.shell
    this.log = options.log || (() => {})
    this.parentWindow = options.parentWindow || (() => null)
    this.partition = options.partition || PLATFORM_PARTITION
    this.authTimeoutMs = options.authTimeoutMs || 10 * 60 * 1000
    this.silentAuthTimeoutMs = options.silentAuthTimeoutMs || 2500
    this.paymentSession = null
    this.platformToken = null
    this.authenticated = false
    this.authValidation = null
    this.authWaiters = new Set()
    this.loginWindow = null
    this.loginRevealTimer = null
    this.loginVisibilityTimer = null
    this.syncLoginWindowVisibility = null
    this.interactiveLoginRequested = false
    this.initialized = false
    this.safeStorage = options.safeStorage || null
    this.tokenPath = typeof options.userDataPath === 'string' && options.userDataPath !== ''
      ? path.join(options.userDataPath, 'payment-platform-token.bin')
      : null
  }

  /**
   * 平台令牌持久化（Windows DPAPI 加密，仅本机本账户可解）：
   * 首次网页登录成功后写入 userData；之后每次启动自动恢复登录并异步校验，
   * 无需再打开网页静默重登窗口。重装（userData 保留）或重启后依然有效，
   * 令牌失效时自动清除并回退到既有登录流程。API Key 无法签发支付令牌，
   * 所以换新机器仍需一次网页登录——这是平台接口的边界。
   */
  loadPersistedToken() {
    try {
      if (!this.safeStorage || typeof this.safeStorage.isEncryptionAvailable !== 'function'
        || !this.safeStorage.isEncryptionAvailable() || !this.tokenPath) return null
      const token = this.safeStorage.decryptString(fs.readFileSync(this.tokenPath))
      return typeof token === 'string' && token.length > 0 && token.length <= 16384 ? token : null
    } catch (_) {
      return null
    }
  }

  persistToken(token) {
    try {
      if (!this.safeStorage || typeof this.safeStorage.isEncryptionAvailable !== 'function'
        || !this.safeStorage.isEncryptionAvailable() || !this.tokenPath) return
      if (typeof token !== 'string' || token.length === 0 || token.length > 16384) return
      fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true })
      fs.writeFileSync(this.tokenPath, this.safeStorage.encryptString(token))
    } catch (error) {
      this.log('平台令牌持久化失败:', error && error.message ? error.message : String(error))
    }
  }

  clearPersistedToken() {
    try {
      if (this.tokenPath && fs.existsSync(this.tokenPath)) fs.rmSync(this.tokenPath, { force: true })
    } catch (_) {}
  }

  initialize() {
    if (this.initialized) return
    this.initialized = true
    this.paymentSession = this.sessionApi.fromPartition(this.partition, { cache: true })
    this.paymentSession.webRequest.onBeforeSendHeaders(
      { urls: [`${PLATFORM_ORIGIN}/api/*`] },
      (details, callback) => {
        try {
          const entry = Object.entries(details.requestHeaders || {})
            .find(([name]) => name.toLowerCase() === 'authorization')
          const header = Array.isArray(entry?.[1]) ? entry[1][0] : entry?.[1]
          if (typeof header === 'string' && /^Bearer\s+\S+/i.test(header)) {
            this.considerToken(header.replace(/^Bearer\s+/i, ''))
          }
        } finally {
          callback({ requestHeaders: details.requestHeaders })
        }
      },
    )
    // 启动即尝试恢复上次登录：校验异步进行，无效会自动清除并走既有流程。
    const persisted = this.loadPersistedToken()
    if (persisted) this.considerToken(persisted)
  }

  async fetchJson(url, init = {}, token = this.platformToken) {
    if (!token) throw new PaymentError('需要登录 DeepSeek 开放平台', 'AUTH_REQUIRED')
    const response = await this.paymentSession.fetch(url, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        Origin: PLATFORM_ORIGIN,
        Referer: PLATFORM_TOP_UP_URL,
        ...(init.headers || {}),
      },
    })
    const text = await response.text()
    let payload
    try {
      payload = JSON.parse(text)
    } catch (_) {
      throw new PaymentError(`DeepSeek 支付接口返回 HTTP ${response.status}`, 'INVALID_RESPONSE')
    }
    return payload
  }

  considerToken(token) {
    if (!token || token.length > 16384) return
    if (token === this.platformToken && (this.authenticated || this.authValidation)) return
    this.platformToken = token
    this.authenticated = false
    const validation = this.validateToken(token)
      .then(valid => {
        if (this.platformToken !== token) return false
        this.authenticated = valid
        if (valid) {
          this.persistToken(token)
          this.resolveAuthWaiters()
        } else {
          this.clearPersistedToken()
          this.platformToken = null
          if (this.interactiveLoginRequested) this.showInteractiveLogin()
          else this.failSilentAuthentication()
        }
        return valid
      })
      .catch(() => {
        if (this.platformToken === token) {
          this.clearPersistedToken()
          this.platformToken = null
          this.authenticated = false
          if (this.interactiveLoginRequested) this.showInteractiveLogin()
          else this.failSilentAuthentication()
        }
        return false
      })
      .finally(() => {
        if (this.authValidation === validation) this.authValidation = null
      })
    this.authValidation = validation
  }

  showInteractiveLogin() {
    if (!this.interactiveLoginRequested) return
    const loginWindow = this.loginWindow
    if (!loginWindow || loginWindow.isDestroyed() || this.authenticated) return
    if (isAuthenticationUrl(loginWindow.webContents.getURL())) {
      this.syncLoginWindowVisibility?.(loginWindow.webContents.getURL())
      return
    }
    loginWindow.loadURL(PLATFORM_SIGN_IN_URL)
      .then(() => this.syncLoginWindowVisibility?.(loginWindow.webContents.getURL()))
      .catch(error => {
        this.log('DeepSeek 登录页面加载失败:', error && error.message ? error.message : String(error))
      })
  }

  failSilentAuthentication() {
    this.rejectAuthWaiters(new PaymentError('DeepSeek 登录状态已失效，请在充值栏主动点击“重新登录 DeepSeek”', 'AUTH_REQUIRED'))
    const loginWindow = this.loginWindow
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close()
  }

  async validateToken(token = this.platformToken) {
    if (!token) return false
    const payload = await this.fetchJson(PLATFORM_SUMMARY_URL, { method: 'GET' }, token)
    return businessCode(payload) === 0
  }

  resolveAuthWaiters() {
    for (const waiter of this.authWaiters) {
      clearTimeout(waiter.timer)
      waiter.resolve()
    }
    this.authWaiters.clear()
    if (this.loginRevealTimer) clearTimeout(this.loginRevealTimer)
    this.loginRevealTimer = null
    if (this.loginVisibilityTimer) clearTimeout(this.loginVisibilityTimer)
    this.loginVisibilityTimer = null
    this.interactiveLoginRequested = false
    const loginWindow = this.loginWindow
    if (loginWindow && !loginWindow.isDestroyed()) {
      setTimeout(() => {
        if (!loginWindow.isDestroyed()) loginWindow.close()
      }, 100)
    }
  }

  rejectAuthWaiters(error) {
    for (const waiter of this.authWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.authWaiters.clear()
  }

  openLoginWindow(interactive = false) {
    if (interactive) this.interactiveLoginRequested = true
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      const currentUrl = this.loginWindow.webContents.getURL()
      if (this.interactiveLoginRequested && isAuthenticationUrl(currentUrl)) {
        this.syncLoginWindowVisibility?.(currentUrl)
      } else if (this.interactiveLoginRequested) {
        this.showInteractiveLogin()
      }
      return
    }
    const parent = this.parentWindow()
    const loginWindow = new this.BrowserWindow({
      width: 980,
      height: 760,
      minWidth: 760,
      minHeight: 600,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      modal: false,
      title: '登录 DeepSeek 开放平台（仅首次充值）',
      backgroundColor: '#151515',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        session: this.paymentSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    this.loginWindow = loginWindow
    const syncVisibility = url => {
      if (loginWindow.isDestroyed() || this.authenticated) return
      if (this.loginVisibilityTimer) clearTimeout(this.loginVisibilityTimer)
      this.loginVisibilityTimer = null
      if (this.interactiveLoginRequested && isAuthenticationUrl(url)) {
        // 登录路由有时会立刻通过 SPA 导航跳回 /top_up。延迟显示并再次
        // 核对当前 URL，避免把这次短暂跳转暴露成一个充值网页窗口。
        this.loginVisibilityTimer = setTimeout(() => {
          this.loginVisibilityTimer = null
          if (loginWindow.isDestroyed() || this.authenticated) return
          if (!isAuthenticationUrl(loginWindow.webContents.getURL())) return
          loginWindow.show()
          loginWindow.focus()
        }, 700)
      } else if (loginWindow.isVisible()) {
        // 登录完成后通常会跳转至 /top_up；令牌校验期间保持隐藏，
        // 避免用户看到完整充值网页一闪而过。
        loginWindow.hide()
      }
    }
    this.syncLoginWindowVisibility = syncVisibility
    loginWindow.on('page-title-updated', event => {
      event.preventDefault()
      loginWindow.setTitle('登录 DeepSeek 开放平台（仅首次充值）')
    })
    loginWindow.webContents.on('will-navigate', (event, url) => {
      try {
        if (new URL(url).protocol === 'https:') return
      } catch (_) {}
      event.preventDefault()
    })
    loginWindow.webContents.on('did-navigate', (_event, url) => syncVisibility(url))
    loginWindow.webContents.on('did-redirect-navigation', (_event, url) => syncVisibility(url))
    loginWindow.webContents.on('did-navigate-in-page', (_event, url) => syncVisibility(url))
    loginWindow.webContents.on('did-stop-loading', () => syncVisibility(loginWindow.webContents.getURL()))
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      let hostname = ''
      try { hostname = new URL(url).hostname.toLowerCase() } catch (_) {}
      const deepseekPage = hostname === 'platform.deepseek.com' || hostname.endsWith('.deepseek.com')
      if (deepseekPage) {
        // DeepSeek 自身链接留在受控登录窗口中，禁止创建一个失去可见性
        // 管理的充值子窗口。
        void loginWindow.loadURL(url).catch(error => {
          this.log('DeepSeek 登录页面跳转失败:', error && error.message ? error.message : String(error))
        })
        return { action: 'deny' }
      }
      const allowed = hostname === 'accounts.google.com'
        || hostname === 'open.weixin.qq.com'
        || hostname === 'appleid.apple.com'
      if (allowed) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: {
              session: this.paymentSession,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          },
        }
      }
      if (/^https:/i.test(url)) void this.shell.openExternal(url)
      return { action: 'deny' }
    })
    loginWindow.on('closed', () => {
      if (this.loginRevealTimer) clearTimeout(this.loginRevealTimer)
      this.loginRevealTimer = null
      if (this.loginVisibilityTimer) clearTimeout(this.loginVisibilityTimer)
      this.loginVisibilityTimer = null
      this.syncLoginWindowVisibility = null
      if (this.loginWindow === loginWindow) this.loginWindow = null
      if (!this.authenticated) {
        this.rejectAuthWaiters(new PaymentError('登录窗口已关闭，尚未完成 DeepSeek 登录', 'AUTH_CANCELLED'))
      }
    })
    loginWindow.loadURL(PLATFORM_TOP_UP_URL).catch(error => {
      this.log('DeepSeek 登录页面加载失败:', error && error.message ? error.message : String(error))
    })
    this.loginRevealTimer = setTimeout(() => {
      this.loginRevealTimer = null
      if (loginWindow.isDestroyed() || this.authenticated) return
      if (this.authValidation) {
        void this.authValidation.finally(() => {
          if (!this.authenticated) {
            if (this.interactiveLoginRequested) this.showInteractiveLogin()
            else this.failSilentAuthentication()
          }
        })
        return
      }
      const currentUrl = loginWindow.webContents.getURL()
      if (this.interactiveLoginRequested && isAuthenticationUrl(currentUrl)) {
        syncVisibility(currentUrl)
        return
      }
      if (this.interactiveLoginRequested) this.showInteractiveLogin()
      else this.failSilentAuthentication()
    }, this.silentAuthTimeoutMs)
  }

  async ensureAuthenticated() {
    this.initialize()
    if (this.authenticated && this.platformToken) return
    if (this.platformToken) {
      try {
        if (await this.validateToken()) {
          this.authenticated = true
          return
        }
      } catch (_) {}
      this.platformToken = null
      this.authenticated = false
    }
    const promise = new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null }
      waiter.timer = setTimeout(() => {
        this.authWaiters.delete(waiter)
        reject(new PaymentError('等待 DeepSeek 登录超时，请重试', 'AUTH_TIMEOUT'))
      }, this.authTimeoutMs)
      this.authWaiters.add(waiter)
    })
    this.openLoginWindow(false)
    await promise
  }

  async loginInteractively() {
    this.initialize()
    if (this.authenticated && this.platformToken) return
    const promise = new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null }
      waiter.timer = setTimeout(() => {
        this.authWaiters.delete(waiter)
        reject(new PaymentError('等待 DeepSeek 登录超时，请重试', 'AUTH_TIMEOUT'))
      }, this.authTimeoutMs)
      this.authWaiters.add(waiter)
    })
    this.openLoginWindow(true)
    await promise
  }

  async createOrder(input) {
    const method = normalizeMethod(input?.method)
    const amount = normalizeAmount(input?.amount)
    await this.ensureAuthenticated()
    const payload = await this.fetchJson(PLATFORM_PAYMENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createPaymentRequest({ method, amount })),
    })
    try {
      return parsePaymentOrder(payload, method, amount)
    } catch (error) {
      if (error?.code === 'AUTH_REQUIRED') {
        this.platformToken = null
        this.authenticated = false
      }
      throw error
    }
  }

  async getStatus(orderId) {
    if (typeof orderId !== 'string' || !/^[A-Za-z0-9_.:-]{4,160}$/.test(orderId)) {
      throw new PaymentError('支付订单号无效', 'INVALID_ORDER')
    }
    await this.ensureAuthenticated()
    const payload = await this.fetchJson(`${PLATFORM_PAYMENT_URL}/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    return parsePaymentStatus(payload)
  }

  destroy() {
    this.rejectAuthWaiters(new PaymentError('应用正在退出', 'APP_QUIT'))
    if (this.loginRevealTimer) clearTimeout(this.loginRevealTimer)
    this.loginRevealTimer = null
    if (this.loginVisibilityTimer) clearTimeout(this.loginVisibilityTimer)
    this.loginVisibilityTimer = null
    this.syncLoginWindowVisibility = null
    this.interactiveLoginRequested = false
    if (this.loginWindow && !this.loginWindow.isDestroyed()) this.loginWindow.destroy()
    this.loginWindow = null
    this.platformToken = null
    this.authenticated = false
  }
}

module.exports = {
  DeepSeekPaymentService,
  PaymentError,
  PLATFORM_PARTITION,
  PLATFORM_PAYMENT_URL,
  PLATFORM_SIGN_IN_URL,
  PLATFORM_TOP_UP_URL,
  businessCode,
  createPaymentRequest,
  isAuthenticationUrl,
  normalizeAmount,
  normalizeMethod,
  parsePaymentOrder,
  parsePaymentStatus,
  qrDataUrl,
}
