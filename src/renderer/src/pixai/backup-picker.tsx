import {
  BACKUP_CATEGORIES,
  BACKUP_LABELS,
  type BackupSelection
} from '@shared/pixai/backup-transfer'
import type { Library } from '@shared/pixai/library'

export function BackupPicker({
  library,
  value,
  onChange,
  disabled,
  available
}: {
  library: Library
  value: BackupSelection
  onChange: (value: BackupSelection) => void
  disabled?: boolean
  available?: BackupSelection
}): React.JSX.Element {
  return (
    <fieldset className="px-backup-picker" disabled={disabled}>
      <legend>포함할 항목</legend>
      <div className="px-toolbar">
        <button
          type="button"
          onClick={() =>
            onChange(
              Object.fromEntries(
                Object.keys(value).map((key) => [
                  key,
                  available ? available[key as keyof BackupSelection] : true
                ])
              ) as BackupSelection
            )
          }
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
      <div className="px-backup-grid">
        {([...BACKUP_CATEGORIES, 'common', 'options'] as const).map((key) => (
          <label className="px-check" key={key}>
            <input
              type="checkbox"
              checked={value[key]}
              disabled={available && !available[key]}
              onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
            />
            <span>
              {BACKUP_LABELS[key]}
              {key !== 'common' && key !== 'options' ? ` · ${library[key]?.length ?? 0}개` : ''}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
