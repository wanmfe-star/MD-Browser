// Pure Markdown edits: returns the replacement range and selection after insertion.
(function (root) {
  function formatMarkdown(text, start, end, kind) {
    const selected = text.slice(start, end);
    const fonts = {
      sans: 'PingFang SC, Microsoft YaHei, sans-serif',
      serif: 'Songti SC, SimSun, serif',
      kai: 'Kaiti SC, KaiTi, serif',
      mono: 'Menlo, Consolas, monospace',
    };
    const [styleKind, option] = kind.split(':');
    if (['font', 'color', 'size'].includes(styleKind)) {
      let style;
      if (styleKind === 'font' && fonts[option]) style = 'font-family:' + fonts[option];
      if (styleKind === 'color' && /^#[0-9a-f]{6}$/i.test(option)) style = 'color:' + option;
      if (styleKind === 'size' && /^(12|14|16|18|20|24|28)$/.test(option)) style = 'font-size:' + option + 'px';
      if (!style) return null;
      const opening = '<span style="' + style + '">';
      const property = style.split(':')[0];
      const content = (selected || '文字').replace(/<span\s+style="([^"]*)">/gi, (_tag, styles) => {
        const remaining = styles.split(';').filter(rule => rule.split(':')[0].trim().toLowerCase() !== property).join(';');
        return remaining ? '<span style="' + remaining + '">' : '<span>';
      });
      const value = content.split('\n').map(line => {
        if (!line.trim()) return line;
        const prefix = line.match(/^(?:#{1,6}\s+|>\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/)?.[0] || '';
        return prefix + opening + line.slice(prefix.length) + '</span>';
      }).join('\n');
      return { start, end, value, selectStart: selected ? start : start + opening.length, selectEnd: selected ? start + value.length : start + opening.length + content.length };
    }
    if (kind === 'indent') {
      const lineStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
      const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
      const nextBreak = text.indexOf('\n', last);
      const lineEnd = nextBreak < 0 ? text.length : nextBreak;
      const lines = text.slice(lineStart, lineEnd).split('\n');
      const value = lines.map(line => {
        if (/^(?: {4}|\t|#{1,6}\s|>|[-+*]\s|\d+[.)]\s|`{3}|~{3}|\|)/.test(line)) return line;
        return line.startsWith('　　') ? line.slice(2) : line.trim() || (lines.length === 1 && start === end) ? '　　' + line : line;
      }).join('\n');
      return { start: lineStart, end: lineEnd, value, selectStart: lineStart, selectEnd: lineStart + value.length };
    }
    const inline = {
      bold: ['**', '**', '加粗文字'], italic: ['*', '*', '斜体文字'],
      strike: ['~~', '~~', '删除线文字'], code: ['`', '`', '代码'],
      link: ['[', '](https://)', '链接文字'], image: ['![', '](https://)', '图片描述'],
    };
    if (inline[kind]) {
      const [left, right, placeholder] = inline[kind];
      const content = selected || placeholder;
      // Repeating an inline style on its selected content removes the markers.
      if (!['link', 'image'].includes(kind) && selected && text.slice(start - left.length, start) === left && text.slice(end, end + right.length) === right) {
        return { start: start - left.length, end: end + right.length, value: selected, selectStart: start - left.length, selectEnd: end - left.length };
      }
      const value = left + content + right;
      const url = ['link', 'image'].includes(kind);
      const offset = url ? left.length + content.length + 2 : left.length;
      return { start, end, value, selectStart: start + offset, selectEnd: start + offset + (url ? 8 : content.length) };
    }
    if (kind === 'block') {
      const content = selected || '在这里输入代码';
      const runs = content.match(/`+/g) || [];
      const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
      const left = (start > 0 && text[start - 1] !== '\n' ? '\n' : '') + fence + '\n';
      const right = '\n' + fence + (end < text.length && text[end] !== '\n' ? '\n' : '');
      return { start, end, value: left + content + right, selectStart: start + left.length, selectEnd: start + left.length + content.length };
    }
    if (kind === 'rule') {
      const value = (start && text[start - 1] !== '\n' ? '\n\n' : '\n') + '---\n\n';
      return { start, end, value, selectStart: start + value.length, selectEnd: start + value.length };
    }
    const prefixes = { h1: '# ', h2: '## ', h3: '### ', bullet: '- ', ordered: '1. ', task: '- [ ] ', quote: '> ' };
    if (!prefixes[kind]) return null;
    const lineStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
    const effectiveEnd = end > start && text[end - 1] === '\n' ? end - 1 : end;
    const nextBreak = text.indexOf('\n', effectiveEnd);
    const lineEnd = nextBreak < 0 ? text.length : nextBreak;
    const lines = text.slice(lineStart, lineEnd).split('\n');
    const value = lines.map((line, i) => {
      const indent = line.match(/^\s*/)[0];
      let body = line.slice(indent.length);
      if (kind[0] === 'h') body = body.replace(/^#{1,6}\s+/, '');
      else if (['bullet', 'ordered', 'task'].includes(kind)) body = body.replace(/^(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/, '');
      const prefix = kind === 'ordered' ? (i + 1) + '. ' : prefixes[kind];
      return indent + prefix + body;
    }).join('\n');
    return { start: lineStart, end: lineEnd, value, selectStart: lineStart, selectEnd: lineStart + value.length };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = formatMarkdown;
  else root.mdFormat = formatMarkdown;
})(globalThis);
