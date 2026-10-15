import { useEffect, useState } from 'react'
import {
  Clapperboard,
  FileImage,
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
import { emptyDraft, type ComposeDraft } from './composition'
import { Scenes } from './scenes'
import { LibraryEditor } from './library-editor'
import { BackupSettings } from './settings'
import { usePixaiStore, type PixaiStore } from './store'
import './pixai.css'
import { ExecutionQueue } from './execution'
import { ImageInformation } from './image-info'
import { appIdentity, channelForVersion } from '@shared/pixai/channels'

export default function PixaiApp({
  store = usePixaiStore
}: {
  store?: PixaiStore
}): React.JSX.Element {
  const { workspace, ready, busy, draftSaving, conflict, error } = store()
  const [confirmReload, setConfirmReload] = useState(false)
  const [tab, setTab] = useState('compose')
  const [productName, setProductName] = useState('PixaiClackHelper')
  const draft = workspace.composeDraft ?? emptyDraft()
  const [sceneEditId, setSceneEditId] = useState('')
  const [epoch, setEpoch] = useState(0)
  useEffect(() => {
    void store.getState().hydrate()
  }, [store])
  useEffect(() => {
    const check = (): void => {
      const state = store.getState()
      if (state.ready && !state.busy && !state.draftSaving && !state.conflict)
        void state.verifyCurrent().catch(() => {})
    }
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [store])
  useEffect(() => {
    if (!window.nais || window.nais.runtime === 'browser') return
    let live = true
    void window.nais
      .invoke('pixai:update-status', {})
      .then((status) => {
        if (live && typeof status?.currentVersion === 'string') {
          const name = `${appIdentity().productName}${channelForVersion(status.currentVersion) === 'beta' ? ' Beta' : ''}`
          setProductName(name)
          document.title = name
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  function setDraft(next: ComposeDraft): void {
    void store
      .getState()
      .saveDraft(next)
      .catch(() => {}) // The store displays a failed save and keeps the previous state.
  }
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
    { id: 'image-info', label: '이미지 정보', Icon: FileImage },
    { id: 'settings', label: '설정', Icon: Settings }
  ]
  return (
    <div className="px-app">
      <header className="px-titlebar">
        <strong>{productName}</strong>

        <nav className="px-nav" aria-label="PixaiClackHelper 메뉴">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === 'queue' && workspace.jobs.length > 0 && (
                <small>{workspace.jobs.length}</small>
              )}
            </button>
          ))}
          <span className="px-save-state" role="status">
            {busy || draftSaving
              ? '저장 중…'
              : error
                ? '저장 확인 필요'
                : ready
                  ? '초안·구성 저장됨'
                  : '불러오는 중…'}
          </span>
        </nav>
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
      {error && (
        <div className="px-global-error" role="alert">
          {error}
          {conflict ? (
            <>
              <button onClick={() => setTab('settings')}>화면에 남은 재료 백업</button>
              <span>설정 백업에는 조합 초안·등록 작업·편집 중인 입력은 포함되지 않습니다.</span>
              {confirmReload ? (
                <>
                  <span>
                    미저장 입력을 버리고 최신 자료를 불러옵니다. 필요한 내용은 먼저 복사해 주세요.
                  </span>
                  <button
                    disabled={busy || draftSaving}
                    onClick={() => {
                      void store
                        .getState()
                        .reload()
                        .then((loaded) => {
                          if (!loaded) return
                          setEpoch((value) => value + 1)
                          setSceneEditId('')
                          setConfirmReload(false)
                        })
                    }}
                  >
                    미저장 변경을 버리고 불러오기
                  </button>
                  <button disabled={busy} onClick={() => setConfirmReload(false)}>
                    취소
                  </button>
                </>
              ) : (
                <button disabled={busy || draftSaving} onClick={() => setConfirmReload(true)}>
                  최신 자료 다시 불러오기
                </button>
              )}
            </>
          ) : ready ? (
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
          <fieldset
            className="px-workspace-lock"
            disabled={
              busy ||
              (draftSaving && tab === 'settings') ||
              (conflict && !['settings', 'queue'].includes(tab))
            }
          >
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
            <div hidden={tab !== 'image-info'} className="px-page">
              <ImageInformation store={store} onCompose={() => setTab('compose')} />
            </div>
            <div hidden={tab !== 'settings'} className="px-page">
              <BackupSettings
                store={store}
                onImport={() => {
                  setEpoch((value) => value + 1)
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
    </div>
  )
}
