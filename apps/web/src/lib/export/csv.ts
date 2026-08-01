/**
 * Build a CSV string and trigger a browser download.
 * Deliberately client-side — no new API surface for Phase 2.
 */
export function downloadCsv(
  filename: string,
  headers: readonly string[],
  rows: readonly string[][],
) {
  const escapeCell = (cell: string) => {
    if (/[",\n\r]/.test(cell)) {
      return `"${cell.replaceAll('"', '""')}"`;
    }
    return cell;
  };
  const lines = [
    headers.map(escapeCell).join(","),
    ...rows.map((row) => row.map(escapeCell).join(",")),
  ];
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
