'use strict';

const { LaunchCoordinator } = require('./passport');
const { LaunchRegistry } = require('./launchRegistry');
const { localDateKey } = require('./proposedName');
const { normalizeOccupancy, isSolvedFamily, isFailedFamily } = require('./occupancy');
const { pickNext, planProfile } = require('./handoff');
const { sanitizeMediaId, matchRestartTopics, catalogById, mediaIdsEqual } = require('./media');
const { csv, truthy } = require('./config');

/** Min gap between switchMedia publishes to the same player topic (loop guard). */
const PLAYER_MEDIA_DEBOUNCE_MS = 2000;

class PxmEngine {
  constructor({ config, publish, registry, now, schedule } = {}) {
    if (!config) throw new Error('PxmEngine requires config');
    this.config = config;
    this.publish = publish || (() => {});
    this.nowFn = typeof now === 'function' ? now : () => Date.now();
    this.schedule = typeof schedule === 'function' ? schedule : (fn, ms) => setTimeout(fn, ms);
    this.launch = new LaunchCoordinator({
      registry: registry || new LaunchRegistry({ filePath: config.launchRegistryPath }),
      defaultGame: config.game,
    });

    this.occupancy = {};
    this.lastSeen = {};
    this.passports = {};
    this.prevOccupancy = {};
    this.timers = [];
    this.slotMediaIds = {};
    this.defaultMediaId = config.defaultMediaId;
    this._configWarningsPublished = false;
    /** @type {Record<string, number>} last switchMedia publish time per command topic */
    this._playerSwitchAt = {};

    for (const id of config.slotIds) {
      this.occupancy[id] = 'offline';
      this.prevOccupancy[id] = 'offline';
    }
  }

  now() {
    return this.nowFn();
  }

  applyChamberState(slotId, payload) {
    const slot = this.config.slots[slotId];
    if (!slot) return;
    this.lastSeen[slotId] = this.now();
    const next = normalizeOccupancy(payload);
    const prev = this.occupancy[slotId];
    this.prevOccupancy[slotId] = prev;
    this.occupancy[slotId] = next;

    if (next === 'ready') {
      delete this.passports[slotId];
    }

    // Players start with omit-mediaId paths. After a pack tree lives under
    // {media_dir}/{id}/, they must receive switchMedia when they come online
    // (PxM may have booted first; commands are not retained).
    if (prev === 'offline' && next !== 'offline') {
      this._ensureSlotMedia(slotId, true);
    }

    this.publishState();

    if (
      this.config.autoHandoff &&
      this.passports[slotId] &&
      prev === 'running' &&
      next === 'ending' &&
      (isSolvedFamily(payload) || isFailedFamily(payload))
    ) {
      this.promote({ from: slotId, source: 'auto' });
    }
  }

  /**
   * Retained PFx/PxT `{base}/state`: if payload.mediaId ≠ assigned pack for the
   * slot, publish switchMedia to that player's `{base}/commands` only.
   * Debounced per topic so our own fan-out cannot loop.
   */
  applyPlayerMediaState(slotId, commandTopic, payload) {
    if (!this.config.slots[slotId] || !commandTopic) return;
    const assigned = this._assignedMediaId(slotId);
    const reported = payload && typeof payload === 'object' ? payload.mediaId : undefined;
    if (mediaIdsEqual(assigned, reported)) return;

    const last = this._playerSwitchAt[commandTopic] || 0;
    if (this.now() - last < PLAYER_MEDIA_DEBOUNCE_MS) return;

    this._publishSwitchTopic(slotId, commandTopic, assigned, true);
  }

  markOfflineStale() {
    const limit = this.config.offlineMs;
    const t = this.now();
    let changed = false;
    for (const id of this.config.slotIds) {
      const seen = this.lastSeen[id];
      if (!seen || t - seen > limit) {
        if (this.occupancy[id] !== 'offline') {
          this.occupancy[id] = 'offline';
          changed = true;
        }
      }
    }
    if (changed) this.publishState();
  }

  handleCommand(cmd) {
    if (!cmd || typeof cmd !== 'object') {
      return { ok: false, reason: 'bad-command' };
    }
    const name = String(cmd.command || cmd.cmd || '').trim();
    if (name === 'startGroup') return this.startGroup(cmd);
    if (name === 'promote') return this.promote(cmd);
    if (name === 'abortGroup') return this.abortGroup(cmd);
    if (name === 'switchMedia') return this.switchMedia(cmd);
    if (name === 'restartProcess') return this.restartProcess(cmd);
    return { ok: false, reason: 'unknown-command', command: name };
  }

  startGroup(cmd) {
    const first = this.config.firstSlot;
    if (!first) return this.fail('no-first-slot');
    if (this.occupancy[first] !== 'ready') {
      return this.fail('chamber_1-not-ready', { slot: first, occupancy: this.occupancy[first] });
    }
    const result = this.launch.startGroup(cmd, {
      chamber1Ready: true,
      now: this.now(),
    });
    if (!result.ok) return result;

    this._applyStartMedia(result.passport, cmd, first);
    this.passports[first] = result.passport;
    const topic = `${this.config.slots[first].gameTopic}/commands`;
    this.publish(topic, Object.assign({ command: 'start' }, result.passport, {
      passport: { ...result.passport },
    }));
    this.publishEvent('group_started', { slot: first, passport: result.passport });
    this.publishState();
    return result;
  }

  promote(cmd = {}) {
    const fromId = this._resolveFromSlot(cmd);
    if (!fromId) return this.fail('promote-from-unknown');
    const fromSlot = this.config.slots[fromId];
    const picked = pickNext(fromSlot, this.occupancy);
    const passport = this.passports[fromId] || cmd.passport || null;

    if (!picked.ok) {
      if (picked.stall && fromSlot.stall) {
        this._runProfile(fromSlot.stall, {
          fromTopic: fromSlot.gameTopic,
          toTopic: picked.to ? (this.config.slots[picked.to] || {}).gameTopic : '',
        }, passport);
      }
      this.publishEvent('promote_refused', {
        from: fromId,
        reason: picked.reason,
        to: picked.to || null,
      });
      this.publishState({ collisionActive: !!picked.stall });
      return { ok: false, reason: picked.reason, stall: !!picked.stall, to: picked.to };
    }

    const toSlot = this.config.slots[picked.to];
    if (passport) {
      this.passports[picked.to] = { ...passport };
      delete this.passports[fromId];
      if (passport.mediaId != null) {
        this.slotMediaIds[picked.to] = passport.mediaId;
        this._fanOutSwitch(picked.to, passport.mediaId, false);
      }
    }
    const profileName = fromSlot.handoff;
    if (profileName) {
      this._runProfile(profileName, {
        fromTopic: fromSlot.gameTopic,
        toTopic: toSlot.gameTopic,
      }, passport);
    } else {
      this.publish(`${toSlot.gameTopic}/commands`, Object.assign({ command: 'start' }, passport || {}, {
        passport: passport ? { ...passport } : undefined,
      }));
    }
    this.publishEvent('promoted', { from: fromId, to: picked.to, groupId: passport && passport.groupId });
    this.publishState({ collisionActive: false });
    return { ok: true, from: fromId, to: picked.to };
  }

  abortGroup(cmd = {}) {
    const groupId = cmd.groupId || (cmd.passport && cmd.passport.groupId);
    const targets = [];
    for (const [slotId, pass] of Object.entries(this.passports)) {
      if (!groupId || (pass && pass.groupId === groupId)) targets.push(slotId);
    }
    if (!targets.length && this.config.firstSlot) targets.push(this.config.firstSlot);
    for (const slotId of targets) {
      const slot = this.config.slots[slotId];
      if (!slot) continue;
      this.publish(`${slot.gameTopic}/commands`, { command: 'abort', groupId: groupId || undefined });
      delete this.passports[slotId];
    }
    this.publishEvent('group_aborted', { groupId: groupId || null, slots: targets });
    this.publishState();
    return { ok: true, slots: targets };
  }

  switchMedia(cmd = {}) {
    let mediaId = null;
    if (cmd.mediaId !== null) {
      const parsed = sanitizeMediaId(cmd.mediaId);
      if (!parsed.ok) {
        this.publishWarning('illegal-media-id', { mediaId: cmd.mediaId });
        return this.fail('illegal-media-id', { mediaId: cmd.mediaId });
      }
      mediaId = parsed.value;
    }

    const refresh = truthy(cmd.refresh);
    const listed = this._listedSlots(cmd.slots);
    let targets;
    if (!listed) {
      if (this._catalogLoaded()) this.defaultMediaId = mediaId;
      targets = this.config.slotIds.filter((id) => this.occupancy[id] !== 'running');
    } else {
      targets = listed;
    }

    for (const slotId of targets) {
      if (mediaId == null) delete this.slotMediaIds[slotId];
      else this.slotMediaIds[slotId] = mediaId;
      this._fanOutSwitch(slotId, mediaId, refresh);
    }
    this.publishEvent('media_switched', { mediaId, refresh, slots: targets });
    this.publishState();
    return { ok: true, mediaId, refresh, slots: targets };
  }

  restartProcess(cmd = {}) {
    const slotId = this._resolveNamedSlot(cmd.slot || cmd.chamber);
    const slot = slotId && this.config.slots[slotId];
    if (!slot) return this.fail('unknown-slot', { slot: cmd.slot });
    const process = cmd.process != null ? String(cmd.process).trim() : '';
    if (!process) return this.fail('process-required', { slot: slotId });
    const topics = matchRestartTopics((slot.media && slot.media.restartTopics) || [], process);
    if (!topics.length) {
      return this.fail('unknown-restart-process', { slot: slotId, process });
    }
    for (const topic of topics) {
      this.publish(topic, { command: 'restart' });
    }
    this.publishEvent('process_restarted', { slot: slotId, process, topics });
    return { ok: true, slot: slotId, process, topics };
  }

  _catalogLoaded() {
    return Array.isArray(this.config.mediaCatalog) && this.config.mediaCatalog.length > 0;
  }

  _listedSlots(raw) {
    if (raw == null || raw === '') return null;
    const names = Array.isArray(raw) ? raw.map((s) => String(s).trim()).filter(Boolean) : csv(raw);
    if (!names.length) return null;
    const out = [];
    for (const name of names) {
      if (this.config.slots[name]) {
        out.push(name);
        continue;
      }
      const byRole = this.config.slotIds.find((id) => this.config.slots[id].role === name);
      if (byRole) out.push(byRole);
    }
    return out;
  }

  _applyStartMedia(passport, cmd, slotId) {
    const raw = (cmd && cmd.mediaId != null && cmd.mediaId !== '')
      ? cmd.mediaId
      : (cmd && cmd.passport && cmd.passport.mediaId != null && cmd.passport.mediaId !== ''
        ? cmd.passport.mediaId
        : undefined);
    let mediaId;
    if (raw !== undefined) {
      const parsed = sanitizeMediaId(raw);
      if (!parsed.ok) {
        this.publishWarning('illegal-media-id', { mediaId: raw });
        mediaId = this.defaultMediaId;
      } else {
        mediaId = parsed.value;
      }
    } else if (passport.mediaId != null) {
      mediaId = passport.mediaId;
    } else {
      mediaId = this.defaultMediaId;
    }
    if (mediaId == null) {
      delete passport.mediaId;
      return;
    }
    passport.mediaId = mediaId;
    this.slotMediaIds[slotId] = mediaId;
    this._fanOutSwitch(slotId, mediaId, false);
  }

  _assignedMediaId(slotId) {
    return this.slotMediaIds[slotId] != null
      ? this.slotMediaIds[slotId]
      : this.defaultMediaId;
  }

  _ensureSlotMedia(slotId, refresh) {
    const mediaId = this._assignedMediaId(slotId);
    if (mediaId == null) return;
    this.slotMediaIds[slotId] = mediaId;
    this._fanOutSwitch(slotId, mediaId, refresh);
  }

  _publishSwitchTopic(slotId, topic, mediaId, refresh) {
    const slot = this.config.slots[slotId];
    if (!slot || !slot.media || !topic) return;
    const pack = catalogById(this.config.mediaCatalog, mediaId);
    const speechSet = new Set(slot.media.speechTopics || []);
    const payload = { command: 'switchMedia', mediaId, refresh: !!refresh };
    if (speechSet.has(topic) && pack) payload.language = pack.language;
    this.publish(topic, payload);
    this._playerSwitchAt[topic] = this.now();
  }

  _fanOutSwitch(slotId, mediaId, refresh) {
    const slot = this.config.slots[slotId];
    if (!slot || !slot.media) return;
    const seen = new Set();
    const topics = [...(slot.media.switchTopics || []), ...(slot.media.speechTopics || [])];
    for (const topic of topics) {
      if (!topic || seen.has(topic)) continue;
      seen.add(topic);
      this._publishSwitchTopic(slotId, topic, mediaId, refresh);
    }
  }

  _publishConfigWarnings() {
    if (this._configWarningsPublished) return;
    this._configWarningsPublished = true;
    for (const w of this.config.mediaWarnings || []) {
      const { warning, ...details } = w;
      this.publishWarning(warning, details);
    }
  }

  _resolveNamedSlot(raw) {
    if (!raw) return null;
    if (this.config.slots[raw]) return raw;
    for (const [id, slot] of Object.entries(this.config.slots)) {
      if (slot.role === raw || id === raw) return id;
    }
    return null;
  }

  _resolveFromSlot(cmd) {
    const raw = cmd.from || cmd.slot || cmd.chamber;
    if (raw && this.config.slots[raw]) return raw;
    if (raw) {
      for (const [id, slot] of Object.entries(this.config.slots)) {
        if (slot.role === raw || id === raw) return id;
      }
    }
    if (cmd.groupId) {
      for (const [id, pass] of Object.entries(this.passports)) {
        if (pass && pass.groupId === cmd.groupId) return id;
      }
    }
    // Prefer a slot that is ending (just solved) then running.
    for (const id of this.config.slotIds) {
      if (this.occupancy[id] === 'ending' && this.config.slots[id].next.length) return id;
    }
    for (const id of this.config.slotIds) {
      if (this.occupancy[id] === 'running' && this.config.slots[id].next.length) return id;
    }
    return this.config.firstSlot;
  }

  _runProfile(name, ctx, passport) {
    const steps = this.config.profiles[name] || [];
    const planned = planProfile(steps, ctx, passport);
    for (const step of planned) {
      const send = () => {
        if (step.topic) this.publish(step.topic, step.payload);
      };
      if (step.delayMs > 0) this.schedule(send, step.delayMs);
      else send();
    }
  }

  fail(reason, extra = {}) {
    this.publishEvent('command_rejected', { reason, ...extra });
    return { ok: false, reason, ...extra };
  }

  publishEvent(event, details = {}) {
    this.publish(`${this.config.masterTopic}/events`, { event, ts: new Date(this.now()).toISOString(), ...details });
  }

  publishWarning(code, details = {}) {
    this.publish(`${this.config.masterTopic}/warnings`, { warning: code, ts: new Date(this.now()).toISOString(), ...details });
  }

  snapshot() {
    const launch = this.launch.snapshot(this.now());
    const chambers = {};
    for (const id of this.config.slotIds) {
      const slot = this.config.slots[id];
      const pass = this.passports[id];
      const row = {
        role: slot.role,
        status: this.occupancy[id],
        groupId: pass ? pass.groupId : null,
        name: pass ? pass.name : null,
      };
      if (this._catalogLoaded() && this.slotMediaIds[id] != null) {
        row.mediaId = this.slotMediaIds[id];
      }
      chambers[id] = row;
    }
    const required = this.config.bridgesRequired.length
      ? this.config.bridgesRequired
      : this.config.slotIds.slice(1);
    const bridgesOk = required.every((id) => this.occupancy[id] !== 'offline');
    const snap = {
      application: 'pxm',
      game: this.config.game,
      ts: new Date(this.now()).toISOString(),
      today: launch.today || localDateKey(this.now()),
      groupsToday: launch.groupsToday,
      nextGroupIndex: launch.nextGroupIndex,
      nextGroupName: launch.nextGroupName,
      bridgesOk,
      collisionActive: false,
      chambers,
      chamber_1: chambers[this.config.firstSlot] || null,
    };
    if (this._catalogLoaded()) {
      snap.mediaCatalog = this.config.mediaCatalog;
      if (this.defaultMediaId != null) snap.defaultMediaId = this.defaultMediaId;
    }
    return snap;
  }

  publishState(extra = {}) {
    this._publishConfigWarnings();
    const snap = Object.assign(this.snapshot(), extra);
    this.publish(`${this.config.masterTopic}/state`, snap, { retain: true });
    return snap;
  }
}

module.exports = { PxmEngine, PLAYER_MEDIA_DEBOUNCE_MS };
