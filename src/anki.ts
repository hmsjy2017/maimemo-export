import { Buffer } from "node:buffer"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { Word } from "@/types"

const execFileAsync = promisify(execFile)
const MODEL_ID = 1700000000000
const CSS = ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }"

function normalizeDeckName(value: string) {
  return value.replace(/[\\\t\r\n]/g, " ").replace(/::/g, "：：").trim() || "墨墨词库"
}

function checksum(value: string) {
  let hash = 0
  for (const char of value) hash = (Math.imul(31, hash) + char.charCodeAt(0)) | 0
  return Math.abs(hash)
}

function ankiTimestamp() {
  return Math.floor(Date.now() / 1000)
}

function sqliteString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function ankiJson(value: unknown) {
  return sqliteString(JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026"))
}

function field(value: string) {
  return [...value].map(char => char.charCodeAt(0) === 31 || char === "\r" || char === "\n" ? " " : char).join("").trim()
}

function guid(word: Word, index: number) {
  return Buffer.from(`${word.word}:${word.list ?? ""}:${index}`).toString("base64url").slice(0, 10)
}

export async function createAnkiApkg(words: Word[], deckName = "墨墨词库") {
  const dir = await mkdtemp(join(tmpdir(), "maimemo-anki-"))
  const dbPath = join(dir, "collection.anki2")
  const mediaPath = join(dir, "media")
  const zipPath = join(dir, "deck.apkg")
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
  const decks = Object.fromEntries([...deckIds].map(([name, id]) => [id, {
    id,
    mod: now,
    name,
    usn: 0,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: false,
    browserCollapsed: false,
    desc: "",
    dyn: 0,
    extendNew: 10,
    extendRev: 50,
    conf: 1,
  }]))
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
  const statements = [
    "PRAGMA legacy_file_format = ON;",
    "CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);",
    "CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld text not null, csum integer not null, flags integer not null, data text not null);",
    "CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);",
    "CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);",
    "CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);",
    `INSERT INTO col VALUES(1, ${now}, ${now * 1000}, ${now * 1000}, 11, 0, 0, 0, ${ankiJson({ nextPos: 1 })}, ${ankiJson(models)}, ${ankiJson(decks)}, ${ankiJson({ 1: { id: 1, name: "Default", replayq: true, lapse: {}, rev: {}, timer: 0, maxTaken: 60, usn: 0, new: {}, mod: now, autoplay: true } })}, ${ankiJson({})});`,
    ...notes.flatMap(({ word, index, deckId }) => {
      const nid = now * 1000 + index + 1
      const cid = nid + 100000
      const flds = `${field(word.word)}\u001F${field(word.translation ?? "")}`
      return [
        `INSERT INTO notes VALUES(${nid}, ${sqliteString(guid(word, index))}, ${MODEL_ID}, ${now}, 0, '', ${sqliteString(flds)}, ${sqliteString(field(word.word))}, ${checksum(word.word)}, 0, '');`,
        `INSERT INTO cards VALUES(${cid}, ${nid}, ${deckId}, 0, ${now}, 0, 0, 0, ${index + 1}, 0, 2500, 0, 0, 0, 0, 0, 0, '');`,
      ]
    }),
  ]

  try {
    await writeFile(join(dir, "init.sql"), statements.join("\n"))
    await execFileAsync("sqlite3", [dbPath, `.read ${join(dir, "init.sql")}`])
    await writeFile(mediaPath, "{}")
    await execFileAsync("zip", ["-q", "-j", zipPath, dbPath, mediaPath])
    return await readFile(zipPath)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
