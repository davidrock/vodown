import {courseScope} from './model.js';
// Keep all affected tabs while scans run: background navigation in a temporary
// tab must not overwrite a user's switch to another active course.
export function autoDiscovery({tab,scan,busy,ready=Promise.resolve(),schedule=setTimeout,cancel=clearTimeout}) {
  let timer=null,running=false;const pending=new Set();
  async function run() {
    timer=null;await ready;
    if(running || busy()){if(pending.size)timer=schedule(run,1500);return;}
    const batch=[...pending];pending.clear();
    if(!batch.length)return;
    running=true;
    try {
      for(const id of batch){
        try {
          const current=await tab(id);
          if(!current?.active || !current.url)continue;
          try{courseScope(current.url);}catch{continue;}
          await scan(id);
        } catch { /* Closed tabs and pages that are not ready can retry on navigation. */ }
      }
    } finally {running=false;if(pending.size && timer===null)timer=schedule(run,1000);}
  }
  return {notify(id) {if(!Number.isInteger(id))return;pending.add(id);if(timer!==null)cancel(timer);timer=schedule(run,1000);}};
}
