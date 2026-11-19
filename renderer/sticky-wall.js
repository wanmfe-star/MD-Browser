(() => {
  if (window.isPaneChild) return;
  const byId = id => document.getElementById(id);
  const wall = byId('noteWall'), query = byId('noteQuery'), message = byId('noteMessage');
  let notes = [], selected = null, generation = 0;
  const menu = byId('noteContext'), removeButton = menu.querySelector('button');
  let contextNote;
  function closeMenu() { menu.hidden = true; contextNote = null; }
  function openMenu(event, id) {
    event.preventDefault();
    contextNote = id;
    menu.hidden = false;
    const rect = event.currentTarget.getBoundingClientRect();
    menu.style.left = Math.min(event.clientX || rect.left, innerWidth - menu.offsetWidth) + 'px';
    menu.style.top = Math.min(event.clientY || rect.bottom, innerHeight - menu.offsetHeight) + 'px';
    removeButton.focus();
  }
  removeButton.onclick = async () => {
    const id = contextNote;
    closeMenu();
    if (id) await report(window.mdAPI.deleteNote(id));
  };
  document.addEventListener('pointerdown', e => { if (!menu.contains(e.target)) closeMenu(); });
  menu.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenu(); byId('noteWallTitle').focus(); }
  });
  menu.addEventListener('focusout', closeMenu);
  function element(tag, content) {
    const el = document.createElement(tag);
    el.textContent = content;
    return el;
  }
  async function report(request) {
    const result = await request;
    if (!result.ok) message.textContent = result.error;
    return result;
  }
  function render() {
    const tags = new Set(['随想', '法义', '产品创意', ...notes.flatMap(note => note.tags)]);
    const filters = [null, ...tags].map(tag => {
      const button = element('button', tag ?? '全部');
      button.setAttribute('aria-pressed', String(selected === tag));
      button.onclick = () => { selected = tag; render(); };
      return button;
    });
    byId('noteFilters').replaceChildren(...filters);
    const term = query.value.trim().toLocaleLowerCase();
    const cards = notes.filter(n => (!selected || n.tags.includes(selected)) &&
      (n.title.toLocaleLowerCase().includes(term) || n.body.toLocaleLowerCase().includes(term))).map(n => {
      const card = element('button', '');
      card.className = 'sticky-card';
      const tags = element('div', '');
      tags.className = 'sticky-tags';
      for (const tag of n.tags) tags.append(element('span', tag));
      if (n.title) card.append(element('strong', n.title));
      card.append(element('p', n.body), tags);
      if (!n.title && !n.body.trim()) card.setAttribute('aria-label','打开空白便签');
      card.title = n.backup;
      card.onclick = () => report(window.mdAPI.notesDetails(n.id));
      card.oncontextmenu = event => openMenu(event,n.id);
      return card;
    });
    byId('noteCards').replaceChildren(...cards);
    message.textContent = cards.length ? '' : notes.length ? '没有匹配的便签' : '点击「新建便签」，记下第一个想法。';
  }
  async function refresh() {
    const version = ++generation;
    const res = await window.mdAPI.notesList();
    if (generation !== version) return;
    if (!res.ok) { message.textContent = res.error; return; }
    notes = res.data;
    render();
  }
  function show(active) {
    closeMenu();
    wall.hidden = !active;
    document.body.classList.toggle('notes-active', active);
    byId('showNotes').setAttribute('aria-pressed', String(active));
    byId('showDocs').setAttribute('aria-pressed', String(!active));
    if (active) { refresh(); byId('noteWallTitle').focus({ preventScroll:true }); }
    else window.dispatchEvent(new Event('resize'));
  }
  byId('showNotes').onclick = () => show(true);
  byId('showDocs').onclick = () => show(false);
  byId('createNote').onclick = () => report(window.mdAPI.notesOpen());
  byId('openQuick').onclick = () => report(window.mdAPI.openQuick());
  const login = byId('quickLogin');
  async function readLogin() {
    const result = await window.mdAPI.quickLogin();
    if (result.ok && typeof result.data === 'boolean') {
      byId('quickLoginLabel').hidden = false;
      login.checked = result.data;
    }
  }
  login.onchange = async () => {
    login.disabled = true;
    try { await report(window.mdAPI.quickLogin(login.checked)); await readLogin(); }
    finally { login.disabled = false; }
  };
  readLogin();
  window.mdAPI.onShowWall(() => show(true));
  byId('noteFolder').onclick = () => report(window.mdAPI.notesFolder());
  query.oninput = render;
  window.addEventListener('keydown', event => {
    if (wall.hidden || document.querySelector('dialog[open]') || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key !== 'f' && key !== 's') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (key === 'f') { query.focus(); query.select(); }
  }, true);
  window.mdAPI.onNotesChanged?.(() => { if (!wall.hidden) refresh(); });
})();
