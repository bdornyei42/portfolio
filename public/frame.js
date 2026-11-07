// frame.js — the shared ribbon on the tool pages: a strip of the sky from the site's Léggömb painting, the
// balloon-stripe rule, and links between the tools. /admin/ pages link the private tools; the public demos link
// each other and lead back to the workshop. deploy.bat copies it to site/ and site/admin/.
(() => {
  const H = 38, RULE = 3;
  const isAdmin = /\/admin(\/|$)/.test(location.pathname);
  const here = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '');
  const LINKS = isAdmin
    ? [['budget', 'Budget'], ['apply', 'Applications'], ['planner', 'Planner'], ['connections', 'Connections'], ['rejections', '1000 No’s'], ['./', 'All tools']]
    : [['planner-demo', 'Planner'], ['dashboard', 'Budget'], ['connections', 'Connections'], ['workshop', '← The workshop']];

  const css = `
    .dz-ribbon{ position:fixed; top:0; left:0; right:0; height:${H}px; z-index:1000; display:flex; align-items:center; gap:18px; padding:0 18px;
      background:linear-gradient(100deg, #3f6dbd, #6f8fca 55%, #8aa6d6); color:#F6F2E6;
      font:500 11.5px 'IBM Plex Mono', ui-monospace, monospace; letter-spacing:.07em; text-transform:uppercase; }
    .dz-ribbon::after{ content:""; position:absolute; left:0; right:0; bottom:-${RULE}px; height:${RULE}px;
      background:repeating-linear-gradient(90deg, #C1440E 0 12px, #EFE6CF 12px 24px); }
    .dz-ribbon a{ color:#F6F2E6; text-decoration:none; opacity:.82; white-space:nowrap; padding:3px 0; }
    .dz-ribbon a:hover, .dz-ribbon a:focus-visible{ opacity:1; text-decoration:underline; }
    .dz-ribbon a.on{ opacity:1; border-bottom:1px solid #F6F2E6; }
    .dz-ribbon .dz-who{ margin-right:auto; white-space:nowrap; opacity:.95; }
    .dz-ribbon nav{ display:flex; gap:16px; overflow-x:auto; scrollbar-width:none; }
    .dz-ribbon nav::-webkit-scrollbar{ display:none; }
    :root{ --radius:3px; }
    html.dz-flow body{ padding-top:${H + RULE}px; }
    html.dz-flow header.topbar{ top:${H + RULE}px; }
    /* full-screen apps (connections): move their fixed chrome down instead of padding the page */
    html.dz-fixed header.bar{ top:${H + RULE}px !important; }
    html.dz-fixed #stage, html.dz-fixed .sheet, html.dz-fixed #panel{ top:${H + RULE + 58}px !important; }
    @media (max-width:640px){ .dz-ribbon .dz-who{ display:none; } .dz-ribbon{ gap:12px; padding:0 12px; } }
    @media print{ .dz-ribbon{ display:none; } html.dz-flow body{ padding-top:0; } }
  `;

  function mount(){
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const bar = document.createElement('div');
    bar.className = 'dz-ribbon';
    bar.setAttribute('role', 'navigation');
    bar.setAttribute('aria-label', isAdmin ? 'Your tools' : 'Workshop tools');
    const who = document.createElement('a');
    who.className = 'dz-who';
    who.href = isAdmin ? './' : 'workshop.html';
    who.textContent = isAdmin ? 'B. Dörnyei · private' : 'B. Dörnyei · the workshop';
    const nav = document.createElement('nav');
    for (const [slug, label] of LINKS){
      const a = document.createElement('a');
      a.href = slug.endsWith('/') ? slug : slug + '.html';
      a.textContent = label;
      if (slug === here) { a.className = 'on'; a.setAttribute('aria-current', 'page'); }
      nav.appendChild(a);
    }
    bar.append(who, nav);
    document.body.prepend(bar);
    const fixedBar = document.querySelector('header.bar');
    document.documentElement.classList.add(fixedBar && getComputedStyle(fixedBar).position === 'fixed' ? 'dz-fixed' : 'dz-flow');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
