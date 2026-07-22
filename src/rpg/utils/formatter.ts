// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/utils/formatter.ts — verbatim

export class RichFormatter {
  static header(title: string, icon = '🔧'): string {
    const line = '━'.repeat(40)
    return `\n${line}\n${icon}  **${title.toUpperCase()}**\n${line}\n`
  }
  static section(title: string): string {
    return `\n### ${title}\n`
  }
  static keyValue(data: Record<string, unknown>): string {
    let out = ''
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || v === null) continue
      out += `- **${k}:** ${typeof v === 'object' ? JSON.stringify(v) : String(v)}\n`
    }
    return out
  }
  static table(headers: string[], rows: (string | number)[][]): string {
    if (!rows.length) return '\n*No data*\n'
    const h = `| ${headers.join(' | ')} |`
    const s = `| ${headers.map(() => '---').join(' | ')} |`
    const d = rows.map((r) => `| ${r.join(' | ')} |`).join('\n')
    return `\n${h}\n${s}\n${d}\n`
  }
  static list(items: string[], ordered = false): string {
    if (!items.length) return '\n*None*\n'
    return '\n' + items.map((it, i) => (ordered ? `${i + 1}. ${it}` : `- ${it}`)).join('\n') + '\n'
  }
  static alert(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info'): string {
    const icons: Record<string, string> = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' }
    return `\n> ${icons[type]} **${type.toUpperCase()}**: ${message}\n`
  }
  static success(message: string): string {
    return this.alert(message, 'success')
  }
  static error(message: string): string {
    return this.alert(message, 'error')
  }
  static embedJson(data: unknown, tag = 'DATA'): string {
    return `\n<!-- ${tag}_JSON\n${JSON.stringify(data)}\n${tag}_JSON -->\n`
  }
  static code(content: string, language = ''): string {
    return `\n\`\`\`${language}\n${content}\n\`\`\`\n`
  }
}
