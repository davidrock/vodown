// A failed module read is actionable; retry only missing/not-yet-loaded frames.
export async function readCoursePage(read,{timeoutMs=18000}={}) {
  let timer;
  try {
    const results=await Promise.race([read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('A busca demorou demais. Atualize a página do curso e tente novamente.')),timeoutMs);})]);
    const failure=results.find(item=>item.result?.collectionError)?.result;
    if(failure){const error=new Error(failure.collectionError);error.diagnostic=failure.collectionDiagnostic;throw error;}
    return results;
  } finally {clearTimeout(timer);}
}
