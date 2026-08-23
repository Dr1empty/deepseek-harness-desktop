'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { EventEmitter } = require('node:events')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { Backend, clearStaleProfileJunctions } = require('../src/backend')

test('caches the successful profile junction audit until dependencies change', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-backend-cache-'))
  const harnessRoot = path.join(root, 'runtime')
  const dshHome = path.join(root, 'home')
  const fallbackModules = path.join(dshHome, 'profiles', 'node_modules')
  const webProfile = path.join(dshHome, 'profiles', 'web')
  const statePath = path.join(root, 'backend-maintenance.json')
  fs.mkdirSync(path.join(harnessRoot, 'node_modules'), { recursive: true })
  fs.mkdirSync(fallbackModules, { recursive: true })
  fs.mkdirSync(path.join(webProfile, 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(webProfile, 'package.json'), '{}\n')
  fs.writeFileSync(path.join(webProfile, 'node_modules', '.modules.yaml'), 'state: one\n')

  const runtime = { harnessRoot, dshHome, version: '1.0.0', maintenanceStatePath: statePath }
  assert.equal(clearStaleProfileJunctions(runtime), 0)
  const firstState = fs.readFileSync(statePath, 'utf8')

  assert.equal(clearStaleProfileJunctions(runtime), 0)
  assert.equal(fs.readFileSync(statePath, 'utf8'), firstState)

  fs.appendFileSync(path.join(webProfile, 'package.json'), ' ')
  assert.equal(clearStaleProfileJunctions(runtime), 0)
  assert.notEqual(fs.readFileSync(statePath, 'utf8'), firstState)
})

test('waitReady rejects immediately when the backend exited before listeners were attached', async () => {
  const backend = new Backend({
    nodePath: 'node',
    harnessRoot: process.cwd(),
    binPath: 'bin.js',
    version: '1.0.0',
  })
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.exitCode = 1
  child.signalCode = null
  backend.child = child
  backend.stderrTail = 'fast startup failure'

  const started = Date.now()
  await assert.rejects(backend.waitReady(1000), /提前退出.*fast startup failure/s)
  assert.ok(Date.now() - started < 200, 'fast child exit must not wait for the startup timeout')
})
