// ESC/POS command builders + text helpers. Ported from surevax-pos's
// js/escpos-printing.js, which is the field-tested implementation against
// 58/80mm thermal printers. Fixed-width 32-char output (LINE_CHARS_57).

const ESC = '\x1B'
const GS = '\x1D'

export const LINE_CHARS_57 = 32

export type PrintOptions = {
  align?: 'left' | 'center' | 'right'
  bold?: boolean
  underline?: boolean
  doubleHeight?: boolean
  doubleWidth?: boolean
  largeBold?: boolean
  charSize?: { width?: number; height?: number }
  lineFeed?: number
}

export const ESC_POS = {
  initialize: () => ESC + '@',
  alignLeft: () => ESC + 'a' + '\x00',
  alignCenter: () => ESC + 'a' + '\x01',
  alignRight: () => ESC + 'a' + '\x02',
  bold: (enable = true) => ESC + 'E' + (enable ? '\x01' : '\x00'),
  underline: (enable = true) => ESC + '-' + (enable ? '\x01' : '\x00'),
  doubleHeight: (enable = true) => ESC + '!' + (enable ? '\x10' : '\x00'),
  doubleWidth: (enable = true) => ESC + '!' + (enable ? '\x20' : '\x00'),
  largeBold: (enable = true) => ESC + '!' + (enable ? '\x30' : '\x00'),
  charSize: (width: number, height: number) => {
    const size = ((width & 0x07) << 4) | (height & 0x07)
    return GS + '!' + String.fromCharCode(size)
  },
  lineFeed: (lines = 1) => '\n'.repeat(lines),
  cutPaper: (partial = false) => GS + 'V' + (partial ? '\x01' : '\x00'),
  openDrawer: () => ESC + 'p' + '\x00' + '\x19' + '\x64',

  printLine(char = '-', width = LINE_CHARS_57) {
    let out = ''
    out += ESC + '!' + '\x00'
    out += this.bold(false)
    out += this.underline(false)
    out += this.charSize(0, 0)
    out += this.alignLeft()
    out += char.repeat(width) + '\n'
    return out
  },

  printText(text: string, options: PrintOptions = {}) {
    let output = ''
    // Hard reset modes before each line — avoids style bleed
    output += ESC + '!' + '\x00'
    output += this.bold(false)
    output += this.underline(false)
    output += this.charSize(0, 0)

    if (options.align === 'center') output += this.alignCenter()
    else if (options.align === 'right') output += this.alignRight()
    else output += this.alignLeft()

    if (options.bold) output += this.bold(true)
    if (options.underline) output += this.underline(true)
    if (options.doubleHeight) output += this.doubleHeight(true)
    if (options.doubleWidth) output += this.doubleWidth(true)
    if (options.largeBold) output += this.largeBold(true)
    if (options.charSize) {
      output += this.charSize(options.charSize.width ?? 0, options.charSize.height ?? 0)
    }

    output += text
    output += this.lineFeed(options.lineFeed ?? 1)
    return output
  },
}

// Many 58mm ESC/POS printers expect ASCII; map common Unicode to closest equivalents.
const REPLACEMENTS: Record<string, string> = {
  '₱': 'PHP ', // ₱
  '€': 'EUR ', // €
  '£': 'GBP ', // £
  '–': '-',
  '—': '-',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '•': '*',
  '°': ' deg ',
  '×': 'x',
}

export function sanitizeEscPosText(input: string | null | undefined): string {
  if (!input) return ''
  return input.replace(/[\u0080-\uFFFF]/g, (ch) => REPLACEMENTS[ch] ?? '?')
}

export function escposWrap(text: string, width = LINE_CHARS_57): string[] {
  const clean = sanitizeEscPosText(text)
  if (clean.length <= width) return [clean]
  const words = clean.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if ((line ? line.length + 1 : 0) + word.length <= width) {
      line += (line ? ' ' : '') + word
    } else {
      if (line) lines.push(line)
      if (word.length > width) {
        let start = 0
        while (start < word.length) {
          lines.push(word.slice(start, start + width))
          start += width
        }
        line = ''
      } else {
        line = word
      }
    }
  }
  if (line) lines.push(line)
  return lines
}

export function escposKV(left: string, right: string, width = LINE_CHARS_57): string {
  const l = sanitizeEscPosText(left)
  const r = sanitizeEscPosText(right)
  const maxLeft = Math.max(0, width - r.length)
  const lTrunc = l.length > maxLeft ? l.slice(0, maxLeft) : l
  const spaces = ' '.repeat(Math.max(0, width - (lTrunc.length + r.length)))
  return lTrunc + spaces + r
}

export function escposLabelOrBlank(
  label: string,
  value: string | null | undefined,
  width = LINE_CHARS_57,
): string[] {
  const cleanLabel = sanitizeEscPosText(label)
  const cleanValue = value ? sanitizeEscPosText(value) : ''
  if (!cleanValue) {
    const prefix = `${cleanLabel} `
    const pad = Math.max(0, width - prefix.length)
    return [prefix.slice(0, width) + '_'.repeat(pad)]
  }
  return escposWrap(`${cleanLabel} ${cleanValue}`, width)
}
