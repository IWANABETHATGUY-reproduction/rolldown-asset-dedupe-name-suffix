import { rolldown, VERSION as rolldownVersion } from 'rolldown';
import { rollup, VERSION as rollupVersion } from 'rollup';

// The same source, emitted two times with two names. The assets are deduplicated by content.
const source = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>\n';
const bundlers = { [`rolldown ${rolldownVersion}`]: rolldown, [`rollup ${rollupVersion}`]: rollup };

async function build(bundler, plugin, assetFileNames) {
  const bundle = await bundler({ input: 'entry', plugins: [plugin], logLevel: 'silent' });
  const { output } = await bundle.generate({ assetFileNames });
  await bundle.close();
  return output.filter(file => file.type === 'asset').map(file => file.fileName).join(', ');
}

// Part 1: the emit order is fixed. Both emits run in one load hook.
function emitInOrder(names) {
  return {
    name: 'emit-in-order',
    resolveId: id => (id === 'entry' ? id : null),
    load(id) {
      if (id !== 'entry') return null;
      for (const name of names) this.emitFile({ type: 'asset', name, source });
      return 'export default 1;';
    },
  };
}

const cases = [
  ['shortest name first', ['a.svg', 'long-name.svg'], 'assets/[hash][extname]'],
  ['longest name first', ['long-name.svg', 'a.svg'], 'assets/[hash][extname]'],
  ['longest name first, [name] in template', ['long-name.svg', 'a.svg'], 'assets/[name]-[hash][extname]'],
];
console.log('Part 1: fixed emit order');
for (const [label, names, template] of cases) {
  console.log(`  ${label} (${names.join(' then ')}, ${template})`);
  for (const [name, bundler] of Object.entries(bundlers)) {
    console.log(`    ${name.padEnd(16)} ${await build(bundler, emitInOrder(names), template)}`);
  }
}

// Part 2: two modules emit the asset in their load hooks, as Vite's asset plugin does. A random
// delay stands in for the thread timing of a real build, so the emit order changes in each run.
function emitPerModule() {
  return {
    name: 'emit-per-module',
    resolveId: id => (id === 'entry' || id.endsWith('.svg') ? id : null),
    async load(id) {
      if (id === 'entry') return 'import a from "a.svg"; import b from "long-name.svg"; export default [a, b];';
      await new Promise(resolve => setTimeout(resolve, Math.random() * 4));
      const ref = this.emitFile({ type: 'asset', name: id, source });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
  };
}

const runs = 20;
console.log(`\nPart 2: emit order set by load timing, ${runs} builds each, assets/[hash][extname]`);
for (const [name, bundler] of Object.entries(bundlers)) {
  const counts = new Map();
  for (let i = 0; i < runs; i++) {
    const files = await build(bundler, emitPerModule(), 'assets/[hash][extname]');
    counts.set(files, (counts.get(files) ?? 0) + 1);
  }
  console.log(`  ${name.padEnd(16)} ${[...counts].map(([files, count]) => `${files} (${count}x)`).join(', ')}`);
}

// Part 3: the name that the shorter name replaces stays reserved. A different asset with that
// name then gets a suffix too.
const reserved = {
  name: 'emit-reserved',
  resolveId: id => (id === 'entry' ? id : null),
  load(id) {
    if (id !== 'entry') return null;
    this.emitFile({ type: 'asset', name: 'long.svg', source: 'one' });
    this.emitFile({ type: 'asset', name: 'a.svg', source: 'one' });
    this.emitFile({ type: 'asset', name: 'long.svg', source: 'two' });
    return 'export default 1;';
  },
};
console.log('\nPart 3: long.svg ("one"), a.svg ("one"), long.svg ("two"), assets/[name][extname]');
for (const [name, bundler] of Object.entries(bundlers)) {
  console.log(`  ${name.padEnd(16)} ${await build(bundler, reserved, 'assets/[name][extname]')}`);
}
