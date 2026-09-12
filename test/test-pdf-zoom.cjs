'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument } = require('pdf-lib');
app.setPath('userData', path.join(os.tmpdir(), 'md-pdf-zoom-' + process.pid));
ipcMain.handle('app:load-connection', () => ({ ok: true, data: null }));
ipcMain.handle('app:inspect-pdf-annotations', async (_event, bytes) => ({
  ok: true, data: await require('../electron/pdf-annotations').inspectAnnotations(bytes),
}));
const timeout = setTimeout(() => { console.error('PDF zoom test timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 600]).drawText('Zoom preserves selectable PDF text', { x: 30, y: 400, size: 16 });
  const bytes = Array.from(await pdf.save());
  const win = new BrowserWindow({ show: false, width: 1360, height: 860, webPreferences: {
    preload: path.join(__dirname, '../electron/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false,
  } });
  await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  await win.webContents.executeJavaScript(`(async () => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    state.currentFile = { path: '/zoom.pdf', name: 'zoom.pdf', kind: 'pdf' };
    document.getElementById('pdfPane').hidden = false;
    window.pdfAnnotations.load(${JSON.stringify(bytes)});
    await runAction(() => window.pdfAnnotations.open());
    const scroll = document.querySelector('.pdf-canvas-scroll');
    const canvas = document.getElementById('pdfPageCanvas');
    const label = document.getElementById('pdfZoomFit');
    const initialWidth = canvas.width;
    const wheel = (deltaY, ctrlKey = true, deltaMode = 0) => {
      const event = new WheelEvent('wheel', { deltaY, ctrlKey, deltaMode, bubbles: true, cancelable: true });
      scroll.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const idle = async () => {
      const deadline = Date.now() + 8000;
      while (state.busy) {
        if (Date.now() > deadline) throw new Error('Zoom render did not finish');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    check(!wheel(100, false), 'ordinary scrolling must remain available');
    check(canvas.width === initialWidth, 'ordinary scrolling must not zoom');
    check(wheel(-10), 'Ctrl wheel must prevent browser zoom');
    await idle();check(label.textContent === '100.5%', 'small trackpad motion must zoom continuously');
    wheel(-30); await idle();
    check(label.textContent === '102%' && canvas.width > initialWidth, 'wheel up must enlarge the PDF');
    wheel(2.5, true, 1); await idle();
    check(label.textContent === '适宽', 'line-mode wheel down must reduce zoom');
    for (let i = 0; i < 80; i++) wheel(-100);
    await idle();
    check(label.textContent === '400%', 'rapid wheel events must reach the upper limit');
    for (let i = 0; i < 100; i++) wheel(100);
    await idle();
    check(label.textContent === '10%', 'rapid wheel events must reach the lower limit');
    document.getElementById('pdfZoomFit').click(); await idle();
    check(label.textContent === '适宽' && canvas.width === initialWidth, 'fit-width must restore the original size');
    check(document.getElementById('pdfTextLayer').textContent.includes('Zoom preserves'), 'text layer must survive zoom');
    check(document.getElementById('pdfOverlayCanvas').width === canvas.width, 'annotation overlay must follow canvas dimensions');
    check(!window.pdfAnnotations.dirty(), 'zoom must not modify PDF annotations');
  })()`);
  console.log('PDF Ctrl+wheel checks passed: direction, ordinary scroll, trackpad, rapid input, limits, fit, text and annotation layers');
  clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });