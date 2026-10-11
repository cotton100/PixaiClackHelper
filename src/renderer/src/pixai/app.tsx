import { useEffect, useState } from 'react'
import {
  Clapperboard,
  Layers,
  Library,
  ListOrdered,
  Minus,
  Settings,
  Square,
  X
} from 'lucide-react'
import type { SceneCard } from '@shared/pixai/library'
import { Compose } from './compose'
import { emptyDraft } from './composition'
import { Scenes } from './scenes'
import { LibraryEditor } from './library-editor'
import { BackupSettings } from './settings'
import { usePixaiStore, type PixaiStore } from './store'
import './pixai.css'
import { ExecutionQueue } from './execution'

export default function PixaiApp({
  store = usePixaiStore
}: {
  store?: PixaiStore
}): React.JSX.Element {
  const { workspace, ready, busy, error } = store()
  const [tab, setTab] = useState('compose')
  const [draft, setDraft] = useState(emptyDraft)
  const [sceneEditId, setSceneEditId] = useState('')
  const [epoch, setEpoch] = useState(0)
  useEffect(() => {
    void store.getState().hydrate()
  }, [store])
  function openScene(card: SceneCard): void {
    setDraft({
      ...draft,
      sceneIds: [...card.sceneIds],
      card,
      imageOptions: card.imageOptions,
      triggerPosition: card.triggerPosition ?? 1
    })
    setTab('compose')
  }
  const tabs = [
    { id: 'compose', label: '조합 예약', Icon: Layers },
    { id: 'scenes', label: '씬', Icon: Clapperboard },
    { id: 'library', label: '라이브러리', Icon: Library },
    { id: 'queue', label: '대기열', Icon: ListOrdered },
    { id: 'settings', label: '설정', Icon: Settings }
  ]
  return (
    <div className="px-app">
      <header className="px-titlebar">
        <strong>PixaiClackHelper</strong>
        <span>캐릭터와 장면을 골라, 한 번에 예약</span>
        <div className="px-window-controls">
          {window.nais?.runtime !== 'browser' &&
            (
              [
                ['minimize', Minus, '최소화'],
                ['maximize', Square, '최대화'],
                ['close', X, '닫기']
              ] as const
            ).map(([action, Icon, label]) => (
              <button
                key={action}
                aria-label={label}
                onClick={() => {
                  void window.nais.invoke('window:control', { action })
                }}
              >
                <Icon size={15} />
              </button>
            ))}
        </div>
      </header>
      <nav className="px-nav" aria-label="PixaiClackHelper 메뉴">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={19} />
            <span>{label}</span>
            {id === 'queue' && workspace.jobs.length > 0 && <small>{workspace.jobs.length}</small>}
          </button>
        ))}
        <span className="px-save-state" role="status">
          {busy ? '저장 중…' : ready ? '로컬 작업 공간' : '불러오는 중…'}
        </span>
      </nav>
      {error && (
        <div className="px-global-error" role="alert">
          {error}
          {ready ? (
            <button onClick={() => store.getState().clearError()}>닫기</button>
          ) : (
            <button
              onClick={() => {
                void store.getState().hydrate()
              }}
            >
              다시 불러오기
            </button>
          )}
        </div>
      )}
      {ready ? (
        <main className="px-content" key={epoch}>
          <fieldset className="px-workspace-lock" disabled={busy}>
            <div hidden={tab !== 'compose'} className="px-page">
              <Compose
                store={store}
                draft={draft}
                onChange={setDraft}
                onSceneCreated={(id) => {
                  setSceneEditId(id)
                  setTab('scenes')
                }}
              />
            </div>
            <div hidden={tab !== 'scenes'} className="px-page">
              <Scenes
                key={sceneEditId || 'scenes'}
                initialEditId={sceneEditId}
                store={store}
                onOpen={openScene}
              />
            </div>
            <div hidden={tab !== 'library'} className="px-page">
              <LibraryEditor store={store} />
            </div>
            <div hidden={tab !== 'queue'} className="px-page">
              <ExecutionQueue store={store} />
            </div>
            <div hidden={tab !== 'settings'} className="px-page">
              <BackupSettings
                store={store}
                onImport={() => {
                  setEpoch((value) => value + 1)
                  setDraft(emptyDraft())
                  setSceneEditId('')
                }}
              />
            </div>
          </fieldset>
        </main>
      ) : (
        <div className="px-loading">
          {error ? '기존 자료를 보호하기 위해 편집을 잠시 멈췄습니다.' : '작업 공간을 불러옵니다…'}
        </div>
      )}
      <footer className="px-app-footer">
        <span>예약 {workspace.library.reservations.length}조합</span>
        <span>대기열 {workspace.jobs.length}작업</span>
        <span>예약·등록은 준비 단계입니다. 대기열에서 시작하세요.</span>
      </footer>
    </div>
  )
}
