'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { pickNext, planProfile } = require('../src/handoff');

describe('pickNext first_ready', () => {
  const from = { id: 'chamber_1', next: ['chamber_2'] };

  it('allows promote when next is ready', () => {
    const r = pickNext(from, { chamber_2: 'ready' });
    assert.equal(r.ok, true);
    assert.equal(r.to, 'chamber_2');
  });

  it('refuses and stalls when next is running', () => {
    const r = pickNext(from, { chamber_2: 'running' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'next-busy');
    assert.equal(r.stall, true);
  });

  it('refuses without stall when next is offline', () => {
    const r = pickNext(from, { chamber_2: 'offline' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'next-offline');
    assert.equal(r.stall, false);
  });

  it('picks the first ready Y candidate', () => {
    const y = { next: ['chamber_2a', 'chamber_2b'] };
    const r = pickNext(y, { chamber_2a: 'running', chamber_2b: 'ready' });
    assert.equal(r.ok, true);
    assert.equal(r.to, 'chamber_2b');
  });
});

describe('planProfile', () => {
  it('expands topics and attaches passport', () => {
    const planned = planProfile([
      { delayMs: 0, topic: '{from}/commands', payload: { command: 'openDoor' } },
      { delayMs: 45, topic: '{to}/commands', payload: { command: 'start', attach_passport: true } },
    ], { fromTopic: 'paradox/tfd/elevator', toTopic: 'paradox/tfd/generator' }, { groupId: 'g1', name: 'A' });
    assert.equal(planned[0].topic, 'paradox/tfd/elevator/commands');
    assert.equal(planned[1].payload.command, 'start');
    assert.equal(planned[1].payload.groupId, 'g1');
    assert.equal(planned[1].payload.attach_passport, undefined);
  });
});
