// Applies the saved colour theme before the page paints. "system" follows the device setting.
(function () {
  const KEY = 'habit-tracker-theme';
  function read() {
    try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch (e) { return 'system'; }
  }
  function apply(mode) {
    if (mode === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
  }
  window.HabitTheme = {
    get: read,
    set: function (mode) {
      try { if (mode === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch (e) { /* storage unavailable: the choice lasts until reload */ }
      apply(mode);
    },
  };
  apply(read());
})();
