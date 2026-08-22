'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  DshUpdater,
  compareVersions,
  ensureNodeTools,
  loadInstalledRuntime,
} = require('../src/updater')

function fakeResponse(version) {
  return { ok: true, status: 200, json: async () => ({ version }) }
}

function updater(fetchImpl, currentVersion = '0.1.0-rc.8') {
  return new DshUpdater({
    currentVersion,
    userDataPath: 'unused',
    nodePath: 'node',
    npmCliPath: 'npm-cli.js',
    fetchImpl,
  })
}

test('semver comparison handles release candidates numerically', () => {
  assert.equal(compareVersions('0.1.1-rc.1', '0.1.0-rc.8'), 1)
  assert.equal(compareVersions('0.1.1-rc.10', '0.1.1-rc.2'), 1)
  assert.equal(compareVersions('0.1.1', '0.1.1-rc.9'), 1)
  assert.equal(compareVersions('0.1.1-rc.1', '0.1.1-rc.1'), 0)
})

test('checkForUpdates reports no update when versions match', async () => {
  const result = await updater(async () => fakeResponse('0.1.1-rc.1'), '0.1.1-rc.1').checkForUpdates()
  assert.deepEqual(result, {
    currentVersion: '0.1.1-rc.1',
    latestVersion: '0.1.1-rc.1',
    updateAvailable: false,
  })
})

test('checkForUpdates reports a newer registry version', async () => {
  const result = await updater(async () => fakeResponse('0.1.1-rc.1')).checkForUpdates()
  assert.equal(result.updateAvailable, true)
  assert.equal(result.latestVersion, '0.1.1-rc.1')
})

test('checkForUpdates surfaces registry failures', async () => {
  await assert.rejects(
    updater(async () => ({ ok: false, status: 503 })).checkForUpdates(),
    /HTTP 503/,
  )
})

test('runtime pointer accepts only a verified runtime below userData/runtime', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-updater-'))
  try {
    const version = '0.1.1-rc.1'
    const root = path.join(userData, 'runtime', `dsh-${version}`)
    const packageRoot = path.join(root, 'node_modules', '@deepseek-ai', 'dsh')
    fs.mkdirSync(path.join(packageRoot, 'lib'), { recursive: true })
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ version }))
    fs.writeFileSync(path.join(packageRoot, 'lib', 'bin.js'), '')
    fs.writeFileSync(path.join(root, '.dsh-runtime-complete.json'), JSON.stringify({ version }))
    fs.writeFileSync(path.join(userData, 'current-runtime.json'), JSON.stringify({
      version,
      relativePath: path.join('runtime', `dsh-${version}`),
    }))

    const valid = loadInstalledRuntime(userData, 'node.exe')
    assert.equal(valid.version, version)
    assert.equal(valid.source, 'updated')

    fs.writeFileSync(path.join(userData, 'current-runtime.json'), JSON.stringify({
      version,
      relativePath: '..',
    }))
    assert.equal(loadInstalledRuntime(userData, 'node.exe'), null)
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('ensureNodeTools replaces an invalid cache and accepts a wrapped Node archive', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-updater-tools-'))
  const archive = path.join(userData, 'node.zip')
  fs.writeFileSync(archive, 'fixture')
  const invalidCache = path.join(userData, 'update-tools', 'node-24.18.0')
  fs.mkdirSync(invalidCache, { recursive: true })
  fs.writeFileSync(path.join(invalidCache, 'incomplete.txt'), 'stale')
  try {
    const tools = await ensureNodeTools(archive, userData, async (actualArchive, destination) => {
      assert.equal(actualArchive, archive)
      const root = path.join(destination, 'node-v24.18.0-win-x64')
      fs.mkdirSync(path.join(root, 'node_modules', 'npm', 'bin'), { recursive: true })
      fs.writeFileSync(path.join(root, 'node.exe'), 'node')
      fs.writeFileSync(path.join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'npm')
    })
    assert.equal(tools.nodePath, path.join(invalidCache, 'node.exe'))
    assert.equal(tools.npmCliPath, path.join(invalidCache, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    assert.equal(fs.existsSync(path.join(invalidCache, 'incomplete.txt')), false)
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})
