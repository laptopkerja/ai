import fs from 'node:fs/promises'
import path from 'node:path'

const REPORT_DIR = path.resolve(process.cwd(), 'reports', 'platform-17-audit')
const REPORT_JSON_FILE = path.join(REPORT_DIR, 'latest.json')
const REPORT_CSV_FILE = path.join(REPORT_DIR, 'latest.csv')
const REPORT_MD_FILE = path.join(REPORT_DIR, 'latest.md')

function safeString(value) {
  return String(value || '').trim()
}

function csvEscape(value) {
  const text = safeString(value)
  if (!text.includes(',') && !text.includes('"') && !text.includes('\n')) return text
  return `"${text.replace(/"/g, '""')}"`
}

function toChecklistMap(checklist) {
  const map = {}
  const list = Array.isArray(checklist) ? checklist : []
  list.forEach((item) => {
    map[safeString(item?.id)] = item
  })
  return map
}

async function readJsonReport() {
  const raw = await fs.readFile(REPORT_JSON_FILE, 'utf8')
  return JSON.parse(raw)
}

async function writeCsv(report) {
  const rows = Array.isArray(report?.platforms) ? report.platforms : []
  const headers = [
    'platform',
    'verdict',
    'failed_items',
    'allowed_lengths',
    'contract_available',
    'allowed_length_valid',
    'hook_contract',
    'description_contract',
    'hashtag_contract',
    'narrator_contract',
    'audio_contract',
    'decision_consistency',
    'final_score_formula',
    'api_generate_quality_meta',
    'real_performance_ingest',
    'real_performance_pass'
  ]
  const lines = [headers.join(',')]

  rows.forEach((row) => {
    const check = toChecklistMap(row?.checklist)
    const toFlag = (id) => (check[id]?.pass === true ? 'PASS' : 'FAIL')
    const values = [
      row?.platform,
      row?.verdict,
      Array.isArray(row?.failedItems) ? row.failedItems.join('|') : '',
      Array.isArray(row?.allowedLengths) ? row.allowedLengths.join('|') : '',
      toFlag('contract_available'),
      toFlag('allowed_length_valid'),
      toFlag('hook_contract'),
      toFlag('description_contract'),
      toFlag('hashtag_contract'),
      toFlag('narrator_contract'),
      toFlag('audio_contract'),
      toFlag('decision_consistency'),
      toFlag('final_score_formula'),
      toFlag('api_generate_quality_meta'),
      toFlag('real_performance_ingest'),
      toFlag('real_performance_pass')
    ]
    lines.push(values.map(csvEscape).join(','))
  })

  await fs.writeFile(REPORT_CSV_FILE, `${lines.join('\n')}\n`, 'utf8')
}

function renderMarkdown(report) {
  const summary = report?.summary || {}
  const rows = Array.isArray(report?.platforms) ? report.platforms : []
  const lines = []
  lines.push('# Platform 17 Audit Report')
  lines.push('')
  lines.push(`- Generated at: ${safeString(report?.generatedAt)}`)
  lines.push(`- Audit version: ${safeString(report?.auditVersion)}`)
  lines.push(`- Verdict: ${safeString(summary?.verdict)} (${summary?.passPlatformCount}/${summary?.totalPlatformCount} PASS)`)
  lines.push('')
  lines.push('| Platform | Verdict | Failed Items |')
  lines.push('|---|---|---|')
  rows.forEach((row) => {
    const failed = Array.isArray(row?.failedItems) && row.failedItems.length
      ? row.failedItems.join(', ')
      : '-'
    lines.push(`| ${safeString(row?.platform)} | ${safeString(row?.verdict)} | ${failed} |`)
  })
  lines.push('')
  return `${lines.join('\n')}\n`
}

async function writeMarkdown(report) {
  await fs.writeFile(REPORT_MD_FILE, renderMarkdown(report), 'utf8')
}

async function main() {
  const report = await readJsonReport()
  await fs.mkdir(REPORT_DIR, { recursive: true })
  await writeCsv(report)
  await writeMarkdown(report)
  console.log(`CSV report saved: ${REPORT_CSV_FILE}`)
  console.log(`Markdown report saved: ${REPORT_MD_FILE}`)
}

main().catch((err) => {
  console.error(`export platform17 report failed: ${safeString(err?.message || err)}`)
  process.exitCode = 1
})
