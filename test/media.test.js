'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PxmEngine } = require('../src/engine');
const { LaunchRegistry } = require('../src/launchRegistry');
const { writeSampleConfig, RecordingBus, fakeClock, MEDIA_INI } = require('./helpers');

function makeMediaEngine(extraIni = '') {
  const config = writeSampleConfig(MEDIA_INI + extraIni);
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

describe('media catalog + startGroup', () => {
  it('puts startGroup mediaId on the chamber start payload', () => {
    const { engine, bus } = makeMediaEngine();
    engine.applyChamberState('chamber_1', { gameState: 'ready' });
    const r = engine.startGroup({ name: 'Crew', groupId: 'g-2', mediaId: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.passport.mediaId, 2);
    const starts = bus.commands('paradox/tfd/elevator');
    assert.equal(starts.length, 1);
    assert.equal(starts[0].payload.command, 'start');
    assert.equal(starts[0].payload.mediaId, 2);
    assert.equal(starts[0].payload.passport.mediaId, 2);
    const switched = bus.of('paradox/tfd/elevator/pfx/commands')
      .filter((m) => m.payload.command === 'switchMedia');
    assert.ok(switched.length >= 1);
    const last = switched[switched.length - 1];
    assert.equal(last.payload.mediaId, 2);
    assert.equal(last.payload.refresh, false);
    const state = bus.of('paradox/tfd/master/state').pop();
    assert.equal(state.payload.chambers.chamber_1.mediaId, 2);
    assert.equal(state.payload.defaultMediaId, 1);
    assert.equal(state.payload.mediaCatalog.length, 2);
  });

  it('does not let a second slot overwrite the first slot pack', () => {
    const { engine, bus } = makeMediaEngine();
    engine.applyChamberState('chamber_1', { gameState: 'ready' });
    engine.applyChamberState('chamber_2', { gameState: 'ready' });
    engine.startGroup({ name: 'A', groupId: 'g-a', mediaId: 1 });
    engine.applyChamberState('chamber_1', { gameState: 'gameplay' });
    engine.applyChamberState('chamber_1', { gameState: 'solved' });
    const promoted = engine.promote({ from: 'chamber_1' });
    assert.equal(promoted.ok, true);
    assert.equal(engine.snapshot().chambers.chamber_2.mediaId, 1);

    engine.applyChamberState('chamber_1', { gameState: 'ready' });
    engine.startGroup({ name: 'B', groupId: 'g-b', mediaId: 2 });

    const snap = engine.snapshot();
    assert.equal(snap.chambers.chamber_1.mediaId, 2);
    assert.equal(snap.chambers.chamber_2.mediaId, 1);

    const genSwitch = bus.of('paradox/tfd/generator/pfx/commands')
      .filter((m) => m.payload.command === 'switchMedia');
    assert.ok(genSwitch.length >= 1);
    assert.ok(genSwitch.every((m) => m.payload.mediaId === 1));

    const elevSwitch = bus.of('paradox/tfd/elevator/pfx/commands')
      .filter((m) => m.payload.command === 'switchMedia');
    assert.equal(elevSwitch[elevSwitch.length - 1].payload.mediaId, 2);
  });

  it('warns and ignores an illegal mediaId on switchMedia', () => {
    const { engine, bus } = makeMediaEngine();
    engine.applyChamberState('chamber_1', { gameState: 'ready' });
    engine.startGroup({ name: 'A', groupId: 'g-a', mediaId: 1 });
    const before = engine.snapshot().chambers.chamber_1.mediaId;
    const r = engine.handleCommand({ command: 'switchMedia', mediaId: 'v1' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'illegal-media-id');
    const warns = bus.of('paradox/tfd/master/warnings')
      .filter((m) => m.payload.warning === 'illegal-media-id');
    assert.ok(warns.length >= 1);
    assert.equal(engine.snapshot().chambers.chamber_1.mediaId, before);
    const switched = bus.of('paradox/tfd/elevator/pfx/commands')
      .filter((m) => m.payload.command === 'switchMedia' && m.payload.mediaId === 'v1');
    assert.equal(switched.length, 0);
  });
});

describe('online fan-out of default pack', () => {
  it('sends switchMedia refresh when a chamber leaves offline', () => {
    const { engine, bus } = makeMediaEngine();
    engine.applyChamberState('chamber_1', { gameState: 'ready' });
    const switched = bus.of('paradox/tfd/elevator/pfx/commands')
      .filter((m) => m.payload.command === 'switchMedia');
    assert.equal(switched.length, 1);
    assert.equal(switched[0].payload.mediaId, 1);
    assert.equal(switched[0].payload.refresh, true);
    assert.equal(engine.snapshot().chambers.chamber_1.mediaId, 1);
  });
});

describe('player retained state media sync', () => {
  const elevCmd = 'paradox/tfd/elevator/pfx/commands';

  it('fans switchMedia when player reports null/undefined', () => {
    const { engine, bus } = makeMediaEngine();
    engine.applyPlayerMediaState('chamber_1', elevCmd, { application: 'pfx' });
    let switched = bus.of(elevCmd).filter((m) => m.payload.command === 'switchMedia');
    assert.equal(switched.length, 1);
    assert.equal(switched[0].payload.mediaId, 1);
    assert.equal(switched[0].payload.refresh, true);

    bus.published.length = 0;
    engine._playerSwitchAt = {};
    engine.applyPlayerMediaState('chamber_1', elevCmd, { mediaId: null });
    switched = bus.of(elevCmd).filter((m) => m.payload.command === 'switchMedia');
    assert.equal(switched.length, 1);
    assert.equal(switched[0].payload.mediaId, 1);
    assert.equal(switched[0].payload.refresh, true);
  });

  it('does not fan when player reports the matching mediaId', () => {
    const { engine, bus } = makeMediaEngine();
    engine.slotMediaIds.chamber_1 = 2;
    engine.applyPlayerMediaState('chamber_1', elevCmd, { mediaId: 2 });
    const switched = bus.of(elevCmd).filter((m) => m.payload.command === 'switchMedia');
    assert.equal(switched.length, 0);

    engine.applyPlayerMediaState('chamber_1', elevCmd, { mediaId: '2' });
    assert.equal(
      bus.of(elevCmd).filter((m) => m.payload.command === 'switchMedia').length,
      0,
    );
  });

  it('fans switchMedia when player reports a different mediaId', () => {
    const { engine, bus } = makeMediaEngine();
    engine.slotMediaIds.chamber_1 = 2;
    engine.applyPlayerMediaState('chamber_1', elevCmd, { mediaId: 1 });
    const switched = bus.of(elevCmd).filter((m) => m.payload.command === 'switchMedia');
    assert.equal(switched.length, 1);
    assert.equal(switched[0].payload.mediaId, 2);
    assert.equal(switched[0].payload.refresh, true);
    // Only that topic — not the whole slot / other chambers.
    assert.equal(
      bus.published.filter((m) => m.payload && m.payload.command === 'switchMedia').length,
      1,
    );
  });

  it('debounces per topic for at least 2s', () => {
    const { engine, bus, clock } = makeMediaEngine();
    engine.applyPlayerMediaState('chamber_1', elevCmd, { mediaId: null });
    engine.applyPlayerMediaState('chamber_1', elevCmd, { mediaId: null });
    assert.equal(
      bus.of(elevCmd).filter((m) => m.payload.command === 'switchMedia').length,
      1,
    );

    clock.advance(1999);
    engine.applyPlayerMediaState('chamber_1', elevCmd, { mediaId: null });
    assert.equal(
      bus.of(elevCmd).filter((m) => m.payload.command === 'switchMedia').length,
      1,
    );

    clock.advance(1);
    engine.applyPlayerMediaState('chamber_1', elevCmd, { mediaId: null });
    assert.equal(
      bus.of(elevCmd).filter((m) => m.payload.command === 'switchMedia').length,
      2,
    );
  });
});

describe('switchMedia fan-out + restartProcess', () => {
  it('omitting slots updates the default and idle slots only', () => {
    const { engine, bus } = makeMediaEngine();
    engine.applyChamberState('chamber_1', { gameState: 'ready' });
    engine.applyChamberState('chamber_2', { gameState: 'ready' });
    engine.startGroup({ name: 'A', groupId: 'g-a', mediaId: 1 });
    engine.applyChamberState('chamber_1', { gameState: 'gameplay' });

    const r = engine.switchMedia({ mediaId: 2, refresh: true });
    assert.equal(r.ok, true);
    const snap = engine.snapshot();
    assert.equal(snap.defaultMediaId, 2);
    assert.equal(snap.chambers.chamber_1.mediaId, 1);
    assert.equal(snap.chambers.chamber_2.mediaId, 2);

    const elev = bus.of('paradox/tfd/elevator/pfx/commands')
      .filter((m) => m.payload.command === 'switchMedia' && m.payload.mediaId === 2);
    assert.equal(elev.length, 0);
    const gen = bus.of('paradox/tfd/generator/pfx/commands')
      .filter((m) => m.payload.command === 'switchMedia' && m.payload.mediaId === 2);
    assert.equal(gen.length, 1);
    assert.equal(gen[0].payload.refresh, true);
  });

  it('copies catalog language onto speech switchMedia', () => {
    const { engine, bus } = makeMediaEngine();
    engine.switchMedia({ mediaId: 2, slots: ['chamber_3'] });
    const speech = bus.of('paradox/tfd/control/speech/commands')
      .filter((m) => m.payload.command === 'switchMedia');
    assert.equal(speech.length, 1);
    assert.equal(speech[0].payload.mediaId, 2);
    assert.equal(speech[0].payload.language, 'es');
    const hdmi = bus.of('paradox/tfd/control/pfx/hdmi/commands')
      .filter((m) => m.payload.command === 'switchMedia');
    assert.equal(hdmi.length, 1);
    assert.equal(hdmi[0].payload.language, undefined);
  });

  it('publishes { command: restart } to the configured restart topic', () => {
    const { engine, bus } = makeMediaEngine();
    const r = engine.restartProcess({ slot: 'chamber_1', process: 'pfx' });
    assert.equal(r.ok, true);
    const msgs = bus.of('paradox/tfd/elevator/pfx/commands')
      .filter((m) => m.payload.command === 'restart');
    assert.equal(msgs.length, 1);
    assert.deepEqual(msgs[0].payload, { command: 'restart' });
  });

  it('publishes unknown-language warnings at startup', () => {
    const { engine, bus } = makeMediaEngine(`
[media.3]
name = Extra
short_name = Extra
description = Bad language code
language = tlh
`);
    engine.publishState();
    const warns = bus.of('paradox/tfd/master/warnings')
      .filter((m) => m.payload.warning === 'unknown-media-language');
    assert.equal(warns.length, 1);
    assert.equal(warns[0].payload.id, 3);
    assert.equal(engine.snapshot().mediaCatalog.length, 2);
  });
});
