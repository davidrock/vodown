// Injected into an ISOLATED world. Reads delivered DOM and ordinary player config.
// Never reads browser cookies, other tabs' sessions, or hidden React application state.
export async function collectPage(action, argument = {}) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
  const title = () => norm(document.querySelector('h1')?.innerText || document.title.split('|')[0]);
  const host = location.hostname;
  const onHotmart = host === 'hotmart.com';
  const onWhop = host === 'whop.com' || host.endsWith('.whop.com');
  const onKiwify = host === 'members.kiwify.com';
  const playerHost = host.endsWith('.play.hotmart.com');
  const whopButtons = () => [...document.querySelectorAll('button')].filter(b => /Multimedia\s*•/.test(b.innerText));
  const mediaId = b => {
    const src = b.querySelector('img')?.getAttribute('src');
    try { const u = new URL(src, location.href); return u.hostname === 'image.mux.com' ? u.pathname.split('/')[1] : null; } catch { return null; }
  };

  if (action === 'prepare') {
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
    if (onHotmart && !location.pathname.includes('/content/')) {
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
      const lessons = whopButtons().map((b,i)=>({
        index:i+1, title:norm(b.querySelector('img')?.alt || b.innerText.split('\n')[0]),
        label:b.innerText, expected_media:mediaId(b), module:'Aulas', module_index:1,
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
    if(location.pathname.split('/')[3]!==argument.id)return null;
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
}
