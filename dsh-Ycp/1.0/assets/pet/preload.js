const { contextBridge, ipcRenderer } = require('electron')

function readConfig() {
  return {
    clickUrl: process.env.YCP_CLICK_URL || '',
    volume: Number(process.env.YCP_SOUND_VOLUME) || 0,
  }
}

contextBridge.exposeInMainWorld('ycpPet', {
  config: readConfig(),
  dragStart: (point) => ipcRenderer.send('ycp:drag-start', point),
  dragMove: (point) => ipcRenderer.send('ycp:drag-move', point),
  dragEnd: (velocity) => ipcRenderer.send('ycp:drag-end', velocity),
  reaction: () => ipcRenderer.send('ycp:reaction'),
  menu: () => ipcRenderer.send('ycp:menu'),
  onState: (callback) => {
    ipcRenderer.on('ycp:state', (_event, value) => callback(value))
  },
})
