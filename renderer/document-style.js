// Keep document typography while excluding layout-changing or resource-loading CSS.
window.sanitizeMarkdownHTML = function (html) {
  const template = document.createElement('template');
  template.innerHTML = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'video', 'audio', 'object', 'embed'],
  });
  const fonts = new Set(['pingfang sc', 'microsoft yahei', 'sans-serif', 'songti sc', 'simsun', 'serif', 'kaiti sc', 'kaiti', 'menlo', 'consolas', 'monospace']);
  for (const element of template.content.querySelectorAll('[style]')) {
    const color = element.style.color;
    const family = element.style.fontFamily;
    const size = element.style.fontSize;
    element.removeAttribute('style');
    if (/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(color)) element.style.color = color;
    if (family && family.split(',').every(font => fonts.has(font.trim().replace(/["']/g, '').toLowerCase()))) element.style.fontFamily = family;
    if (/^(12|14|16|18|20|24|28)px$/.test(size)) element.style.fontSize = size;
  }
  return template.innerHTML;
};
