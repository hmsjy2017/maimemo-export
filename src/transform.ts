import { stringify } from "csv-stringify/sync"
import type { Target, Word } from "@/types"

function toAnkiDeckName(value: string) {
  return value.replace(/[\\\t\r\n]/g, " ").replace(/::/g, "：：").trim()
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
        const chapter = k.list ? `::${toAnkiDeckName(k.list)}` : ""
        return stringify([[k.word, k.translation ?? "", `${toAnkiDeckName(deckName ?? "墨墨词库")}${chapter}`]], { delimiter: "\t", record_delimiter: "" })
      }),
    ].join("\n")
  }
  // target = word
  return words.map(obj => obj.word).join("\n")
}
