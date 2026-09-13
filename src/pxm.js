#!/usr/bin/env node
'use strict';

const path = require('path');
const minimist = require('minimist');
const { loadConfig } = require('./config');
const { MqttBus } = require('./mqtt');
const { PxmEngine } = require('./engine');
const { stateTopic } = require('./media');

function main(argv = process.argv.slice(2)) {
  const args = minimist(argv);
  if (args.help || args.h) {
    console.log('Usage: pxm --config /path/to/pxm.ini');
    process.exit(0);
  }
  const configPath = args.config || args.c || process.env.PXM_CONFIG
    || '/opt/paradox/config/pxm.ini';
  const config = loadConfig(configPath);
  const bus = new MqttBus({
    url: config.mqttUrl,
    clientId: `pxm-${path.basename(config.game)}-${process.pid}`,
    logger: console,
  });

  const engine = new PxmEngine({
    config,
    publish: (topic, payload, opts) => bus.publish(topic, payload, opts),
  });

  return bus.connect().then(() => {
    bus.subscribe(`${config.masterTopic}/commands`, (_topic, payload) => {
      const cmd = typeof payload === 'object' ? payload : safeJson(payload);
      const result = engine.handleCommand(cmd);
      if (!result.ok) {
        engine.publishWarning(result.reason, result);
      }
    });

    for (const id of config.slotIds) {
      const slot = config.slots[id];
      if (slot.gameTopic) {
        bus.subscribe(`${slot.gameTopic}/state`, (_topic, payload) => {
          engine.applyChamberState(id, payload);
        });
      }
      // Players may boot after the chamber offline→online fan-out; commands are
      // not retained. Sync from each switch topic's retained {base}/state.
      for (const cmdTopic of (slot.media && slot.media.switchTopics) || []) {
        const playerState = stateTopic(cmdTopic);
        if (!playerState) continue;
        bus.subscribe(playerState, (_topic, payload) => {
          engine.applyPlayerMediaState(id, cmdTopic, payload);
        });
      }
    }

    engine.publishState();
    setInterval(() => engine.markOfflineStale(), Math.min(5000, config.offlineMs));
    console.log(`[pxm] ${config.game} master on ${config.masterTopic} (${config.slotIds.join(', ')})`);
  });
}

function safeJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch { return { command: String(raw || '') }; }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[pxm] failed', err && err.message);
    process.exit(1);
  });
  const shutdown = () => process.exit(0);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { main };
