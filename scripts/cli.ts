#!/usr/bin/env tsx
import process from "node:process"
import { checkDatabases } from "../src/db"
import { exportLib } from "../src/export"
import { getLibs } from "../src/query"
import { targets } from "../shared/types"
import type { ExportFnProps, LibType, Range, SelectedLib, Target } from "../shared/types"

interface CliOptions {
  help: boolean
  list: boolean
  type: LibType
  range: Range
  selected: SelectedLib[]
  target: Target[]
  folderName: string
  exculedMemorized: boolean
  override: boolean
}

function usage() {
  return `墨墨词库命令行导出工具

用法:
  pnpm cli [选项]

数据库文件默认读取 ./database：
  - maimemo_base.db      必需，墨墨本地词库数据库
  - maimemo_cloud.db     可选，云词库/生词本数据库
  - ecdict_ultimate.db   导出 translation 时必需

选项:
  --list                     列出可导出的词库
  --type <base|cloud>        词库类型，默认 base
  --range <all|selected>     导出范围，默认 all
  --ids <1,2,3>              选中词库 ID，使用 selected 时必需
  --target <word,list,translation,anki>
                             导出目标，可逗号分隔，默认 word；anki 为分章节牌组并包含中文释义
  --folder <name>            exported 下的输出目录名，默认 cli
  --exclude-memorized        排除已背单词
  --override                 覆盖已存在文件
  -h, --help                 显示帮助

示例:
  pnpm cli --list
  pnpm cli --target word,list --folder windows-export --override
  pnpm cli --range selected --ids 1001,1002 --target translation --override
  pnpm cli --target anki --folder anki-export --override
`
}

function readValue(args: string[], index: number, name: string) {
  const value = args[index + 1]
  if (!value || value.startsWith("-"))
    throw new Error(`${name} 需要一个参数`)
  return value
}

function parseTargets(value: string): Target[] {
  const result = value.split(",").map(k => k.trim()).filter(Boolean)
  for (const target of result) {
    if (!targets.includes(target as Target))
      throw new Error(`不支持的导出目标: ${target}`)
  }
  return result as Target[]
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    list: false,
    type: "base",
    range: "all",
    selected: [],
    target: ["word"],
    folderName: "cli",
    exculedMemorized: false,
    override: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "-h" || arg === "--help") {
      options.help = true
    } else if (arg === "--list") {
      options.list = true
    } else if (arg === "--exclude-memorized") {
      options.exculedMemorized = true
    } else if (arg === "--override") {
      options.override = true
    } else if (arg === "--type") {
      const value = readValue(args, i, arg)
      if (value !== "base" && value !== "cloud") throw new Error("--type 只能是 base 或 cloud")
      options.type = value
      i++
    } else if (arg === "--range") {
      const value = readValue(args, i, arg)
      if (value !== "all" && value !== "selected") throw new Error("--range 只能是 all 或 selected")
      options.range = value
      i++
    } else if (arg === "--ids") {
      const value = readValue(args, i, arg)
      options.selected = value.split(",").map(k => k.trim()).filter(Boolean).map((id) => {
        const parsed = Number(id)
        if (!Number.isInteger(parsed)) throw new Error(`非法词库 ID: ${id}`)
        return { id: parsed, name: String(parsed) }
      })
      i++
    } else if (arg === "--target") {
      options.target = parseTargets(readValue(args, i, arg))
      i++
    } else if (arg === "--folder") {
      options.folderName = readValue(args, i, arg)
      i++
    } else {
      throw new Error(`未知参数: ${arg}`)
    }
  }

  return options
}

function assertDatabaseReady(options: CliOptions) {
  const status = checkDatabases()
  if (!status.maimemo_base?.status)
    throw new Error(`找不到可用的 maimemo_base.db: ${status.maimemo_base?.path}`)
  if (options.type === "cloud" && !status.maimemo_cloud?.status)
    throw new Error(`导出云词库需要 maimemo_cloud.db: ${status.maimemo_cloud?.path}`)
  if ((options.target.includes("translation") || options.target.includes("anki")) && !status.ecdict?.status)
    throw new Error(`导出中文释义需要 ecdict_ultimate.db: ${status.ecdict?.path}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }

  assertDatabaseReady(options)

  if (options.list) {
    const libs = getLibs(options.type)
    for (const lib of libs)
      console.log(`${lib.id}\t${lib.name}`)
    console.log(`共 ${libs.length} 个词库`)
    return
  }

  let selected = options.selected
  if (options.range === "selected") {
    if (!selected.length) throw new Error("--range selected 需要配合 --ids")
    const libMap = new Map(getLibs(options.type).map(lib => [lib.id, lib.name]))
    selected = selected.map(lib => ({ ...lib, name: libMap.get(lib.id) ?? lib.name }))
  }

  const exportOptions: ExportFnProps = {
    range: options.range,
    type: options.type,
    selected,
    options: {
      target: options.target,
      folderName: options.folderName,
      exculedMemorized: options.exculedMemorized,
      override: options.override,
    },
  }

  await exportLib({
    ...exportOptions,
    fnEvery: async (log) => {
      console.log(`[${log.completed}/${log.all}] ${log.status.join(" ")} ${log.name}，失败 ${log.failed}`)
      return false
    },
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
