/**
 * Concatenates the existing ordered browser modules without transpilation.
 * Source files remain readable; production serves two deterministic assets.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

const cssFiles = [
  'variables.css', 'buttons.css', 'auth.css', 'layout-shell-a.css',
  'layout-shell-b.css', 'layout-panels-a.css', 'layout-panels-b.css',
  'sidebar.css', 'metrics.css', 'components.css', 'console.css',
  'dashboard-cards.css', 'dashboard-skeletons.css', 'certificates.css',
  'table-list.css', 'table-item.css', 'ops-screen.css', 'dashboard-premium.css',
  'toast.css', 'rules-screen.css', 'mobile-shell.css', 'responsive-a.css',
  'responsive-b.css', 'motion.css', 'insights.css', 'enterprise-polish.css'
];

const jsFiles = [
  'js/utils.js', 'js/toast.js', 'js/dataCache.js', 'js/panels-bundle.js',
  'js/apiAuth.js', 'js/apiCerts.js', 'js/apiData.js', 'js/apiDownloads.js',
  'js/uiElements.js', 'js/uiTableCore.js', 'js/uiTableLoading.js',
  'js/uiTableRender.js', 'js/uiCore.js', 'js/uiCerts.js', 'js/uiProgress.js',
  'js/uiTabs.js', 'js/unitsController.js', 'js/historyController.js',
  'js/certStatusController.js', 'js/syncController.js', 'js/queryLoop.js',
  'js/dashboardController.js', 'js/insightsController.js', 'js/docDrawer.js',
  'js/eventsCert.js', 'js/eventsAuth.js', 'js/eventsSync.js', 'js/eventsTable.js',
  'js/eventsFilters.js', 'js/eventsNsu.js', 'js/eventsNav.js',
  'js/eventsScheduler.js', 'js/events.js', 'app.js', 'js/bootComponents.js',
  'js/bootData.js', 'js/boot.js'
];

function normalized(relativePath) {
  return fs.readFileSync(path.join(publicDir, relativePath), 'utf8').replace(/\r\n/g, '\n').trimEnd();
}

const css = cssFiles
  .map(file => `/* source: css/${file} */\n${normalized(`css/${file}`)}`)
  .join('\n\n') + '\n';
const js = jsFiles
  .map(file => `/* source: ${file} */\n${normalized(file)}\n;`)
  .join('\n\n') + '\n';

const cssOut = path.join(publicDir, 'css', 'app.bundle.css');
const jsOut = path.join(publicDir, 'js', 'app.bundle.js');
fs.writeFileSync(cssOut, css);
fs.writeFileSync(jsOut, js);
console.log(`OK: ${cssOut} (${Buffer.byteLength(css)} bytes)`);
console.log(`OK: ${jsOut} (${Buffer.byteLength(js)} bytes)`);
