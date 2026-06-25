import { stringify } from "csv-stringify/sync"
import type { Target, Word } from "@/types"

function normalizeDeckName(value: string) {
  return value.replace(/[\\\t\r\n]/g, " ").trim() || "墨墨词库"
}

function toAnkiDeckName(...values: string[]) {
  return values
    .flatMap(value => normalizeDeckName(value).split("::"))
    .map(part => normalizeDeckName(part))
    .filter(Boolean)
    .join("::")
}

export function transform(words: Word[], traget: Target, deckName?: string): string {
  if (traget === "list") {
    let list = words[0]?.list
    if (list) {
      return words
        .reduce(
          (acc, cur) => {
            if (cur.list !== list) {
              list = cur.list!
              acc.push(`#${list}`)
            }
            acc.push(cur.word)
            return acc
          },
          [`#${list}`],
        )
        .join("\n")
    }
  } else if (traget === "translation") {
    return stringify(words.map(k => ({
      word: k.word,
      translation: k.translation,
    })))
  } else if (traget === "anki") {
    return [
      "#separator:tab",
      "#html:false",
      "#columns:Front Back Deck",
      ...words.map((k) => {
        const deck = k.list ? toAnkiDeckName(deckName ?? "墨墨词库", k.list) : toAnkiDeckName(deckName ?? "墨墨词库")
        return stringify([[k.word, k.translation ?? "", deck]], { delimiter: "\t", record_delimiter: "" })
      }),
    ].join("\n")
  }
  // target = word
  return words.map(obj => obj.word).join("\n")
}
