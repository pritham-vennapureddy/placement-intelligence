export type CsvValue = string | number | boolean | null | undefined;

function escape(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Leading =, +, - or @ would run as a formula in Excel; prefix a quote. Negative numbers stay as they are.
  const safe = typeof value === "string" && /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Builds a CSV file from a header row and data rows and starts the download. */
export function downloadCsv(filename: string, header: string[], rows: CsvValue[][]) {
  const text = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  // The BOM lets Excel open UTF-8 names correctly.
  const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
