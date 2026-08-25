'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const zlib = require('node:zlib')
const {
  UsageService,
  aggregateByDay,
  aggregateByPriceBand,
  aggregateUsage,
  decompressSessionFile,
  isPeakHour,
  markBalanceLevel,
  normalizeBalance,
  parseSessionText,
  readCredential,
  recordCostCny,
} = require('../src/usage')

function event(id, time, usage, provider = 'deepseek-official') {
  return {
    type: 'assistant/message',
    seq: 1,
    time,
    data: {
      message: { id, source: { kind: 'model', provider, model: 'model' } },
      usage,
    },
  }
}

test('aggregates today, month and all-time usage without double-counting forked messages', () => {
  const now = new Date(2026, 7, 22, 12).getTime()
  const today = event('same-id', new Date(2026, 7, 22, 9).getTime(), { inputTokens: 10, outputTokens: 2, cacheReadTokens: 5 })
  const older = event('older', new Date(2026, 6, 1, 9).getTime(), { inputTokens: 20, outputTokens: 3 }, 'zhipu')
  const records = [
    ...parseSessionText(`${JSON.stringify(today)}\n${JSON.stringify(older)}\n`, 'one'),
    ...parseSessionText(`${JSON.stringify(today)}\n`, 'fork'),
  ]
  const result = aggregateUsage(records, now)
  assert.deepEqual(result.today, {
    requests: 1, inputTokens: 10, outputTokens: 2, cacheReadTokens: 5, cacheWriteTokens: 0, reasoningTokens: 0,
    costCny: 0, costCovered: 0,
  })
  assert.equal(result.month.requests, 1)
  assert.equal(result.all.requests, 2)
  assert.equal(result.all.inputTokens, 30)
  assert.equal(result.byProvider.zhipu.requests, 1)
})

test('decompresses concatenated zstd frames', () => {
  const first = zlib.zstdCompressSync(Buffer.from('one\n'))
  const second = zlib.zstdCompressSync(Buffer.from('two\n'))
  assert.equal(decompressSessionFile(Buffer.concat([first, second])), 'one\ntwo\n')
})

test('reads one credential without exposing unrelated refs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-usage-'))
  const file = path.join(root, '.credentials.yaml')
  fs.writeFileSync(file, 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: "secret-value"\n  OTHER: ignored\n', 'utf8')
  assert.equal(readCredential(file, 'DEEPSEEK_API_KEY'), 'secret-value')
  assert.equal(readCredential(file, 'MISSING'), null)
  fs.rmSync(root, { recursive: true, force: true })
})

test('normalizes the official balance response', () => {
  assert.deepEqual(normalizeBalance({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '2.34', topped_up_balance: '10.00' }],
  }), {
    status: 'ok', provider: 'DeepSeek', isAvailable: true,
    balances: [{ currency: 'CNY', totalBalance: '12.34', grantedBalance: '2.34', toppedUpBalance: '10.00' }],
  })
})

test('marks a usable CNY balance below the warning threshold as low', () => {
  const balance = markBalanceLevel(normalizeBalance({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '3.69', granted_balance: '0.00', topped_up_balance: '3.69' }],
  }))
  assert.equal(balance.lowBalance, true)
  assert.equal(balance.thresholdCny, 5)
})

test('snapshot combines local usage with the official balance call', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-usage-'))
  fs.mkdirSync(path.join(root, 'sessions', 'workspace', 'session-a'), { recursive: true })
  fs.writeFileSync(path.join(root, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: key\n', 'utf8')
  fs.writeFileSync(
    path.join(root, 'sessions', 'workspace', 'session-a', 'session.jsonl'),
    `${JSON.stringify(event('id', 1, { inputTokens: 4, outputTokens: 2 }))}\n`,
    'utf8',
  )
  const service = new UsageService({
    dshHome: root,
    now: () => 1,
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer key')
      return { ok: true, json: async () => ({ is_available: true, balance_infos: [] }) }
    },
  })
  const result = await service.snapshot()
  assert.equal(result.usage.all.requests, 1)
  assert.equal(result.balance.status, 'ok')
  assert.equal(result.usage.byDay.length, 7)
  assert.equal(result.usage.byPriceBand.length, 2)
  fs.rmSync(root, { recursive: true, force: true })
})

test('estimates cost from the official pricing table with peak/off-peak split', () => {
  // 北京时间周二 10:00 = UTC 02:00 → 高峰；周二 20:00 = UTC 12:00 → 空闲。
  const peak = Date.UTC(2026, 7, 25, 2, 0)
  const off = Date.UTC(2026, 7, 25, 12, 0)
  assert.equal(isPeakHour(peak), true)
  assert.equal(isPeakHour(off), false)

  const record = (time, usage, model = 'deepseek-v4-flash') => ({ id: 'x', time, model, usage })
  const usage = { inputTokens: 2_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 }
  // flash：命中 0.10 / 未命中 3.0 / 输出 9.0 元每百万（高峰）；空闲减半。
  assert.equal(recordCostCny(record(peak, usage)), 1 * 0.10 + 1 * 3.0 + 1 * 9.0)
  assert.equal(recordCostCny(record(off, usage)), 0.05 + 1.5 + 4.5)
  assert.equal(recordCostCny(record(peak, usage, 'deepseek-v4-pro')), 0.30 + 9.0 + 27.0)
  assert.equal(recordCostCny(record(peak, usage, 'unknown-model')), null)
})

test('aggregates the last 7 days with zero-filled slots', () => {
  const now = new Date(2026, 7, 22, 12).getTime()
  const today = event('a', new Date(2026, 7, 22, 9).getTime(), { inputTokens: 10, outputTokens: 2 })
  const older = event('b', new Date(2026, 7, 16, 9).getTime(), { inputTokens: 20, outputTokens: 3 })
  const records = parseSessionText(`${JSON.stringify(today)}\n${JSON.stringify(older)}\n`, 'one')

  const days = aggregateByDay(records, now)
  assert.equal(days.length, 7)
  assert.equal(days[6].date, '08-22')
  assert.equal(days[6].requests, 1)
  assert.equal(days[0].date, '08-16')
  assert.equal(days[0].requests, 1)
  assert.equal(days[3].requests, 0)

})

test('aggregates the last 24 hours into peak and off-peak pricing bands', () => {
  // 北京时间周二 10:00 为高峰、20:00 为空闲；当前时间为当日 21:30。
  const now = Date.UTC(2026, 7, 25, 13, 30)
  const usage = { inputTokens: 2_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 }
  const records = [
    { id: 'peak', time: Date.UTC(2026, 7, 25, 2), model: 'deepseek-v4-flash', usage },
    { id: 'off', time: Date.UTC(2026, 7, 25, 12), model: 'deepseek-v4-flash', usage },
  ]

  const bands = aggregateByPriceBand(records, now)
  assert.deepEqual(bands.map(item => item.band), ['peak', 'off'])
  assert.equal(bands[0].requests, 1)
  assert.equal(bands[1].requests, 1)
  assert.equal(bands[0].tokens, 3_000_000)
  assert.equal(bands[1].tokens, 3_000_000)
  assert.equal(bands[0].costCny, 12.1)
  assert.equal(bands[1].costCny, 6.05)
})
