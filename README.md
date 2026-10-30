# Deduplicated asset gets a `2` suffix when a shorter name is emitted later

Rolldown deduplicates emitted assets by content. When the same content is emitted again with
a shorter name, rolldown picks a new file name for the asset. If `assetFileNames` has no
`[name]` (for example `assets/[hash][extname]`), the new file name is the same as the old one.
The old name is still reserved, so the asset gets a `2` suffix: `BZJ5HxlP2.svg`.

The suffix only appears when the longer name is emitted first. In a real build the emit order
depends on which `load` hook finishes first, so the output file names change from build to
build. Rollup gives `BZJ5HxlP.svg` in each case.

## Run

```sh
pnpm install
pnpm start
```

## Output (rolldown 1.2.14, rollup 4.64.6)

```
Part 1: fixed emit order
  shortest name first (a.svg then long-name.svg, assets/[hash][extname])
    rolldown 1.2.14  assets/BZJ5HxlP.svg
    rollup 4.64.6    assets/BZJ5HxlP.svg
  longest name first (long-name.svg then a.svg, assets/[hash][extname])
    rolldown 1.2.14  assets/BZJ5HxlP2.svg
    rollup 4.64.6    assets/BZJ5HxlP.svg
  longest name first, [name] in template (long-name.svg then a.svg, assets/[name]-[hash][extname])
    rolldown 1.2.14  assets/a-BZJ5HxlP.svg
    rollup 4.64.6    assets/a-BZJ5HxlP.svg

Part 2: emit order set by load timing, 20 builds each, assets/[hash][extname]
  rolldown 1.2.14  assets/BZJ5HxlP2.svg (15x), assets/BZJ5HxlP.svg (5x)
  rollup 4.64.6    assets/BZJ5HxlP.svg (20x)

Part 3: long.svg ("one"), a.svg ("one"), long.svg ("two"), assets/[name][extname]
  rolldown 1.2.14  assets/a.svg, assets/long2.svg
  rollup 4.64.6    assets/a.svg, assets/long.svg
```

The counts in part 2 change from run to run. The rolldown `main` build at `3258f1361` (after
1.2.15) gives the same results.

- Part 1 shows the bug with a fixed order.
- Part 2 emits the asset from the `load` hook of each module, as Vite's asset plugin does. A
  random delay changes the emit order, so the file name changes between builds.
- Part 3 shows the same cause with a different effect. After the rename to `a.svg`, the name
  `long.svg` stays reserved, so a different asset named `long.svg` gets `long2.svg`.

## Cause

`FileEmitter::emit_file` in `crates/rolldown_common/src/file_emitter.rs`:

1. The first emit renders the file name and reserves it in `names` with `make_unique_name`.
2. A later emit with the same content and a shorter name goes to the `Entry::Occupied` branch.
   During the build phase it calls `generate_file_name` again (the re-pick from #9948).
3. `generate_file_name` renders the template and calls `make_unique_name` again. The old name
   is still in `names`, and it is never released.
   - With no `[name]` in the template, the new name is the same as the old name. So the asset
     conflicts with itself and gets `2` (parts 1 and 2).
   - With `[name]`, the old name stays reserved for nothing (part 3).

Rollup also keeps the shortest name, but it gives no suffix in these cases.

## Effect in a real build

A Vite 8 + React Router app with `assetFileNames: 'assets/[hash:12][extname]'` imports many
SVG, PNG and WebP files. Some of the files have the same content. Over six builds with the same
input, 8 to 108 client assets got a `2` suffix. So:

- `dist` is not reproducible. The file count and the `.map` files of the chunks that import
  these assets change between builds.
- React Router copies a server asset to the client folder when the client has no file with the
  same name. A suffix in one environment adds a duplicate file to the client output.

## Possible fix

In the re-pick, keep the current file name when the new rendered name is the same. Release the
old name from `names` before the new name is reserved.
