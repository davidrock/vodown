// Reads use the ISOLATED world. Attachment clicks run in MAIN only to capture
// the normal file target requested by the platform and restore window.open.
// Never reads browser cookies, other tabs' sessions, or hidden React application state.
export async function collectPage(action, argument = {}) {
  const deadline=argument.deadline||Date.now()+15000;
  const sleep = async ms => {if(action==='prepare' && Date.now()+ms>deadline)throw new Error('A leitura dos módulos demorou demais. Atualize o curso e tente novamente.');await new Promise(resolve=>setTimeout(resolve,ms));};
  try {
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
  const title = () => norm(document.querySelector('h1')?.innerText || document.title.split('|')[0]);
  const host = location.hostname;
  const onHotmart = host === 'hotmart.com';
  const onWhop = host === 'whop.com' || host.endsWith('.whop.com');
  const onKiwifyDashboard=host==='dashboard.kiwify.com';
  const onKiwify = host === 'members.kiwify.com'||onKiwifyDashboard;
  const playerHost = host.endsWith('.play.hotmart.com');
  const whopButtons = () => [...document.querySelectorAll('button')].filter(b => /Multimedia\s*•/.test(b.innerText));
  const mediaId = b => {
    const src = b.querySelector('img')?.getAttribute('src');
    try { const u = new URL(src, location.href); return u.hostname === 'image.mux.com' ? u.pathname.split('/')[1] : null; } catch { return null; }
  };

  const kiwiTitle=row=>row.querySelector('.line-clamp')||row.querySelector('[class*="line-clamp"]')||row.querySelector('.ml-2');
  const kiwiRows=()=>{
    const candidates=[...new Set([...document.querySelectorAll('div.cursor-pointer.p-3'),...document.querySelectorAll('div.cursor-pointer')])].filter(node=>node.querySelectorAll('input[type="checkbox"]').length===1 && kiwiTitle(node) && node.getClientRects().length);
    return candidates.filter(node=>!candidates.some(child=>child!==node && node.contains?.(child)));
  };
  const kiwiDashboardHeaders=()=>[...document.querySelectorAll('div.cursor-pointer')].filter(node=>{
    if(!node.getClientRects().length)return false;
    if(!/\d+\s*\/\s*\d+\s*$/.test(norm(node.innerText)) || node.querySelector('input[type="checkbox"]'))return false;
    return ![...(node.querySelectorAll?.('div.cursor-pointer')||[])].some(child=>/\d+\s*\/\s*\d+\s*$/.test(norm(child.innerText)));
  });
  const kiwiGroup=(header,headers)=>{
    let group=header.parentElement;
    for(let i=0;i<5 && group;i++){
      if(group.querySelector('input[type="checkbox"]'))return group;
      const parent=group.parentElement;
      if(!parent || headers.some(other=>other!==header && parent.contains?.(other)))return group;
      group=parent;
    }
    return header.parentElement;
  };
  const kiwiModuleRows=(header,headers,rows=kiwiRows())=>{
    const next=headers[headers.indexOf(header)+1];
    if(header.compareDocumentPosition)return rows.filter(row=>(header.compareDocumentPosition(row)&4) && (!next || (row.compareDocumentPosition(next)&4)));
    const group=kiwiGroup(header,headers);
    return rows.filter(row=>group.contains?group.contains(row):row.parentElement?.parentElement?.parentElement===group);
  };
  const openKiwiDashboardModules=async()=>{
    const headers=kiwiDashboardHeaders();
    if(!headers.length)return;
    for(const header of headers){
      const expected=Number(norm(header.innerText).match(/\d+\s*\/\s*(\d+)\s*$/)?.[1]||0);
      if(!expected)continue;
      const visible=()=>kiwiModuleRows(header,headers);
      const expanded=header.getAttribute?.('aria-expanded');
      if(expanded==='false'||!visible().length){header.click();}
      let loaded=false;
      for(let i=0;i<25;i++){if(visible().length>=expected){loaded=true;break;}await sleep(200);}
      if(!loaded)throw new Error(`O módulo ${norm(header.innerText).replace(/\s*\d+\s*\/\s*\d+\s*$/,'')} carregou ${visible().length} de ${expected} aulas. Atualize a página e tente novamente.`);
    }
  };
  const kiwiDashboardLessons=()=>{
    const headers=kiwiDashboardHeaders(),groups=[];
    const rows=kiwiRows();
    const byHeader=new Map(headers.map(h=>[h,kiwiModuleRows(h,headers,rows)]));
    return rows.map(row=>{
      const header=headers.find(h=>byHeader.get(h).includes(row));
      const group=header?null:row.parentElement.parentElement.parentElement;
      if(!groups.includes(group))groups.push(group);
      const module=norm((header||group.firstElementChild).innerText).replace(/\s*\d+\s*\/\s*\d+\s*$/,'').trim();
      const moduleIndex=header?headers.indexOf(header)+1:groups.indexOf(group)+1;
      const moduleRows=header?byHeader.get(header):rows.filter(r=>r.parentElement.parentElement.parentElement===group);
      const position=moduleRows.indexOf(row)+1;
      return {row,title:norm(kiwiTitle(row).textContent),module,module_index:moduleIndex,id:`kiwify:${moduleIndex}:${position}`,page_url:location.href};
    });
  };
  if(action==='openKiwify' && onKiwifyDashboard) {
    await openKiwiDashboardModules();
    const matches=kiwiDashboardLessons().filter(l=>l.id===argument.id&&l.title===argument.title&&l.module===argument.module);
    if(matches.length!==1)throw new Error('A lista da Kiwify mudou. Atualize as aulas.');
    matches[0].row.click();
    for(let i=0;i<50;i++){if(norm(document.querySelector('header h3')?.textContent)===argument.title && norm(document.querySelector('header h4')?.textContent)===argument.module)return {opened:true};await sleep(200);}
    throw new Error('A aula da Kiwify não carregou.');
  }
  if(action==='materialChunk') {
    const url=new URL(argument.url,location.href);
    if(!(url.protocol==='blob:'&&url.origin===location.origin)&&url.protocol!=='data:')throw new Error('Origem de arquivo inválida.');
    if(!Number.isSafeInteger(argument.offset)||argument.offset<0||argument.offset>536870912)throw new Error('Posição inválida.');
    const response=await fetch(url.href);const blob=await response.blob();
    const data=Array.from(new Uint8Array(await blob.slice(argument.offset,argument.offset+32768).arrayBuffer()));
    return {data,done:argument.offset+data.length>=blob.size};
  }
  const materialNodes=()=>{
    const roots=[...document.querySelectorAll('[id$="content-materials"], [data-testid*="attachment"], [data-test*="material"], [data-testid*="resource"], [data-test*="attachment"]')];
    const anchors=[...document.querySelectorAll('a[href]')].filter(a=>{try{const url=new URL(a.href,location.href);return url.protocol==='https:' || url.protocol==='blob:'&&url.origin===location.origin;}catch{return false;}}).filter(a=>a.hasAttribute('download')||/\.(pdf|zip|rar|7z|docx?|xlsx?|pptx?|txt|csv|mp3|wav|psd|epub|png|jpe?g|webp|svg)(?:[?#]|$)/i.test(a.getAttribute('href')));
    const buttons=[...new Set([...roots.flatMap(root=>[...root.querySelectorAll('button')]),...document.querySelectorAll('button,[role="button"]')])].filter(b=>/^(download|baixar)( arquivo)?$/i.test(norm(b.innerText)) || /\.(pdf|zip|rar|7z|docx?|xlsx?|pptx?|txt|csv|mp3|wav|psd|epub|png|jpe?g|webp|svg)(?:\s|$)/i.test(norm(b.innerText)));
    return [...new Set([...anchors,...buttons])].filter(node=>node.getAttribute('aria-disabled')!=='true').map(node=>{
      const block=node.closest('[data-testid*="attachment"], [data-test*="attachment"]')||node.parentElement?.parentElement;
      const filenameNode=[...(node.querySelectorAll?.('span')||[])].find(x=>/\.[a-z0-9]{1,8}$/i.test(norm(x.textContent)));
      const text=node.getAttribute('download')||node.getAttribute('title')||filenameNode?.textContent||node.innerText||'';
      const context=/\.(pdf|zip|rar|7z|docx?|xlsx?|pptx?|txt|csv|mp3|wav|psd|epub|png|jpe?g|webp|svg)(?:\s|$)/i.test(text)?text:(block?.innerText||text);
      const match=context.match(/([^\n]+?\.(?:pdf|zip|rar|7z|docx?|xlsx?|pptx?|txt|csv|mp3|wav|psd|epub|png|jpe?g|webp|svg))/i);
      let name=norm(match?.[1]||text);
      if(!/\.[a-z0-9]{1,8}$/i.test(name) && node.href){try{name=decodeURIComponent(new URL(node.href).pathname.split('/').pop());}catch{}}
      return {node,name};
    }).filter(x=>x.name && /\.[a-z0-9]{1,8}$/i.test(x.name));
  };
  if(action==='materials' || action==='downloadMaterial') {
    if(!onHotmart&&!onWhop&&!onKiwify)return null;
    if(argument.title && onWhop && ![...document.querySelectorAll('mux-player')].some(p=>norm(p.getAttribute('title'))===norm(argument.title)))return null;
    if(argument.title && onKiwifyDashboard && (norm(document.querySelector('header h3')?.textContent)!==norm(argument.title)||norm(document.querySelector('header h4')?.textContent)!==norm(argument.module)))return null;
    if(onHotmart && argument.page_url && new URL(argument.page_url).pathname!==location.pathname)return null;
    const tab=[...document.querySelectorAll('[role="tab"]')].find(b=>/materia|resource|attachment|arquivo/i.test(b.textContent));
    if(tab && tab.getAttribute('aria-selected')!=='true'){tab.click();await sleep(500);}
    const entries=materialNodes();
    if(action==='materials')return {materials:entries.map((x,index)=>({index,name:x.name}))};
    const entry=entries[argument.materialIndex];
    if(!entry || entry.name!==argument.name)throw new Error('O material mudou. Busque a aula novamente.');
    if(entry.node.tagName==='A' && entry.node.href && /^https:/.test(entry.node.href))return {clicked:true,downloadUrl:entry.node.href};
    // Capture only this file's normal window.open target. Synthetic clicks do
    // not carry browser user activation; transferring the captured bytes to the desktop
    // avoids a popup dependency without changing browser security settings.
    const originalOpen=window.open;
    const anchorPrototype=window.HTMLAnchorElement?.prototype;
    const originalClick=anchorPrototype?.click;
    const originalRevoke=window.URL?.revokeObjectURL;
    let destination=null;
    const captureTarget=raw=>{
      try{const url=new URL(raw,location.href);if(url.protocol==='https:'||url.protocol==='data:'||url.protocol==='blob:'&&url.origin===location.origin){destination=url.href;return true;}}catch{}
      return false;
    };
    const popupLocation={assign:captureTarget,replace:captureTarget};
    Object.defineProperty(popupLocation,'href',{set:captureTarget,get:()=>destination||'about:blank'});
    const popup={closed:false,close(){this.closed=true;},focus(){}};
    Object.defineProperty(popup,'location',{set:captureTarget,get:()=>popupLocation});
    const intercepted=raw=>{
      if(!raw||raw==='about:blank')return popup;
      return captureTarget(raw)?popup:null;
    };
    const captureAnchor=anchor=>{
      try {
        const url=new URL(anchor.href,location.href);
        const eligible=anchor.hasAttribute('download') || url.protocol==='blob:' || url.protocol==='data:' || url.protocol==='https:';
        if(eligible && ((url.protocol==='blob:' && url.origin===location.origin)||url.protocol==='data:'||url.protocol==='https:')){destination=url.href;return true;}
      }catch{}
      return false;
    };
    const interceptedClick=function(...args){if(captureAnchor(this))return;return originalClick.apply(this,args);};
    const captureEvent=event=>{const anchor=event.target?.closest?.('a[href]');if(!event.isTrusted && anchor && captureAnchor(anchor)){event.preventDefault();event.stopImmediatePropagation();}};
    const interceptedRevoke=raw=>{
      if(destination && raw===destination){setTimeout(()=>originalRevoke.call(window.URL,raw),600000);return;}
      return originalRevoke.call(window.URL,raw);
    };
    window.open=intercepted;
    if(originalRevoke)window.URL.revokeObjectURL=interceptedRevoke;
    if(anchorPrototype && originalClick)anchorPrototype.click=interceptedClick;
    document.addEventListener?.('click',captureEvent,true);
    try {
      entry.node.click();
      for(let i=0;i<40 && !destination;i++)await sleep(200);
      return {clicked:true,...(destination?{downloadUrl:destination}:{})};
    } finally {
      document.removeEventListener?.('click',captureEvent,true);
      if(originalRevoke && window.URL.revokeObjectURL===interceptedRevoke)window.URL.revokeObjectURL=originalRevoke;
      if(anchorPrototype && anchorPrototype.click===interceptedClick)anchorPrototype.click=originalClick;
      if(window.open===intercepted)window.open=originalOpen;
    }
  }
  if(action==='hotmartTracks' && onHotmart){
    const base=location.pathname.match(/^(\/[^/]+\/club\/[^/]+\/products\/\d+)/)?.[1];
    if(!base)return null;
    const tracks=[];const seen=new Set();
    for(const anchor of document.querySelectorAll('a[href]')){
      let url;try{url=new URL(anchor.getAttribute('href'),location.href);}catch{continue;}
      if(url.origin!==location.origin || !url.pathname.startsWith(`${base}/track/`))continue;
      const match=url.pathname.slice(base.length).match(/^\/track\/([A-Za-z0-9_-]+)\/?$/);
      if(!match || seen.has(match[1]))continue;
      seen.add(match[1]);url.search='';url.hash='';
      const name=norm(anchor.getAttribute('title')||anchor.querySelector('h1,h2,h3,h4,[data-test*="title"],img[alt]')?.textContent||anchor.querySelector('img[alt]')?.getAttribute('alt')||anchor.innerText);
      tracks.push({id:match[1],title:name||`Trilha ${tracks.length+1}`,url:url.href});
    }
    const trackCount=document.body?.innerText?.match(/(?:\b(\d+)\s+trilhas\b|\btrilhas\s*\(\s*(\d+)\s*\))/i);
    return {tracks,courseTitle:title(),expectedTracks:Number(trackCount?.[1]||trackCount?.[2])||0};
  }
  if (action === 'prepare' && playerHost)return {courseTitle:title()};
  if (action === 'prepare') {
    if(onKiwifyDashboard){
      await openKiwiDashboardModules();
      const lessons=kiwiDashboardLessons().map(({row,...lesson},index)=>({...lesson,index:index+1}));
      const headers=kiwiDashboardHeaders();
      const expected=headers.reduce((sum,header)=>sum+Number(norm(header.innerText).match(/\d+\s*\/\s*(\d+)\s*$/)?.[1]||0),0);
      if(expected && expected!==lessons.length)throw new Error(`A lista da Kiwify está incompleta: ${lessons.length} de ${expected} aulas.`);
      return lessons.length?{platform:'kiwify',courseTitle:document.title,lessons,page_url:location.href}:null;
    }
    if(onKiwify) {
      const buttons=[...document.querySelectorAll('button[aria-controls^="headlessui-disclosure-panel-"]')];
      if(!buttons.length)return null;
      for(const button of buttons) {
        if(button.getAttribute('aria-expanded')==='false')button.click();
      }
      const course=location.pathname.split('/')[1];
      const read=()=>buttons.flatMap((button,m)=>{
        const panel=document.getElementById(button.getAttribute('aria-controls'));
        const module=norm(button.innerText).replace(/\s*\d+\s*\/\s*\d+\s*$/,'').trim()||`Módulo ${m+1}`;
        return [...(panel?.querySelectorAll('ol li a[href]')||[])].flatMap(a=>{
          const url=new URL(a.getAttribute('href'),location.href),parts=url.pathname.split('/').filter(Boolean);
          if(url.origin!==location.origin||parts.length!==3||parts[0]!==course||a.getAttribute('aria-disabled')==='true')return [];
          const club=url.searchParams.get('club');url.search='';url.hash='';if(club)url.searchParams.set('club',club);
          return [{title:norm(a.innerText),page_url:url.href,module,module_index:m+1,id:parts[2]}];
        });
      });
      let items=[],previous='',stable=0;
      for(let i=0;i<60;i++) {
        items=read();const signature=JSON.stringify(items);
        stable=signature===previous&&items.length?stable+1:0;previous=signature;
        if(stable>=4)break;
        await sleep(200);
      }
      if(!items.length||stable<4||buttons.some(b=>b.getAttribute('aria-expanded')!=='true'))throw new Error('A lista da Kiwify não carregou completamente. Abra a lista de aulas e tente novamente.');
      const expected=buttons.reduce((sum,b)=>sum+Number(norm(b.innerText).match(/\d+\s*\/\s*(\d+)\s*$/)?.[1]||0),0);
      if(expected&&items.length!==expected)throw new Error(`A lista da Kiwify está incompleta: ${items.length} de ${expected} aulas.`);
      if(new Set(items.map(x=>x.id)).size!==items.length)throw new Error('A lista da Kiwify contém aulas duplicadas.');
      return {platform:'kiwify',courseTitle:document.title.split(' - ').slice(2).join(' - ')||course,lessons:items.map((x,i)=>({...x,index:i+1})),page_url:location.href};
    }
    if (onHotmart && !location.pathname.includes('/content/') && !document.querySelector('button[aria-controls^="sectionId_"]')) {
      const button = [...document.querySelectorAll('button')].find(b => norm(b.innerText) === 'Continuar assistindo');
      if (!button) return null;
      const count = document.body.innerText.match(/\d+\/(\d+)\s+conteúdos/);
      const courseTitle = title();
      button.click();
      return {navigating:true, expectedCount:count ? Number(count[1]) : null, courseTitle};
    }
    if (onHotmart) {
      const buttons = [...document.querySelectorAll('button[aria-controls^="sectionId_"]')];
      if (!buttons.length) return null;
      for (const button of buttons) {
        if (button.getAttribute('aria-expanded') === 'false') {
          button.click();
          let ready = false;
          for (let i=0; i<60; i++) {
            await sleep(100);
            if (button.getAttribute('aria-expanded') === 'true') { ready=true; break; }
          }
          if (!ready) throw new Error('Um módulo não abriu. Tente buscar as aulas novamente.');
        }
      }
      const read = () => buttons.flatMap((button, m) => {
        const section = document.getElementById(button.getAttribute('aria-controls'));
        const module = norm(button.querySelector('[data-test="module-item-name"]')?.textContent) || `Módulo ${m+1}`;
        return [...(section?.querySelectorAll('a[href*="/content/"]') || [])].map(a => {
          const url = new URL(a.getAttribute('href'), location.href); url.search=''; url.hash='';
          const thumb = a.querySelector('[data-test="content-background-thumbnail"]')?.getAttribute('src');
          return {title:norm(a.querySelector('span[title]')?.getAttribute('title') || a.innerText),
            page_url:url.href, module, module_index:m+1,
            expected_media:thumb?.match(/\/thumbnail\/([^/]+)\//)?.[1] || null};
        });
      });
      let items=[], previous='', stable=0;
      for (let i=0; i<60; i++) {
        items=read(); const signature=JSON.stringify(items.map(x=>x.page_url));
        stable = signature === previous && items.length ? stable+1 : 0; previous=signature;
        if (stable >= 4) break;
        await sleep(200);
      }
      if (!items.length || stable < 4) throw new Error('A lista de aulas não estabilizou.');
      if (new Set(items.map(x=>x.page_url)).size !== items.length) throw new Error('A lista possui aulas duplicadas.');
      return {platform:'hotmart', lessons:items.map((x,i)=>({...x,index:i+1,id:x.page_url})), page_url:location.href};
    }
    if (onWhop && whopButtons().length) {
      const moduleHeaders=[];
      const lessons = whopButtons().map((b,i)=>({
        index:i+1, title:norm(b.querySelector('img')?.alt || b.innerText.split('\n')[0]),
        label:b.innerText, expected_media:mediaId(b), ...(()=>{
          const sections=[...document.querySelectorAll('[aria-controls]')];
          const toggle=sections.find(t=>document.getElementById(t.getAttribute('aria-controls'))?.contains(b));
          if(toggle)return {module:norm(toggle.innerText).replace(/\s+\d+\s*(lessons?|aulas?)\s*$/i,'')||'Aulas',module_index:sections.indexOf(toggle)+1};
          let parent=b.parentElement;
          while(parent && parent!==document.body){const header=parent.children?.[0];if(header && !header.contains(b) && header.querySelector('span') && header.querySelector('button') && norm(header.innerText) && !/Multimedia\s*•/.test(header.innerText)){if(!moduleHeaders.includes(header))moduleHeaders.push(header);return {module:norm(header.innerText),module_index:moduleHeaders.indexOf(header)+1};}const heading=parent.querySelector('h2,h3,h4,[role="heading"]');if(heading && parent.querySelectorAll('button').length<whopButtons().length)return {module:norm(heading.innerText)||'Aulas',module_index:[...document.querySelectorAll('h2,h3,h4,[role="heading"]')].indexOf(heading)+1};parent=parent.parentElement;}
          return {module:'Aulas',module_index:1};
        })(),
        id:`whop:${mediaId(b) || i+1}`, page_url:location.href,
        duration: (b.innerText.match(/Multimedia\s*•\s*((?:\d+:)?\d+:\d{2})/)?.[1] || '').split(':').reduce((total,n)=>total*60+Number(n),0) || null,
      }));
      return {platform:'whop', courseTitle:title(), lessons, page_url:location.href};
    }
    return null;
  }

  if (action === 'openWhop' && onWhop) {
    if(!whopButtons().length)return null;
    const matches = whopButtons().filter(b => argument.expected_media ? mediaId(b) === argument.expected_media : norm(b.innerText) === norm(argument.label));
    if (matches.length !== 1) throw new Error('Não foi possível identificar o botão desta aula.');
    matches[0].click();
    return {opened:true};
  }

  if (action === 'capture' && playerHost) {
    const scripts = [...document.querySelectorAll('script[type="application/json"]')];
    for (const script of scripts) {
      let data; try { data=JSON.parse(script.textContent); } catch { continue; }
      const app=data?.props?.pageProps?.applicationData;
      if (!app?.mediaCode) continue;
      if (argument.expected_media && app.mediaCode !== argument.expected_media) return null;
      if (app.isDrmEnabled !== false || app.flags?.ENABLE_PLAYER_V4_ENCRYPTION) return {protected:true, reason:'Este player utiliza DRM ou proteção não suportada.'};
      const asset=(app.mediaAssets || []).filter(a=>a.url && new URL(a.url).pathname.endsWith('.m3u8')).sort((a,b)=>(b.height||0)-(a.height||0))[0];
      if (!asset) return {unsupported:true, reason:'O player não ofereceu uma playlist HLS suportada.'};
      for (let i=0; i<20 && !document.querySelector('video'); i++) await sleep(100);
      document.querySelectorAll('video').forEach(v=>v.pause());
      return {platform:'hotmart', url:asset.url, playback_id:app.mediaCode, duration:app.mediaDuration,
        drm:false, encryption:false, user_agent:navigator.userAgent};
    }
  }

  if(action==='capture'&&onKiwify) {
    if(onKiwifyDashboard){if(norm(document.querySelector('header h3')?.textContent)!==norm(argument.title)||norm(document.querySelector('header h4')?.textContent)!==norm(argument.module))return null;}
    else if(location.pathname.split('/')[3]!==argument.id)return null;
    const video=document.querySelector('video');
    if(!video)return null;
    if(video.mediaKeys)return {protected:true,reason:'Este vídeo da Kiwify utiliza DRM.'};
    const poster=video.getAttribute('data-poster')||video.getAttribute('poster');
    let media;
    try{media=new URL(poster,location.href).pathname.match(/\/([a-f0-9-]{36})\/thumbnail\./i)?.[1];}catch{}
    if(!media)return {unsupported:true,reason:'O player Kiwify não ofereceu uma identificação de vídeo suportada.'};
    const urls=performance.getEntriesByType('resource').map(r=>r.name).filter(raw=>{
      try{const url=new URL(raw);return url.protocol==='https:'&&url.hostname==='d3pjuhbfoxhm7c.cloudfront.net'&&url.pathname.endsWith(`/${media}/${media}-master.m3u8`);}catch{return false;}
    });
    if(!urls.length)return null;
    video.pause();
    return {platform:'kiwify',url:urls.at(-1),playback_id:media,page_url:location.href,drm:false,duration:Number.isFinite(video.duration)&&video.duration>0?video.duration:null};
  }

  if (action === 'capture' && onWhop) {
    const players=[...document.querySelectorAll('mux-player')];
    for (const p of players) {
      const id=p.getAttribute('playback-id');
      if (argument.expected_media && id !== argument.expected_media) continue;
      if (norm(p.getAttribute('title')) !== norm(argument.title)) continue;
      const v=p.shadowRoot?.querySelector('mux-video');
      if (p.hasAttribute('drm-token') || v?.hasAttribute('drm-token')) return {protected:true,reason:'Este player utiliza DRM.'};
      const url=v?.getAttribute('src') || p.getAttribute('src');
      if (!id || !url || new URL(url).pathname !== `/${id}.m3u8`) continue;
      const video=v?.shadowRoot?.querySelector('video'); video?.pause();
      const subtitles=[...p.querySelectorAll('track'),...(p.shadowRoot?.querySelectorAll('track')||[]),...(v?.shadowRoot?.querySelectorAll('track')||[])].filter(t=>['subtitles','captions'].includes(t.getAttribute('kind'))&&t.getAttribute('src')).map(t=>({url:new URL(t.getAttribute('src'),location.href).href,language:t.getAttribute('srclang')||'und',label:t.getAttribute('label')||''}));
      return {platform:'whop', url, playback_id:id, page_url:location.href, drm:false,
        duration:Number.isFinite(video?.duration) ? video.duration : argument.duration || null, subtitles,user_agent:navigator.userAgent};
    }
  }
  return null;
  } catch(error) {if(action==='prepare'){
    let diagnostic='';
    if(location.hostname==='dashboard.kiwify.com'){try{
      const nodes=[...document.querySelectorAll('div.cursor-pointer')].filter(n=>n.querySelector('input[type="checkbox"]')||/\d+\s*\/\s*\d+\s*$/.test(String(n.innerText||'').trim())).slice(0,16).map(n=>({classes:String(n.className).slice(0,170),visible:!!n.getClientRects().length,text:String(n.innerText||'').slice(0,60),inputs:n.querySelectorAll('input').length,title:!!n.querySelector('.ml-2')}));
      diagnostic=JSON.stringify({version:'1.6.13',error:String(error.message).slice(0,200),inputs:document.querySelectorAll('input[type="checkbox"]').length,nodes});
    }catch{}}
    return {collectionError:String(error.message||'Não foi possível ler os módulos.').replace(/https?:\/\/\S+/g,'[URL omitida]').slice(0,600),collectionDiagnostic:diagnostic};
  }throw error;}
}
