'use strict'

const { parentPort, workerData } = require('node:worker_threads')
const { LocalUsageCollector } = require('./usage')

const collector = new LocalUsageCollector({ dshHome: workerData.dshHome })

parentPort.on('message', async message => {
  if (!message || !Number.isInteger(message.id)) return
  try {
    const value = await collector.collect(message.now)
    parentPort.postMessage({ id: message.id, ok: true, value })
  } catch (error) {
    parentPort.postMessage({
      id: message.id,
      ok: false,
      error: error?.message || String(error),
    })
  }
})
