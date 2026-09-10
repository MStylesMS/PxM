'use strict';

const { isBusy } = require('./occupancy');

/**
 * Pick the next slot for a linear (or Y) edge.
 * v0 policy: first_ready only.
 *
 * @param {{ next: string[], nextPolicy?: string, id?: string }} fromSlot
 * @param {Record<string, 'ready'|'running'|'ending'|'offline'>} occupancy
 */
function pickNext(fromSlot, occupancy = {}) {
  const candidates = (fromSlot && fromSlot.next) || [];
  if (!candidates.length) {
    return { ok: false, reason: 'no-next', stall: false };
  }

  const policy = (fromSlot.nextPolicy || 'first_ready').toLowerCase();
  if (policy !== 'first_ready') {
    // Config-shaped only in v0.
  }

  for (const id of candidates) {
    if (occupancy[id] === 'ready') {
      return { ok: true, to: id };
    }
  }

  const first = candidates[0];
  const status = occupancy[first] || 'offline';
  if (status === 'offline') {
    return { ok: false, reason: 'next-offline', stall: false, to: first };
  }
  return {
    ok: false,
    reason: 'next-busy',
    stall: isBusy(status),
    to: first,
  };
}

function expandTopic(template, ctx) {
  return String(template || '')
    .replace(/\{from\}/g, ctx.fromTopic || '')
    .replace(/\{to\}/g, ctx.toTopic || '');
}

function expandPayload(payload, passport) {
  if (!payload || typeof payload !== 'object') return payload;
  const attach = payload.attach_passport === true || payload._passport === true;
  const copy = { ...payload };
  delete copy.attach_passport;
  delete copy._passport;
  if (!attach || !passport) return copy;
  return Object.assign({}, copy, passport, { passport: { ...passport } });
}

/**
 * Turn an INI profile into scheduled publishes (delays are cumulative per step).
 */
function planProfile(steps, ctx, passport) {
  if (!Array.isArray(steps)) return [];
  return steps.map((step) => ({
    delayMs: Number(step.delayMs) || 0,
    topic: expandTopic(step.topic, ctx),
    payload: expandPayload(step.payload, passport),
  }));
}

module.exports = {
  pickNext,
  expandTopic,
  expandPayload,
  planProfile,
};
