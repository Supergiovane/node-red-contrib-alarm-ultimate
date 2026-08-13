'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { expect } = require('chai');

const editorUrls = require('../resources/alarm-ultimate-editor-urls.js');

describe('Alarm Ultimate editor URLs', function () {
  it('keeps the Home Assistant Ingress prefix', function () {
    const location = { pathname: '/api/hassio_ingress/session-token/' };

    expect(editorUrls.resolve('/alarm-ultimate/alarm-panel?id=alarm1', location)).to.equal(
      '/api/hassio_ingress/session-token/alarm-ultimate/alarm-panel?id=alarm1'
    );
  });

  it('keeps a configured Node-RED admin path', function () {
    const location = { pathname: '/red/' };

    expect(editorUrls.resolve('alarm-ultimate/alarm/nodes', location)).to.equal(
      '/red/alarm-ultimate/alarm/nodes'
    );
  });

  it('normalizes editor paths without a trailing slash', function () {
    const location = { pathname: '/api/hassio_ingress/session-token' };

    expect(editorUrls.resolve('alarm-ultimate/alarm-settings', location)).to.equal(
      '/api/hassio_ingress/session-token/alarm-ultimate/alarm-settings'
    );
  });

  it('is loaded and used by every editor that opens or queries the panel API', function () {
    const root = path.join(__dirname, '..', 'nodes');
    const editorFiles = [
      'AlarmSystemUltimate.html',
      'AlarmUltimateZone.html',
      'AlarmUltimateSiren.html',
    ];

    for (const filename of editorFiles) {
      const html = fs.readFileSync(path.join(root, filename), 'utf8');
      expect(html, filename).to.include(
        'resources/node-red-contrib-alarm-ultimate/alarm-ultimate-editor-urls.js'
      );
      expect(html, filename).to.include('AlarmUltimateEditorUrls.resolve');
    }
  });

  it('does not show the web page button in Alarm State and Alarm Zone', function () {
    const root = path.join(__dirname, '..', 'nodes');
    for (const filename of ['AlarmUltimateState.html', 'AlarmUltimateZone.html']) {
      const html = fs.readFileSync(path.join(root, filename), 'utf8');
      expect(html, filename).not.to.include('node-input-alarm-panel');
      expect(html, filename).not.to.include('<label>WEB PAGE</label>');
    }
  });

  it('registers every inline editor definition', function () {
    const root = path.join(__dirname, '..', 'nodes');
    const expectedTypes = {
      'AlarmSystemUltimate.html': 'AlarmSystemUltimate',
      'AlarmUltimateZone.html': 'AlarmUltimateZone',
      'AlarmUltimateState.html': 'AlarmUltimateState',
      'AlarmUltimateSiren.html': 'AlarmUltimateSiren',
    };

    for (const [filename, expectedType] of Object.entries(expectedTypes)) {
      const html = fs.readFileSync(path.join(root, filename), 'utf8');
      const scriptMatch = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/);
      expect(scriptMatch, filename).not.to.equal(null);

      const registered = [];
      vm.runInNewContext(scriptMatch[1], {
        RED: {
          nodes: {
            registerType(type, definition) {
              registered.push({ type, definition });
            },
          },
          validators: {
            number() {
              return () => true;
            },
          },
        },
      });
      expect(registered.map((entry) => entry.type), filename).to.deep.equal([expectedType]);

      if (expectedType === 'AlarmUltimateState') {
        const definition = registered[0].definition;
        expect(definition.inputs).to.equal(0);
        expect(definition.outputs).to.equal(1);

        const inputNode = { io: 'in', wires: [[]] };
        definition.onadd.call(inputNode);
        expect(inputNode.inputs).to.equal(1);
        expect(inputNode.outputs).to.equal(0);
        expect(inputNode.wires).to.deep.equal([]);
      }
    }
  });

  it('lists Alarm System nodes from the editor model', function () {
    const root = path.join(__dirname, '..', 'nodes');
    const selectorFiles = [
      'AlarmUltimateZone.html',
      'AlarmUltimateState.html',
      'AlarmUltimateSiren.html',
    ];

    for (const filename of selectorFiles) {
      const html = fs.readFileSync(path.join(root, filename), 'utf8');
      expect(html, filename).to.include('RED.nodes.eachNode');
      expect(html, filename).to.include('n.type === "AlarmSystemUltimate"');
      expect(html, filename).not.to.include('alarm-ultimate/alarm/nodes');
    }
  });

  it('keeps the Ingress prefix in every Dashboard V2 panel example', function () {
    const example = require('../examples/alarm-ultimate-dashboard-v2.json');
    const widgets = example.filter(
      (node) => typeof node.format === 'string' && node.format.includes('alarm-ultimate/alarm-panel')
    );

    expect(widgets).to.have.length(3);
    for (const widget of widgets) {
      expect(widget.format).to.include('new URL(`alarm-ultimate/alarm-panel');
      expect(widget.format).to.include('`, setupUrl).toString()');
      expect(widget.format).not.to.include('${root}alarm-ultimate/alarm-panel');
    }

    const setupUrl = new URL(
      '../_setup',
      'http://homeassistant.local:8123/api/hassio_ingress/session-token/dashboard/panel'
    );
    expect(new URL('alarm-ultimate/alarm-panel', setupUrl).pathname).to.equal(
      '/api/hassio_ingress/session-token/alarm-ultimate/alarm-panel'
    );
  });
});
