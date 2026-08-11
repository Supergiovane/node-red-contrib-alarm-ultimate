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
});
