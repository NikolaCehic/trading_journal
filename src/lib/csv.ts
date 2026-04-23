export type CsvColumn<T> = {
  header: string
  get: (row: T) => string | number | null | undefined
}

function escape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map(c => escape(c.header)).join(',')
  const body = rows
    .map(r => columns.map(c => escape(c.get(r))).join(','))
    .join('\n')
  return header + '\n' + body
}

export function downloadFile(name: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
