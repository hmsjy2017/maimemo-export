import { describe, expect, it } from "vitest"
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
