'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

test('distribution does not bundle external plugins', () => {
  const thirdPartyDir = path.join(root, 'third_party')
  const thirdPartyFiles = fs.existsSync(thirdPartyDir)
    ? fs.readdirSync(thirdPartyDir, { recursive: true }).filter((entry) => fs.statSync(path.join(thirdPartyDir, entry)).isFile())
    : []
  assert.deepEqual(thirdPartyFiles, [])
  assert.equal(fs.existsSync(path.join(root, 'build', 'desktop-profile.package.json')), false)

  const builder = fs.readFileSync(path.join(root, 'electron-builder-desktop.yml'), 'utf8')
  assert.doesNotMatch(builder, /desktop-profile|third_party|\.tgz|corepack|pnpm\.cmd/i)

  const prepare = fs.readFileSync(path.join(root, 'build', 'prepare-desktop.cjs'), 'utf8')
  assert.doesNotMatch(prepare, /liang-intensity|super-injector|vision-router|imessage|mass-spectrometry/i)
})

test('only Desktop build commands and product identity remain', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts.dist, undefined)
  assert.equal(pkg.scripts['dist:portable'], undefined)
  assert.equal(pkg.scripts['dist:installer'], undefined)
  assert.match(pkg.scripts['release:desktop'], /dist:desktop-installer/)

  const builder = fs.readFileSync(path.join(root, 'electron-builder-desktop.yml'), 'utf8')
  const installer = fs.readFileSync(path.join(root, 'electron-builder-desktop-installer.yml'), 'utf8')
  assert.match(builder, /productName: DeepSeek Harness Desktop/)
  assert.match(installer, /productName: DeepSeek Harness Desktop/)
})
