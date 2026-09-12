'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOccupancy, isSolvedFamily, isFailedFamily } = require('../src/occupancy');

describe('normalizeOccupancy', () => {
  it('maps ready / running / ending / offline', () => {
    assert.equal(normalizeOccupancy({ gameState: 'ready' }), 'ready');
    assert.equal(normalizeOccupancy({ gameState: 'intro' }), 'running');
    assert.equal(normalizeOccupancy({ gameState: 'gameplay' }), 'running');
    assert.equal(normalizeOccupancy({ gameState: 'paused' }), 'running');
    assert.equal(normalizeOccupancy({ gameState: 'solved' }), 'ending');
    assert.equal(normalizeOccupancy({ gameState: 'failed' }), 'ending');
    assert.equal(normalizeOccupancy({ gameState: 'wait_gen' }), 'ending');
    assert.equal(normalizeOccupancy(null), 'offline');
    assert.equal(normalizeOccupancy({}, { offline: true }), 'offline');
  });

  it('treats ready flag without gameState as ready', () => {
    assert.equal(normalizeOccupancy({ ready: true }), 'ready');
  });
});

describe('isSolvedFamily', () => {
  it('is true for solved / win', () => {
    assert.equal(isSolvedFamily({ gameState: 'solved' }), true);
    assert.equal(isSolvedFamily({ gameState: 'gameplay' }), false);
  });
});

describe('isFailedFamily', () => {
  it('is true for failed / timeout, not wait-gen', () => {
    assert.equal(isFailedFamily({ gameState: 'failed' }), true);
    assert.equal(isFailedFamily({ gameState: 'timeout-ending' }), true);
    assert.equal(isFailedFamily({ gameState: 'wait-gen' }), false);
    assert.equal(isFailedFamily({ gameState: 'solved' }), false);
  });
});
