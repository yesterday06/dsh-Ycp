const { contextBridge, ipcRenderer } = require('electron')

function readConfig() {
  return {
    clickUrl: process.env.YCP_CLICK_URL || '',
    name: process.env.YCP_NAME || '大肥鱼',
    volume: Number(process.env.YCP_SOUND_VOLUME) || 0,
  }
}

contextBridge.exposeInMainWorld('ycpPet', {
  config: readConfig(),
  balance: () => {
    try { return ipcRenderer.sendSync('ycp:balance-sync') } catch { return null }
  },
  api: (pathName, method, body) => ipcRenderer.invoke('ycp:api', { path: pathName, method, body }),
  audio: (urlPath) => ipcRenderer.invoke('ycp:audio', urlPath),
  action: (kind, value) => ipcRenderer.send('ycp:action', { kind, value }),
  chatSend: (text) => ipcRenderer.send('ycp:chat-send', text),
  ledger: (payload) => ipcRenderer.send('ycp:ledger', payload),
  menuPick: (act, value) => ipcRenderer.send('ycp:menu-pick', { act, value }),
  chatResize: (expanded) => ipcRenderer.send('ycp:chat-resize', Boolean(expanded)),
  onMenuState: (callback) => { ipcRenderer.on('ycp:menu-state', (_event, state) => callback(state)) },
  onChatReply: (callback) => { ipcRenderer.on('ycp:chat-reply', (_event, reply) => callback(reply)) },
  onLedger: (callback) => { ipcRenderer.on('ycp:ledger-reply', (_event, reply) => callback(reply)) },
  onReply: (callback) => { ipcRenderer.on('ycp:reply', (_event, reply) => callback(reply)) },
  mouse: (mode) => ipcRenderer.send('ycp:mouse', mode),
  dragStart: (point) => ipcRenderer.send('ycp:drag-start', point),
  dragMove: (point) => ipcRenderer.send('ycp:drag-move', point),
  dragEnd: (velocity) => ipcRenderer.send('ycp:drag-end', velocity),
  reaction: () => ipcRenderer.send('ycp:reaction'),
  menu: () => ipcRenderer.send('ycp:menu'),
  onState: (callback) => { ipcRenderer.on('ycp:state', (_event, value) => callback(value)) },
  onChat: (callback) => { ipcRenderer.on('ycp:chat', () => callback()) },
  onSettings: (callback) => { ipcRenderer.on('ycp:settings', () => callback()) },
  onLedgerOpen: (callback) => { ipcRenderer.on('ycp:ledger-open', () => callback()) },
  onAnim: (callback) => { ipcRenderer.on('ycp:anim', (_event, name) => callback(name)) },
  onPinned: (callback) => { ipcRenderer.on('ycp:pinned', (_event, value) => callback(value)) },
  onScale: (callback) => { ipcRenderer.on('ycp:scale', (_event, value) => callback(value)) },
  onGravity: (callback) => { ipcRenderer.on('ycp:gravity', (_event, value) => callback(value)) },
  onMenu: (callback) => { ipcRenderer.on('ycp:menu', () => callback()) },
})
