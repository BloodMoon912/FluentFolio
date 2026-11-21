// Loaded from inside <main> on purpose: swup (reloadScripts: true) re-executes
// on every navigation, which is what re-initialises the dashboard. The
// implementation lives in a module so this file stays readable.
(async function () {
  /** @type {string} */
  const src = '/scripts/home-dashboard.js';
  const mod = await import(src);
  mod.initHomeDashboard();
})();
