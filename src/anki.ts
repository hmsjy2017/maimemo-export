import { Buffer } from "node:buffer"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "libsql"
import type { Word } from "@/types"

const MODEL_ID = 1700000000000
const FIELD_SEPARATOR = String.fromCharCode(31)
const CSS = ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }"

function normalizeDeckName(value: string) {
  return [...value].map(char => char === "\\" || char === "\t" || char === "\r" || char === "\n" ? " " : char).join("").replace(/::/g, "：：").trim() || "墨墨词库"
}
function checksum(value: string) {
  let hash = 0
  for (const char of value) hash = (Math.imul(31, hash) + char.charCodeAt(0)) | 0
  return Math.abs(hash)
}

function ankiTimestamp() {
  return Math.floor(Date.now() / 1000)
}

function ankiJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
}

function field(value: string) {
  return [...value].map(char => char.charCodeAt(0) === 31 || char === "\r" || char === "\n" ? " " : char).join("").trim()
}

function guid(word: Word, index: number) {
  return Buffer.from(`${word.word}:${word.list ?? ""}:${index}`).toString("base64url").slice(0, 10)
}

function crc32(data: Buffer) {
  let crc = 0xFFFFFFFF
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980)
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = (year - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate()
  return { time, day }
}

function zip(files: { name: string, data: Buffer }[]) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  const { time, day } = dosDateTime()

  for (const file of files) {
    const name = Buffer.from(file.name)
    const crc = crc32(file.data)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034B50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(time, 10)
    localHeader.writeUInt16LE(day, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(file.data.length, 18)
    localHeader.writeUInt32LE(file.data.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, name, file.data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014B50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(time, 12)
    centralHeader.writeUInt16LE(day, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(file.data.length, 20)
    centralHeader.writeUInt32LE(file.data.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)
    offset += localHeader.length + name.length + file.data.length
  }

  const centralOffset = offset
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralDirectory, end])
}

export async function createAnkiApkg(words: Word[], deckName = "墨墨词库") {
  const dir = await mkdtemp(join(tmpdir(), "maimemo-anki-"))
  const dbPath = join(dir, "collection.anki2")
  const now = ankiTimestamp()
  const baseDeckName = normalizeDeckName(deckName)
  const baseDeckId = checksum(baseDeckName) + 1
  const deckIds = new Map<string, number>([[baseDeckName, baseDeckId]])
  const notes = words.map((word, index) => {
    const chapter = word.list ? normalizeDeckName(word.list) : ""
    const fullDeckName = chapter ? `${baseDeckName}::${chapter}` : baseDeckName
    if (!deckIds.has(fullDeckName)) deckIds.set(fullDeckName, checksum(fullDeckName) + deckIds.size + 1)
    return { word, index, deckName: fullDeckName, deckId: deckIds.get(fullDeckName)! }
  })
  const decks = Object.fromEntries([...deckIds].map(([name, id]) => [id, { id, mod: now, name, usn: 0, collapsed: false, browserCollapsed: false, desc: "", dyn: 0, extendNew: 10, extendRev: 50, conf: 1 }]))
  const models = {
    [MODEL_ID]: {
      id: MODEL_ID,
      name: "Maimemo Basic",
      type: 0,
      mod: now,
      usn: 0,
      sortf: 0,
      did: baseDeckId,
      css: CSS,
      flds: [
        { name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20 },
        { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20 },
      ],
      tmpls: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr id=answer>{{Back}}", did: null, bqfmt: "", bafmt: "" }],
      req: [[0, "any", [0]]],
      tags: [],
      latexPre: "\\documentclass[12pt]{article}",
      latexPost: "\\end{document}",
    },
  }

  const db = new Database(dbPath)
  let closed = false
  try {
    db.exec("PRAGMA legacy_file_format = ON")
    db.exec("CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null)")
    db.exec("CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld text not null, csum integer not null, flags integer not null, data text not null)")
    db.exec("CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null)")
    db.exec("CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null)")
    db.prepare("INSERT INTO col VALUES(1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)").run(now, now * 1000, now * 1000, ankiJson({ nextPos: 1 }), ankiJson(models), ankiJson(decks), ankiJson({ 1: { id: 1, name: "Default", replayq: true, lapse: {}, rev: {}, timer: 0, maxTaken: 60, usn: 0, new: {}, mod: now, autoplay: true } }), ankiJson({}))

    const insertNote = db.prepare("INSERT INTO notes VALUES(?, ?, ?, ?, 0, '', ?, ?, ?, 0, '')")
    const insertCard = db.prepare("INSERT INTO cards VALUES(?, ?, ?, 0, ?, 0, 0, 0, ?, 0, 2500, 0, 0, 0, 0, 0, 0, '')")
    for (const { word, index, deckId } of notes) {
      const nid = now * 1000 + index + 1
      const cid = nid + 100000
      const front = field(word.word)
      insertNote.run(nid, guid(word, index), MODEL_ID, now, `${front}${FIELD_SEPARATOR}${field(word.translation ?? "")}`, front, checksum(word.word))
      insertCard.run(cid, nid, deckId, now, index + 1)
    }
    db.close()
    closed = true

    return zip([
      { name: "collection.anki2", data: await readFile(dbPath) },
      { name: "media", data: Buffer.from("{}") },
    ])
  } finally {
    if (!closed) db.close()
    await rm(dir, { recursive: true, force: true })
  }
}
