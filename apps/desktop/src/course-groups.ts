export type CourseLesson = {id:string;title:string;module:string;moduleIndex:number;index:number;trackId?:string;trackTitle?:string;trackIndex?:number};
export type CourseModule = {key:string;title:string;lessons:CourseLesson[]};
export type CourseTrack = {key:string;title:string;lessons:CourseLesson[];modules:CourseModule[]};

export function groupCourse(lessons:CourseLesson[]):CourseTrack[] {
  const tracks=new Map<string,CourseTrack>();
  for(const lesson of lessons){
    const trackKey=lesson.trackId||'';
    let track=tracks.get(trackKey);
    if(!track){track={key:trackKey,title:lesson.trackTitle||'',lessons:[],modules:[]};tracks.set(trackKey,track);}
    track.lessons.push(lesson);
    const moduleKey=`${lesson.moduleIndex}:${lesson.module}`;
    let module=track.modules.find(item=>item.key===moduleKey);
    if(!module){module={key:moduleKey,title:lesson.module||'Aulas',lessons:[]};track.modules.push(module);}
    module.lessons.push(lesson);
  }
  return [...tracks.values()];
}
