# Paradox Master (PxM) — AI Instructions

PxM is a **thin multi-chamber coordinator**. It gates group launch, carries a lean passport, runs config-driven handoffs, and refuses a promote when the next slot is busy.

**Repository**: [GitHub (MStylesMS/PxM)](https://github.com/MStylesMS/PxM)

## Tech stack

- **Runtime**: Node.js 20+ (deploy on 24 LTS with the rest of the suite)
- **Config**: INI only — PxM does **not** load chamber EDN
- **Transport**: MQTT (`mqtt` package)
- **Tests**: `node --test`

## What PxM knows vs ignores

| Cares about | Does not need |
|-------------|----------------|
| Slot occupancy: `ready` / `running` / `ending` / `offline` | Puzzle names, GPIO, media files |
| Graph edges + handoff/stall publish lists | How a stall looks in-theme |
| Passport identity | PxO phases beyond occupancy |

## Paradox family

- **PxO** — one group per chamber (game engine)
- **PxM** — this project (site coordinator)
- **PFx / PxIO / PxT / PxH / PxD** — media, IO, terminal, health, operator HTML

## Critical constraints

- MQTT topic contract: `{baseTopic}/{commands|events|state|warnings}`
- Never encode a room name (`elevator`, TFD) in engine logic — slots and topics come from INI
- Next-slot policy v0: `first_ready` only (`alternate` / `longest_idle` are config-shaped, unused)
- Do not add HTTP/WS, visit-summary writers, or hint fan-out unless the spec says so
- Never bypass the MQTT wrapper in the live process — tests inject a fake bus

## Docs-first

Update `docs/` in the same change as behaviour. Commit prefixes: `Docs:`, `Implement:`, `Fix:`, `Test:`, `Refactor:`, `Chore:`.

## Key references

| Document | Purpose |
|----------|---------|
| [docs/SPEC.md](docs/SPEC.md) | Functional spec |
| [docs/MQTT_API.md](docs/MQTT_API.md) | MQTT surface |
| [docs/CONFIG_INI.md](docs/CONFIG_INI.md) | INI |
| TFD room spec | `/opt/paradox/rooms/tfd/docs/PxM-SPEC.md` |
| Suite MQTT | `/opt/paradox/apps/PxH/docs/standards/MQTT-CONTRACT.md` |
