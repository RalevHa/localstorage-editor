// Standalone tab: shows the current value of every saved preset and applies it to the source tab.
// Presets are written by popup.js (★ on a number field) under `presets:${host}` in this extension's localStorage.
const $ = id => document.getElementById(id)
const h = (tag, props, ...kids) => {
  const el = Object.assign(document.createElement(tag), props)
  el.append(...kids)
  return el
}
const q = new URLSearchParams(location.search)
const tabId = Number(q.get('tab')), host = q.get('host'), key = q.get('key')
const msg = t => { $('msg').textContent = t }

const all = () => { try { return JSON.parse(localStorage.getItem(`presets:${host}`)) || [] } catch { return [] } }
const mine = () => all().filter(p => p.key === key)
const plabel = p => (p.op === 'add' ? (p.n >= 0 ? '+' : '') + p.n : '= ' + p.n)
const next = (cur, p) => (p.op === 'add' ? cur + p.n : p.n)
const dig = (o, path) => path.reduce((x, k) => x[k], o)

const inTab = (func, args) => chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args }).then(r => r[0].result)
const wrapped = new Set()
const read = async () => {
  const o = JSON.parse(await inTab(k => localStorage.getItem(k), [key]))
  wrapped.clear()
  unwrap(o, wrapped)
  return o
}

async function render() {
  let obj
  try { obj = await read() } catch { msg('อ่านหน้าเกมไม่ได้ (tab ปิด/ไม่มีสิทธิ์) — เปิดจาก popup ใหม่'); return }
  $('list').replaceChildren(...mine().map(p => {
    const rp = resolvePath(obj, p.path)
    const cur = rp && dig(obj, rp)
    const ok = typeof cur === 'number'
    return h('div', { className: 'row' },
      h('span', { className: 'path', textContent: pathStr(p.path) }),
      h('span', { className: 'val', textContent: ok ? `${cur} → ${next(cur, p)}` : 'ไม่พบ' }),
      h('button', { textContent: plabel(p), disabled: !ok, onclick: () => apply(p) }),
      h('button', { className: 'x', title: 'ลบ', textContent: '✕', onclick: () => remove(p) }))
  }))
}

async function apply(p) {
  const obj = await read()
  const rp = resolvePath(obj, p.path)
  const cur = rp && dig(obj, rp)
  if (typeof cur !== 'number') return msg('ไม่พบ ' + pathStr(p.path))
  dig(obj, rp.slice(0, -1))[rp.at(-1)] = next(cur, p)
  const reload = $('rl').checked
  await inTab((k, v, reload) => {
    const orig = Storage.prototype.setItem
    if (reload) Storage.prototype.setItem = () => {} // กันเกมเขียน state เก่าทับตอน reload
    orig.call(localStorage, k, v)
    if (reload) location.reload()
  }, [key, JSON.stringify(ser(obj, wrapped)), reload])
  msg(`${pathStr(p.path)} ${plabel(p)} แล้ว`)
  setTimeout(render, reload ? 1500 : 0)
}

function remove(p) {
  const rest = all().filter(x => !(x.key === p.key && x.op === p.op && x.n === p.n && pathStr(x.path) === pathStr(p.path)))
  localStorage.setItem(`presets:${host}`, JSON.stringify(rest))
  render()
}

$('title').textContent = `${host} · ${key}`
$('refresh').onclick = render
window.onfocus = render
render()
