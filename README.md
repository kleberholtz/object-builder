<p align="center">
  <img src="public/object-builder-logo.png" alt="Object Builder" width="160" />
</p>

# Object Builder

Native, dark-first OTClient object editor built with Rust, Tauri, React, Tailwind CSS and shadcn-style Radix primitives.

## Implemented workflow

- Starts with an empty launcher offering **Create Project** and **Open Client**; no sample objects or generated sprites are loaded.
- Configures clients from 7.40 through 15.25 using an extensible version profile, explicit DAT/SPR names, client type, OTFI overrides and format feature switches.
- Parses DAT metadata and validates the SPR index in a Rust background task, sending per-stage progress to the responsive UI.
- Reports structured loading errors with the affected file, operation, reason and corrective guidance.
- Lazily decompresses individual sprites from the SPR source and bounds decoded images with a 48 MB LRU cache.
- Composes every tile, layer, pattern and frame at the object's real pixel dimensions through one shared Rust renderer used by previews, canvas and PNG I/O.
- Organizes Items, Outfits, Effects and Missiles under a persistent, searchable category tree with combinable core-side filters, ordering and pagination.
- Shows the film roll only for animated objects, reconciles state when selection changes, and supports per-frame or bulk durations with undo/redo.
- Streams bounded, searchable and filterable Rust/UI events into an expandable footer Log Panel.
- Saves the active client as version-aware DAT/SPR/OTFI in a background task, with structured progress, validation and recoverable backups; Save As explicitly chooses between the client pair and the JSON project format before asking for a path.
- Reports each save as an ordered stage checklist with per-stage duration, the file being written, bytes written, throughput and elapsed time.
- Optionally publishes the finished SPR as fixed-size volumes (32/64/96/128 MB or a custom size) named `Tibia.spr.001`, `Tibia.spr.002`, … plus a `Tibia.spr.parts` index, next to the complete archive; a client directory that only carries the volumes is joined back when it is opened. The volume size is remembered, so plain Save keeps producing the chosen layout.
- Persists Recent Projects locally, reopens client configurations or project manifests, and supports unavailable-path location/removal without touching project data.
- Provides a paginated Sprite Manager backed by a Rust usage index, including unused/shared counts and bidirectional object-to-sprite navigation.
- Analyzes unused, invalid and duplicate sprite candidates before optimization; confirmed optimization only removes provably unused project overrides and never mutates source DAT/SPR archives.
- Imports DAT/SPR pairs, JSON projects, PNG/spritesheets and lossless `.obd` object bundles (`.obx` remains accepted for compatibility).
- Exports selected objects through an explicit OBD/PNG/Spritesheet chooser, preserving supported metadata, sprite references, layers, patterns and frames; exported sheet padding is accepted on re-import and complete sheets map each frame/pattern back to its layout region.
- Imports individual PNG frames or complete spritesheets and exports a selected frame, all frames, or the complete sprite layout.
- Persists imported sprite overrides in the atomic `project.json` manifest and keeps recoverable `.backup` files.
- Provides configurable, conflict-checked keyboard shortcuts persisted in local storage and a version-sourced About dialog.

Unmodified DAT records round-trip byte-for-byte. Modified records are serialized according to the selected client version and OTFI features. SPR saves preserve the original data region and rebuild the offset table only when overrides must be embedded; unsupported or structurally ambiguous data causes an explicit error instead of silent removal.

## Development

```bash
npm install
npm run tauri dev
```

Frontend-only preview:

```bash
npm run dev
```

## Tests

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

If the `860` fixture exists at the repository root, the Rust suite also runs real-file DAT traversal and byte-for-byte round trips, extended SPR header checks, lazy RGBA decompression and version-profile coverage. The large client files are not required in CI.

## Versioning and releases

`npm install` points git at `.githooks/`, and the `pre-commit` hook there bumps
the version on every commit — `package.json`, `package-lock.json`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and `src-tauri/tauri.conf.json`
move together, and the hook stages them into the commit that triggered it.

Both patch and minor are base-10: `0.1.1` runs to `0.1.9`, then `0.2.0`; `0.9.9`
becomes `1.0.0`. The hook stands down during merge, rebase, cherry-pick and
revert, which replay commits that already carry their own bump. `SKIP_VERSION_BUMP=1
git commit` skips it by hand.

```bash
npm run version:next   # print the next version without writing
npm run version:bump   # bump and write
```

Pushing to `master` runs `.github/workflows/release.yml`, which builds Linux,
Windows and macOS (arm64 and x86_64) and publishes a stable GitHub Release at
`v<version>`. The release is created as a draft and only published once all four
platforms have uploaded; a version whose release already exists is skipped, so a
push that does not change the version does not republish it.

## Architecture

- `src-tauri/src/core`: strongly typed domain model, real object dimensions, logging events and indexed sprite relationships
- `src-tauri/src/formats`: isolated, version-aware DAT/SPR/OTFI codecs
- `src-tauri/src/sprites`: sprite decompression, slicing, pixel operations and LRU cache
- `src-tauri/src/history`: bounded command history
- `src-tauri/src/project`: atomic project persistence and backup
- `src-tauri/src/commands`: asynchronous Tauri API boundary
- `src/features`: object browser, canvas, inspector and film roll UI
- `src/stores`: separate project, editor, selection and history state
