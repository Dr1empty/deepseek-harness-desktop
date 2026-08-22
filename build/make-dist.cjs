'use strict'
/**
 * make-dist.cjs — 把便携文件夹里的 harness 变成「零 junction + 重建清单」，
 * 使其可以被任何压缩工具（Windows 自带 zip / 7z / tar）直接打包分发。
 *
 * 背景：便携版的 harness 里有 ~5452 个 junction，每个 target 都是打包机的
 * 打包机上的绝对路径。普通压缩工具
 * 要么解引用（撞循环依赖死循环），要么丢弃 junction。而且绝对路径到了别人
 * 机器上是悬空的。
 *
 * 方案：所有 junction 的 target 都指向树内（.pnpm 商店 / vendor 真实目录），
 * 链接本身不含数据。所以——删掉 junction 前，把「链接路径 → 目标路径」的
 * 相对关系记进 .dsh-junction-map.json，再删掉所有 junction。整棵树零 junction，
 * 压缩打包不再有任何障碍；收件人首启时由 backend.js::restoreJunctions() 按清单
 * 用 fs.symlinkSync(..., 'junction') 现场重建（junction 不需要管理员 / Developer Mode）。
 *
 * 用法：node build/make-dist.cjs ["dist/win-unpacked/resources/harness"]
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'harness'))

const map = Object.create(null)
let removed = 0
let outsideSkipped = 0

function walk(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch (_) {
    return
  }
  for (const name of entries) {
    const p = path.join(dir, name)
    let st
    try {
      st = fs.lstatSync(p)
    } catch (_) {
      continue
    }
    if (st.isSymbolicLink()) {
      const target = fs.readlinkSync(p)
      const relTarget = path.relative(ROOT, target)
      const relPath = path.relative(ROOT, p)
      if (relTarget.startsWith('..') || path.isAbsolute(relTarget)) {
        // 指向树外：无法在收件人机器上重建，跳过并计数
        outsideSkipped++
        console.log('  跳过树外链接:', relPath, '->', target)
        continue
      }
      map[relPath.split(path.sep).join('/')] = relTarget.split(path.sep).join('/')
      fs.unlinkSync(p) // 删 junction（只删链接，不动 target）
      removed++
      continue
    }
    if (st.isDirectory()) {
      walk(p)
    }
  }
}

function main() {
  console.log('ROOT:', ROOT)
  if (!fs.existsSync(ROOT)) {
    console.error('ROOT 不存在')
    process.exit(1)
  }

  const t0 = Date.now()
  walk(ROOT)

  const manifestFile = path.join(ROOT, '.dsh-junction-map.json')
  fs.writeFileSync(manifestFile, JSON.stringify(map, null, 0), 'utf8')

  const sec = ((Date.now() - t0) / 1000).toFixed(1)
  console.log('\n=== 完成（' + sec + 's）===')
  console.log('移除 junction:', removed)
  console.log('清单条目:', Object.keys(map).length)
  console.log('树外链接(已跳过):', outsideSkipped)
  console.log('清单写入:', manifestFile)
  console.log('\n现在整棵树已零 junction，可直接用任意工具压缩分发。')
  console.log('示例：tar -a -c -f "DeepSeek Harness.zip" "DeepSeek Harness"')
}

main()
