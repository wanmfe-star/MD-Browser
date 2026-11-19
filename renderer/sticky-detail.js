(() => {
  const byId = id => document.getElementById(id);
  function render(note) {
    if (!note) return;
    byId('detailTitle').textContent = note.title;
    byId('detailTitle').hidden = !note.title;
    byId('detailBody').textContent = note.body;
    byId('detailTags').replaceChildren(...note.tags.map(tag => {
      const span = document.createElement('span');
      span.textContent = tag;
      return span;
    }));
  }
  window.noteDetail.onChange(render);
  window.noteDetail.load().then(render).catch(error => { byId('detailError').textContent = error.message; });
  byId('editDetail').onclick = () => window.noteDetail.edit().catch(error => { byId('detailError').textContent = error.message; });
})();
