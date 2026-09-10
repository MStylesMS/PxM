'use strict';

/**
 * Friendly GM group names. Not unique; spaces allowed.
 * Format: "Group X on MM/DD/YYYY" where X is 1-based for that local calendar day.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function asDate(date) {
  if (date instanceof Date) return date;
  if (date == null) return new Date();
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function localDateParts(date) {
  const d = asDate(date);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  };
}

function localDateKey(date) {
  const { year, month, day } = localDateParts(date);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function displayDate(date) {
  const { year, month, day } = localDateParts(date);
  return `${pad2(month)}/${pad2(day)}/${year}`;
}

function proposedGroupName(index, date) {
  const n = Math.max(1, Math.floor(Number(index) || 1));
  return `Group ${n} on ${displayDate(date)}`;
}

function isProposedGroupName(name, index, date) {
  if (name == null) return false;
  return String(name).trim() === proposedGroupName(index, date);
}

module.exports = {
  pad2,
  localDateKey,
  displayDate,
  proposedGroupName,
  isProposedGroupName,
};
