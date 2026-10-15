import { useMemo, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { exportForScript, makeSettingsBackup } from '@shared/pixai/library'
import {
  BACKUP_CATEGORIES,
  BACKUP_LABELS,
  backupSelection,
  makeTransferBackup,
  parseTransferBackup,
  prepareBackupImport,
  selectBackupLibrary,
  type TransferBackup,
  type ImportMode
} from '@shared/pixai/backup-transfer'
import type { PixaiStore } from './store'
import { ApiConnection } from './execution'
import { AppUpdates } from './updates'
import { BackupPicker } from './backup-picker'

export function BackupSettings({
  store,
  onImport
}: {
  store: PixaiStore
  onImport: () => void
}): React.JSX.Element {
  const { workspace, busy, revision } = store()
  const [preview, setPreview] = useState<{ transfer: TransferBackup; revision: number } | null>(
    null
  )
  const [importSelection, setImportSelection] = useState(backupSelection(false))
  const [exportSelection, setExportSelection] = useState(backupSelection())
  const [mode, setMode] = useState<ImportMode>('append')
  const fileRead = useRef(0)
  const [exportTarget, setExportTarget] = useState<'app' | 'script' | null>(null)
  const [notice, setNotice] = useState('')
  const available = preview ? { ...preview.transfer.selection } : backupSelection(false)
  if (preview)
    for (const key of BACKUP_CATEGORIES)
      available[key] ||= !!preview.transfer.backup.library[key]?.length
  const importResult = useMemo(() => {
    if (!preview) return null
    try {
      let id = 0
      return {
        value: prepareBackupImport(
          workspace.library,
          preview.transfer,
          importSelection,
          mode,
          () => `import-preview-${++id}`
        ),
        error: ''
      }
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : '가져올 자료를 확인해 주세요.'
      }
    }
  }, [preview, workspace.library, importSelection, mode])
  const selectedExport = useMemo(() => {
    try {
      return { value: selectBackupLibrary(workspace.library, exportSelection), error: '' }
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : '백업할 자료를 확인해 주세요.'
      }
    }
  }, [workspace.library, exportSelection])
  const dropped = exportForScript(workspace.library).dropped
  if (workspace.options.ui) dropped.keys.push('options.ui')
  const names: Record<string, string> = {
    sceneFolders: '씬 그룹',
    commonPresets: '공통문 세트 목록',
    'presets.commonPresetId': '프리셋의 공통문 세트 연결',
    'options.ui': '칸 비율·씬 보기·접힘 설정',
    sceneCards: '씬 카드',
    casts: '저장 출연',
    batchPlans: '일괄 예약 구성',
    'characters.defaultPresetId': '캐릭터 기본 프리셋 연결',
    'reservations.batch': '예약 묶음 표시',
    'presets.prompt': '프리셋 공통 포지·네거'
  }
  async function readFile(file?: File): Promise<void> {
    const reading = ++fileRead.current
    setPreview(null)
    setNotice('')
    if (!file) return
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error('설정 파일은 5MiB 이하만 불러올 수 있습니다.')
      const at = store.getState().revision
      const transfer = parseTransferBackup(await file.text())
      if (reading !== fileRead.current) return
      setImportSelection({ ...transfer.selection, options: false })
      setMode('append')
      setPreview({ transfer, revision: at })
    } catch (error) {
      if (reading !== fileRead.current) return
      setNotice(error instanceof Error ? error.message : '파일을 읽지 못했습니다.')
    }
  }
  function download(): void {
    if (!exportTarget) return
    try {
      const backup =
        exportTarget === 'app'
          ? makeTransferBackup(workspace.library, workspace.options, exportSelection, {
              appVersion: 'PixaiClackHelper',
              exportedAt: new Date().toISOString()
            })
          : makeSettingsBackup(
              workspace.library,
              workspace.options,
              { appVersion: 'PixAIS-batch-1', exportedAt: new Date().toISOString() },
              exportTarget
            )
      const link = document.createElement('a')
      // Compact JSON keeps the exported file inside the same 5MiB reader limit.
      const text = JSON.stringify(backup)
      if (new TextEncoder().encode(text).byteLength > 5 * 1024 * 1024)
        throw new Error('백업이 5MiB를 넘습니다. 내보낼 항목을 나눠 주세요.')
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      link.href = url
      link.download = `PixAIS-${exportTarget}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(`${exportTarget === 'app' ? '앱용' : '스크립트용'} 설정 백업을 내보냈습니다.`)
      setExportTarget(null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '백업을 만들지 못했습니다.')
    }
  }
  return (
    <div className="px-settings">
      <ApiConnection />
      <AppUpdates />
      <section className="px-pane">
        <h2>백업 가져오기</h2>
        <p>
          앱의 선택 백업과 기존 앱·스크립트 백업을 읽을 수 있습니다. 파일을 골라도 바로 적용되지는
          않습니다.
        </p>
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
            <BackupPicker
              library={preview.transfer.backup.library}
              value={importSelection}
              onChange={setImportSelection}
              available={available}
              disabled={busy}
            />
            <fieldset className="px-backup-picker" disabled={busy}>
              <legend>가져오기 방식</legend>
              <label className="px-check">
                <input
                  type="radio"
                  name="backup-mode"
                  checked={mode === 'append'}
                  onChange={() => setMode('append')}
                />
                기존 자료에 추가
              </label>
              <label className="px-check">
                <input
                  type="radio"
                  name="backup-mode"
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                />
                선택한 항목만 교체
              </label>
            </fieldset>
            <p>
              {mode === 'append'
                ? '같은 이름도 새 자료로 추가합니다. 원래 자료는 덮어쓰지 않습니다.'
                : '체크한 종류의 목록 전체와 해당 폴더를 교체합니다. 체크하지 않은 종류는 유지합니다.'}{' '}
              등록된 대기 작업은 유지합니다.
            </p>
            {mode === 'replace' && (
              <p className="px-backup-warning">
                교체 범위:{' '}
                {Object.keys(importSelection)
                  .filter((key) => importSelection[key as keyof typeof importSelection])
                  .map((key) => BACKUP_LABELS[key as keyof typeof importSelection])
                  .join(' · ') || '없음'}
                . 0개인 항목을 체크하면 해당 목록을 비웁니다.
              </p>
            )}
            {importSelection.options && (
              <p className="px-backup-warning">
                생성·화면 설정은 선택한 방식에 관계없이 파일의 설정으로 교체합니다. API 키와 이미지
                저장 폴더는 변경하지 않습니다.
              </p>
            )}
            {importResult?.value && (
              <>
                <dl className="px-backup-summary" aria-label="적용 후 자료 수">
                  {BACKUP_CATEGORIES.filter(
                    (key) => importSelection[key] || importResult.value!.dependencies[key]
                  ).map((key) => (
                    <div key={key}>
                      <dt>
                        {BACKUP_LABELS[key]}
                        {!importSelection[key] && ' (연결 자료)'}
                      </dt>
                      <dd>
                        {workspace.library[key]?.length ?? 0}개 →{' '}
                        {importResult.value!.library[key]?.length ?? 0}개
                      </dd>
                    </div>
                  ))}
                </dl>
                <p>
                  연결 때문에 함께 추가하는 자료:{' '}
                  {Object.entries(importResult.value.dependencies)
                    .map(
                      ([key, count]) =>
                        `${BACKUP_LABELS[key as keyof typeof importSelection]} ${count}개`
                    )
                    .join(' · ') || '없음'}
                </p>
                {importResult.value.warnings.map((message) => (
                  <p className="px-backup-warning" key={message}>
                    {message}
                  </p>
                ))}
              </>
            )}
            {importResult?.error && (
              <p role="alert" className="px-error">
                {importResult.error}
              </p>
            )}
            {revision !== preview.revision && (
              <p className="px-error">
                미리보기 후 자료가 바뀌었습니다. 파일을 다시 선택해 주세요.
              </p>
            )}
            <button
              className="px-primary"
              disabled={busy || revision !== preview.revision || !importResult?.value}
              onClick={() => {
                void store
                  .getState()
                  .importSelectedBackup(preview.transfer, importSelection, mode, preview.revision)
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
          앱용 백업은 아래에서 고른 종류만 담습니다. 폴더와 필요한 연결 자료는 함께 포함합니다. API
          키·저장 폴더·이미지 파일·등록된 대기 작업은 포함하지 않습니다.
        </p>
        <BackupPicker
          library={workspace.library}
          value={exportSelection}
          onChange={setExportSelection}
          disabled={busy}
        />
        <div className="px-toolbar">
          <button
            disabled={busy || !Object.values(exportSelection).some(Boolean)}
            onClick={() => setExportTarget('app')}
          >
            <Download size={16} />
            앱용 내보내기
          </button>
          <button disabled={busy} onClick={() => setExportTarget('script')}>
            <Download size={16} />
            스크립트용 내보내기
          </button>
        </div>
        <small>
          스크립트용은 호환성을 위해 기존 전체 백업 형식을 사용합니다. 위 선택 범위는 앱용에
          적용됩니다.
        </small>
        {exportTarget && (
          <div className="px-confirm">
            <h3>{exportTarget === 'app' ? '앱용' : '스크립트용'} 설정 백업</h3>
            {exportTarget === 'script' ? (
              <>
                <p>
                  추가 문구가 포함된 예약 {dropped.reservations}개를 제외합니다
                  {dropped.reservationsWithPresetText > 0 &&
                    ` (그중 프리셋 공통 문구가 든 예약 ${dropped.reservationsWithPresetText}개)`}
                  .
                </p>
                {dropped.presetsWithText.length > 0 && (
                  <p>
                    프리셋 {dropped.presetsWithText.map((name) => `「${name}」`).join(', ')}의 추가
                    문구와 공통문 세트 연결은 스크립트가 읽지 못해 빠집니다. 새 조합에는 기본
                    공통문이 적용됩니다
                    {dropped.combinationsWithPresetText > 0 &&
                      ` (이 프리셋을 쓰는 최근 조합·즐겨찾기 ${dropped.combinationsWithPresetText}개도 연결 문구 없이 불러와집니다)`}
                    .
                  </p>
                )}
                <p>
                  빠지는 항목: {dropped.keys.map((key) => names[key] ?? key).join(', ') || '없음'}
                </p>
                <small>앱의 원본은 그대로 보관됩니다.</small>
              </>
            ) : (
              <>
                <p>
                  선택한 항목:{' '}
                  {Object.keys(exportSelection)
                    .filter((key) => exportSelection[key as keyof typeof exportSelection])
                    .map((key) => BACKUP_LABELS[key as keyof typeof exportSelection])
                    .join(' · ')}
                </p>
                <p>
                  연결 자료 추가:{' '}
                  {Object.entries(selectedExport.value?.dependencies ?? {})
                    .map(
                      ([key, count]) =>
                        `${BACKUP_LABELS[key as keyof typeof exportSelection]} ${count}개`
                    )
                    .join(' · ') || '없음'}
                </p>
                {selectedExport.error && <p className="px-error">{selectedExport.error}</p>}
                <small>
                  선택 백업은 이 기능이 있는 앱에서 불러와 주세요. 예전 앱과 스크립트는 선택 백업
                  형식을 읽지 못합니다.
                </small>
              </>
            )}
            <button
              className="px-primary"
              onClick={download}
              disabled={
                busy ||
                (exportTarget === 'app' &&
                  (!selectedExport.value || !Object.values(exportSelection).some(Boolean)))
              }
            >
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
