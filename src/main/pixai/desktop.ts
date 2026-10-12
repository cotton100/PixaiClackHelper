import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { initDb, closeDb, getDb } from '../db'
import { getSetting, setSetting } from '../db/settings'
import { PixaiClient } from './client'
import { PixaiRunner } from './runner'
import { PixaiVault } from './vault'
import { SceneThumbnails } from './scene-thumbnails'
import { checkFolder, saveMedia } from './files'
import { readModelLink } from './model-link'
import { readImageInfo, embedGenerationInfo } from './image-info'
import { PixaisUpdates, publicUpdateJson, canInstallUpdate } from './updates'
import { makeUpdateEngine } from './update-engine'
import { backupBeforeUpdate, preserveSettingsOnVersionChange } from './settings-backup'
import type { PixaiInvokeMap, ConnectionStatus, ExecutionJob } from '../../shared/pixai/execution'

const smoke = process.argv.includes('--pixais-smoke-test')
app.setName('PixAIS')
app.setPath(
  'userData',
  smoke ? mkdtempSync(join(tmpdir(), 'pixais-smoke-')) : join(app.getPath('appData'), 'PixAIS')
)
const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()
let win: BrowserWindow | null = null
let runner: PixaiRunner
let quitting = false
app.on('second-instance', () => {
  if (win?.isMinimized()) win.restore()
  win?.show()
  win?.focus()
})
if (ownsInstance)
  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('com.cotton100.pixais')
      try {
        initDb()
        preserveSettingsOnVersionChange()
      } catch {
        dialog.showErrorBox(
          'PixaiClackHelper',
          '작업 공간 열기 또는 설정 백업에 실패했습니다. 기존 자료를 보존하고 종료합니다.'
        )
        app.quit()
        return
      }
      const vault = new PixaiVault({
        read: () => getSetting('pixais.key.v1'),
        write: (value) => setSetting('pixais.key.v1', value),
        available: () =>
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== 'linux' ||
            safeStorage.getSelectedStorageBackend() !== 'basic_text'),
        encrypt: (value) => safeStorage.encryptString(value),
        decrypt: (value) => safeStorage.decryptString(Buffer.from(value))
      })
      const thumbnails = new SceneThumbnails({
        read: () => getSetting('pixais.sceneThumbnails.v1'),
        write: (text) => setSetting('pixais.sceneThumbnails.v1', text)
      })
      const client = new PixaiClient(() => vault.get())
      try {
        runner = new PixaiRunner({
          read: () => getSetting('pixais.runner.v1'),
          write: (text) => setSetting('pixais.runner.v1', text),
          create: (job) => client.create(job.payload),
          task: (id) => client.task(id),
          save: async (job, id) => {
            const file = await saveMedia(client, job, id)
            await thumbnails.remember(job.sourceSceneId, file.path)
            return file
          },
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        })
      } catch {
        dialog.showErrorBox(
          'PixaiClackHelper',
          '생성 기록을 열지 못했습니다. 기존 자료를 보존하고 종료합니다.'
        )
        app.quit()
        return
      }
      let outputDir = getSetting('pixais.outputDir') ?? ''
      let embedMetadata = getSetting('pixais.embedMetadata.v1') === 'true'
      let readingImage = false
      const updates = new PixaisUpdates({
        version: app.getVersion(),
        supported: app.isPackaged && process.platform === 'win32' && process.arch === 'x64',
        json: publicUpdateJson,
        engine: makeUpdateEngine,
        databaseVersion: () => getDb().pragma('user_version', { simple: true }) as number,
        backup: backupBeforeUpdate,
        canInstall: () => canInstallUpdate(runner.status())
      })
      const updateIdle = (): void => {
        if (updates.status().phase === 'installing')
          throw new Error('업데이트 설치를 준비하고 있습니다.')
      }
      let maxInFlight = Number(getSetting('pixais.maxInFlight') ?? 2)
      if (!Number.isInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 5) maxInFlight = 2
      const connection = (): ConnectionStatus => ({
        connected: !!vault.get(),
        remembered: vault.remembered,
        encryptionAvailable: vault.available(),
        outputDir,
        embedMetadata,
        maxInFlight
      })
      const idle = (): void => {
        updateIdle()
        if (runner.status().running) throw new Error('실행을 멈춘 뒤 변경해 주세요.')
      }
      function handle<C extends keyof PixaiInvokeMap>(
        channel: C,
        callback: (
          req: PixaiInvokeMap[C]['req']
        ) => PixaiInvokeMap[C]['res'] | Promise<PixaiInvokeMap[C]['res']>
      ): void {
        ipcMain.handle(channel, (event, req) => {
          if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame)
            throw new Error('허용되지 않은 호출입니다.')
          if (!['pixai:update-status', 'pixai:status', 'pixai:connection'].includes(channel))
            updateIdle()
          return callback(req)
        })
      }
      handle('pixai:status', () => runner.status())
      handle('pixai:image-info', async (req) => {
        if (readingImage) throw new Error('이미지를 확인 중입니다. 잠시 후 다시 시도해 주세요.')
        readingImage = true
        try {
          return await readImageInfo(req?.bytes)
        } catch {
          throw new Error(
            '이미지 정보를 읽지 못했습니다. 정지 PNG·JPEG·WebP, 32MB·4천만 픽셀 이하인지 확인해 주세요.'
          )
        } finally {
          readingImage = false
        }
      })
      handle('pixai:metadata-setting', (req) => {
        idle()
        if (typeof req?.enabled !== 'boolean') throw new Error('기록 설정을 확인해 주세요.')
        setSetting('pixais.embedMetadata.v1', String(req.enabled))
        embedMetadata = req.enabled
        return connection()
      })
      handle('pixai:scene-thumbnails', (req) => thumbnails.status(req?.revision))
      handle('pixai:update-status', () => updates.status())
      handle('pixai:update-check', () => updates.check())
      handle('pixai:update-latest', () => updates.updateLatest())
      handle('pixai:update-download', (req) => updates.download(req?.version))
      handle('pixai:update-install', (req) => updates.install(req?.confirmed === true))
      handle('pixai:model-link', (req) => {
        if (typeof req.url !== 'string' || req.url.length > 2048)
          throw new Error('모델 링크를 확인해 주세요.')
        return readModelLink(req.url)
      })
      handle('pixai:connection', connection)
      handle('pixai:connect', (req) => {
        idle()
        vault.connect(req.key, req.remember === true)
        return connection()
      })
      handle('pixai:forget', () => {
        idle()
        vault.forget()
        return connection()
      })
      handle('pixai:folder', async () => {
        idle()
        const result = await dialog.showOpenDialog(win!, {
          properties: ['openDirectory', 'createDirectory']
        })
        if (!result.canceled && result.filePaths[0]) {
          await checkFolder(result.filePaths[0])
          idle()
          outputDir = result.filePaths[0]
          setSetting('pixais.outputDir', outputDir)
        }
        return connection()
      })
      handle('pixai:concurrency', (req) => {
        idle()
        if (!Number.isInteger(req.count) || req.count < 1 || req.count > 5)
          throw new Error('동시 작업은 1~5개입니다.')
        setSetting('pixais.maxInFlight', String(req.count))
        maxInFlight = req.count
        return connection()
      })
      handle('pixai:start', async (req) => {
        if (!vault.get()) throw new Error('설정에서 API 키를 연결해 주세요.')
        if (req.costsAccepted !== true) throw new Error('생성 비용 안내를 확인해 주세요.')
        await checkFolder(outputDir)
        updateIdle()
        runner.start(req.jobs, outputDir, maxInFlight, req.relocatePending === true, embedMetadata)
        return runner.status()
      })
      handle('pixai:dismiss-unknown', (req) => {
        runner.dismissUnknown(req.id, req.acknowledged === true)
        return runner.status()
      })
      handle('pixai:pause', () => {
        runner.pause()
        return runner.status()
      })
      handle('pixai:remove', (req) => {
        if (!Array.isArray(req.ids) || req.ids.some((id) => typeof id !== 'string'))
          throw new Error('작업 목록 형식을 확인해 주세요.')
        runner.remove(req.ids)
        return runner.status()
      })
      handle('pixai:open-folder', async () => {
        await checkFolder(outputDir)
        await shell.openPath(outputDir)
      })
      for (const channel of ['settings:get', 'settings:set', 'window:control']) {
        ipcMain.handle(channel, (event, req) => {
          if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame)
            throw new Error('허용되지 않은 호출입니다.')
          if (channel === 'window:control') {
            if (req.action === 'minimize') win.minimize()
            else if (req.action === 'maximize') {
              if (win.isMaximized()) win.unmaximize()
              else win.maximize()
            } else if (req.action === 'close') win.close()
            return
          }
          if (req.key !== 'pixais.workspace.v1') throw new Error('허용되지 않은 설정입니다.')
          if (channel === 'settings:get') return { value: getSetting(req.key) }
          updateIdle()
          if (typeof req.value !== 'string' || Buffer.byteLength(req.value) > 20 * 1024 * 1024)
            throw new Error('설정 용량을 확인해 주세요.')
          JSON.parse(req.value)
          setSetting(req.key, req.value)
          return {}
        })
      }
      win = new BrowserWindow({
        width: 1440,
        height: 940,
        minWidth: 780,
        minHeight: 640,
        show: !smoke,
        frame: false,
        backgroundColor: '#171b1c',
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      })
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      const target =
        !app.isPackaged && process.env.ELECTRON_RENDERER_URL
          ? process.env.ELECTRON_RENDERER_URL
          : pathToFileURL(join(__dirname, '../renderer/index.html')).href
      win.webContents.on('will-navigate', (event, url) => {
        if (url !== target) event.preventDefault()
      })
      win.on('close', (event) => {
        if (runner.status().running && !quitting) {
          event.preventDefault()
          const choice = dialog.showMessageBoxSync(win!, {
            type: 'question',
            buttons: ['계속 실행', '중지 후 종료'],
            defaultId: 0,
            cancelId: 0,
            message: '진행 중인 작업이 있습니다.',
            detail:
              '중지 후 종료해도 서버에 제출된 작업은 남습니다. 다음 실행에서 같은 ID로 확인·저장할 수 있습니다.'
          })
          if (choice === 1) {
            runner.pause()
            const timer = setInterval(() => {
              if (!runner.status().running) {
                clearInterval(timer)
                quitting = true
                app.quit()
              }
            }, 250)
          }
        }
      })
      await win.loadURL(target)
      if (smoke) {
        const ok = await win.webContents.executeJavaScript(
          `(async () => {
          for (let n = 0; n < 50 && !document.querySelector('.px-content'); n++)
            await new Promise(resolve => setTimeout(resolve, 100));
          const connection = await window.nais.invoke('pixai:connection', {});
          const status = await window.nais.invoke('pixai:status', {});
          const updates = await window.nais.invoke('pixai:update-status', {});
          const forbidden = await window.nais.invoke('account:list', {}).then(() => false, () => true);
          const settings = Array.from(document.querySelectorAll('.px-nav button')).find(button => button.textContent === '설정');
          settings?.click();
          await new Promise(resolve => setTimeout(resolve, 100));
          return document.title === 'PixaiClackHelper' && !!document.querySelector('.px-content') &&
            !!document.querySelector('input[type="password"]') &&
            !connection.connected && status.jobs.length === 0 && forbidden &&
            updates.currentVersion === ${JSON.stringify(app.getVersion())} && updates.phase === 'idle' &&
            document.body.textContent.includes('앱 업데이트 · 버전 선택');
        })()`
        )
        setSetting('pixais.smoke', 'roundtrip')
        const dbOk = getSetting('pixais.smoke') === 'roundtrip'
        const encryption =
          safeStorage.isEncryptionAvailable() &&
          safeStorage.decryptString(safeStorage.encryptString('pixais-smoke-dummy')) ===
            'pixais-smoke-dummy'
        const result = { renderer: ok, db: dbOk, encryption, packaged: app.isPackaged }
        writeFileSync(
          join(app.getPath('userData'), 'settings.png'),
          (await win.webContents.capturePage()).toPNG()
        )
        const composeOk = await win.webContents.executeJavaScript(`(async () => {
          Array.from(document.querySelectorAll('.px-nav button')).find(button => button.textContent === '조합 예약')?.click();
          await new Promise(resolve => setTimeout(resolve, 100));
          const pane = document.querySelector('[aria-label="조합 재료"]');
          return !!pane && ['생성당 이미지 수', 'Ultra', '4장 배치'].every(text => pane.textContent.includes(text));
        })()`)
        result.renderer &&= composeOk
        const sharp = (await import('sharp')).default
        const sample = embedGenerationInfo(
          await sharp({ create: { width: 160, height: 96, channels: 3, background: '#315e56' } })
            .png()
            .toBuffer(),
          {
            payload: {
              prompt: 'metadata-smoke-prompt',
              negativePrompt: 'metadata-smoke-negative',
              modelVersionId: '100',
              loras: [],
              seed: 42,
              batchSize: 4,
              aspectRatio: '5:3',
              size: '1k',
              promptHelper: 'disable'
            },
            metadataReferences: { modelId: '10', loraModelIds: [] }
          } as unknown as ExecutionJob,
          '11'
        )
        const infoOk = await win.webContents.executeJavaScript(`(async () => {
          Array.from(document.querySelectorAll('.px-nav button')).find(b => b.textContent === '이미지 정보')?.click();
          await new Promise(resolve => setTimeout(resolve, 100));
          const bytes = Uint8Array.from(atob(${JSON.stringify(sample.toString('base64'))}), c => c.charCodeAt(0));
          const input = document.querySelector('input[aria-label="이미지 파일 선택"]');
          const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'metadata-smoke.png', {type:'image/png'}));
          input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true}));
          for(let n=0; n<50 && !document.querySelector('.px-image-field'); n++) await new Promise(resolve => setTimeout(resolve, 100));
          for(let n=0; n<50 && !(document.querySelector('.px-image-preview')?.naturalWidth > 0); n++) await new Promise(resolve => setTimeout(resolve, 100));
          const section = document.querySelector('.px-image-info');
          const status = await window.nais.invoke('pixai:status', {});
          return section.textContent.includes('metadata-smoke-prompt') && section.textContent.includes('요청 시드') && !section.querySelector('input[type="checkbox"]:checked') && status.jobs.length === 0 && section.querySelector('.px-image-preview')?.naturalWidth === 160 && document.documentElement.scrollWidth <= innerWidth;
        })()`)
        result.renderer &&= infoOk
        writeFileSync(
          join(app.getPath('userData'), 'image-info.png'),
          (await win.webContents.capturePage()).toPNG()
        )
        win.setSize(853, 740)
        await new Promise((resolve) => setTimeout(resolve, 150))
        writeFileSync(
          join(app.getPath('userData'), 'image-info-narrow.png'),
          (await win.webContents.capturePage()).toPNG()
        )
        const applyOk = await win.webContents.executeJavaScript(`(async () => {
          for(const label of ['긍정 프롬프트 적용','부정 프롬프트 적용','PixAI 모델·LoRA 버전 적용']) document.querySelector('input[aria-label="'+label+'"]')?.click();
          await new Promise(resolve => setTimeout(resolve, 100));
          [...document.querySelectorAll('.px-image-info button')].find(b=>b.textContent==='선택 정보로 조합 열기')?.click();
          await new Promise(resolve => setTimeout(resolve, 100));
          [...document.querySelectorAll('.px-image-info button')].find(b=>b.textContent==='확인하고 새 조합 열기')?.click();
          await new Promise(resolve => setTimeout(resolve, 200));
          const saved = JSON.parse((await window.nais.invoke('settings:get',{key:'pixais.workspace.v1'})).value);
          const status = await window.nais.invoke('pixai:status', {});
          return saved.library.scenes.at(-1)?.prompt==='metadata-smoke-prompt' && saved.jobs.length===0 && status.jobs.length===0 && document.querySelector('.px-nav button[aria-current="page"]').textContent==='조합 예약';
        })()`)
        result.renderer &&= applyOk
        writeFileSync(
          join(app.getPath('userData'), 'compose.png'),
          (await win.webContents.capturePage()).toPNG()
        )
        writeFileSync(join(app.getPath('userData'), 'smoke-result.json'), JSON.stringify(result))
        console.log(`PIXAIS_SMOKE=${JSON.stringify(result)} DIR=${app.getPath('userData')}`)
        quitting = true
        app.exit(result.renderer && dbOk && encryption ? 0 : 1)
      }
    })
    .catch(() => {
      dialog.showErrorBox(
        'PixaiClackHelper',
        '앱을 시작하지 못했습니다. 설치 상태를 확인해 주세요.'
      )
      app.quit()
    })
app.on('window-all-closed', () => app.quit())
app.on('quit', closeDb)
