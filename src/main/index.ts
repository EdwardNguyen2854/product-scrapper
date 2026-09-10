import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { ScraperWorkerClient } from './workerClient'
import { loadSettings, saveSettings } from './settings'
import { IPC } from '../shared/ipc'
import type { AppSettings, WorkerCommand } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let worker: ScraperWorkerClient | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#f5f7fa',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  worker = new ScraperWorkerClient(app.getPath('userData'), app.getVersion())
  worker.start()
  worker.onEvent((event) => mainWindow?.webContents.send(IPC.workerEvent, event))

  ipcMain.handle(IPC.workerRequest, async (_event, command: WorkerCommand) => {
    if (!worker) throw new Error('Scraper worker is unavailable.')
    return worker.request(command)
  })

  ipcMain.handle(IPC.settingsGet, () => loadSettings())
  ipcMain.handle(IPC.settingsSet, (_event, settings: AppSettings) => saveSettings(settings))

  ipcMain.handle(IPC.chooseOutput, async () => {
    const settings = await loadSettings()
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose export output folder',
      defaultPath: settings.outputDirectory,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.openPath, async (_event, targetPath: string) => {
    if (!targetPath) return false
    const error = await shell.openPath(targetPath)
    if (error) throw new Error(error)
    return true
  })

  ipcMain.handle(IPC.openExternal, async (_event, targetUrl: string) => {
    const url = new URL(targetUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP/HTTPS links can be opened.')
    await shell.openExternal(url.toString())
    return true
  })

  const settings = await loadSettings()
  await mkdir(settings.outputDirectory, { recursive: true }).catch(() => undefined)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (!worker) return
  event.preventDefault()
  const current = worker
  worker = null
  void current.shutdown().finally(() => app.exit(0))
})
