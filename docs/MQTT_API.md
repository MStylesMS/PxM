# PxM MQTT API (v0)

Suite contract: `{baseTopic}/{commands|events|state|warnings}`.

`baseTopic` is `[gm] base_topic` (TFD: `paradox/tfd/master`).

## Commands (`…/commands`)

| command | Fields | Effect |
|---------|--------|--------|
| `startGroup` | optional `name`, `size`, `types`, `notes`, `groupId`, `mediaId` | Start first slot if `ready`. Optional pack id is stored on the group passport and attached on chamber `start` (same as `attach_passport`). If omitted, use INI `default` when configured; otherwise omit (legacy). |
| `promote` | optional `from` (slot id or role), `groupId` | Handoff or stall. Destination `start` with `attach_passport` includes `mediaId` so the pack survives promote. |
| `abortGroup` | optional `groupId` | `abort` on slots holding that group |
| `switchMedia` | `mediaId` (integer or `null` to clear), optional `refresh` (default `false`), optional `slots` | Sanitize `mediaId` (`^[1-9][0-9]{0,8}$`). Omit `slots` = update site `defaultMediaId` and fan out to every **idle** slot (never a `running` chamber unless the GM listed it). Fan-out `{ command: switchMedia, mediaId, refresh }` to each slot’s configured switch topics; speech topics also get catalog `language`. |
| `restartProcess` | `slot`, `process` | Publish `{ command: restart }` to that slot’s matching restart topic. Recovery only — not the media-switch mechanism. Not SSH/`systemctl`. |

Lean passport fields may sit at the top level or under `passport`. Optional `mediaId` is a catalog Version ID (positive integer).

Illegal `mediaId` (`0`, `"v1"`, `../etc`): ignore the command, publish `warnings`, keep the previous pack.

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
    "chamber_1": { "role": "elevator", "status": "running", "groupId": "…", "name": "…", "mediaId": 2 }
  },
  "chamber_1": { "role": "elevator", "status": "running" },
  "defaultMediaId": 1,
  "mediaCatalog": [
    {
      "id": 1,
      "slug": "1",
      "name": "English — original trailer",
      "shortName": "English",
      "description": "…",
      "language": "en"
    }
  ]
}
```

`defaultMediaId`, `mediaCatalog`, and per-slot `mediaId` are **omitted** when no packs are loaded / the field is unset. Rooms without `[media]` stay bit-identical to today’s snapshot. `chambers.chamber_N.mediaId` is what that slot is using; a second slot on a different pack does not overwrite the first.

## Events / warnings

`…/events`: `group_started`, `promoted`, `promote_refused`, `group_aborted`, `command_rejected`, `media_switched`, `process_restarted`.  
`…/warnings`: same reject reasons for operators, plus startup `unknown-media-language` / `invalid-media-default` / `illegal-media-id`.

## Chamber topics

PxM **subscribes** `{game_topic}/state` per slot and **publishes** `{game_topic}/commands` (and any other topics listed in handoff/stall profiles). `switchMedia` / `restartProcess` also publish to per-slot `[chamber.N.media]` process bases (`{base}/commands`).
