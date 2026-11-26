'use client'

import type { ReactNode } from 'react'

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={`code-${index}`}
          className="rounded bg-white/10 px-1 py-0.5 font-mono text-[11px] text-sky-200"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={`bold-${index}`} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return part
  })
}

export function HouseAgentMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()

    if (!trimmed) {
      i += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        codeLines.push(lines[i]!)
        i += 1
      }
      i += 1
      blocks.push(
        <pre
          key={`pre-${i}`}
          className="overflow-x-auto rounded-lg border border-white/10 bg-black/50 p-2.5 font-mono text-[11px] leading-5 text-zinc-200"
        >
          {codeLines.join('\n')}
        </pre>,
      )
      continue
    }

    if (
      trimmed.startsWith('|') &&
      i + 1 < lines.length &&
      /^\|?[\s:|-]+\|/.test(lines[i + 1]!.trim())
    ) {
      const parseRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim())
      const header = parseRow(trimmed)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(parseRow(lines[i]!))
        i += 1
      }
      blocks.push(
        <div key={`table-${i}`} className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-white/5 text-zinc-300">
              <tr>
                {header.map((cell, idx) => (
                  <th
                    key={`th-${idx}`}
                    className="border-white/10 border-b px-2.5 py-1.5 font-medium"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={`tr-${rowIdx}`} className="border-white/5 border-t">
                  {header.map((_, colIdx) => (
                    <td key={`td-${colIdx}`} className="px-2.5 py-1.5 text-zinc-200">
                      {renderInline(row[colIdx] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (headingMatch) {
      const level = headingMatch[1]!.length
      const content = headingMatch[2]!
      blocks.push(
        <h3
          key={`h-${i}`}
          className={
            level === 1
              ? 'font-semibold text-sm text-white'
              : level === 2
                ? 'font-semibold text-xs text-sky-200'
                : 'font-medium text-xs text-zinc-200'
          }
        >
          {renderInline(content)}
        </h3>,
      )
      i += 1
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^[-*]\s+/, ''))
        i += 1
      }
      blocks.push(
        <ul key={`ul-${i}`} className="list-disc space-y-1 pl-4 text-xs leading-5 text-zinc-200">
          {items.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInline(item)}</li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^\d+\.\s+/, ''))
        i += 1
      }
      blocks.push(
        <ol key={`ol-${i}`} className="list-decimal space-y-1 pl-4 text-xs leading-5 text-zinc-200">
          {items.map((item, idx) => (
            <li key={`oli-${idx}`}>{renderInline(item)}</li>
          ))}
        </ol>,
      )
      continue
    }

    const paragraphLines: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !lines[i]!.trim().startsWith('#') &&
      !lines[i]!.trim().startsWith('```') &&
      !lines[i]!.trim().startsWith('|') &&
      !/^[-*]\s+/.test(lines[i]!.trim()) &&
      !/^\d+\.\s+/.test(lines[i]!.trim())
    ) {
      paragraphLines.push(lines[i]!)
      i += 1
    }
    blocks.push(
      <p key={`p-${i}`} className="whitespace-pre-wrap break-words text-xs leading-5 text-zinc-200">
        {renderInline(paragraphLines.join('\n'))}
      </p>,
    )
  }

  return <div className="space-y-2">{blocks}</div>
}
