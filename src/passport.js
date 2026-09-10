'use strict';

const { LaunchRegistry } = require('./launchRegistry');
const { localDateKey } = require('./proposedName');

function randomGroupId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const { randomUUID } = require('crypto');
  return randomUUID();
}

function normalizeTypes(raw) {
  if (raw == null || raw === '') return [];
  let list = raw;
  if (typeof raw === 'string') {
    list = raw.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const t = String(item).replace(/^:/, '').trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function pick(src, nested, ...keys) {
  for (const k of keys) {
    if (src[k] !== undefined && src[k] !== null && src[k] !== '') return src[k];
    if (nested[k] !== undefined && nested[k] !== null && nested[k] !== '') return nested[k];
  }
  return undefined;
}

function buildPassport(cmd, { proposedName, now, defaultGame }) {
  const src = cmd && typeof cmd === 'object' ? cmd : {};
  const nested = src.passport && typeof src.passport === 'object' ? src.passport : {};

  let groupId = pick(src, nested, 'groupId', 'group_id', 'groupID');
  if (!groupId) groupId = randomGroupId();
  groupId = String(groupId).trim();

  const typedName = pick(src, nested, 'name', 'groupName', 'group_name');
  const name = (typedName != null && String(typedName).trim())
    ? String(typedName).trim()
    : proposedName;

  const sizeRaw = pick(src, nested, 'size', 'groupSize', 'group_size', 'players');
  let size = null;
  if (sizeRaw !== undefined && sizeRaw !== null && sizeRaw !== '') {
    const n = Number(sizeRaw);
    if (Number.isFinite(n) && n >= 0) size = n;
  }

  const types = normalizeTypes(pick(src, nested, 'types', 'type', 'tags'));
  const notesRaw = pick(src, nested, 'notes', 'note');
  const gameRaw = pick(src, nested, 'game', 'room', 'gameSlug', 'game_slug');
  const startedAt = pick(src, nested, 'startedAt', 'started_at')
    || new Date(now || Date.now()).toISOString();

  const passport = {
    groupId,
    game: gameRaw != null && String(gameRaw).trim() ? String(gameRaw).trim() : defaultGame,
    name,
    startedAt,
  };
  if (size != null) passport.size = size;
  if (types.length) passport.types = types;
  if (notesRaw != null && String(notesRaw).trim()) passport.notes = String(notesRaw).trim();
  return passport;
}

class LaunchCoordinator {
  constructor({ registry, defaultGame = 'tfd' } = {}) {
    this.registry = registry || new LaunchRegistry();
    this.defaultGame = defaultGame;
  }

  snapshot(now) {
    const date = now != null ? new Date(now) : new Date();
    const groupsToday = this.registry.count(date);
    return {
      today: localDateKey(date),
      groupsToday,
      nextGroupIndex: groupsToday + 1,
      nextGroupName: this.registry.proposedName(date),
    };
  }

  startGroup(cmd, opts = {}) {
    if (opts.chamber1Ready === false) {
      return { ok: false, reason: 'chamber_1-not-ready' };
    }
    const date = opts.now != null ? new Date(opts.now) : new Date();
    const proposedName = this.registry.proposedName(date);
    const passport = buildPassport(cmd, {
      proposedName,
      now: date,
      defaultGame: this.defaultGame,
    });
    const rec = this.registry.record(passport, date);
    return {
      ok: true,
      passport,
      index: rec.index,
      groupsToday: rec.groupsToday,
      nextGroupName: rec.nextGroupName,
      nextGroupIndex: rec.nextIndex,
      proposedNameUsed: passport.name === proposedName,
    };
  }
}

module.exports = {
  LaunchCoordinator,
  buildPassport,
  normalizeTypes,
  randomGroupId,
};
