'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { writeSampleConfig, MEDIA_INI } = require('./helpers');

describe('loadConfig', () => {
  it('loads slots and handoff steps', () => {
    const cfg = writeSampleConfig();
    assert.equal(cfg.game, 'tfd');
    assert.equal(cfg.firstSlot, 'chamber_1');
    assert.deepEqual(cfg.slots.chamber_1.next, ['chamber_2']);
    assert.equal(cfg.profiles['ch1-to-ch2'].length, 3);
    assert.equal(cfg.profiles['ch1-to-ch2'][2].delayMs, 45000);
    assert.equal(cfg.autoHandoff, false);
    assert.deepEqual(cfg.mediaCatalog, []);
    assert.equal(cfg.defaultMediaId, undefined);
  });

  it('loads media catalog from [media.1] / [media.2]', () => {
    const cfg = writeSampleConfig(MEDIA_INI);
    assert.equal(cfg.defaultMediaId, 1);
    assert.equal(cfg.mediaCatalog.length, 2);
    assert.deepEqual(cfg.mediaCatalog[0], {
      id: 1,
      slug: '1',
      name: 'English — original trailer',
      shortName: 'English',
      description: 'Current show picture and English VO from the Crafty Fox trailer.',
      language: 'en',
    });
    assert.equal(cfg.mediaCatalog[1].id, 2);
    assert.equal(cfg.mediaCatalog[1].slug, '2');
    assert.equal(cfg.mediaCatalog[1].language, 'es');
    assert.deepEqual(cfg.slots.chamber_1.media.switchTopics, ['paradox/tfd/elevator/pfx/commands']);
    assert.deepEqual(cfg.slots.chamber_1.media.restartTopics, ['paradox/tfd/elevator/pfx/commands']);
    assert.deepEqual(cfg.slots.chamber_3.media.speechTopics, ['paradox/tfd/control/speech/commands']);
  });

  it('maps switch command topics to player state topics', () => {
    const { stateTopic, mediaIdsEqual } = require('../src/media');
    assert.equal(stateTopic('paradox/tfd/elevator/pfx'), 'paradox/tfd/elevator/pfx/state');
    assert.equal(stateTopic('paradox/tfd/elevator/pfx/commands'), 'paradox/tfd/elevator/pfx/state');
    assert.equal(mediaIdsEqual(1, '1'), true);
    assert.equal(mediaIdsEqual(null, undefined), true);
    assert.equal(mediaIdsEqual(1, null), false);
  });

  it('refuses a pack with an unknown language and still loads the others', () => {
    const cfg = writeSampleConfig(`${MEDIA_INI}
[media.3]
name = Extra
short_name = Extra
description = Bad language code
language = tlh
`);
    assert.equal(cfg.mediaCatalog.length, 2);
    assert.ok(!cfg.mediaCatalog.some((p) => p.id === 3));
    assert.equal(cfg.mediaWarnings.length, 1);
    assert.equal(cfg.mediaWarnings[0].warning, 'unknown-media-language');
    assert.equal(cfg.mediaWarnings[0].id, 3);
    assert.equal(cfg.mediaWarnings[0].language, 'tlh');
  });
});
