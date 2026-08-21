(() => {
  const BUILD = '20260821-1';

  function setFavicon() {
    let icon = document.querySelector('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      document.head.appendChild(icon);
    }
    icon.type = 'image/svg+xml';
    icon.href = `/image/taliabu-tv.svg?v=${BUILD}`;
  }

  function stopLive() {
    try {
      if (typeof state !== 'undefined' && state.liveHls) {
        state.liveHls.destroy();
        state.liveHls = null;
      }
    } catch (_) {}

    const video = document.getElementById('liveVideo');
    if (video) {
      try { video.pause(); } catch (_) {}
      try {
        video.removeAttribute('src');
        while (video.firstChild) video.removeChild(video.firstChild);
        video.load();
      } catch (_) {}
    }

    document.querySelectorAll('.channel.active').forEach(el => el.classList.remove('active'));
    const title = document.getElementById('liveNowPlaying');
    if (title) title.textContent = '请选择频道';
    const hint = document.getElementById('livePlayerHint');
    if (hint) {
      hint.textContent = '已停止';
      hint.classList.remove('hidden');
    }
  }

  function installStopButton() {
    const nowPlaying = document.getElementById('liveNowPlaying');
    const header = nowPlaying?.parentElement;
    if (!header || document.getElementById('liveStopBtn')) return;

    header.classList.add('relative', 'pr-20');
    const button = document.createElement('button');
    button.id = 'liveStopBtn';
    button.type = 'button';
    button.textContent = '■ 停止';
    button.className = 'absolute right-0 bottom-0 px-3 py-1.5 rounded-lg border border-red-900/70 bg-red-950/40 hover:bg-red-900/50 text-red-300 text-sm';
    button.addEventListener('click', stopLive);
    header.appendChild(button);

    document.querySelectorAll('.nav-btn').forEach(nav => {
      nav.addEventListener('click', () => {
        if (nav.dataset.section !== 'live') stopLive();
      });
    });

    window.addEventListener('pagehide', stopLive);
  }

  async function clearLegacyWorkerAndCaches() {
    try {
      if (localStorage.getItem('taliabuCleanupBuild') === BUILD) return;
      let hadController = false;

      if ('serviceWorker' in navigator) {
        hadController = !!navigator.serviceWorker.controller;
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.allSettled(registrations.map(reg => reg.unregister()));
      }

      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.allSettled(names.map(name => caches.delete(name)));
      }

      localStorage.setItem('taliabuCleanupBuild', BUILD);

      if (hadController && sessionStorage.getItem('taliabuCleanupReload') !== BUILD) {
        sessionStorage.setItem('taliabuCleanupReload', BUILD);
        location.reload();
      }
    } catch (_) {}
  }

  setFavicon();
  clearLegacyWorkerAndCaches();
  document.addEventListener('DOMContentLoaded', () => {
    setFavicon();
    installStopButton();
  });
})();
