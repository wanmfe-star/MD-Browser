'use strict';
function validatePDF(bytes) {
  if (bytes.length > 50 * 1024 * 1024) throw new Error('PDF 超过 50 MB，暂不支持预览');
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('文件不是有效的 PDF');
}
module.exports = { validatePDF };
