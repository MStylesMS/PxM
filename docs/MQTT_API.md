# PxM MQTT API (v0)

Suite contract: `{baseTopic}/{commands|events|state|warnings}`.

`baseTopic` is `[gm] base_topic` (TFD: `paradox/tfd/master`).

## Commands (`…/commands`)

| command | Fields | Effect |
|---------|--------|--------|
| `startGroup` | optional `name`, `size`, `types`, `notes`, `groupId` | Start first slot if `ready` |
| `promote` | optional `from` (slot id or role), `groupId` | Handoff or stall |
| `abortGroup` | optional `groupId` | `abort` on slots holding that group |

Lean passport fields may sit at the top level or under `passport`.

## State (`…/state`, retained)

```json
{
  "application": "pxm",
  "game": "tfd",
  "today": "2026-09-09",
  "groupsToday": 1,
  "nextGroupIndex": 2,
  "nextGroupName": "Group 2 on 09/09/2026",
  "bridgesOk": true,
  "collisionActive": false,
  "chambers": {
    "chamber_1": { "role": "elevator", "status": "running", "groupId": "…", "name": "…" }
  },
  "chamber_1": { "role": "elevator", "status": "running" }
}
```

## Events / warnings

`…/events`: `group_started`, `promoted`, `promote_refused`, `group_aborted`, `command_rejected`.  
`…/warnings`: same reject reasons for operators.

## Chamber topics

PxM **subscribes** `{game_topic}/state` per slot and **publishes** `{game_topic}/commands` (and any other topics listed in handoff/stall profiles).
