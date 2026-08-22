'use strict'

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance'
const DEEPSEEK_TOP_UP_URL = 'https://platform.deepseek.com/top_up'
const DEEPSEEK_PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'
const LOW_BALANCE_THRESHOLD_CNY = 5

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
    addUsage(all, record.usage)
    if (localMonthKey(record.time) === monthKey) addUsage(month, record.usage)
    if (localDayKey(record.time) === todayKey) addUsage(today, record.usage)
    const provider = record.provider || 'unknown'
    if (!byProvider[provider]) byProvider[provider] = emptyUsage()
    addUsage(byProvider[provider], record.usage)
  }
  return { today, month, all, byProvider }
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

class UsageService {
  constructor(options) {
    this.dshHome = options.dshHome
    this.fetchImpl = options.fetchImpl || globalThis.fetch
    this.now = options.now || Date.now
    this.balanceUrl = options.balanceUrl || DEEPSEEK_BALANCE_URL
    this.fileCache = new Map()
  }

  async collectUsage() {
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
      ...aggregateUsage(records, this.now()),
      sessionFiles: files.length,
      unreadableFiles,
    }
  }

  async queryBalance() {
    const apiKey = readCredential(path.join(this.dshHome, '.credentials.yaml'), 'DEEPSEEK_API_KEY')
    if (!apiKey) {
      return { status: 'unavailable', provider: 'DeepSeek', message: '尚未配置 DeepSeek API Key' }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
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

  async snapshot() {
    const [usage, balance] = await Promise.all([this.collectUsage(), this.queryBalance()])
    return { generatedAt: this.now(), usage, balance }
  }
}

module.exports = {
  DEEPSEEK_BALANCE_URL,
  DEEPSEEK_PRICING_URL,
  DEEPSEEK_TOP_UP_URL,
  LOW_BALANCE_THRESHOLD_CNY,
  UsageService,
  aggregateUsage,
  decompressSessionFile,
  markBalanceLevel,
  normalizeBalance,
  parseSessionText,
  readCredential,
}
