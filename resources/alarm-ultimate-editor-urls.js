(function initAlarmUltimateEditorUrls(globalScope, factory) {
  'use strict';

  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.AlarmUltimateEditorUrls = api;
  }
})(typeof window !== 'undefined' ? window : null, function createAlarmUltimateEditorUrls() {
  'use strict';

  function visibleAdminRoot(locationValue) {
    const location = locationValue || {};
    let pathname = typeof location.pathname === 'string' ? location.pathname.trim() : '';
    if (!pathname) pathname = '/';
    if (!pathname.startsWith('/')) pathname = `/${pathname}`;
    return pathname.endsWith('/') ? pathname : `${pathname}/`;
  }

  function resolve(pathValue, locationValue) {
    const leaf = String(pathValue == null ? '' : pathValue).replace(/^\/+/, '');
    return `${visibleAdminRoot(locationValue)}${leaf}`;
  }

  return {
    resolve,
    visibleAdminRoot,
  };
});
