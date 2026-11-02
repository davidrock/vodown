type Lesson={id:string;title:string};
type Result={status:string;error?:string|null;errorCode?:string|null;warning?:string|null};
export async function runCourseQueue(lessons:Lesson[],options:{saved:()=>Promise<Set<string>>;start:(lesson:Lesson,materialsOnly?:boolean,subtitlesOnly?:boolean)=>Promise<void>;includeSubtitles?:boolean;includeMaterials?:boolean;wait:()=>Promise<Result>;canceled:()=>boolean;report:(progress:{done:number;total:number;failed:number;skipped:number;title:string;warnings:string[]})=>void}) {
  const saved=await options.saved();let done=0,failed=0,skipped=0;const warnings:string[]=[];
  const remember=(lesson:Lesson,result:Result)=>{if(result.warning)warnings.push(`${lesson.title}: ${result.warning}`);if(result.status==='failed'&&result.errorCode!=='no_materials'&&result.error)warnings.push(`${lesson.title}: ${result.error}`);};
  for(const lesson of lessons) {
    if(options.canceled())break;
    let lessonFailed=false;
    if(saved.has(lesson.id)){
      skipped++;
      if(options.includeSubtitles){await options.start(lesson,false,true);const result=await options.wait();remember(lesson,result);if(result.status==='canceled')break;lessonFailed=result.status!=='completed';}
    }
    else {
      options.report({done,total:lessons.length,failed,skipped,warnings:[...warnings],title:lesson.title});
      await options.start(lesson,false);
      const result=await options.wait();remember(lesson,result);
      if(result.status==='canceled')break;
      lessonFailed=result.status!=='completed';
    }
    if(options.includeMaterials!==false && !options.canceled()) {
      options.report({done,total:lessons.length,failed,skipped,warnings:[...warnings],title:`Materiais — ${lesson.title}`});
      await options.start(lesson,true);
      const result=await options.wait();remember(lesson,result);
      if(result.status==='canceled')break;
      if(result.status!=='completed' && result.errorCode!=='no_materials')lessonFailed=true;
    }
    if(lessonFailed)failed++;
    done++;options.report({done,total:lessons.length,failed,skipped,warnings:[...warnings],title:lesson.title});
  }
  return {done,total:lessons.length,failed,skipped,warnings,canceled:options.canceled()};
}
