import { describe, expect, it } from "vitest";

/** Mirror of escape rules used by downloadCsv — pure so we can pin them. */
function csvLine(cells: readonly string[]): string {
  return cells
    .map((cell) => {
      if (/[",\n\r]/.test(cell)) {
        return `"${cell.replaceAll('"', '""')}"`;
      }
      return cell;
    })
    .join(",");
}

describe("csvLine", () => {
  it("leaves plain cells alone", () => {
    expect(csvLine(["a", "b"])).toBe("a,b");
  });

  it("quotes cells with commas and escapes quotes", () => {
    expect(csvLine(['say "hi"', "1,2"])).toBe('"say ""hi""","1,2"');
  });
});
