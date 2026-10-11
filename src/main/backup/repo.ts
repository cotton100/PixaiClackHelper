import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getDb } from '../db'
import { getSetting, setSetting } from '../db/settings'
import { imagesRoot } from '../images/storage'

/**
 * NAIS3 데이터 내보내기/가져오기 (백업/이전).
 * 라이브러리(캐릭터·조각·바이브·캐릭레퍼·폴더)·씬·프롬프트 프리셋·현재 프롬프트를 JSON으로.
 * BLOB(썸네일)은 base64로, 바이브/캐릭레퍼의 실제 이미지 파일은 __image(base64)로 인라인해 이식성 확보.
 */

// 내보낼 테이블 (히스토리 images·anlas_log·settings는 제외 — 기기별/대용량)
const TABLES = [
  'character_folders',
  'character_prompts',
  'fragment_folders',
  'fragments',
  'vibe_folders',
  'vibe_images',
  'charref_folders',
  'charref_images',
  'scene_presets',
  'gen_scenes',
  'prompt_presets'
] as const

// file_path의 실제 이미지를 인라인해야 하는 테이블
const IMAGE_TABLES = new Set(['vibe_images', 'charref_images'])

type Row = Record<string, unknown>

function encodeValue(v: unknown): unknown {
  if (Buffer.isBuffer(v)) return { __blob: v.toString('base64') }
  return v
}
function decodeValue(v: unknown): unknown {
  if (v && typeof v === 'object' && '__blob' in (v as object)) {
    return Buffer.from((v as { __blob: string }).__blob, 'base64')
  }
  return v
}

export function exportAll(): Record<string, unknown> {
  const db = getDb()
  const tables: Record<string, Row[]> = {}
  for (const t of TABLES) {
    const rows = db.prepare(`SELECT * FROM ${t}`).all() as Row[]
    tables[t] = rows.map((r) => {
      const out: Row = {}
      for (const [k, v] of Object.entries(r)) out[k] = encodeValue(v)
      // 바이브/캐릭레퍼 이미지 파일 인라인 (이식성)
      if (IMAGE_TABLES.has(t) && typeof r.file_path === 'string') {
        try {
          out.__image = readFileSync(r.file_path).toString('base64')
        } catch {
          out.__image = null // 파일 없으면 스킵
        }
      }
      return out
    })
  }
  return {
    _app: 'NAIS3',
    _version: 1,
    mainParams: getSetting('main_params') || null,
    tables
  }
}

/** 가져오기 — replace: 기존 라이브러리를 지우고 교체(복원). false면 미구현(현재 replace만). */
export function importAll(data: Record<string, unknown>): { imported: number } {
  const tables = (data.tables ?? {}) as Record<string, Row[]>
  const db = getDb()
  const libDir = join(imagesRoot(), '_imported')
  mkdirSync(libDir, { recursive: true })

  let imported = 0
  const tx = db.transaction(() => {
    // 자식→부모 순서 무관하게, 전체 교체: 먼저 모두 비우고(역순) 다시 삽입
    for (const t of [...TABLES].reverse()) db.prepare(`DELETE FROM ${t}`).run()

    for (const t of TABLES) {
      const rows = tables[t]
      if (!Array.isArray(rows)) continue
      for (const raw of rows) {
        const row: Row = {}
        for (const [k, v] of Object.entries(raw)) {
          if (k === '__image') continue
          row[k] = decodeValue(v)
        }
        // 이미지 파일 복원 → 새 경로로 재기록
        if (IMAGE_TABLES.has(t) && typeof raw.__image === 'string') {
          const ext = String(row.file_path ?? '').endsWith('.webp') ? 'webp' : 'png'
          const fp = join(libDir, `${t}_${row.id}_${Date.now()}.${ext}`)
          writeFileSync(fp, Buffer.from(raw.__image, 'base64'))
          row.file_path = fp
        }
        const cols = Object.keys(row)
        const placeholders = cols.map(() => '?').join(', ')
        db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${placeholders})`).run(
          ...cols.map((c) => row[c] as never)
        )
        imported++
      }
    }
    if (typeof data.mainParams === 'string') setSetting('main_params', data.mainParams)
  })
  tx()
  return { imported }
}
