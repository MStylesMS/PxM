'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PxmEngine } = require('../src/engine');
const { LaunchRegistry } = require('../src/launchRegistry');
const { writeSampleConfig, RecordingBus, fakeClock } = require('./helpers');

function makeEngine(opts = {}) {
  const config = writeSampleConfig();
  if (opts.autoHandoff) config.autoHandoff = true;
  const bus = new RecordingBus();
  const clock = fakeClock();
  const engine = new PxmEngine({
    config,
    publish: (t, p, o) => bus.publish(t, p, o),
    registry: new LaunchRegistry(),
    now: clock.now,
    schedule: clock.schedule,
  });
  return { engine, bus, clock, config };
}

describe('PxmEngine startGroup', () => {
  it('rejects when first slot is not ready', () => {
    const { engine } = makeEngine();
    const r = engine.startGroup({ name: 'Nope' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'chamber_1-not-ready');
  });

  it('starts chamber_1 with a minted passport', () => {
    const { engine, bus } = makeEngine();
    engine.applyChamberState('chamber_1', { gameState: 'ready' });
    const now = new Date(2026, 8, 9, 10, 0, 0);
    engine.nowFn = () => now.getTime();
    const r = engine.startGroup({ size: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.passport.name, 'Group 1 on 09/09/2026');
    const starts = bus.commands('paradox/tfd/elevator');
    assert.equal(starts.length, 1);
    assert.equal(starts[0].payload.command, 'start');
    assert.equal(starts[0].payload.groupId, r.passport.groupId);
    assert.equal(starts[0].payload.mediaId, undefined);
    const state = bus.of('paradox/tfd/master/state').pop();
    assert.equal(state.payload.nextGroupName, 'Group 2 on 09/09/2026');
    assert.equal(state.retain, true);
    assert.equal(state.payload.mediaCatalog, undefined);
    assert.equal(state.payload.defaultMediaId, undefined);
    assert.equal(state.payload.chambers.chamber_1.mediaId, undefined);
  });
});

describe('PxmEngine promote / collision', () => {
  it('runs ch1-to-ch2 profile when generator is ready', () => {
    const { engine, bus, clock } = makeEngine();
    engine.applyChamberState('chamber_1', { gameState: 'ready' });
    engine.applyChamberState('chamber_2', { gameState: 'ready' });
    engine.startGroup({ name: 'Crew', groupId: 'g-1' });
    engine.applyChamberState('chamber_1', { gameState: 'gameplay' });
    engine.applyChamberState('chamber_1', { gameState: 'solved' });

    const r = engine.promote({ from: 'chamber_1' });
    assert.equal(r.ok, true);
    assert.equal(r.to, 'chamber_2');

    const elev = bus.commands('paradox/tfd/elevator').filter((m) => m.payload.command === 'openDoor');
    const genPrep = bus.commands('paradox/tfd/generator').filter((m) => m.payload.command === 'prepare');
    const genStart = bus.commands('paradox/tfd/generator').filter((m) => m.payload.command === 'start');
    assert.equal(elev.length, 1);
    assert.equal(genPrep.length, 1);
    assert.equal(genStart.length, 0);
    clock.advance(45000);
    const started = bus.commands('paradox/tfd/generator').filter((m) => m.payload.command === 'start');
    assert.equal(started.length, 1);
    assert.equal(started[0].payload.groupId, 'g-1');
  });

  it('refuses promote and publishes stall when next is running', () => {
    const { engine, bus } = makeEngine();
    engine.applyChamberState('chamber_1', { gameState: 'ready' });
    engine.startGroup({ name: 'A', groupId: 'g-a' });
    engine.applyChamberState('chamber_1', { gameState: 'solved' });
    engine.applyChamberState('chamber_2', { gameState: 'gameplay' });

    const r = engine.promote({ from: 'chamber_1' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'next-busy');
    assert.equal(r.stall, true);
    const stall = bus.commands('paradox/tfd/elevator').filter((m) => m.payload.command === 'promoteRefused');
    assert.equal(stall.length, 1);
    const genStart = bus.commands('paradox/tfd/generator').filter((m) => m.payload.command === 'start');
    assert.equal(genStart.length, 0);
  });
});
