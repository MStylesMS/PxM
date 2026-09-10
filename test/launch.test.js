'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { LaunchCoordinator } = require('../src/passport');
const { LaunchRegistry } = require('../src/launchRegistry');
const { proposedGroupName, localDateKey, displayDate } = require('../src/proposedName');

describe('proposedGroupName', () => {
  const noon = new Date(2026, 8, 9, 12, 0, 0);
  it('formats Group X on MM/DD/YYYY', () => {
    assert.equal(proposedGroupName(1, noon), 'Group 1 on 09/09/2026');
    assert.equal(displayDate(noon), '09/09/2026');
    assert.equal(localDateKey(noon), '2026-09-09');
  });
});

describe('LaunchCoordinator startGroup', () => {
  const now = new Date(2026, 8, 9, 15, 30, 0);

  it('rejects launch when chamber 1 is not ready', () => {
    const pxm = new LaunchCoordinator({ registry: new LaunchRegistry() });
    const r = pxm.startGroup({ name: 'Nope' }, { chamber1Ready: false, now });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'chamber_1-not-ready');
    assert.equal(pxm.snapshot(now).groupsToday, 0);
  });

  it('fills groupId, game, and proposed name when GM leaves name blank', () => {
    const pxm = new LaunchCoordinator({ registry: new LaunchRegistry() });
    const r = pxm.startGroup({ size: 4, types: ['family'] }, { now });
    assert.equal(r.ok, true);
    assert.match(r.passport.groupId, /^[0-9a-f-]{36}$/i);
    assert.equal(r.passport.game, 'tfd');
    assert.equal(r.passport.name, 'Group 1 on 09/09/2026');
    assert.equal(r.proposedNameUsed, true);
  });

  it('keeps a GM override and still increments the daily sequence', () => {
    const pxm = new LaunchCoordinator({ registry: new LaunchRegistry() });
    const a = pxm.startGroup({ name: 'Smith party' }, { now });
    const b = pxm.startGroup({ name: '   ' }, { now });
    assert.equal(a.passport.name, 'Smith party');
    assert.equal(b.passport.name, 'Group 2 on 09/09/2026');
    assert.equal(pxm.snapshot(now).nextGroupName, 'Group 3 on 09/09/2026');
  });
});
