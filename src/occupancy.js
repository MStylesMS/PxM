'use strict';

const ENDING = new Set([
  'solved', 'failed', 'ending', 'promoteending', 'waitgen',
  'abort', 'aborted', 'reset', 'resetting', 'sleeping',
]);

/**
 * Map a chamber PxO state payload to PxM occupancy.
 * @returns {'ready'|'running'|'ending'|'offline'}
 */
function normalizeOccupancy(payload, opts = {}) {
  if (opts.offline) return 'offline';
  if (payload == null) return 'offline';
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch {
      return classifyGameState(payload);
    }
  }
  if (typeof payload !== 'object') return 'offline';

  const raw = payload.gameState || payload.status || payload.state || '';
  const gs = String(raw).toLowerCase().replace(/[_-]/g, '');
  if (gs) return classifyGameState(gs);

  if (payload.ready === true && !payload.running) return 'ready';
  if (payload.running === true || payload.paused === true) return 'running';
  return 'offline';
}

function classifyGameState(gs) {
  const key = String(gs || '').toLowerCase().replace(/[_-]/g, '');
  if (!key) return 'offline';
  if (key === 'ready') return 'ready';
  if (ENDING.has(key)) return 'ending';
  return 'running';
}

function isSolvedFamily(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const raw = payload.gameState || payload.status || payload.state || '';
  const gs = String(raw).toLowerCase().replace(/[_-]/g, '');
  return gs === 'solved' || gs === 'win' || gs === 'promoteending';
}

function isBusy(status) {
  return status === 'running' || status === 'ending';
}

module.exports = {
  normalizeOccupancy,
  classifyGameState,
  isSolvedFamily,
  isBusy,
};
