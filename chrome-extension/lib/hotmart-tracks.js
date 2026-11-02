import {sameCourse} from './model.js';

// Read each track in a temporary inactive tab so the user's current lesson stays open.
export async function collectHotmartTracks(scope,{tabs,inject,sleep,cleanUrl}) {
  const base=`https://hotmart.com${scope.basePath}`;
  const temporary=await tabs.create({url:base,active:false});
  try {
    let overview=null,previous='',stable=0;
    for(let attempt=0;attempt<30;attempt++) {
      const tab=await tabs.get(temporary.id);
      if(tab.status==='complete') {
        try {overview=(await inject(temporary.id,'hotmartTracks')).find(x=>x.result)?.result||null;}catch{}
        const signature=JSON.stringify(overview?.tracks?.map(t=>t.id)||[]);
        stable=signature===previous && overview?.tracks?.length?stable+1:0;previous=signature;
        if(stable>=3 && (!overview.expectedTracks||overview.tracks.length>=overview.expectedTracks))break;
      }
      await sleep(400);
    }
    if(!overview?.tracks?.length)return overview?.expectedTracks?{lessons:[],courseTitle:overview.courseTitle,failedTracks:['As trilhas não puderam ser listadas'],totalTracks:overview.expectedTracks}:null;
    const lessons=[],failedTracks=[];
    if(overview.expectedTracks>overview.tracks.length)failedTracks.push('Outras trilhas não foram listadas');
    for(const [trackIndex,track] of overview.tracks.entries()) {
      await tabs.update(temporary.id,{url:track.url});
      let found=null,expected=null,openedTrack=false;
      for(let attempt=0;attempt<80;attempt++) {
        const tab=await tabs.get(temporary.id);
        if(tab.url&&!sameCourse(tab.url,base))break;
        if(tab.url && new URL(tab.url).pathname.replace(/\/$/,'')===new URL(track.url).pathname.replace(/\/$/,''))openedTrack=true;
        if(openedTrack && tab.status==='complete') {
          try {
            const results=await inject(temporary.id,'prepare');
            if(results.some(x=>x.result?.collectionError))break;
            const navigation=results.find(x=>x.result?.navigating)?.result;
            if(navigation){expected=navigation.expectedCount||expected;await sleep(500);continue;}
            found=results.find(x=>x.result?.platform==='hotmart'&&x.result?.lessons?.length)?.result||null;
            if(found)break;
          } catch { /* A navigation can replace the frame while it is read. */ }
        }
        await sleep(400);
      }
      if(!found || expected && expected!==found.lessons.length){failedTracks.push(track.title);continue;}
      for(const item of found.lessons) {
        const pageUrl=cleanUrl(item.page_url);
        if(!sameCourse(pageUrl,base))throw new Error('Uma trilha contém uma aula de outro curso.');
        lessons.push({...item,id:pageUrl,page_url:pageUrl,track_id:track.id,track_title:track.title,track_index:trackIndex+1,index:lessons.length+1});
      }
    }
    const counts=new Map();for(const lesson of lessons)counts.set(lesson.id,(counts.get(lesson.id)||0)+1);
    for(const lesson of lessons)if(counts.get(lesson.id)>1)lesson.id=`${lesson.track_id}:${lesson.id}`;
    return {lessons,courseTitle:overview.courseTitle,failedTracks,totalTracks:overview.tracks.length};
  } finally {await tabs.remove(temporary.id).catch(()=>{});}
}
