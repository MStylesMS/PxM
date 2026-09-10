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
```

Handoff / stall steps: `delay_ms | topic | json`.

Topic placeholders: `{from}` and `{to}` expand to that slot’s `game_topic`.  
`attach_passport: true` merges the lean passport into the JSON payload.
