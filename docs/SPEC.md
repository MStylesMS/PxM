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

`X` increments for every launch that calendar day, custom name or not.

## Handoff

`promote` (optional `from` slot) picks the next candidate with policy `first_ready`. If that slot is `ready`, PxM runs the named handoff profile (delay + MQTT publishes). If it is busy, PxM runs the stall profile on the **current** slot and does not start the next chamber.

Auto-handoff on solved-family `gameState` is opt-in (`auto_handoff` in INI). Leave it off until destination `start` / `prepare` commands are proven.

## Non-goals (v0)

HTTP/WS, last-chamber visit JSONL, Y-routing policies other than `first_ready`, hint/solve fan-out, puzzle knowledge.
