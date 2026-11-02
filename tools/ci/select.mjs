import {execFileSync} from 'node:child_process';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {areas, affectedAreas, affectedProjects, changedPaths} from './impact.mjs';
import {configuration} from './workflow.mjs';

const git = (...args) => execFileSync('git', args, {encoding:'utf8'}).trim();
const head = git('rev-parse', 'HEAD');
const branch = process.env.CIRCLE_BRANCH || git('branch', '--show-current');
const full = process.env.VODOWN_CI_FULL === 'true' || process.env.CIRCLE_PIPELINE_TRIGGER_SOURCE === 'scheduled_pipeline';
let base = null, reason = 'full requested', paths = [], projects = [];
const output = process.env.VODOWN_CI_OUTPUT || '/tmp/vodown-ci';
await mkdir(output, {recursive:true});

async function json(url, headers = {}) {
  const response = await fetch(url, {headers, signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`CI metadata unavailable (${response.status})`);
  return response.json();
}
try {
  if (!full) {
    const pr = process.env.CIRCLE_PULL_REQUEST;
    if (pr) {
      const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(pr);
      if (!match) throw new Error('Unrecognized pull request URL');
      const info = await json(`https://api.github.com/repos/${match[1]}/${match[2]}/pulls/${match[3]}`);
      // Fetch by immutable SHA; target branches need not be master.
      git('fetch', 'origin', info.base.sha);
      base = git('merge-base', head, info.base.sha);
      reason = 'pull request merge base';
    } else if (branch === 'master') {
      const headers = process.env.CIRCLECI_READ_TOKEN ? {'Circle-Token':process.env.CIRCLECI_READ_TOKEN} : {};
      const project = 'gh/davidrock/vodown';
      const pipelines = await json(`https://circleci.com/api/v2/project/${project}/pipeline?branch=master`, headers);
      for (const pipeline of pipelines.items || []) {
        if (!pipeline.vcs?.revision || pipeline.vcs.revision === head) continue;
        const workflows = await json(`https://circleci.com/api/v2/pipeline/${pipeline.id}/workflow`, headers);
        if (workflows.items?.some(w => w.name === 'verify' && w.status === 'success')) {
          git('fetch', 'origin', pipeline.vcs.revision);
          // Never compare against an unrelated/rebased commit.
          git('merge-base', '--is-ancestor', pipeline.vcs.revision, head);
          base = pipeline.vcs.revision; break;
        }
      }
      if (!base) throw new Error('No successful master workflow found');
      reason = 'last successful master verification';
    } else {
      git('fetch', 'origin', 'master');
      base = git('merge-base', head, 'origin/master');
      reason = 'feature branch merge base';
    }
    paths = changedPaths(base, head);
    const graphPath = `${output}/nx-project-graph.json`;
    execFileSync('pnpm', ['exec','nx','graph',`--file=${graphPath}`], {
      encoding:'utf8', env:{...process.env, NX_DAEMON:'false', NX_ISOLATE_PLUGINS:'false'}, timeout:120000,
    });
    projects = affectedProjects(paths, JSON.parse(await readFile(graphPath,'utf8')).graph);
  }
} catch (error) {
  reason = `full fallback: ${error.message}`; base = null;
}
const selected = full || !base ? areas : [...affectedAreas(paths, projects)].sort();
const report = {head, base, branch, reason, selected, projects, paths};
await writeFile(`${output}/impact.json`, JSON.stringify(report, null, 2));
await writeFile(`${output}/continuation.json`, JSON.stringify(configuration(selected), null, 2));
console.log(JSON.stringify(report, null, 2));
