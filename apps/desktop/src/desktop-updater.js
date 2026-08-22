'use strict'

const { compareVersions } = require('./updater')

const DEFAULT_FEED = Object.freeze({
  provider: 'github',
  owner: 'Dr1empty',
  repo: 'deepseek-harness-desktop',
  releaseType: 'release',
})

class DesktopUpdater {
  constructor(options) {
    this.autoUpdater = options.autoUpdater
    this.currentVersion = options.currentVersion
    this.isPackaged = options.isPackaged === true
    this.feed = options.feed || DEFAULT_FEED
    this.log = options.log || (() => {})
    this.onProgress = options.onProgress || (() => {})
    this.initialized = false
    this.downloading = false
    this.downloadedVersion = null
  }

  initialize() {
    if (this.initialized || !this.isPackaged) return
    this.initialized = true
    this.autoUpdater.autoDownload = false
    this.autoUpdater.autoInstallOnAppQuit = false
    this.autoUpdater.allowPrerelease = false
    this.autoUpdater.setFeedURL(this.feed)
    this.autoUpdater.on('download-progress', progress => {
      this.onProgress({
        percent: Number.isFinite(progress?.percent) ? progress.percent : 0,
        transferred: Number.isFinite(progress?.transferred) ? progress.transferred : 0,
        total: Number.isFinite(progress?.total) ? progress.total : 0,
      })
    })
    this.autoUpdater.on('error', error => {
      this.log('Desktop 更新器错误:', error && error.message ? error.message : String(error))
    })
  }

  state() {
    return {
      supported: this.isPackaged,
      currentVersion: this.currentVersion,
      downloadedVersion: this.downloadedVersion,
    }
  }

  async checkForUpdates() {
    if (!this.isPackaged) {
      return { ...this.state(), latestVersion: this.currentVersion, updateAvailable: false }
    }
    this.initialize()
    const result = await this.autoUpdater.checkForUpdates()
    const latestVersion = result?.updateInfo?.version || this.currentVersion
    return {
      ...this.state(),
      latestVersion,
      updateAvailable: compareVersions(latestVersion, this.currentVersion) > 0,
    }
  }

  async downloadLatest() {
    if (this.downloading) throw new Error('Desktop 更新正在下载，请稍候')
    this.downloading = true
    try {
      const check = await this.checkForUpdates()
      if (!check.supported) throw new Error('开发模式不支持 Desktop 自动更新')
      if (!check.updateAvailable) return { ...check, readyToInstall: false }
      await this.autoUpdater.downloadUpdate()
      this.downloadedVersion = check.latestVersion
      return { ...check, downloadedVersion: this.downloadedVersion, readyToInstall: true }
    } finally {
      this.downloading = false
    }
  }

  installDownloaded() {
    if (!this.downloadedVersion) throw new Error('尚未下载 Desktop 更新')
    this.autoUpdater.quitAndInstall(false, true)
  }
}

module.exports = { DEFAULT_FEED, DesktopUpdater }
