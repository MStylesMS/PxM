'use strict';

const fs = require('fs');
const path = require('path');
const ini = require('ini');
const { parseMediaCatalog, parseSlotMedia } = require('./media');

function truthy(v) {
  if (v === true || v === 1) return true;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

function csv(v) {
  return String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseSteps(section) {
  if (!section || typeof section !== 'object') return [];
  const steps = [];
  for (const [key, raw] of Object.entries(section)) {
    const m = /^step_(\d+)$/i.exec(key);
    if (!m) continue;
    const parts = String(raw).split('|').map((s) => s.trim());
    const delayMs = Number(parts[0]) || 0;
    const topic = parts[1] || '';
    const json = parts.slice(2).join('|');
    let payload = {};
    if (json) {
      try { payload = JSON.parse(json); } catch {
        payload = { command: json };
      }
    }
    steps.push({ n: Number(m[1]), delayMs, topic, payload });
  }
  steps.sort((a, b) => a.n - b.n);
  return steps.map(({ delayMs, topic, payload }) => ({ delayMs, topic, payload }));
}

function loadConfig(filePath) {
  const resolved = path.resolve(filePath);
  const text = fs.readFileSync(resolved, 'utf8');
  const raw = ini.parse(text);
  const global = raw.global || {};
  const gm = raw.gm || {};
  const passport = raw.passport || {};
  const chambersSec = raw.chambers || {};

  const slotIds = csv(chambersSec.slots);
  const chamberTree = raw.chamber && typeof raw.chamber === 'object' ? raw.chamber : {};
  const slots = {};
  for (const id of slotIds) {
    const sec = chamberTree[id] || raw[`chamber.${id}`] || {};
    slots[id] = {
      id,
      role: String(sec.role || id).trim(),
      gameTopic: String(sec.game_topic || '').trim(),
      next: csv(sec.next),
      nextPolicy: String(sec.next_policy || 'first_ready').trim(),
      handoff: sec.handoff ? String(sec.handoff).trim() : null,
      stall: sec.stall ? String(sec.stall).trim() : null,
      isLast: truthy(sec.is_last),
      media: parseSlotMedia(sec, csv),
    };
  }

  const { catalog: mediaCatalog, defaultMediaId, warnings: mediaWarnings } = parseMediaCatalog(raw);

  const profiles = {};
  const handoffTree = raw.handoff && typeof raw.handoff === 'object' ? raw.handoff : {};
  const stallTree = raw.stall && typeof raw.stall === 'object' ? raw.stall : {};
  for (const [name, sec] of Object.entries(handoffTree)) {
    if (sec && typeof sec === 'object') profiles[name] = parseSteps(sec);
  }
  for (const [name, sec] of Object.entries(stallTree)) {
    if (sec && typeof sec === 'object') profiles[name] = parseSteps(sec);
  }

  const firstSlot = slotIds[0] || null;
  const logDir = String(global.log_directory || '/opt/paradox/logs/pxm').trim();

  return {
    filePath: resolved,
    game: String(global.game || 'tfd').trim(),
    mqttUrl: String(global.listen_mqtt || 'mqtt://127.0.0.1:1883').trim(),
    logDirectory: logDir,
    autoHandoff: truthy(global.auto_handoff),
    offlineMs: Number(global.offline_ms) || 20000,
    bridgesRequired: csv(global.bridges_required),
    masterTopic: String(gm.base_topic || 'paradox/tfd/master').trim(),
    launchRegistryPath: String(passport.launch_registry || path.join(logDir, 'launches.json')).trim(),
    slotIds,
    slots,
    firstSlot,
    profiles,
    mediaCatalog,
    defaultMediaId,
    mediaWarnings,
  };
}

module.exports = { loadConfig, parseSteps, truthy, csv };
