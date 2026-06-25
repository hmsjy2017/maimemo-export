import { join } from "node:path"
import fs from "fs-extra"
import { getLibWords, getLibs, translateAll } from "./query"
import { checkDatabases, databases } from "./db"
import { transform } from "./transform"
import { ensureTargetFolders } from "./dir"
import { targets } from "@/types"
import type { ExportFnProps, ExportLog, Target, TrafficLights } from "@/types"

export async function exportLib({ selected, range, type, options, fnEvery }: ExportFnProps & { fnEvery: (log: ExportLog) => Promise<boolean> }) {
  checkDatabases()
  const targetFolders = await ensureTargetFolders(options.folderName)

  let libs = selected
  if (range === "all") {
    libs = getLibs(type).map(k => ({
      id: k.id,
      name: k.name,
    }))
  }

  const initStatus = Object.fromEntries(targets.map(target => [target, "🟡"])) as Record<Target, TrafficLights>
  const score = {
    failed: 0,
    completed: 0,
    status: { ...initStatus },
  }

  for (const lib of libs) {
    const words = getLibWords({
      id: lib.id,
      type,
      exculedMemorized: options.exculedMemorized,
    })
    for (const target of options.target) {
      try {
        let path = join(targetFolders[target], `${lib.name}.txt`)
        if (target === "translation")
          path = join(targetFolders[target], `${lib.name}.csv`)
        else if (target === "anki")
          path = join(targetFolders[target], `${lib.name}.txt`)
        if (!options.override && fs.existsSync(path)) {
          score.status[target] = "🟡"
          continue
        }
        if (!words.length) throw new Error("No words found")

        let content = ""
        if (target === "translation" || target === "anki") {
          if (databases.ecdict?.db) {
            content = transform(translateAll(words), target, lib.name)
          } else {
            throw new Error("No ecdict database found")
          }
        } else {
          content = transform(words, target)
        }
        await fs.writeFile(path, content)
        score.status[target] = "🟢"
      } catch (e) {
        console.error(e)
        score.status[target] = "🔴"
      }
    }
    const status = targets.map(target => score.status[target])
    score.completed++
    if (status.includes("🔴")) score.failed++

    const log: ExportLog = {
      completed: score.completed,
      failed: score.failed,
      status,
      name: lib.name,
      all: libs.length,
      time: new Date().toLocaleString(),
    }
    if (await fnEvery(log)) return
    score.status = { ...initStatus }
  }
}
