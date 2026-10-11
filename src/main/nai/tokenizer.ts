import { app } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * T5 unigram 토크나이저 — V4/4.5 프롬프트 토큰 카운트용 (한도 512).
 *
 * NAI 웹 번들의 자체 JS 구현을 미러링한다 (resources/t5_tokenizer.json =
 * novelai.net/tokenizer/compressed/t5_tokenizer.def 해제본):
 * - normalizer: 웹은 Precompiled charsmap을 "무시"하고 identity — 동일하게 함
 * - pre-tokenize: 공백 분할 → 각 조각 앞에 ▁ (Metaspace, add_prefix_space)
 * - encode 전에 웹과 동일하게 가중치 문자 []{} 제거
 * - 결과에 EOS 1토큰 포함 (웹 카운트 방식)
 */

interface TokenizerDef {
  model: { vocab: [string, number][]; unk_id: number }
}

interface Vocab {
  pieces: Map<string, { id: number; score: number }>
  maxPieceLength: number
  unkScore: number
}

let vocab: Vocab | null = null

function load(): Vocab {
  if (vocab) return vocab
  const def = JSON.parse(
    readFileSync(join(app.getAppPath(), 'resources', 't5_tokenizer.json'), 'utf-8')
  ) as TokenizerDef

  const pieces = new Map<string, { id: number; score: number }>()
  let maxPieceLength = 0
  let minScore = Infinity
  def.model.vocab.forEach(([piece, score], id) => {
    pieces.set(piece, { id, score })
    maxPieceLength = Math.max(maxPieceLength, piece.length)
    if (score < minScore) minScore = score
  })
  vocab = { pieces, maxPieceLength, unkScore: minScore - 10 }
  return vocab
}

/** sentencepiece unigram Viterbi — 한 조각(▁포함)을 최적 분할했을 때의 토큰 수 */
function viterbiCount(piece: string, v: Vocab): number {
  const n = piece.length
  // best[i] = [0,i) 구간 최적 (score, tokenCount)
  const bestScore = new Float64Array(n + 1).fill(-Infinity)
  const bestCount = new Int32Array(n + 1)
  bestScore[0] = 0
  for (let i = 0; i < n; i++) {
    if (bestScore[i] === -Infinity) continue
    const maxLen = Math.min(v.maxPieceLength, n - i)
    let matched = false
    for (let len = 1; len <= maxLen; len++) {
      const sub = piece.slice(i, i + len)
      const entry = v.pieces.get(sub)
      if (!entry) continue
      matched = true
      const score = bestScore[i] + entry.score
      if (score > bestScore[i + len]) {
        bestScore[i + len] = score
        bestCount[i + len] = bestCount[i] + 1
      }
    }
    if (!matched) {
      // unk 1글자 소비 (sentencepiece unk 처리와 동일 취지)
      const score = bestScore[i] + v.unkScore
      if (score > bestScore[i + 1]) {
        bestScore[i + 1] = score
        bestCount[i + 1] = bestCount[i] + 1
      }
    }
  }
  return bestCount[n]
}

/**
 * 웹과 동일한 카운트: []{} 및 수치 가중치(N:: / ::) 제거 → 공백 분할 → ▁조각 unigram → +EOS(1)
 * (전처리 정규식은 NAI 웹 encode()에서 그대로 — 원본 코드와 카운트 일치 검증 완료)
 */
export function countTokens(text: string): number {
  const v = load()
  const cleaned = text.replace(/[[\]{}]/g, '').replace(/-?\d*\.?\d*::/g, '')
  const parts = cleaned.split(/\s+/).filter((p) => p.length > 0)
  let total = 1 // EOS
  for (const part of parts) {
    total += viterbiCount('▁' + part, v)
  }
  return total
}
