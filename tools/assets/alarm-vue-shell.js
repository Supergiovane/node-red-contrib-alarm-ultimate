(function initAlarmUltimateVueShell(global) {
  function asText(value) {
    return String(value == null ? '' : value).trim();
  }

  function parseEmbed(value) {
    const v = asText(value).toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }

  function resolveHttpAdminRoot(pathname) {
    const text = asText(pathname);
    const index = text.indexOf('/alarm-ultimate/');
    if (index >= 0) {
      return text.slice(0, index + 1);
    }
    return '/';
  }

  function joinPath(root, leaf) {
    const a = asText(root) || '/';
    const b = asText(leaf).replace(/^\/+/, '');
    if (!b) return a;
    return a.endsWith('/') ? a + b : a + '/' + b;
  }

  function computeTargetUrl(root, page, params, sourceParams) {
    const target = new URLSearchParams();
    const copyKeys = ['id', 'name', 'embed', 'access_token'];
    for (const key of copyKeys) {
      const value = asText(params.get(key));
      if (value) target.set(key, value);
    }

    if (page === 'panel') {
      const view = asText(sourceParams && sourceParams.view);
      if (view) target.set('view', view);
    }

    const query = target.toString();
    let pathName = 'alarm-ultimate/alarm-panel';
    if (page === 'mapper') pathName = 'alarm-ultimate/alarm-json-mapper';
    if (page === 'settings') pathName = 'alarm-ultimate/alarm-settings';
    const url = joinPath(root, pathName);
    return query ? url + '?' + query : url;
  }

  function createShell(options) {
    if (!global || !global.Vue || typeof global.Vue.createApp !== 'function') return null;
    const opts = options && typeof options === 'object' ? options : {};
    const rootId = asText(opts.rootId) || 'alarm-vue-shell';
    const mountTarget = global.document && global.document.getElementById(rootId);
    if (!mountTarget) return null;

    const params = new URLSearchParams(global.location.search || '');
    const adminRoot = resolveHttpAdminRoot(global.location.pathname || '/');
    const sourceParams = {
      view: asText(params.get('view')),
    };

    return global.Vue.createApp({
      data() {
        return {
          sidebarCollapsed: false,
          embedMode: parseEmbed(params.get('embed')),
          currentPage: asText(opts.currentPage) || 'panel',
          pageTitle: asText(opts.pageTitle) || 'Alarm Ultimate',
          pageSubtitle: asText(opts.pageSubtitle),
          adminRoot,
          params,
          sourceParams,
        };
      },
      computed: {
        panelUrl() {
          return computeTargetUrl(this.adminRoot, 'panel', this.params, this.sourceParams);
        },
        mapperUrl() {
          return computeTargetUrl(this.adminRoot, 'mapper', this.params, this.sourceParams);
        },
        settingsUrl() {
          return computeTargetUrl(this.adminRoot, 'settings', this.params, this.sourceParams);
        },
      },
      methods: {
        toggleSidebar() {
          this.sidebarCollapsed = !this.sidebarCollapsed;
        },
      },
    }).mount('#' + rootId);
  }

  global.createAlarmVueShell = createShell;
})(window);
