import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

export function libraryIdentity(path) {
  const bytes = readFileSync(path);
  return { file: basename(path), sha256: createHash('sha256').update(bytes).digest('hex'),
    versions: [...new Set(bytes.toString('latin1').match(/libsoup\/3\.\d+\.\d+/g) ?? [])] };
}

// Read only comm/maps, never cmdline, environ, memory or a core dump.
export function observeNetworkLibraries(procRoot = '/proc') {
  const records = new Map();
  const identities = new Map();
  const sample = () => {
    for (const pid of readdirSync(procRoot).filter(name => /^\d+$/.test(name))) {
      try {
        const comm = readFileSync(`${procRoot}/${pid}/comm`, 'utf8').trim();
        if (!/^(WPENetwork|WebKitNetwork)/.test(comm)) continue;
        const maps = readFileSync(`${procRoot}/${pid}/maps`, 'utf8');
        for (const line of maps.split('\n')) {
          const path = line.match(/\s(\/[^\n]*\/libsoup-3\.0\.so[^\s]*)$/)?.[1];
          if (!path) continue;
          if (!identities.has(path)) identities.set(path, libraryIdentity(path));
          const identity = identities.get(path);
          const key = `${pid}:${identity.sha256}`;
          if (!records.has(key)) records.set(key, { at: Date.now(), process: 'webkit-network', pid: Number(pid), ...identity });
        }
      } catch { /* Process may exit between directory and maps reads. */ }
    }
  };
  return { sample, snapshot: () => [...records.values()] };
}
