import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {affectedAreas, affectedProjects, areas, changedPaths} from './impact.mjs';
import {configuration} from './workflow.mjs';
const selected = (paths, projects) => [...affectedAreas(paths, projects)].sort();
for (const [name,paths,expected] of [
  ['backend',['apps/api/Controller.cs'],['backend']],
  ['API tests',['apps/api-tests/Test.cs'],['backend']],
  ['web',['apps/web/app/page.tsx'],['web']],
  ['Rust',['apps/desktop/src-tauri/src/main.rs'],['desktop']],
  ['shared auth',['packages/auth/src/index.ts'],['desktop','web']],
  ['lockfile',['pnpm-lock.yaml'],['desktop','extension','web']],
  ['docs',['README.md','docs/guide.md'],[]],
  ['pipeline',['.circleci/config.yml'],[...areas].sort()],
  ['unmapped',['new-product/main.go'],[...areas].sort()],
]) test(name,()=>assert.deepEqual(selected(paths),expected));
test('Nx transitive consumers extend explicit path mapping',()=>assert.deepEqual(selected(['packages/new/index.ts'],['web','desktop']),[...areas].sort()));
test('Nx reverse graph closure follows new consumers without leaking unrelated global inputs',()=>{
  const graph={nodes:{ui:{data:{root:'packages/ui'}},web:{data:{root:'apps/web'}},desktop:{data:{root:'apps/desktop'}},extension:{data:{root:'chrome-extension'}},api:{data:{root:'apps/api'}}},dependencies:{ui:[],web:[{target:'ui'}],desktop:[{target:'ui'}],extension:[{target:'desktop'}],api:[]}};
  const paths=['packages/ui/src/button.tsx'];
  assert.deepEqual(affectedProjects(paths,graph),['desktop','extension','ui','web']);
  assert.deepEqual(selected(paths,affectedProjects(paths,graph)),['desktop','extension','web']);
  assert.deepEqual(selected(['Directory.Build.props'],affectedProjects(['Directory.Build.props'],graph)),['backend']);
  assert.deepEqual(selected(['pnpm-lock.yaml'],affectedProjects(['pnpm-lock.yaml'],graph)),['desktop','extension','web']);
});
test('final gate requires every selected job, including no-op pipelines',()=>{
  for (const selection of [[],['backend'],areas]) {
    const config=configuration(selection), jobs=config.workflows.verify.jobs;
    assert.deepEqual(jobs.at(-1)['ci-complete'].requires,jobs.slice(0,-1));
  }
});
test('deletions and renames retain both paths, including spaces',()=>{
  const directory=mkdtempSync(join(tmpdir(),'vodown-impact-'));
  const git=(...args)=>execFileSync('git',args,{cwd:directory,encoding:'utf8'});
  try {
    git('init');git('config','user.name','CI');git('config','user.email','ci@example.invalid');
    mkdirSync(join(directory,'apps/web'),{recursive:true});
    writeFileSync(join(directory,'apps/web/old file.ts'),'test');git('add','.');git('commit','-m','initial');
    const base=git('rev-parse','HEAD').trim();
    mkdirSync(join(directory,'apps/desktop'),{recursive:true});
    git('mv','apps/web/old file.ts','apps/desktop/new file.ts');git('commit','-m','move');
    assert.deepEqual(changedPaths(base,'HEAD',git).sort(),['apps/desktop/new file.ts','apps/web/old file.ts']);
    assert.deepEqual(selected(changedPaths(base,'HEAD',git)),['desktop','web']);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
for (const full of [true,false]) test(full ? 'manual full execution selects all areas' : 'missing base safely selects all areas',()=>{
  const directory=mkdtempSync(join(tmpdir(),'vodown-base-'));
  const git=(...args)=>execFileSync('git',args,{cwd:directory,encoding:'utf8'});
  try {
    git('init');git('config','user.name','CI');git('config','user.email','ci@example.invalid');
    writeFileSync(join(directory,'README.md'),'fixture');git('add','.');git('commit','-m','initial');
    execFileSync(process.execPath,[fileURLToPath(new URL('./select.mjs',import.meta.url))],{
      cwd:directory,env:{...process.env,CIRCLE_BRANCH:'fixture',CIRCLE_PULL_REQUEST:'',VODOWN_CI_FULL:String(full),VODOWN_CI_OUTPUT:join(directory,'report')},stdio:'pipe',
    });
    const report=JSON.parse(readFileSync(join(directory,'report/impact.json'),'utf8'));
    assert.equal(report.base,null);
    assert.deepEqual(report.selected,areas);
    if (!full) assert.match(report.reason,/full fallback/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
