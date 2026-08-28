'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { Worker } = require('node:worker_threads')
const zlib = require('node:zlib')

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance'
const DEEPSEEK_TOP_UP_URL = 'https://platform.deepseek.com/top_up'
const DEEPSEEK_PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'
const LOW_BALANCE_THRESHOLD_CNY = 5
const LOCAL_USAGE_TIMEOUT_MS = 15000
const BALANCE_TIMEOUT_MS = 8000
const BEIJING_OFFSET_MS = 8 * 3600 * 1000
const DAY_MS = 24 * 3600 * 1000

/**
 * 官方计费单价（元 / 百万 tokens），来自 api-docs.deepseek.com 价格页：
 * 高峰时段（北京周一至周五 9:00-12:00、14:00-18:00）为 peak，
 * 其余空闲时段为 off（高峰价的一半）。
 */
const PRICING_CNY_PER_1M = {
  'deepseek-v4-flash': {
    hit: { peak: 0.10, off: 0.05 },
    miss: { peak: 3.0, off: 1.5 },
    output: { peak: 9.0, off: 4.5 },
  },
  'deepseek-v4-pro': {
    hit: { peak: 0.30, off: 0.15 },
    miss: { peak: 9.0, off: 4.5 },
    output: { peak: 27.0, off: 13.5 },
  },
  'deepseek-v4-flash-vision-exp': {
    hit: { peak: 0.10, off: 0.05 },
    miss: { peak: 3.0, off: 1.5 },
    output: { peak: 9.0, off: 4.5 },
  },
}

/** 该请求的北京时间时钟（周几 0=周日 / 小时），用于峰谷判定。 */
function beijingClock(time) {
  const date = new Date(time + BEIJING_OFFSET_MS)
  return { day: date.getUTCDay(), hour: date.getUTCHours() }
}

/** 是否落在官方高峰计费时段（北京周一至周五 9-12 点、14-18 点）。 */
function isPeakHour(time) {
  const clock = beijingClock(time)
  return clock.day >= 1 && clock.day <= 5
    && ((clock.hour >= 9 && clock.hour < 12) || (clock.hour >= 14 && clock.hour < 18))
}

/** 下一次官方峰谷计价切换的 UTC 时间戳。 */
function nextPriceBandTransition(time) {
  const now = Number.isFinite(Number(time)) ? Number(time) : Date.now()
  const beijing = new Date(now + BEIJING_OFFSET_MS)
  const baseDay = Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate())
  for (let offset = 0; offset <= 8; offset += 1) {
    const localDay = new Date(baseDay + offset * DAY_MS)
    const weekday = localDay.getUTCDay()
    if (weekday < 1 || weekday > 5) continue
    for (const hour of [9, 12, 14, 18]) {
      const candidate = Date.UTC(
        localDay.getUTCFullYear(),
        localDay.getUTCMonth(),
        localDay.getUTCDate(),
        hour,
      ) - BEIJING_OFFSET_MS
      if (candidate <= now) continue
      if (isPeakHour(candidate - 1) !== isPeakHour(candidate)) return candidate
    }
  }
  return null
}

/** 对话页横幅使用的当前计价时段快照。 */
function priceBandStatus(time = Date.now()) {
  const now = Number.isFinite(Number(time)) ? Number(time) : Date.now()
  const peak = isPeakHour(now)
  const nextAt = nextPriceBandTransition(now)
  return {
    band: peak ? 'peak' : 'off',
    label: peak ? '高峰时段' : '空闲时段',
    schedule: '工作日 09:00–12:00、14:00–18:00（北京时间）',
    nextBand: peak ? 'off' : 'peak',
    nextAt,
    remainingMs: nextAt === null ? null : Math.max(0, nextAt - now),
  }
}

/**
 * 单条请求的费用估算（元）。未知模型返回 null（不编造单价）。
 * 缓存命中 = cacheReadTokens；未命中输入 = inputTokens - 命中；输出 = outputTokens。
 */
function recordCostCny(record) {
  const pricing = record && record.model ? PRICING_CNY_PER_1M[record.model] : undefined
  if (!pricing || !record.usage) return null
  const band = isPeakHour(record.time) ? 'peak' : 'off'
  const usage = record.usage
  const hit = finiteNonNegative(usage.cacheReadTokens)
  const miss = Math.max(0, finiteNonNegative(usage.inputTokens) - hit)
  const output = finiteNonNegative(usage.outputTokens)
  return (hit * pricing.hit[band] + miss * pricing.miss[band] + output * pricing.output[band]) / 1e6
}

function emptyUsage() {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function addUsage(target, usage) {
  target.requests += 1
  target.inputTokens += finiteNonNegative(usage.inputTokens)
  target.outputTokens += finiteNonNegative(usage.outputTokens)
  target.cacheReadTokens += finiteNonNegative(usage.cacheReadTokens)
  target.cacheWriteTokens += finiteNonNegative(usage.cacheWriteTokens)
  target.reasoningTokens += finiteNonNegative(usage.reasoningTokens)
}

function addCost(target, costCny, covered) {
  target.costCny = (target.costCny || 0) + costCny
  target.costCovered = (target.costCovered || 0) + (covered ? 1 : 0)
}

function localDayKey(time) {
  const date = new Date(time)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function localMonthKey(time) {
  const date = new Date(time)
  return `${date.getFullYear()}-${date.getMonth()}`
}

function usageRecordOf(event, fallbackId) {
  if (!event || event.type !== 'assistant/message' || !event.data || typeof event.data !== 'object') return null
  const usage = event.data.usage
  if (!usage || typeof usage !== 'object') return null
  const message = event.data.message && typeof event.data.message === 'object' ? event.data.message : null
  const source = message?.source && typeof message.source === 'object'
    ? message.source
    : event.data.provenance && typeof event.data.provenance === 'object'
      ? event.data.provenance
      : null
  const messageId = typeof message?.id === 'string'
    ? message.id
    : typeof event.data.id === 'string'
      ? event.data.id
      : fallbackId
  return {
    id: messageId,
    time: typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : 0,
    provider: typeof source?.provider === 'string' ? source.provider : null,
    model: typeof source?.model === 'string' ? source.model : null,
    usage,
  }
}

function parseSessionText(text, fileId = 'session') {
  const records = []
  let lineNumber = 0
  for (const line of String(text).split(/\r?\n/u)) {
    lineNumber += 1
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch (_) {
      continue
    }
    const record = usageRecordOf(event, `${fileId}:${event?.seq ?? lineNumber}`)
    if (record) records.push(record)
  }
  return records
}

function decompressSessionFile(buffer) {
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('当前 Node 运行时不支持 Zstandard 会话文件')
  }
  const chunks = []
  let offset = 0
  while (offset < buffer.length) {
    const result = zlib.zstdDecompressSync(buffer.subarray(offset), { info: true })
    const consumed = result.engine?.bytesWritten
    if (!Number.isInteger(consumed) || consumed <= 0) {
      throw new Error(`Zstandard 会话帧无法继续解析（偏移 ${offset}）`)
    }
    chunks.push(result.buffer)
    offset += consumed
  }
  return Buffer.concat(chunks).toString('utf8')
}

function listSessionFiles(root) {
  if (!fs.existsSync(root)) return []
  const files = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch (_) {
      continue
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) pending.push(fullPath)
      else if (entry.isFile() && (entry.name === 'session.jsonl.zstd' || entry.name === 'session.jsonl')) files.push(fullPath)
    }
  }
  return files
}

function aggregateUsage(records, now = Date.now()) {
  const today = emptyUsage()
  const month = emptyUsage()
  const all = emptyUsage()
  const byProvider = {}
  const seen = new Set()
  const todayKey = localDayKey(now)
  const monthKey = localMonthKey(now)

  for (const record of records) {
    if (!record || seen.has(record.id)) continue
    seen.add(record.id)
    const cost = recordCostCny(record)
    addUsage(all, record.usage)
    addCost(all, cost ?? 0, cost !== null)
    if (localMonthKey(record.time) === monthKey) {
      addUsage(month, record.usage)
      addCost(month, cost ?? 0, cost !== null)
    }
    if (localDayKey(record.time) === todayKey) {
      addUsage(today, record.usage)
      addCost(today, cost ?? 0, cost !== null)
    }
    const provider = record.provider || 'unknown'
    if (!byProvider[provider]) byProvider[provider] = emptyUsage()
    addUsage(byProvider[provider], record.usage)
    addCost(byProvider[provider], cost ?? 0, cost !== null)
  }
  return { today, month, all, byProvider }
}

/**
 * 按天聚合（默认近 7 天，含无数据日补零）。条目：
 * { date: 'MM-DD', requests, tokens, costCny, costCovered }，时间升序。
 */
function aggregateByDay(records, now = Date.now(), days = 7) {
  const slots = []
  const start = localDayKey(now)
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now - offset * 24 * 3600 * 1000)
    const key = localDayKey(date.getTime())
    slots.push({
      key,
      date: `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      requests: 0,
      tokens: 0,
      costCny: 0,
      costCovered: 0,
    })
  }
  const index = new Map(slots.map(slot => [slot.key, slot]))
  const seen = new Set()
  for (const record of records) {
    if (!record || seen.has(record.id)) continue
    seen.add(record.id)
    const slot = index.get(localDayKey(record.time))
    if (!slot) continue
    const cost = recordCostCny(record)
    slot.requests += 1
    slot.tokens += finiteNonNegative(record.usage?.inputTokens) + finiteNonNegative(record.usage?.outputTokens)
    slot.costCny += cost ?? 0
    if (cost !== null) slot.costCovered += 1
  }
  return slots
}

/**
 * 将近 24 小时用量按官方计价时段聚合，不为每个小时创建展示槽位。
 * 条目：{ band, label, schedule, requests, tokens, costCny, costCovered }。
 */
function aggregateByPriceBand(records, now = Date.now(), hours = 24) {
  const anchor = Math.floor(now / 3600000) * 3600000
  const start = anchor - (hours - 1) * 3600000
  const end = anchor + 3600000
  const slots = [
    {
      band: 'peak',
      label: '高峰时段',
      schedule: '工作日 09:00–12:00、14:00–18:00',
      requests: 0,
      tokens: 0,
      costCny: 0,
      costCovered: 0,
    },
    {
      band: 'off',
      label: '空闲时段',
      schedule: '其余时段',
      requests: 0,
      tokens: 0,
      costCny: 0,
      costCovered: 0,
    },
  ]
  const index = new Map(slots.map(slot => [slot.band, slot]))
  const seen = new Set()
  for (const record of records) {
    if (!record || seen.has(record.id)) continue
    seen.add(record.id)
    if (record.time < start || record.time >= end) continue
    const slot = index.get(isPeakHour(record.time) ? 'peak' : 'off')
    const cost = recordCostCny(record)
    slot.requests += 1
    slot.tokens += finiteNonNegative(record.usage?.inputTokens) + finiteNonNegative(record.usage?.outputTokens)
    slot.costCny += cost ?? 0
    if (cost !== null) slot.costCovered += 1
  }
  return slots
}

function decodeYamlScalar(raw) {
  const value = raw.trim()
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) } catch (_) { return value.slice(1, -1) }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/gu, "'")
  return value
}

function readCredential(credentialsPath, ref) {
  let text
  try {
    text = fs.readFileSync(credentialsPath, 'utf8')
  } catch (_) {
    return null
  }
  let insideRefs = false
  for (const line of text.split(/\r?\n/u)) {
    if (/^refs:\s*$/u.test(line)) {
      insideRefs = true
      continue
    }
    if (insideRefs && /^\S/u.test(line)) break
    const match = insideRefs ? line.match(/^\s{2}([^:#]+):\s*(.*?)\s*$/u) : null
    if (match && match[1].trim() === ref) {
      const value = decodeYamlScalar(match[2])
      return value.length > 0 ? value : null
    }
  }
  return null
}

function normalizeBalance(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.balance_infos)) {
    throw new Error('余额接口返回格式不正确')
  }
  return {
    status: 'ok',
    provider: 'DeepSeek',
    isAvailable: payload.is_available === true,
    balances: payload.balance_infos.map(info => ({
      currency: typeof info?.currency === 'string' ? info.currency : '',
      totalBalance: typeof info?.total_balance === 'string' ? info.total_balance : String(info?.total_balance ?? ''),
      grantedBalance: typeof info?.granted_balance === 'string' ? info.granted_balance : String(info?.granted_balance ?? ''),
      toppedUpBalance: typeof info?.topped_up_balance === 'string' ? info.topped_up_balance : String(info?.topped_up_balance ?? ''),
    })),
  }
}

function markBalanceLevel(balance, thresholdCny = LOW_BALANCE_THRESHOLD_CNY) {
  if (!balance || balance.status !== 'ok') return balance
  const cny = balance.balances.find(item => item.currency.toUpperCase() === 'CNY')
  const totalCny = cny ? Number(cny.totalBalance) : null
  const lowBalance = balance.isAvailable === false
    || (Number.isFinite(totalCny) && totalCny < thresholdCny)
  return { ...balance, lowBalance, thresholdCny }
}

class LocalUsageCollector {
  constructor(options) {
    this.dshHome = options.dshHome
    this.fileCache = new Map()
  }

  async collect(now = Date.now()) {
    const sessionRoot = path.join(this.dshHome, 'sessions')
    const files = listSessionFiles(sessionRoot)
    const livePaths = new Set(files)
    const records = []
    let unreadableFiles = 0
    for (const file of files) {
      // Large append-only session archives can take a few seconds in total.
      // Yield between files so Electron's main loop keeps painting/responding.
      await new Promise(resolve => setImmediate(resolve))
      try {
        const stat = await fs.promises.stat(file)
        const signature = `${stat.size}:${stat.mtimeMs}`
        let cached = this.fileCache.get(file)
        if (!cached || cached.signature !== signature) {
          const buffer = await fs.promises.readFile(file)
          const text = file.endsWith('.zstd') ? decompressSessionFile(buffer) : buffer.toString('utf8')
          cached = { signature, records: parseSessionText(text, file) }
          this.fileCache.set(file, cached)
        }
        records.push(...cached.records)
      } catch (_) {
        unreadableFiles += 1
      }
    }
    for (const file of this.fileCache.keys()) {
      if (!livePaths.has(file)) this.fileCache.delete(file)
    }
    return {
      ...aggregateUsage(records, now),
      byDay: aggregateByDay(records, now),
      byPriceBand: aggregateByPriceBand(records, now),
      sessionFiles: files.length,
      unreadableFiles,
      collectedAt: now,
    }
  }
}

class UsageWorkerCollector {
  constructor(options) {
    this.dshHome = options.dshHome
    this.worker = null
    this.nextRequestId = 1
    this.pending = new Map()
    this.inFlight = null
  }

  ensureWorker() {
    if (this.worker) return this.worker
    const worker = new Worker(path.join(__dirname, 'usage-worker.js'), {
      workerData: { dshHome: this.dshHome },
    })
    worker.on('message', message => {
      if (!message || !Number.isInteger(message.id)) return
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      if (message.ok) request.resolve(message.value)
      else request.reject(new Error(message.error || '后台用量统计失败'))
    })
    worker.on('error', error => this.failWorker(worker, error))
    worker.on('exit', code => {
      if (code !== 0) this.failWorker(worker, new Error(`用量统计后台线程异常退出（${code}）`))
      else this.failWorker(worker, new Error('用量统计后台线程已退出'))
    })
    worker.unref()
    this.worker = worker
    return worker
  }

  failWorker(worker, error) {
    if (worker !== this.worker) return
    this.worker = null
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }

  collect(now = Date.now()) {
    if (this.inFlight) return this.inFlight
    const worker = this.ensureWorker()
    const id = this.nextRequestId++
    worker.ref()
    const request = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ id, now })
    })
    this.inFlight = request.finally(() => {
      this.inFlight = null
      if (worker === this.worker) worker.unref()
    })
    return this.inFlight
  }

  reset(message = '用量统计已取消') {
    const worker = this.worker
    if (!worker) return
    this.worker = null
    const error = new Error(message)
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
    void worker.terminate()
  }

  dispose() {
    this.reset('应用正在退出')
  }
}

function withTimeout(promise, timeoutMs, message, onTimeout) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.()
      reject(new Error(message))
    }, timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

class UsageService {
  constructor(options) {
    this.dshHome = options.dshHome
    this.fetchImpl = options.fetchImpl || globalThis.fetch
    this.now = options.now || Date.now
    this.balanceUrl = options.balanceUrl || DEEPSEEK_BALANCE_URL
    this.localUsageTimeoutMs = options.localUsageTimeoutMs || LOCAL_USAGE_TIMEOUT_MS
    this.balanceTimeoutMs = options.balanceTimeoutMs || BALANCE_TIMEOUT_MS
    this.localCollector = options.localCollector || new UsageWorkerCollector({ dshHome: this.dshHome })
    this.usageInFlight = null
    this.balanceInFlight = null
    this.lastUsage = null
  }

  collectUsage() {
    if (this.usageInFlight) return this.usageInFlight
    const operation = withTimeout(
      this.localCollector.collect(this.now()),
      this.localUsageTimeoutMs,
      '本地会话统计超时',
      () => this.localCollector.reset?.('本地会话统计超时'),
    ).then(usage => {
      this.lastUsage = usage
      return usage
    }).catch(error => {
      if (!this.lastUsage) throw error
      return {
        ...this.lastUsage,
        stale: true,
        warning: `${error?.message || String(error)}，已显示上次结果`,
      }
    }).finally(() => {
      this.usageInFlight = null
    })
    this.usageInFlight = operation
    return operation
  }

  async queryBalanceOnce() {
    const apiKey = readCredential(path.join(this.dshHome, '.credentials.yaml'), 'DEEPSEEK_API_KEY')
    if (!apiKey) {
      return { status: 'unavailable', provider: 'DeepSeek', message: '尚未配置 DeepSeek API Key' }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.balanceTimeoutMs)
    try {
      const response = await this.fetchImpl(this.balanceUrl, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`余额接口返回 HTTP ${response.status}`)
      return markBalanceLevel(normalizeBalance(await response.json()))
    } catch (error) {
      const message = error?.name === 'AbortError' ? '查询余额超时' : (error?.message || String(error))
      return { status: 'error', provider: 'DeepSeek', message }
    } finally {
      clearTimeout(timer)
    }
  }

  queryBalance() {
    if (this.balanceInFlight) return this.balanceInFlight
    const operation = this.queryBalanceOnce().finally(() => {
      this.balanceInFlight = null
    })
    this.balanceInFlight = operation
    return operation
  }

  async snapshot() {
    const [usage, balance] = await Promise.all([this.collectUsage(), this.queryBalance()])
    return { generatedAt: this.now(), usage, balance }
  }

  dispose() {
    this.localCollector.dispose?.()
  }
}

module.exports = {
  DEEPSEEK_BALANCE_URL,
  DEEPSEEK_PRICING_URL,
  DEEPSEEK_TOP_UP_URL,
  LOW_BALANCE_THRESHOLD_CNY,
  LocalUsageCollector,
  UsageService,
  UsageWorkerCollector,
  aggregateByDay,
  aggregateByPriceBand,
  aggregateUsage,
  decompressSessionFile,
  isPeakHour,
  markBalanceLevel,
  normalizeBalance,
  nextPriceBandTransition,
  parseSessionText,
  priceBandStatus,
  readCredential,
  recordCostCny,
}
