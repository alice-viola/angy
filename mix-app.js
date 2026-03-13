function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + viewName).classList.add('active');
  document.querySelectorAll('.rail-btn[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  closeAllPopovers();
}

function togglePicker(id, evt) {
  const el = document.getElementById(id);
  if (!el) return;
  const wasHidden = el.classList.contains('hidden');
  closeAllPopovers();
  if (wasHidden) {
    const btn = evt ? evt.currentTarget : null;
    if (btn) {
      const r = btn.getBoundingClientRect();
      el.style.position = 'fixed';
      el.style.top = (r.bottom + 4) + 'px';
      el.style.left = Math.max(56, r.left) + 'px';
    }
    el.classList.remove('hidden');
    const input = el.querySelector('input[type="text"]');
    if (input) setTimeout(() => input.focus(), 50);
  }
}

function closeAllPopovers() {
  document.querySelectorAll('.proj-popover').forEach(p => p.classList.add('hidden'));
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.proj-popover') && !e.target.closest('.popover-trigger')) {
    closeAllPopovers();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllPopovers();
});
