'use strict';
const { BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function exportPDF({ html, title }, destination) {
  if (typeof html !== 'string' || typeof title !== 'string') throw new Error('导出内容无效');
  const window = new BrowserWindow({
    show: false, width: 900, height: 1100,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'pdf-' + randomUUID() },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  let temporary;
  try {
    await window.loadFile(path.join(__dirname, '../renderer/pdf.html'));
    const warnings = await window.webContents.executeJavaScript(`(async () => {
      const payload = ${JSON.stringify({ html, title })};
      document.title = payload.title;
      const content = document.getElementById('document');
      content.innerHTML = window.sanitizeMarkdownHTML(payload.html);
      if (!content.querySelector('h1, h2')) {
        const heading = document.createElement('h1'); heading.textContent = payload.title; content.prepend(heading);
      }
      await document.fonts.ready;
      const images = Array.from(content.querySelectorAll('img'));
      await Promise.all(images.map(img => new Promise(resolve => {
        if (img.complete) return resolve();
        const timer = setTimeout(resolve, 10000);
        const done = () => { clearTimeout(timer); resolve(); };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      })));
      let missing = 0;
      for (const img of images) {
        if (!img.complete || !img.naturalWidth) {
          const note = document.createElement('p'); note.className = 'missing-image';
          note.textContent = '[图片未加载' + (img.alt ? '：' + img.alt : '') + ']';
          img.replaceWith(note); missing++;
        }
      }
      return missing;
    })()`);
    const pdf = await window.webContents.printToPDF({
      pageSize: 'A4', printBackground: true,
      margins: { top: 0.79, bottom: 0.79, left: 0.87, right: 0.87 },
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-size:9px;color:#888;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      generateTaggedPDF: true,
    });
    temporary = destination + '.' + randomUUID() + '.tmp';
    await fs.writeFile(temporary, pdf);
    await fs.rename(temporary, destination);
    return { path: destination, missingImages: warnings };
  } finally {
    if (!window.isDestroyed()) window.destroy();
    if (temporary) await fs.rm(temporary, { force: true });
  }
}
module.exports = { exportPDF };
