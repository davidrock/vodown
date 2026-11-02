// Only auth SDK values use this namespace. No password is stored here.
export function persistentAuthStorage(local,legacy) {
  const prefix='vodown-auth-v1:';
  let access;
  const ready=()=>access ||= Promise.all([
    local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),
    legacy.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),
  ]);
  const keyFor=key=>{
    if(typeof key!=='string' || !key.startsWith('sb-') || key.length>200 || /[\x00-\x1f]/.test(key))throw new Error('Chave de sessão inválida.');
    return prefix+key;
  };
  return {
    async getItem(key) {
      const target=keyFor(key);await ready();
      const value=(await local.get(target))[target];
      if(typeof value==='string')return value;
      const previous=(await legacy.get(key))[key];
      if(typeof previous!=='string')return null;
      // Commit durably before removing the old in-memory session.
      await local.set({[target]:previous});await legacy.remove(key);
      return previous;
    },
    async setItem(key,value) {
      const target=keyFor(key);await ready();
      await local.set({[target]:value});await legacy.remove(key);
    },
    async removeItem(key) {
      const target=keyFor(key);await ready();
      await local.remove(target);await legacy.remove(key);
    },
  };
}
