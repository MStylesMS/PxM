# Paradox Master (PxM)

Thin **multi-chamber coordinator**. One PxO process is one group in one chamber; PxM is the process that knows a site can have more than one group at a time.

PxM is **not** a game engine, media player, GPIO driver, or log viewer.

## Job (v0)

- Gate **group launch** (first slot must be `ready`)
- Mint a lean **passport** (`groupId`, `game`, friendly `name`, …)
- Run **handoff** from INI profiles (delay + MQTT publishes)
- **Collision:** next slot busy → configured stall publishes, no start
- Publish retained `{master}/state`

## Quick start

```bash
cd /opt/paradox/apps/PxM
npm install
npm test
node src/pxm.js --config /opt/paradox/config/pxm.ini
```

## Docs

| Document | Purpose |
|----------|---------|
| [docs/SPEC.md](docs/SPEC.md) | What PxM is and is not |
| [docs/MQTT_API.md](docs/MQTT_API.md) | Topics and commands |
| [docs/CONFIG_INI.md](docs/CONFIG_INI.md) | INI reference |

Room packages supply `pxm.ini` (slots, graph, handoff profiles). TFD: `rooms/tfd/config/master/pxm.ini`.

## License

Dual-licensed: **AGPL-3.0** ([LICENSE](LICENSE)) and commercial — see [COMMERCIAL.md](COMMERCIAL.md).
