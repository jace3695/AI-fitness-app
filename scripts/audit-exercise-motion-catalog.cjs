// Read tracked catalog code only. Usage: node scripts/audit-exercise-motion-catalog.cjs <repo> <revision>
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(process.argv[2]), revision = process.argv[3];
if (!/^[a-f0-9]{40}$/.test(revision || '')) throw Error('Use an explicit commit SHA');
const ts = require(path.join(repo, 'node_modules/typescript'));
const cache = {};
function load(file) {
  // Catalog membership and guide names do not depend on workout-group display metadata.
  if (file === 'app/data/workoutGroups.ts') return { WORKOUT_GROUPS: [] };
  if (!['app/data/homeExerciseCatalog.ts', 'app/data/exerciseGuides.ts', 'app/data/expandedHomeExercises.ts'].includes(file)) throw Error(`Unexpected import ${file}`);
  if (cache[file]) return cache[file];
  const code = execFileSync('git', ['-C', repo, 'show', `${revision}:${file}`], { encoding: 'utf8' });
  const evaluatedModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module: evaluatedModule, exports: evaluatedModule.exports,
    require: name => load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name))),
    process: { env: { NODE_ENV: 'production' } }, console: { log() {} },
  });
  return cache[file] = evaluatedModule.exports;
}
const catalog = load('app/data/homeExerciseCatalog.ts');
const done = ['wall-pushup', 'supported-calf-raise', 'supported-side-leg-raise', 'seated-knee-extension', 'light-dumbbell-curl'];
const rows = catalog.HOME_EQUIPMENT.flatMap(equipment => catalog.homeExerciseCandidates(equipment).map(e => ({ id: e.exerciseId, name: e.name, equipment, complete: done.includes(e.exerciseId) })));
if (new Set(rows.map(r => r.id)).size !== rows.length) throw Error('Duplicate IDs: count unique motions before reporting');
const out = path.resolve(__dirname, '../docs/exercise-motion/batch3-evidence/catalog.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ revision, total: rows.length, completed: rows.filter(r => r.complete).length, rows, note: 'Selection and names execute actual catalog/guide code; WORKOUT_GROUPS display metadata stubbed. Completion list is deployed-five baseline, not new local work.' }, null, 2));
console.log(`${rows.length} selectable, ${rows.filter(r => r.complete).length} deployed demonstrations`);
