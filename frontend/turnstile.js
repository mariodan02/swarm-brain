// Cloudflare Turnstile (anti-bot check) for the public copy: one fresh token per run.

let loading = null;

function load() {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => { loading = null; reject(new Error('script')); };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Run the check and return its token. The widget stays hidden unless Cloudflare needs the
 * visitor to click. Rejects if the script is blocked, the check fails or 60 seconds pass.
 * @param {string} sitekey
 * @param {HTMLElement} container
 * @returns {Promise<string>}
 */
export async function turnstileToken(sitekey, container) {
  const turnstile = await load();
  return new Promise((resolve, reject) => {
    const box = document.createElement('div');
    container.replaceChildren(box);
    const finish = (fn, value) => {
      clearTimeout(timer);
      try { turnstile.remove(id); } catch { /* already gone */ }
      container.replaceChildren();
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('timeout')), 60000);
    const id = turnstile.render(box, {
      sitekey,
      theme: 'dark',
      appearance: 'interaction-only',
      callback: (token) => finish(resolve, token),
      'error-callback': () => finish(reject, new Error('challenge')),
    });
  });
}
