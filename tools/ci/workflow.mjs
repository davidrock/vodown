import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {areas} from './impact.mjs';

const run = (name, command, extra = {}) => ({run:{name, command, ...extra}});
const nodeImage = 'node:24.22.1-bookworm';
const nodeEnvironment = {NX_DAEMON:'false', NX_ISOLATE_PLUGINS:'false', NEXT_TELEMETRY_DISABLED:'1'};
const installNode = [
  run('Install pinned pnpm', 'npm install --global pnpm@11.17.0'),
  {restore_cache:{keys:['pnpm-v1-{{ arch }}-node24-{{ checksum "pnpm-lock.yaml" }}']}},
  run('Install workspace', 'pnpm install --frozen-lockfile --store-dir ~/.pnpm-store'),
  {save_cache:{key:'pnpm-v1-{{ arch }}-node24-{{ checksum "pnpm-lock.yaml" }}',paths:['~/.pnpm-store']}},
];
const buildEnvironment = {
  // Build-only placeholders; production builds receive environment-specific public values.
  NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ci',
  NEXT_PUBLIC_API_URL:'https://api.example.invalid',
};
function frontend(area) {
  const steps = ['checkout', ...installNode];
  if (area === 'extension') steps.push(
    run('Test capture and processing helpers', 'node tools/build-extension-auth.mjs --bundle-only\nnode --test chrome-extension/tests/*.test.js'),
    run('Install browser processing dependencies', 'npm ci --prefix chrome-extension'),
    run('Prepare and package extension', 'node chrome-extension/build.mjs\nnode tools/prepare-brand.mjs\npnpm package:extension'),
    {store_artifacts:{path:'dist'}},
  );
  else {
    if (area === 'web') steps.push(run('Test account recovery', 'node --test apps/web/tests/*.test.ts'));
    if (area === 'desktop') steps.push(run('Test desktop OAuth', 'node --test apps/desktop/tests/*.test.ts'));
    steps.push(run('Check shared TypeScript', 'pnpm check'), run(`Build ${area}`, `pnpm --dir apps/${area} build`));
  }
  return {docker:[{image:nodeImage}],environment:{...nodeEnvironment,...buildEnvironment},steps};
}
function mac(target) {
  return {
    macos:{xcode:'16.4.0'},resource_class:'m4pro.medium',environment:nodeEnvironment,
    steps:['checkout',run('Install pinned Node', 'bash tools/ci/install-node.sh'),
      ...installNode,
      run('Install pinned Rust', `curl -fsSL https://sh.rustup.rs -o /tmp/rustup.sh\nsh /tmp/rustup.sh -y --no-modify-path --profile minimal --default-toolchain 1.99.1\necho 'export PATH="$HOME/.cargo/bin:$PATH"' >> "$BASH_ENV"`),
      {restore_cache:{keys:[`cargo-v1-macos-${target}-rust199-{{ checksum "apps/desktop/src-tauri/Cargo.lock" }}`]}},
      run('Build interface', 'pnpm --dir apps/desktop build'),
      run('Test native code on host', 'cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml'),
      run('Build unsigned installer', `rustup target add ${target}\npnpm --dir apps/desktop tauri build --target ${target} --bundles app --no-sign`),
      {save_cache:{key:`cargo-v1-macos-${target}-rust199-{{ checksum "apps/desktop/src-tauri/Cargo.lock" }}`,paths:['~/.cargo/registry','~/.cargo/git']}},
      {store_artifacts:{path:`apps/desktop/src-tauri/target/${target}/release/bundle`}},
    ],
  };
}
const windows = {
  machine:{image:'windows-server-2022-gui:current',shell:'powershell.exe -ExecutionPolicy Bypass'},resource_class:'windows.medium',environment:nodeEnvironment,
  steps:['checkout',run('Install Node and pnpm', '. tools/ci/install-node.ps1\nnpm install --global pnpm@11.17.0\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'),
    run('Build and test Windows', '. tools/ci/install-node.ps1\npnpm install --frozen-lockfile\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\nrustup toolchain install 1.99.1 --profile minimal\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\ncargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\npnpm --dir apps/desktop tauri build --bundles nsis --no-sign\nexit $LASTEXITCODE'),
    {store_artifacts:{path:'apps/desktop/src-tauri/target/release/bundle'}},
  ],
};
const backend = {
  docker:[{image:'mcr.microsoft.com/dotnet/sdk:10.0'}, {image:'postgres:18',environment:{POSTGRES_PASSWORD:'ci-local-only',POSTGRES_USER:'vodown',POSTGRES_DB:'vodown_test'}}],
  environment:{VODOWN_TEST_DATABASE:'Host=localhost;Port=5432;Database=vodown_test;Username=vodown;Password=ci-local-only;SSL Mode=Disable',DOTNET_CLI_TELEMETRY_OPTOUT:'1'},
  steps:['checkout',
    run('Wait for isolated PostgreSQL', 'apt-get update && apt-get install -y postgresql-client python3\nfor attempt in $(seq 1 30); do pg_isready -h localhost -U vodown && exit 0; sleep 2; done\nexit 1'),
    {restore_cache:{keys:['nuget-v1-linux-dotnet10-{{ checksum "apps/api-tests/Vodown.Tests.csproj" }}-{{ checksum "apps/api/Vodown.Repository/Vodown.Repository.csproj" }}']}},
    run('Restore and build', 'dotnet tool restore\ndotnet restore Vodown.slnx\ndotnet build Vodown.slnx --configuration Release --no-restore'),
    run('Test API and database migrations', 'set +e\ndotnet test apps/api-tests --configuration Release --no-build --logger "trx;LogFileName=api.trx" --results-directory /tmp/test-results\nresult=$?\nset -e\npython3 tools/ci/trx-to-junit.py /tmp/test-results /tmp/junit\nexit "$result"'),
    {store_test_results:{path:'/tmp/junit'}},
    {store_artifacts:{path:'/tmp/test-results'}},
    {save_cache:{key:'nuget-v1-linux-dotnet10-{{ checksum "apps/api-tests/Vodown.Tests.csproj" }}-{{ checksum "apps/api/Vodown.Repository/Vodown.Repository.csproj" }}',paths:['~/.nuget/packages']}},
  ],
};

export function configuration(selected) {
  const jobs = {
    'pipeline-check':{docker:[{image:nodeImage}],steps:['checkout',run('Validate pipeline selection and repository metadata','node --test tools/ci/*.test.mjs\nnode tools/ci/validate-repository.mjs')]},
    'ci-complete':{docker:[{image:nodeImage}],steps:[run('All selected checks passed','echo "All selected checks passed"')]},
  };
  const invocations = ['pipeline-check'];
  for (const area of selected) {
    if (!areas.includes(area)) throw new Error(`Unknown area: ${area}`);
    if (area === 'desktop') {
      jobs['desktop-ui'] = frontend('desktop');
      jobs['desktop-macos-arm'] = mac('aarch64-apple-darwin');
      jobs['desktop-macos-intel'] = mac('x86_64-apple-darwin');
      jobs['desktop-windows'] = windows;
      invocations.push('desktop-ui','desktop-macos-arm','desktop-macos-intel','desktop-windows');
    } else if (area === 'backend') { jobs.backend = backend; invocations.push('backend'); }
    else if (area === 'infra') {
      jobs.infra = {machine:{image:'ubuntu-2404:current'},steps:['checkout',run('Validate container deployment','docker compose --env-file infra/vps/.env.example -f infra/vps/compose.yaml config --quiet')]};
      invocations.push('infra');
    } else { jobs[area] = frontend(area); invocations.push(area); }
  }
  return {version:2.1,jobs,workflows:{verify:{jobs:[...invocations,{'ci-complete':{requires:invocations}}]}}};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(process.argv[2] || '/tmp/vodown-continuation.json',JSON.stringify(configuration(areas),null,2));
}
