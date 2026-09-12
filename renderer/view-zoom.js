(() => {
  // A 100-pixel wheel movement changes scale by five percentage points.
  const delta = (event, pane) => -event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pane.clientHeight : 1) / 2000;
  const clamp = (value, min, max) => Math.round(Math.max(min, Math.min(max, value)) * 10000) / 10000;
  window.viewZoom = { delta, clamp };
})();
