'use strict'
/**
 * flatten.cjs — 把 dsh-build 复制成「无环」的 dsh-flat，用于产出单个 exe 安装包。
 *
 * 背景：pnpm 的 workspace 互链（cordis ↔ cordis-plugin-include 等 5 个环）让 7z/NSIS
 * 解引用 junction 时无限循环。但环只存在于「workspace 包 ↔ workspace 包」的互链里；
 * 外部依赖（.pnpm）是无环 DAG。
 *
 * 做法：把 workspace 互链改成「星型拓扑」——
 *   1. 复制整棵树，junction 原样重建（绝对 target 重写到 DST）。
 *   2. 凡是「指向另一个 workspace 包」的 junction（互链），一律跳过不建。
 *   3. 在根 node_modules/@deepseek-ai/<name> 建一个 junction，单向指向该 workspace 包
 *      在 DST 里的真实目录。
 * 结果：junction 图无环（星型 + 外部 DAG）。node 解析 @deepseek-ai/* 时向上走到根
 * node_modules 即命中，语义不变；7z 解引用不再死循环。
 */
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.resolve(process.argv[3] || process.env.DSH_BUILD_SOURCE || path.join(__dirname, '..', '..', 'dsh-build'))
const DST = path.resolve(process.argv[2] || path.join(__dirname, 'dsh-flat'))

const EXCLUDE_ANY = new Set(['.git', '.github', '.agents', '.claude'])

let files = 0
let dirs = 0
let externalJunctions = 0
let interlinksSkipped = 0
let hoisted = 0

// 每个被链到的 workspace 包：name -> 相对 SRC 的规范目录
const workspaceTargets = new Map()

function isExcluded(relParts) {
  for (const p of relParts) {
    if (EXCLUDE_ANY.has(p)) return true
  }
  return false
}

// 判断一个真实目录是否是 @deepseek-ai/* workspace 包，返回其 name 或 null
function workspaceNameOf(dir) {
  const pj = path.join(dir, 'package.json')
  if (!fs.existsSync(pj)) return null
  try {
    const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'))
    if (pkg.name && pkg.name.startsWith('@deepseek-ai/')) return pkg.name
  } catch {}
  return null
}

function copyEntry(src, dst, relParts) {
  const st = fs.lstatSync(src)

  if (st.isSymbolicLink()) {
    const target = fs.readlinkSync(src)
    // 解析 target 到真实物理目录（穿过可能的嵌套 junction）
    let real = null
    try { real = fs.realpathSync(target) } catch {}

    // 是否指向 workspace 包？
    const wsName = real ? workspaceNameOf(real) : null
    if (wsName) {
      // 互链 → 跳过；记录其规范目录供后续根级 hoist
      const rel = path.relative(SRC, real)
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        if (!workspaceTargets.has(wsName)) workspaceTargets.set(wsName, rel)
      }
      interlinksSkipped++
      return
    }

    // 外部链接（.pnpm 等）→ 重建 junction，target 重写到 DST
    const rel = path.relative(SRC, target)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      // 指向树外：原样保留绝对链接
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      try { fs.symlinkSync(target, dst, 'junction') } catch {}
      return
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.symlinkSync(path.join(DST, rel), dst, 'junction')
    externalJunctions++
    return
  }

  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    dirs++
    const entries = fs.readdirSync(src)
    for (const name of entries) {
      const childRel = relParts.concat(name)
      if (isExcluded(childRel)) continue
      copyEntry(path.join(src, name), path.join(dst, name), childRel)
    }
    return
  }

  if (st.isFile()) {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
    files++
    return
  }
}

function main() {
  console.log('SRC:', SRC)
  console.log('DST:', DST)
  if (!fs.existsSync(SRC)) { console.error('SRC 不存在'); process.exit(1) }

  const t0 = Date.now()
  fs.rmSync(DST, { recursive: true, force: true })
  fs.mkdirSync(DST, { recursive: true })

  copyEntry(SRC, DST, [])

  // 根级 hoist：每个 workspace 包在根 node_modules/@deepseek-ai/<name> 建 junction
  const rootNodeModules = path.join(DST, 'node_modules')
  const scopeDir = path.join(rootNodeModules, '@deepseek-ai')
  fs.mkdirSync(scopeDir, { recursive: true })
  for (const [name, rel] of workspaceTargets) {
    const target = path.join(DST, rel)
    const linkPath = path.join(scopeDir, name.split('/')[1])
    try { fs.rmSync(linkPath, { recursive: true, force: true }) } catch {}
    try { fs.symlinkSync(target, linkPath, 'junction'); hoisted++ } catch (e) {
      console.log('  hoist 失败', name, e.code)
    }
  }

  const sec = ((Date.now() - t0) / 1000).toFixed(1)
  console.log('\n=== 完成（' + sec + 's）===')
  console.log('文件:', files)
  console.log('目录:', dirs)
  console.log('外部 junction 重建:', externalJunctions)
  console.log('workspace 互链跳过:', interlinksSkipped)
  console.log('根级 hoist:', hoisted, '/', workspaceTargets.size)
}

main()
