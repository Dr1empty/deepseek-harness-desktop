'use strict'
/**
 * copy-harness.cjs — 把 dsh-build（deepseek-harness 全量 pnpm install 的工作副本）
 * 复制到打包目录，同时把 pnpm 的「绝对路径 junction」重写为指向目标目录的新 junction。
 *
 * 为什么不能用 electron-builder 直接拷：
 *   electron-builder 的 copyAppFiles 对每个符号链接调用 fs-extra 的
 *   ensureSymlink(绝对 target, dest)。ensureSymlink 会把绝对 target 原样保留、
 *   再用 symlinkType 判断成 'dir'，最终 fs.symlinkSync(abs, dest, 'dir')。
 *   本机 Developer Mode 关闭，创建相对/目录符号链接一律 EPERM；只有 junction
 *   （绝对 target）能建。所以这里自己用 type='junction' 重建链接。
 *
 * 为什么不「解引用」成无链接树：
 *   vendor/cordis ↔ vendor/cordis-plugin-include 存在循环依赖（workspace 交叉链接），
 *   递归解引用会无限循环。而「重建 junction」不跟随链接，只把链接当成叶子节点，
 *   天然避开循环。
 *
 * 可移植性：junction 的 target 是绝对路径（指向 DST）。打包后的整棵树只在 DST
 * 这个路径下有效；若应用被解压/安装到别的路径，由 backend.js 在运行时按
 * .dsh-junction-root 记录重写所有 junction（见 backend.js 的 fixJunctions）。
 */
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.resolve(process.argv[3] || process.env.DSH_BUILD_SOURCE || path.join(__dirname, '..', '..', 'dsh-build'))
const DST = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'harness'))

// 顶层不排除任何 workspace 目录：native（landlock-run）、python、examples 都被
// 别处 junction 引用（如 packages/sandbox/sandbox-local → native/landlock-run），
// 排除它们会制造悬空链接导致启动失败。体积代价极小（合计约 4.5M）。
const EXCLUDE_TOP = new Set()
// 任意层级都排除的元数据目录
const EXCLUDE_ANY = new Set(['.git', '.github', '.agents', '.claude'])

let files = 0
let dirs = 0
let junctions = 0
let skipped = 0
let outsideLinks = 0

function shouldExcludeTop(name) {
  return EXCLUDE_TOP.has(name) || EXCLUDE_ANY.has(name)
}

function shouldExcludeAny(relParts) {
  for (const p of relParts) {
    if (EXCLUDE_ANY.has(p)) return true
  }
  return false
}

function copyEntry(src, dst, relParts) {
  const st = fs.lstatSync(src)

  if (st.isSymbolicLink()) {
    // junction：readlink 返回绝对 target（如 D:\...\dsh-build\...\.pnpm\...）
    const target = fs.readlinkSync(src)
    const rel = path.relative(SRC, target)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      // 指向树外（理论不该发生）：跳过并计数
      outsideLinks++
      return
    }
    const newTarget = path.join(DST, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.symlinkSync(newTarget, dst, 'junction')
    junctions++
    return
  }

  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    dirs++
    const entries = fs.readdirSync(src)
    for (const name of entries) {
      const childRel = relParts.concat(name)
      if (relParts.length === 0 && shouldExcludeTop(name)) { skipped++; continue }
      if (shouldExcludeAny(childRel)) { skipped++; continue }
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
  // 其它（socket/fifo 等）忽略
}

function main() {
  console.log('SRC:', SRC)
  console.log('DST:', DST)
  if (!fs.existsSync(SRC)) {
    console.error('错误：SRC 不存在 →', SRC)
    process.exit(1)
  }

  const t0 = Date.now()
  fs.rmSync(DST, { recursive: true, force: true })
  fs.mkdirSync(DST, { recursive: true })

  copyEntry(SRC, DST, [])

  // 记录本次 junction 指向的根目录，供运行时搬迁后重写
  fs.writeFileSync(path.join(DST, '.dsh-junction-root'), DST, 'utf8')

  const sec = ((Date.now() - t0) / 1000).toFixed(1)
  console.log('\n=== 完成（' + sec + 's）===')
  console.log('文件:', files)
  console.log('目录:', dirs)
  console.log('junction:', junctions)
  console.log('跳过的排除项:', skipped)
  console.log('树外链接(已跳过):', outsideLinks)
}

main()
