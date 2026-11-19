(async () => {
  const el = id => document.getElementById(id);
  const title = el('title'), body = el('body'), tags = el('tags');
  const fields = [title, body, tags];
  const params = new URLSearchParams(location.search);
  let actionPending = false;
  async function act(action) {
    if (actionPending) return;
    actionPending = true;
    const buttons = [...document.querySelectorAll('button')];
    buttons.forEach(button => button.disabled = true);
    try { await action(); }
    catch (error) { el('local').textContent = error.message; }
    finally {
      actionPending = false;
      buttons.forEach(button => button.disabled = false);
    }
  }
  function bindControl(id, pressed, action, labels) {
    const button = el(id);
    if (pressed === null) { button.hidden = true; return; }
    function display(on) {
      button.setAttribute('aria-pressed', String(on));
      button.title = labels[Number(on)];
      button.setAttribute('aria-label', button.title);
      if (id === 'lock') document.body.classList.toggle('position-locked',on);
    }
    display(pressed);
    button.disabled = false;
    button.onclick = () => act(async () => {
        const state = await action();
        display(state);
        if (id === 'pin' && !state) body.focus({preventScroll:true});
    });
  }
  if (params.has('quick')) {
    document.title = '快捷便签';
    document.body.classList.add('quick-editor');
    el('quickHandle').hidden = false;
    let activation;
    for (const field of fields) {
      field.addEventListener('pointerdown', () => {
        if (actionPending || activation) return;
        activation = window.note.edit()
          .catch(error => { el('local').textContent = error.message; })
          .finally(() => { activation = null; });
      });
    }
  }
  let dirty = false, timer;
  fields.forEach(field => field.disabled = true);
  let note;
  try { note = await window.note.load(); }
  catch (error) { el('local').textContent = error.message; return; }
  title.value = note?.title || '';
  body.value = note?.body || '';
  tags.value = note?.tags.join('，') || '';
  el('local').textContent = note ? '本地已保存' : '';
  el('backup').textContent = note?.backup || '';
  function save() {
    clearTimeout(timer);
    if (!dirty) return true;
    const result = window.note.save({ title: title.value.trim(), body: body.value,
      tags: [...new Set(tags.value.split(/[,，]/).map(t => t.trim()).filter(Boolean))] });
    if (result.error) { el('local').textContent = '保存失败：' + result.error; return false; }
    dirty = false;
    el('local').textContent = '本地已保存';
    el('backup').textContent = result.backup;
    return true;
  }
  for (const field of fields) {
    field.disabled = false;
    field.oninput = () => {
      dirty = true;
      el('local').textContent = '等待本地保存';
      el('backup').textContent = '';
      clearTimeout(timer);
      timer = setTimeout(save, 400);
    };
  }
  body.focus();
  el('wall').hidden = false;
  el('wall').onclick = () => act(async () => {
    if (save()) await window.note.wall();
  });
  el('new-note').onclick = () => act(async () => {
    if (!save()) return;
    fields.forEach(field => field.readOnly = true);
    try {
      const result = await window.note.create();
      if (result.reset) {
        clearTimeout(timer);
        dirty = false;
        fields.forEach(field => field.value = '');
        el('local').textContent = '';
        el('backup').textContent = '';
        body.scrollTop = 0;
        body.focus({preventScroll:true});
      }
    } finally { fields.forEach(field => field.readOnly = false); }
  });
  window.note.onStatus(status => { if (!dirty) el('backup').textContent = status || ''; });
  window.addEventListener('beforeunload', event => { if (!save()) event.returnValue = false; });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });
  try {
    const { pinned, locked } = await window.note.controls();
    bindControl('pin', pinned, window.note.pin, ['置顶窗口', '取消置顶']);
    bindControl('lock', locked, window.note.lock, ['锁定位置', '解锁位置，可拖动顶部']);
  } catch (error) { el('local').textContent = error.message; }
})();
