# Asset label suffix guidance

This note clarifies how asset-type suffixes should be used in `name_shortest` values.

## Core rule

For asset/project records, the `shortest` label should usually combine the recognizable site, parent, or project name with a compact asset suffix.

Use these suffixes consistently:

| Suffix | Use for |
| --- | --- |
| `PV` | Any solar project, solar farm, solar park, solar center, solar energy center, or solar portfolio record |
| `WF` | Wind projects and wind farms |
| `ES` | Energy storage, battery storage, BESS, and storage-only records |
| `EC` | Energy centers where `EC` is clearer than `Gen` or `GS` |
| `GS` | Generating stations |
| `Gen` | Generation/generating records when no clearer site-specific suffix fits |
| `Hydro` | Hydroelectric and hydropower records |
| `Cogen` | Cogeneration records |

## Solar records

Call solar assets `PV` in `shortest`. Do not replace a good `PV` suffix with `Solar` merely because the source name says Solar.

Good examples:

- `Midlands PV`
- `Milagro PV 1`
- `Morris Ridge PV`
- `Morrow Lake PV`
- `MS Sunflower PV`
- `Mt. Home PV 1`

Avoid in `shortest`:

- `Midlands Solar`
- `Milagro Solar 1`
- `Morris Ridge Solar`
- `Morrow Lake Solar`

Keep the readable `Solar` wording in `short` or `normal` when useful.

## Energy storage records

Call storage assets `ES` in `shortest`, even when the formal entity name says Energy Storage, Storage, Battery, or BESS, unless a better official acronym exists.

Good examples:

- `Guajillo ES` for `Guajillo Energy Storage, LLC`
- `El Sol ES`
- `Gateway ES`
- `Longhorn ES`
- `Myrtle ES`

Avoid in `shortest`:

- `Guajillo Storage`
- `Gateway Storage`
- `Longhorn Storage`
- `Citadel BESS` unless `BESS` is clearly the more recognizable project label

Keep `BESS`, `Energy Storage`, or `Storage` in `short` or `normal` when useful.

## Parent and project identity

When a parent has many records, use `[parent or recognizable acronym] + [site/project] + [asset suffix]` if it remains readable.

Examples:

- `BT Kellam PV`
- `Hecate Albany PV 1`
- `NAES Albemarle PV`
- `CPV Maple PV`

Do not discard the site/project name just to make the label shorter.

## Do not overcorrect

Do not change a good existing compact label from `PV` to `Solar`, from `WF` to `Wind`, or from `ES` to `Storage` unless the longer word is clearly needed for user recognition.

The final check is practical: the label should be short, recognizable on the map, and consistent with neighboring asset labels.
