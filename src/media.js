'use strict';

const MEDIA_ID_RE = /^[1-9][0-9]{0,8}$/;
const MEDIA_LANGUAGES = new Set(['en', 'es', 'de', 'ru', 'fr']);

/**
 * Sanitize a media pack id. Accepts a JSON number or decimal string.
 * `null` is allowed on switchMedia only (clear pack) — callers must treat that separately.
 * @returns {{ ok: true, value: number } | { ok: false, reason: string }}
 */
function sanitizeMediaId(raw) {
  if (raw === undefined || raw === '') {
    return { ok: false, reason: 'illegal-media-id' };
  }
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 1 || raw > 999999999) {
      return { ok: false, reason: 'illegal-media-id' };
    }
    const s = String(raw);
    if (!MEDIA_ID_RE.test(s)) return { ok: false, reason: 'illegal-media-id' };
    return { ok: true, value: raw };
  }
  const s = String(raw).trim();
  if (!MEDIA_ID_RE.test(s)) return { ok: false, reason: 'illegal-media-id' };
  return { ok: true, value: Number(s) };
}

function commandTopic(base) {
  const t = String(base || '').trim().replace(/\/+$/, '');
  if (!t) return '';
  return t.endsWith('/commands') ? t : `${t}/commands`;
}

function parseMediaCatalog(raw) {
  const warnings = [];
  const catalog = [];
  const root = raw && raw.media && typeof raw.media === 'object' ? raw.media : null;
  if (!root) {
    return { catalog, defaultMediaId: undefined, warnings };
  }

  for (const [key, sec] of Object.entries(root)) {
    if (key === 'default') continue;
    if (!sec || typeof sec !== 'object') continue;
    if (!MEDIA_ID_RE.test(String(key))) {
      warnings.push({ warning: 'invalid-media-section', section: key });
      continue;
    }
    const language = String(sec.language || '').trim().toLowerCase();
    if (!MEDIA_LANGUAGES.has(language)) {
      warnings.push({
        warning: 'unknown-media-language',
        id: Number(key),
        language: sec.language == null ? '' : String(sec.language),
      });
      continue;
    }
    const id = Number(key);
    catalog.push({
      id,
      slug: String(id),
      name: String(sec.name || '').trim(),
      shortName: String(sec.short_name || '').trim(),
      description: String(sec.description || '').trim(),
      language,
    });
  }
  catalog.sort((a, b) => a.id - b.id);

  let defaultMediaId;
  if (root.default != null && String(root.default).trim() !== '') {
    const parsed = sanitizeMediaId(root.default);
    if (!parsed.ok || !catalog.some((p) => p.id === parsed.value)) {
      warnings.push({ warning: 'invalid-media-default', default: root.default });
    } else {
      defaultMediaId = parsed.value;
    }
  }
  return { catalog, defaultMediaId, warnings };
}

function parseSlotMedia(sec, csv) {
  const mediaSec = sec && sec.media && typeof sec.media === 'object' ? sec.media : {};
  return {
    switchTopics: csv(mediaSec.switch).map(commandTopic).filter(Boolean),
    restartTopics: csv(mediaSec.restart).map(commandTopic).filter(Boolean),
    speechTopics: csv(mediaSec.speech).map(commandTopic).filter(Boolean),
  };
}

function matchRestartTopics(topics, process) {
  if (!Array.isArray(topics) || !topics.length) return [];
  if (process == null || String(process).trim() === '') return topics.slice();
  const p = String(process).trim();
  return topics.filter((t) => {
    const base = t.endsWith('/commands') ? t.slice(0, -'/commands'.length) : t;
    if (base === p || t === p) return true;
    const last = base.split('/').pop();
    return last === p;
  });
}

function catalogById(catalog, id) {
  if (id == null || !Array.isArray(catalog)) return null;
  return catalog.find((p) => p.id === id) || null;
}

module.exports = {
  MEDIA_ID_RE,
  MEDIA_LANGUAGES,
  sanitizeMediaId,
  commandTopic,
  parseMediaCatalog,
  parseSlotMedia,
  matchRestartTopics,
  catalogById,
};
