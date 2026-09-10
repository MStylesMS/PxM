'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { writeSampleConfig } = require('./helpers');

describe('loadConfig', () => {
  it('loads slots and handoff steps', () => {
    const cfg = writeSampleConfig();
    assert.equal(cfg.game, 'tfd');
    assert.equal(cfg.firstSlot, 'chamber_1');
    assert.deepEqual(cfg.slots.chamber_1.next, ['chamber_2']);
    assert.equal(cfg.profiles['ch1-to-ch2'].length, 3);
    assert.equal(cfg.profiles['ch1-to-ch2'][2].delayMs, 45000);
    assert.equal(cfg.autoHandoff, false);
  });
});
