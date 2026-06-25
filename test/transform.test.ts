import type { Buffer } from "node:buffer"
import { describe, expect, it } from "vitest"
import { createAnkiApkg } from "../src/anki"
import { transform } from "../src/transform"

const words = [
  { word: "apple", list: "Chapter 1", translation: "n. 苹果" },
  { word: "banana", list: "Chapter 2", translation: "n. 香蕉" },
]

function zipEntryNames(zip: Buffer) {
  const names: string[] = []
  let offset = 0
  while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034B50) {
    const nameLength = zip.readUInt16LE(offset + 26)
    const extraLength = zip.readUInt16LE(offset + 28)
    const compressedSize = zip.readUInt32LE(offset + 18)
    names.push(zip.subarray(offset + 30, offset + 30 + nameLength).toString())
    offset += 30 + nameLength + extraLength + compressedSize
  }
  return names
}

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

describe("createAnkiApkg", () => {
  it("exports an importable apkg package", async () => {
    const apkg = await createAnkiApkg(words, "My Book")
    expect(zipEntryNames(apkg).sort()).toEqual(["collection.anki2", "media"])
  })
})
