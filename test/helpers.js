'use strict';

const { loadConfig } = require('../src/config');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SAMPLE_INI = `
[global]
log_directory = /tmp/pxm-test
listen_mqtt = mqtt://127.0.0.1:1883
game = tfd
auto_handoff = false
offline_ms = 20000
bridges_required = chamber_2,chamber_3

[chambers]
slots = chamber_1,chamber_2,chamber_3

[chamber.chamber_1]
role = elevator
game_topic = paradox/tfd/elevator
next = chamber_2
handoff = ch1-to-ch2
stall = ch1-stall

[chamber.chamber_2]
role = generator
game_topic = paradox/tfd/generator
next = chamber_3
handoff = ch2-to-ch3
stall = ch2-stall

[chamber.chamber_3]
role = control
game_topic = paradox/tfd/control
is_last = true

[gm]
base_topic = paradox/tfd/master

[passport]
launch_registry =

[handoff.ch1-to-ch2]
step_1 = 0 | {from}/commands | {"command":"openDoor"}
step_2 = 0 | {to}/commands | {"command":"prepare"}
step_3 = 45000 | {to}/commands | {"command":"start","attach_passport":true}

[handoff.ch2-to-ch3]
step_1 = 0 | {to}/commands | {"command":"enableBackground"}
step_2 = 30000 | {to}/commands | {"command":"start","attach_passport":true}

[stall.ch1-stall]
step_1 = 0 | {from}/commands | {"command":"promoteRefused"}

[stall.ch2-stall]
step_1 = 0 | {from}/commands | {"command":"stall"}
`;

function writeSampleConfig(overrides = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxm-cfg-'));
  const file = path.join(dir, 'pxm.ini');
  fs.writeFileSync(file, SAMPLE_INI + (overrides || ''));
  return loadConfig(file);
}

class RecordingBus {
  constructor() {
    this.published = [];
  }

  publish(topic, payload, opts) {
    this.published.push({
      topic,
      payload: typeof payload === 'string' ? tryParse(payload) : payload,
      retain: !!(opts && opts.retain),
    });
  }

  of(topic) {
    return this.published.filter((m) => m.topic === topic);
  }

  commands(gameTopic) {
    return this.of(`${gameTopic}/commands`);
  }
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}

function fakeClock() {
  let now = 1_000_000;
  const timers = [];
  return {
    now: () => now,
    schedule(fn, ms) {
      timers.push({ at: now + ms, fn });
    },
    advance(ms) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      due.forEach((t) => t.fn());
      for (let i = timers.length - 1; i >= 0; i -= 1) {
        if (timers[i].at <= now) timers.splice(i, 1);
      }
    },
  };
}

const MEDIA_INI = `
[media]
default = 1

[media.1]
name = English — original trailer
short_name = English
description = Current show picture and English VO from the Crafty Fox trailer.
language = en

[media.2]
name = Español — packed VO
short_name = Español
description = Same picture and timing as pack 1, with Spanish voice-over and PxT chrome.
language = es

[chamber.chamber_1.media]
switch = paradox/tfd/elevator/pfx
restart = paradox/tfd/elevator/pfx

[chamber.chamber_2.media]
switch = paradox/tfd/generator/pfx

[chamber.chamber_3.media]
switch = paradox/tfd/control/pfx/hdmi, paradox/tfd/control/pfx/audio, paradox/tfd/control/terminal
speech = paradox/tfd/control/speech
`;

module.exports = { writeSampleConfig, RecordingBus, fakeClock, SAMPLE_INI, MEDIA_INI };
