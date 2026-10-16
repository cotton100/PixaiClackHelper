import {
  BACKUP_CATEGORIES,
  BACKUP_FOLDER_CATEGORIES,
  BACKUP_LABELS,
  backupFolderChoices,
  backupSelectionLabels,
  type BackupSelection,
  type BackupFolderCategory,
  type BackupFolderSelection
} from '@shared/pixai/backup-transfer'
import type { Library } from '@shared/pixai/library'
import './backup-picker.css'

/** 종류 체크(부모) 아래 폴더 체크(자식). 접힌 제목에 선택 수가 남는다. */
export function BackupPicker({
  library,
  value,
  onChange,
  disabled,
  available,
  folderSelection = {},
  onFolderChange,
  folderLimits = {}
}: {
  library: Library
  value: BackupSelection
  onChange: (value: BackupSelection) => void
  disabled?: boolean
  available?: BackupSelection
  folderSelection?: BackupFolderSelection
  onFolderChange?: (value: BackupFolderSelection) => void
  folderLimits?: BackupFolderSelection
}): React.JSX.Element {
  const summary = (() => {
    try {
      return backupSelectionLabels(library, value, folderSelection).join(' · ')
    } catch {
      return ''
    }
  })()
  return (
    <fieldset className="px-backup-picker" disabled={disabled}>
      <legend>포함할 항목</legend>
      <div className="px-backup-picker-head">
        <div className="px-toolbar">
          <button
            type="button"
            onClick={() => {
              onFolderChange?.({ ...folderLimits })
              onChange(
                Object.fromEntries(
                  Object.keys(value).map((key) => [
                    key,
                    available ? available[key as keyof BackupSelection] : true
                  ])
                ) as BackupSelection
              )
            }}
          >
            전체 선택
          </button>
          <button
            type="button"
            onClick={() =>
              onChange(
                Object.fromEntries(Object.keys(value).map((key) => [key, false])) as BackupSelection
              )
            }
          >
            선택 해제
          </button>
        </div>
        <small className="px-backup-picker-summary" aria-live="polite">
          {summary ? `선택: ${summary}` : '선택한 항목 없음'}
        </small>
      </div>
      <div className="px-backup-grid">
        {([...BACKUP_CATEGORIES, 'common', 'options'] as const).map((key) => {
          const category = key as BackupFolderCategory
          const hasFolders = BACKUP_FOLDER_CATEGORIES.includes(category) && !!onFolderChange
          const scope = folderSelection[category]
          const limit = folderLimits[category]
          const choices = hasFolders
            ? backupFolderChoices(library, category).filter(
                (folder) => !limit || limit.includes(folder.id)
              )
            : []
          const chosen = choices.filter((folder) => !scope || scope.includes(folder.id))
          const chosenItems = chosen.reduce((sum, folder) => sum + folder.count, 0)
          const unavailable = !!available && !available[key]
          return (
            <div
              className={`px-backup-category${value[key] ? ' is-on' : ''}`}
              key={key}
              data-folders={hasFolders && value[key] ? 'true' : undefined}
            >
              <label className="px-check">
                <input
                  type="checkbox"
                  checked={value[key]}
                  disabled={unavailable}
                  onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
                />
                <span>
                  {BACKUP_LABELS[key]}
                  {key !== 'common' && key !== 'options' ? ` · ${library[key]?.length ?? 0}개` : ''}
                </span>
              </label>
              {unavailable && <small className="px-backup-note">파일에 없음</small>}
              {hasFolders && value[key] && (
                <details className="px-backup-folders" open>
                  <summary>
                    <span>
                      {scope
                        ? `폴더 ${chosen.length}/${choices.length} 선택 · ${chosenItems}개`
                        : limit
                          ? `백업에 담긴 폴더 전체 · ${chosenItems}개`
                          : `전체 폴더 · ${chosenItems}개`}
                    </span>
                    {scope && chosen.length > 0 && (
                      <small>{chosen.map((folder) => folder.name).join(', ')}</small>
                    )}
                  </summary>
                  <div className="px-backup-folder-list">
                    <label className="px-check px-backup-folder-all">
                      <input
                        type="checkbox"
                        checked={
                          limit ? !!scope && limit.every((id) => scope.includes(id)) : !scope
                        }
                        onChange={(event) => {
                          const next = { ...folderSelection }
                          if (event.target.checked && !limit) delete next[category]
                          else next[category] = event.target.checked ? [...limit!] : []
                          onFolderChange!(next)
                        }}
                      />
                      {limit ? '백업에 담긴 폴더 전체' : '전체 폴더'}
                    </label>
                    {choices.map((folder) => (
                      <label className="px-check" key={folder.id}>
                        <input
                          type="checkbox"
                          checked={!scope || scope.includes(folder.id)}
                          onChange={(event) => {
                            const selected = scope ?? choices.map((x) => x.id)
                            onFolderChange!({
                              ...folderSelection,
                              [category]: event.target.checked
                                ? [...selected, folder.id]
                                : selected.filter((id) => id !== folder.id)
                            })
                          }}
                        />
                        <span>
                          {folder.name} · {folder.count}개
                        </span>
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
