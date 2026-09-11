# PxM — functional spec (v0)

PxM is a **thin multi-chamber coordinator**. One PxO = one group in one chamber. Concurrent occupancy is coordinated here.

## Occupancy

Each configured slot is normalized from that chamber’s retained `{game_topic}/state` to:

| Status | Meaning |
|--------|---------|
| `ready` | May accept `start` |
| `running` | Occupied (incl. paused) |
| `ending` | Solved / failed / reset in progress — **busy** for promote |
| `offline` | No recent state |

## Launch

`startGroup` is accepted only when the **first** slot is `ready`. PxM mints `groupId` if omitted, fills a friendly `name` (`Group X on MM/DD/YYYY` for the local day), and publishes `start` plus the lean passport to `{first}/commands`.

Optional `mediaId` is stored on the group passport and attached on that `start` (and on later handoff `start` via `attach_passport`). If omitted, use INI `[media] default` when configured; otherwise omit the field (legacy). `X` increments for every launch that calendar day, custom name or not.

## Handoff

`promote` (optional `from` slot) picks the next candidate with policy `first_ready`. If that slot is `ready`, PxM runs the named handoff profile (delay + MQTT publishes). If it is busy, PxM runs the stall profile on the **current** slot and does not start the next chamber.

Auto-handoff on solved-family `gameState` is opt-in (`auto_handoff` in INI). Leave it off until destination `start` / `prepare` commands are proven.

## Media pack catalog

PxM owns the site pack catalog. Players only see the integer `mediaId` (folder name). Canonical MQTT: suite `MQTT-CONTRACT.md` § Media pack.

- Load `[media.<id>]` from INI (`id`, derived `slug`, `name`, `shortName`, `description`, `language`).
- Publish `mediaCatalog` + `defaultMediaId` on retained master state when packs are loaded.
- Store `chambers.chamber_N.mediaId` per slot so two concurrent groups can use different packs. A second slot must not overwrite the first.
- `switchMedia` on the master topic fans out to configured per-slot switch (and speech) topics. Omit `slots` = default + every idle slot; never refresh a `running` chamber unless the GM listed it.
- `restartProcess` publishes MQTT `{ command: restart }` to a configured process topic. It is **not** the media-switch path and does not SSH/`systemctl`.

Omit every media field when no catalog is loaded.

## Non-goals (v0)

HTTP/WS, last-chamber visit JSONL, Y-routing policies other than `first_ready`, hint/solve fan-out, puzzle knowledge.
