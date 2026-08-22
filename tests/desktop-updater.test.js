'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')
const { DEFAULT_FEED, DesktopUpdater } = require('../src/desktop-updater')

class FakeAutoUpdater extends EventEmitter {
  constructor(latestVersion = '1.1.5') {
    super()
    this.latestVersion = latestVersion
    this.downloads = 0
    this.installs = 0
  }

  setFeedURL(feed) { this.feed = feed }
  async checkForUpdates() { return { updateInfo: { version: this.latestVersion } } }
  async downloadUpdate() {
    this.downloads++
    this.emit('download-progress', { percent: 42.5, transferred: 425, total: 1000 })
    return ['setup.exe']
  }
  quitAndInstall() { this.installs++ }
}

test('checks, downloads and installs a newer Desktop release', async () => {
  const fake = new FakeAutoUpdater()
  const progress = []
  const updater = new DesktopUpdater({
    autoUpdater: fake,
    currentVersion: '1.1.4',
    isPackaged: true,
    onProgress: value => progress.push(value),
  })

  const check = await updater.checkForUpdates()
  assert.equal(check.updateAvailable, true)
  assert.deepEqual(fake.feed, DEFAULT_FEED)

  const download = await updater.downloadLatest()
  assert.equal(download.readyToInstall, true)
  assert.equal(download.downloadedVersion, '1.1.5')
  assert.equal(fake.downloads, 1)
  assert.equal(progress[0].percent, 42.5)

  updater.installDownloaded()
  assert.equal(fake.installs, 1)
})

test('reports Desktop updates as unsupported in development', async () => {
  const updater = new DesktopUpdater({
    autoUpdater: new FakeAutoUpdater(),
    currentVersion: '1.1.4',
    isPackaged: false,
  })
  const check = await updater.checkForUpdates()
  assert.equal(check.supported, false)
  assert.equal(check.updateAvailable, false)
  await assert.rejects(updater.downloadLatest(), /开发模式/)
})
