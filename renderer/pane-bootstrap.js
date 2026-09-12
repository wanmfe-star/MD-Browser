window.isPaneChild = new URLSearchParams(location.search).get('pane') === 'secondary' && parent !== window;
if (window.isPaneChild) {
  document.documentElement.classList.add('pane-child');
  window.mdAPI = parent.mdAPI;
  window.paneHost = parent.workspace;
}
