'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { clearStaleProfileJunctions } = require('../src/backend')

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
