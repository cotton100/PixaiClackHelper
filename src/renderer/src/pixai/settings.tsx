import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import {
  exportForScript,
  makeSettingsBackup,
  parseSettingsBackup,
  type SettingsBackup
} from '@shared/pixai/library'
import type { PixaiStore } from './store'
import { ApiConnection } from './execution'
import { AppUpdates } from './updates'

export function BackupSettings({
  store,
  onImport
}: {
  store: PixaiStore
  onImport: () => void
}): React.JSX.Element {
  const { workspace, busy, revision } = store()
  const [preview, setPreview] = useState<{ backup: SettingsBackup; revision: number } | null>(null)
  const [exportTarget, setExportTarget] = useState<'app' | 'script' | null>(null)
  const [notice, setNotice] = useState('')
  const dropped = exportForScript(workspace.library).dropped
  const names: Record<string, string> = {
    sceneFolders: '씬 모음',
    sceneCards: '씬 카드',
    casts: '저장 출연',
    batchPlans: '일괄 예약 구성',
    'characters.defaultPresetId': '캐릭터 기본 프리셋 연결',
    'reservations.batch': '예약 묶음 표시'
  }
  async function readFile(file?: File): Promise<void> {
    setPreview(null)
    setNotice('')
    if (!file) return
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error('설정 파일은 5MiB 이하만 불러올 수 있습니다.')
      const at = store.getState().revision
      const backup = parseSettingsBackup(await file.text())
      setPreview({ backup, revision: at })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '파일을 읽지 못했습니다.')
    }
  }
  function download(): void {
    if (!exportTarget) return
    const backup = makeSettingsBackup(
      workspace.library,
      workspace.options,
      { appVersion: 'PixAIS-batch-1', exportedAt: new Date().toISOString() },
      exportTarget
    )
    const link = document.createElement('a')
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    )
    link.href = url
    link.download = `PixAIS-${exportTarget}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice(`${exportTarget === 'app' ? '앱용' : '스크립트용'} 설정 백업을 내보냈습니다.`)
    setExportTarget(null)
  }
  return (
    <div className="px-settings">
      <ApiConnection />
      <AppUpdates />
      <section className="px-pane">
        <h2>백업 가져오기</h2>
        <p>PixAI 유저스크립트의 설정 백업을 가져올 수 있습니다.</p>
        <label className="px-file">
          <Upload size={18} />
          설정 백업 파일 선택
          <input
            type="file"
            accept=".json,application/json"
            aria-label="설정 백업 파일"
            disabled={busy}
            onChange={(event) => {
              void readFile(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </label>
        {preview && (
          <div className="px-confirm">
            <h3>가져올 자료</h3>
            <dl className="px-counts">
              {(
                [
                  ['프리셋', preview.backup.library.presets.length],
                  ['캐릭터', preview.backup.library.characters.length],
                  ['청크', preview.backup.library.scenes.length],
                  ['예약', preview.backup.library.reservations.length],
                  ['씬', preview.backup.library.sceneCards?.length ?? 0],
                  ['출연', preview.backup.library.casts?.length ?? 0]
                ] as const
              ).map(([label, count]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{count}개</dd>
                </div>
              ))}
            </dl>
            <p>
              현재 라이브러리와 생성 옵션을 이 파일로 교체합니다. 등록된 대기 작업은 유지합니다.
            </p>
            {revision !== preview.revision && (
              <p className="px-error">
                미리보기 후 자료가 바뀌었습니다. 파일을 다시 선택해 주세요.
              </p>
            )}
            <button
              className="px-primary"
              disabled={busy || revision !== preview.revision}
              onClick={() => {
                void store
                  .getState()
                  .importBackup(preview.backup, preview.revision)
                  .then(() => {
                    setPreview(null)
                    setNotice('설정 백업을 적용했습니다.')
                    onImport()
                  })
                  .catch((error) => setNotice(error.message))
              }}
            >
              확인한 백업 적용
            </button>
            <button onClick={() => setPreview(null)}>취소</button>
          </div>
        )}
      </section>
      <section className="px-pane">
        <h2>백업 내보내기</h2>
        <p>
          앱용에는 씬·출연·일괄 구성이 포함됩니다. 설정 백업에는 등록된 대기 작업을 넣지 않습니다.
        </p>
        <div className="px-toolbar">
          <button disabled={busy} onClick={() => setExportTarget('app')}>
            <Download size={16} />
            앱용 내보내기
          </button>
          <button disabled={busy} onClick={() => setExportTarget('script')}>
            <Download size={16} />
            스크립트용 내보내기
          </button>
        </div>
        {exportTarget && (
          <div className="px-confirm">
            <h3>{exportTarget === 'app' ? '앱용' : '스크립트용'} 설정 백업</h3>
            {exportTarget === 'script' ? (
              <>
                <p>추가 문구가 포함된 예약 {dropped.reservations}개를 제외합니다.</p>
                <p>
                  빠지는 항목: {dropped.keys.map((key) => names[key] ?? key).join(', ') || '없음'}
                </p>
                <small>앱의 원본은 그대로 보관됩니다.</small>
              </>
            ) : (
              <p>현재 재료·씬·출연·구성·예약을 포함합니다.</p>
            )}
            <button className="px-primary" onClick={download}>
              백업 파일 저장
            </button>
            <button onClick={() => setExportTarget(null)}>취소</button>
          </div>
        )}
      </section>
      {notice && (
        <p className="px-settings-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  )
}
