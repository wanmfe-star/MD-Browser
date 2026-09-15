(() => {
  // Use each surface's existing cancellation handlers, so pending operations resolve.
  window.dismissTransientUI = target => {
    for (const details of document.querySelectorAll('details[open]')) {
      if (!target || !details.contains(target)) details.open = false;
    }
    for (const dialog of document.querySelectorAll('dialog[open]')) {
      if (target && dialog.contains(target) && target !== dialog) continue;
      const cancel = new Event('cancel', {cancelable:true});
      if (dialog.dispatchEvent(cancel) && dialog.open) dialog.close('cancel');
    }
    if (!target || !target.closest?.('.dictionary-card')) window.dictionaryLookup?.close();
    window.dismissMindPanels?.(target);
  };
  function visit(surface, origin, target) {
    try {
      surface.dismissTransientUI?.(surface === origin ? target : null);
      for (let i=0;i<surface.frames.length;i++) visit(surface.frames[i],origin,target);
    } catch { /* External pages do not expose application UI. */ }
  }
  document.addEventListener('pointerdown', event => {
    // A dialog receives backdrop clicks as its target. Its inner padding is not a backdrop.
    if (event.target instanceof HTMLDialogElement) {
      const r=event.target.getBoundingClientRect();
      if(event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom)return;
    }
    visit(window.top, window, event.target);
  }, true);
  // Embedded browser guests do not bubble pointer events into the host document.
  window.addEventListener('blur',()=>setTimeout(()=>{
    if(document.activeElement?.tagName==='WEBVIEW')visit(window.top,null,null);
  },0));
})();
