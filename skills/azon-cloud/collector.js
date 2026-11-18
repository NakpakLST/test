// Run in the persistent cloud browser REPL after creating `ozonerTab` with
// cua.createBrowserTab("cdp", firstUrl). Supply exact sheet URLs in `inputs`.
// Browser actions must use the documented tab API; this file is a REPL template.
const results = [];
async function collect(item) {
  const match = item.url.match(/\/product\/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)/);
  if (!match) return { ...item, status: 'unavailable', price_rub: null, reason: 'malformed_product_url' };
  try {
    await ozonerTab.goto(item.url);
    const data = await ozonerTab.playwright.evaluate((expectedId) => {
      const current = new URL(location.href);
      const body = document.body ? document.body.innerText : '';
      if (/подтвердите, что вы не робот|проверка безопасности|verify you are human|unusual traffic/i.test(body))
        return { status: 'blocked', reason: 'site_verification' };
      if (current.pathname.startsWith('/search/')) {
        return current.searchParams.get('product_id') === expectedId && document.body.innerText.includes('Товар закончился')
          ? { status: 'out_of_stock' } : { status: 'unavailable', reason: 'unexpected_search' };
      }
      const id = current.pathname.match(/\/product\/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)/);
      if (!id || id[1] !== expectedId) return { status: 'unavailable', reason: 'product_mismatch' };
      const visible = e => {
        if (!e || !e.getBoundingClientRect().width || !e.getBoundingClientRect().height) return false;
        for (let n = e; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
        }
        return true;
      };
      const widgets = [...document.querySelectorAll('[data-widget="webPrice"]')].filter(visible);
      if (widgets.length !== 1) return { status: 'unavailable', reason: `visible_widgets_${widgets.length}` };
      const candidates = [...widgets[0].querySelectorAll('*')].filter(e => {
        if (!visible(e) || !['rgb(0,196,81)', 'rgba(0,196,81,1)'].includes(getComputedStyle(e).backgroundColor.replace(/\s+/g, ''))) return false;
        if (((e.textContent || '').match(/\d[\d\s]*₽/g) || []).length !== 1) return false;
        let row = e;
        for (let i = 0; i < 4 && row; i++, row = row.parentElement) if ((row.textContent || '').includes('С банками')) return true;
        return false;
      });
      if (candidates.length !== 1) return { status: 'unavailable', reason: `green_candidates_${candidates.length}` };
      const amount = candidates[0].textContent.match(/\d[\d\s]*₽/);
      const price = amount && Number(amount[0].replace(/\D/g, ''));
      return Number.isInteger(price) && price > 0 ? { status: 'ok', price_rub: price } : { status: 'unavailable', reason: 'invalid_price' };
    }, match[1]);
    return { ...item, price_rub: null, ...data };
  } catch (e) {
    return { ...item, status: 'infrastructure_error', price_rub: null, reason: String(e).slice(0, 180) };
  }
}
async function collectBatch(inputs) {
  if (!Array.isArray(inputs) || inputs.length > 5) throw new Error('Expected at most five inputs');
  const started = Date.now();
  for (const item of inputs) {
    if (results.some(r => r.column === item.column)) throw new Error(`Already collected: ${item.column}`);
    const record = await collect(item);
    results.push(record);
    nodeRepl.write(record);
    if (record.status === 'blocked') break;
  }
  return { elapsed_ms: Date.now() - started, completed: results.length };
}
