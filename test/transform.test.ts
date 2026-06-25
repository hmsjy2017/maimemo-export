import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { createAnkiApkg } from "../src/anki"
import { transform } from "../src/transform"

const words = [
  { word: "apple", list: "Chapter 1", translation: "n. 苹果" },
  { word: "banana", list: "Chapter 2", translation: "n. 香蕉" },
]

describe("transform", () => {
  it("exports an Anki import deck split by chapter with Chinese translations", () => {
    expect(transform(words, "anki", "My Book")).toBe([
      "#separator:tab",
      "#html:false",
      "#columns:Front Back Deck",
      ["\"apple\"", "\"n. 苹果\"", "\"My Book::Chapter 1\""].join("\t"),
      ["\"banana\"", "\"n. 香蕉\"", "\"My Book::Chapter 2\""].join("\t"),
    ].join("\n"))
  })
})

const execFileAsync = promisify(execFile)

describe("createAnkiApkg", () => {
  it("exports an importable apkg package", async () => {
    const apkg = await createAnkiApkg(words, "My Book")
    const dir = await mkdtemp(join(tmpdir(), "maimemo-apkg-test-"))
    try {
      const apkgPath = join(dir, "deck.apkg")
      await writeFile(apkgPath, apkg)
      const { stdout } = await execFileAsync("zipinfo", ["-1", apkgPath])
      expect(stdout.split("\n").filter(Boolean).sort()).toEqual(["collection.anki2", "media"])

      await execFileAsync("unzip", ["-q", apkgPath, "collection.anki2", "-d", dir])
      const { stdout: decksJson } = await execFileAsync("sqlite3", [join(dir, "collection.anki2"), "select decks from col"])
      const decks = JSON.parse(decksJson)
      for (const deck of Object.values<Record<string, unknown>>(decks)) {
        expect(deck).toMatchObject({
          lrnToday: [0, 0],
          revToday: [0, 0],
          newToday: [0, 0],
          timeToday: [0, 0],
        })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
