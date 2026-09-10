'use strict';

const mqtt = require('mqtt');

class MqttBus {
  constructor({ url, clientId, logger } = {}) {
    this.url = url || 'mqtt://127.0.0.1:1883';
    this.clientId = clientId || `pxm-${process.pid}`;
    this.log = logger || console;
    this.client = null;
    this.handlers = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.url, {
        clientId: this.clientId,
        reconnectPeriod: 2000,
      });
      const onErr = (err) => {
        this.log.error('[pxm] mqtt error', err && err.message);
      };
      this.client.once('connect', () => {
        this.log.info('[pxm] mqtt connected', this.url);
        resolve();
      });
      this.client.once('error', (err) => {
        reject(err);
      });
      this.client.on('error', onErr);
      this.client.on('message', (topic, buf) => {
        const raw = buf.toString();
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch { /* keep string */ }
        for (const [filter, fn] of this.handlers) {
          if (topicMatches(filter, topic)) fn(topic, parsed, raw);
        }
      });
    });
  }

  subscribe(topic, handler) {
    if (handler) this.handlers.set(topic, handler);
    if (this.client) this.client.subscribe(topic);
  }

  publish(topic, payload, opts = {}) {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (!this.client) return;
    this.client.publish(topic, body, { qos: 0, retain: !!opts.retain });
  }

  end() {
    if (this.client) this.client.end(true);
    this.client = null;
  }
}

function topicMatches(filter, topic) {
  if (filter === topic) return true;
  if (filter.endsWith('/#')) {
    const prefix = filter.slice(0, -2);
    return topic === prefix || topic.startsWith(`${prefix}/`);
  }
  return false;
}

module.exports = { MqttBus, topicMatches };
