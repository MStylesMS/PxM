'use strict';

const { LaunchCoordinator } = require('./passport');
const { LaunchRegistry } = require('./launchRegistry');
const { localDateKey } = require('./proposedName');
const { normalizeOccupancy, isSolvedFamily } = require('./occupancy');
const { pickNext, planProfile } = require('./handoff');

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

    this.publishState();

    if (
      this.config.autoHandoff &&
      prev === 'running' &&
      next === 'ending' &&
      isSolvedFamily(payload)
    ) {
      this.promote({ from: slotId, source: 'auto' });
    }
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
    if (passport) this.passports[picked.to] = { ...passport };
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
      chambers[id] = {
        role: slot.role,
        status: this.occupancy[id],
        groupId: pass ? pass.groupId : null,
        name: pass ? pass.name : null,
      };
    }
    const required = this.config.bridgesRequired.length
      ? this.config.bridgesRequired
      : this.config.slotIds.slice(1);
    const bridgesOk = required.every((id) => this.occupancy[id] !== 'offline');
    return {
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
  }

  publishState(extra = {}) {
    const snap = Object.assign(this.snapshot(), extra);
    this.publish(`${this.config.masterTopic}/state`, snap, { retain: true });
    return snap;
  }
}

module.exports = { PxmEngine };
