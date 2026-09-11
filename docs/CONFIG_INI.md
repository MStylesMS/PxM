# PxM INI

PxM does not load chamber EDN. One file, typically `/opt/paradox/config/pxm.ini` → room `config/master/pxm.ini`.

```ini
[global]
log_directory = /opt/paradox/logs/pxm
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

[gm]
base_topic = paradox/tfd/master

[passport]
launch_registry = /opt/paradox/logs/pxm/launches.json

[handoff.ch1-to-ch2]
step_1 = 0 | {from}/commands | {"command":"openDoor"}
step_2 = 0 | {to}/commands | {"command":"prepare"}
step_3 = 45000 | {to}/commands | {"command":"start","attach_passport":true}

[stall.ch1-stall]
step_1 = 0 | {from}/commands | {"command":"promoteRefused"}

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

[chamber.chamber_3.media]
switch = paradox/tfd/control/pfx/hdmi, paradox/tfd/control/pfx/audio, paradox/tfd/control/terminal
speech = paradox/tfd/control/speech
```

Handoff / stall steps: `delay_ms | topic | json`.

Topic placeholders: `{from}` and `{to}` expand to that slot’s `game_topic`.  
`attach_passport: true` merges the lean passport into the JSON payload (including `mediaId` when set).

## Media pack catalog

Scan `[media.<integer>]` sections. There is **no** separate `packs =` list (it would drift). `slug` is always the decimal string of `id` (`1` → `"1"`).

| Key | Required | Notes |
|-----|----------|--------|
| `name` | yes | Full GM label |
| `short_name` | yes | Dropdown label |
| `description` | yes | One to three sentences |
| `language` | yes | `en` \| `es` \| `de` \| `ru` \| `fr`. Unknown code → that pack is refused (warning at startup); other packs still load |

`[media] default` must name a **loaded** id. If `[media]` is absent entirely and no `[media.N]` packs load, master state omits `defaultMediaId` / `mediaCatalog` (bit-identical to today).

Per-slot `[chamber.chamber_N.media]`:

| Key | Meaning |
|-----|---------|
| `switch` | CSV of process bases that receive `{ command: switchMedia, mediaId, refresh }` on `{base}/commands` |
| `speech` | Optional PxS bases; same payload plus catalog `language` |
| `restart` | CSV of process bases for `restartProcess` → `{ command: restart }` (match `process` to the last path segment, e.g. `pfx`) |
