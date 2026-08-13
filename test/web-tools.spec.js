'use strict';

const { expect } = require('chai');
const { helper } = require('./helpers');

const alarmNode = require('../nodes/AlarmSystemUltimate.js');

describe('Alarm Ultimate web tools', function () {
  before(function (done) {
    helper.startServer(done);
  });

  after(function (done) {
    helper.stopServer(done);
  });

  afterEach(function () {
    return helper.unload();
  });

  it('serves every tool page and its shared assets from the admin routes', async function () {
    await helper.load(alarmNode, []);

    const pages = [
      ['/alarm-ultimate/alarm-panel', 'Alarm Ultimate'],
      ['/alarm-ultimate/alarm-json-mapper', 'Alarm Ultimate'],
      ['/alarm-ultimate/alarm-settings', 'Alarm Ultimate'],
    ];

    for (const [url, expectedText] of pages) {
      const response = await helper.request().get(url).expect(200).expect('Content-Type', /html/);
      expect(response.text).to.include(expectedText);
    }

    await helper
      .request()
      .get('/alarm-ultimate/alarm-tools/assets/alarm-vue-shell.js')
      .expect(200)
      .expect('Content-Type', /javascript/);
  });

  it('keeps the zone importer in the Zones submenu and exposes the Save action', async function () {
    await helper.load(alarmNode, []);

    const mapper = await helper
      .request()
      .get('/alarm-ultimate/alarm-json-mapper')
      .expect(200)
      .expect('Content-Type', /html/);

    expect(mapper.text).to.include('class="alarm-nav-submenu"');
    expect(mapper.text).to.include('Import wizard');
    expect(mapper.text).to.include('id="btn-zone-save"');
    expect(mapper.text).not.to.include('id="btn-goto-importer"');
    expect(mapper.text).not.to.include('Important / Importante — save your changes');
    expect(mapper.text).not.to.include('Target Alarm:');
    expect(mapper.text).to.include('id="btn-parse">Parse</button>');
    expect(mapper.text).not.to.include('id="btn-parse">Parse / detect</button>');
    expect(mapper.text).to.include('id="wizard-step2" style="display:none;"');
    expect(mapper.text).to.include('id="btn-wizard-back"');
    expect(mapper.text).to.include('function showZoneListAfterGeneration(generatedZones)');
    expect(mapper.text).to.include('tr.classList.add("zone-row-new")');
    expect(mapper.text).to.include('PARSED_INPUT_STORAGE_KEY');
    expect(mapper.text).to.include('function restoreParsedWizardStep()');
  });

  it('updates Control Panel actions from alarm state and rounds only numeric keypad buttons', async function () {
    await helper.load(alarmNode, []);

    const panel = await helper
      .request()
      .get('/alarm-ultimate/alarm-panel')
      .expect(200)
      .expect('Content-Type', /html/);

    expect(panel.text).to.include('id="btnArm" disabled');
    expect(panel.text).to.include('id="btnDisarm" disabled');
    expect(panel.text).to.include('function updateArmDisarmButtons()');
    expect(panel.text).to.include('states.every((state) => isFullyDisarmed(state))');

    const styles = await helper
      .request()
      .get('/alarm-ultimate/alarm-tools/assets/alarm-tools-pages.css')
      .expect(200)
      .expect('Content-Type', /css/);

    expect(styles.text).to.include('.alarm-panel-page .kbd button[data-k="0"]');
    expect(styles.text).to.include('.alarm-panel-page .kbd button[data-k="9"]');
    expect(styles.text).to.include('border-radius: 50%');
  });
});
