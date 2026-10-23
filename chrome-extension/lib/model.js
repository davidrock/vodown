export function courseScope(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Abra um curso na Whop, Hotmart ou Kiwify.');
  if (url.hostname === 'members.kiwify.com') {
    const match=url.pathname.match(/^\/([a-f0-9-]{36})\/([a-f0-9-]{36})\/([a-f0-9-]{36})(?:\/classes)?\/?$/i);
    if(match)return {platform:'kiwify',key:`kiwify:${match[1]}:${url.searchParams.get('club')||''}`,slug:match[1],basePath:`/${match[1]}`};
  }
  if (url.hostname === 'hotmart.com') {
    const match = url.pathname.match(/^\/[^/]+\/club\/([^/]+)\/products\/(\d+)(?:\/content\/[A-Za-z0-9_-]+)?\/?$/);
    if (match) return {platform:'hotmart', key:`hotmart:${match[1]}:${match[2]}`, slug:match[1], basePath:url.pathname.split('/content/')[0].replace(/\/$/, '')};
  }
  if (url.hostname === 'whop.com') {
    const match = url.pathname.match(/^(.*\/app\/courses\/(cors_[A-Za-z0-9]+))(?:\/lessons\/[A-Za-z0-9_]+)?\/?$/);
    if (match) return {platform:'whop', key:`whop:${match[2]}`, slug:match[2], basePath:match[1]};
  }
  throw new Error('Abra uma aula da Hotmart, Whop ou Kiwify.');
}

export function sameCourse(first, second) {
  try { return courseScope(first).key === courseScope(second).key; } catch { return false; }
}

export function safeError(error) {
  return String(error?.message || error || 'Erro desconhecido').replace(/https?:\/\/\S+/g, '[URL omitida]').slice(0, 600);
}

export function publicState(state) {
  // This is the only data persisted/broadcast. Playback tokens remain transient.
  return {
    inventory: state.inventory,
    busy: state.busy,
    stage: state.stage,
    current: state.current,
    total: state.total,
    finished: state.finished,
    results: state.results,
    logs: state.logs.slice(-60),
    error: state.error,
    engine: state.engine,
    settings: state.settings,
    operation: state.operation,
    contextKey: state.contextKey,
    version: state.version||0,
  };
}

// A panel belongs to its current tab; a queue can keep running in another tab.
export function stateForCourse(state, scope) {
  if(scope && state.inventory?.key===scope.key)return state;
  const ownContext=scope && (state.operation?.key || state.contextKey)===scope.key;
  const stage=ownContext ? state.stage : state.busy ? 'Uma operação continua em outra aba. Aguarde ou pare a fila.' : scope ? 'Carregando as aulas deste curso…' : 'Abra um curso da Hotmart, Whop ou Kiwify nesta aba.';
  return {...state,inventory:null,current:null,total:0,finished:0,results:[],logs:[],error:ownContext?state.error:null,stage};
}

export function validateSelection(inventory, ids, mode) {
  if (!inventory?.lessons?.length) throw new Error('Busque as aulas primeiro.');
  if (!Array.isArray(ids) || !ids.length) throw new Error('Selecione pelo menos uma aula.');
  const selected = inventory.lessons.filter(item => ids.includes(item.id));
  if (selected.length !== new Set(ids).size) throw new Error('A seleção não corresponde ao curso carregado.');
  // Validation intentionally checks one selected lesson, without downloading videos.
  return mode === 'validate' ? selected.slice(0, 1) : selected;
}
