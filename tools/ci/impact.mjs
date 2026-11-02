import {execFileSync} from 'node:child_process';

export const areas = ['backend', 'web', 'desktop', 'extension', 'infra'];
const all = () => new Set(areas);
const documentation = p => /(^|\/)(README[^/]*|[^/]+\.md)$/.test(p) || p.startsWith('docs/');

export function affectedProjects(paths, graph) {
  if (!graph?.nodes || !graph?.dependencies) throw new Error('Invalid Nx graph');
  const touched = new Set();
  for (const [name,node] of Object.entries(graph.nodes)) {
    const root = node.data?.root;
    if (typeof root !== 'string' || !root || root === '.') continue;
    if (paths.some(p => !documentation(p) && (p === root || p.startsWith(`${root}/`)))) touched.add(name);
  }
  // Reverse closure: a change to a library also affects every consumer.
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const [source, dependencies] of Object.entries(graph.dependencies)) {
      if (!touched.has(source) && dependencies.some(d => touched.has(d.target))) {
        touched.add(source); expanded = true;
      }
    }
  }
  return [...touched].sort();
}

// Explicit non-JS roots complement Nx's transitive dependency graph.
export function affectedAreas(paths, projects = []) {
  const selected = new Set();
  const add = (...names) => names.forEach(n => selected.add(n));
  for (const project of projects) {
    if (project === 'api' || project === 'api-tests') add('backend');
    else if (project === 'auth' || project === 'ui') add('web', 'desktop');
    else if (areas.includes(project)) add(project);
  }
  for (const p of paths) {
    if (documentation(p)) continue;
    if (/^(\.circleci\/|tools\/ci\/|nx\.json$|tsconfig.*\.json$)/.test(p)) return all();
    if (/^(apps\/api(?:\/|-tests\/)|Directory\..*|global\.json$|Vodown\.slnx$|\.config\/dotnet-tools\.json$)/.test(p)) add('backend');
    else if (/^apps\/web\//.test(p)) add('web');
    else if (/^(apps\/desktop\/|rust-toolchain\.toml$)/.test(p)) add('desktop');
    else if (/^packages\/(auth|ui)\//.test(p)) add('web', 'desktop');
    else if (/^(chrome-extension\/|tools\/(package-extension|build-extension-auth)\.mjs$|tools\/extension-supabase-entry\.js$)/.test(p)) add('extension');
    else if (/^(package\.json$|pnpm-.*|\.npmrc$|\.node-version$)/.test(p)) add('web', 'desktop', 'extension');
    else if (/^(infra\/|compose[^/]*\.ya?ml$|\.dockerignore$)/.test(p)) add('infra', 'web', 'backend');
    else if (/^(assets\/|tools\/prepare-brand\.mjs$)/.test(p)) add('web', 'desktop', 'extension');
    else if (/^(postman\/|tools\/(api-local|stripe[^/]*|setup-stripe-test)\.mjs$)/.test(p)) add('backend');
    else return all(); // New/unmapped code must never silently bypass validation.
  }
  return selected;
}

export function changedPaths(base, head, git = (...args) => execFileSync('git', args, {encoding:'utf8'})) {
  // --no-renames lists both sides of moves. -z preserves spaces and newlines.
  return git('diff', '--name-only', '--no-renames', '-z', base, head, '--').split('\0').filter(Boolean);
}
