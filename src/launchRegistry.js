'use strict';

const fs = require('fs');
const path = require('path');
const { localDateKey, proposedGroupName } = require('./proposedName');

function emptyState() {
  return { days: {} };
}

function dayEntry(state, dateKey) {
  if (!state.days[dateKey]) {
    state.days[dateKey] = { count: 0, launches: [] };
  }
  return state.days[dateKey];
}

class LaunchRegistry {
  constructor({ filePath } = {}) {
    this.filePath = filePath || null;
    this.state = emptyState();
    this.load();
  }

  load() {
    if (!this.filePath) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.days && typeof parsed.days === 'object') {
        this.state = parsed;
      }
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        this.state = emptyState();
      }
    }
  }

  save() {
    if (!this.filePath) return;
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  count(date) {
    const key = localDateKey(date);
    const day = this.state.days[key];
    return day && Number.isFinite(day.count) ? day.count : 0;
  }

  nextIndex(date) {
    return this.count(date) + 1;
  }

  proposedName(date) {
    return proposedGroupName(this.nextIndex(date), date);
  }

  record(passport, date) {
    const key = localDateKey(date);
    const day = dayEntry(this.state, key);
    day.count += 1;
    const entry = {
      index: day.count,
      groupId: passport && passport.groupId ? passport.groupId : null,
      name: passport && passport.name != null ? String(passport.name) : null,
      startedAt: (passport && passport.startedAt) || new Date(date || Date.now()).toISOString(),
    };
    day.launches.push(entry);
    this.save();
    return {
      index: day.count,
      dateKey: key,
      nextIndex: day.count + 1,
      nextGroupName: proposedGroupName(day.count + 1, date),
      groupsToday: day.count,
    };
  }
}

module.exports = { LaunchRegistry };
