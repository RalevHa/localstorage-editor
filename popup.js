const $ = id => document.getElementById(id)
const h = (tag, props, ...kids) => {
  const el = Object.assign(document.createElement(tag), props)
  el.append(...kids)
  return el
}

let tabId
let data = {}
let obj = null // parsed value of the selected key (form mode)
const openGroups = new Set()

const get = p => p.reduce((o, k) => o[k], obj)
const set = (p, v) => { get(p.slice(0, -1))[p.at(-1)] = v }

const leaves = (v, path = [], out = []) => {
  if (v !== null && typeof v === 'object') Object.keys(v).forEach(k => leaves(v[k], [...path, k], out))
  else out.push(path)
  return out
}

function field(path) {
  const v = get(path)
  if (typeof v === 'boolean') return h('input', { type: 'checkbox', checked: v, onchange: e => set(path, e.target.checked) })
  if (typeof v === 'number') return h('input', {
    type: 'number', step: 'any', value: v,
    oninput: e => e.target.value !== '' && set(path, Number(e.target.value))
  })
  return h('input', { type: 'text', value: v ?? '', oninput: e => set(path, v === null && e.target.value === '' ? null : e.target.value) })
}

function render() {
  const body = $('body')
  body.replaceChildren()
  if (!obj) return
  const q = $('q').value.toLowerCase()
  const groups = new Map()
  for (const path of leaves(obj)) {
    if (q && !path.join('.').toLowerCase().includes(q) && !String(get(path)).toLowerCase().includes(q)) continue
    const g = path.slice(0, -1).join('.') || '(root)'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(path)
  }
  for (const [name, paths] of groups) {
    const d = h('details', { open: !!q || openGroups.has(name), ontoggle: e => (e.target.open ? openGroups.add(name) : openGroups.delete(name)) },
      h('summary', {}, name, h('small', {}, ` (${paths.length})`)))
    const nums = paths.filter(p => typeof get(p) === 'number')
    if (nums.length > 1) {
      const n = h('input', { type: 'number', step: 'any', placeholder: 'ค่า', style: 'width:80px' })
      d.append(h('div', { className: 'row all' }, h('span', {}, `ตั้งทุกตัว (${nums.length})`), n,
        h('button', { onclick: () => { if (n.value !== '') { nums.forEach(p => set(p, Number(n.value))); render() } } }, 'Set all')))
    }
    for (const p of paths) d.append(h('div', { className: 'row' }, h('span', { title: p.join('.') }, p.at(-1)), field(p)))
    body.append(d)
  }
}

function setMode(raw) {
  $('raw').checked = raw
  $('body').classList.toggle('hide', raw)
  $('text').classList.toggle('hide', !raw)
}

function load() {
  const s = data[$('key').value] ?? ''
  try { obj = JSON.parse(s) } catch { obj = null }
  const form = obj !== null && typeof obj === 'object'
  if (!form) obj = null
  $('text').value = form ? JSON.stringify(obj, null, 2) : s
  $('raw').disabled = !form
  setMode(!form)
  render()
}

$('raw').onchange = e => {
  if (e.target.checked) $('text').value = JSON.stringify(obj, null, 2)
  else {
    try { obj = JSON.parse($('text').value) } catch { return setMode(true) }
    render()
  }
  setMode(e.target.checked)
}

$('key').onchange = () => {
  localStorage.setItem(`key:${host}`, $('key').value)
  load()
}
$('q').oninput = render

const msg = text => { $('msg').textContent = text }

// write keys in the page's main world, then reload
function write(entries) {
  chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [entries],
    func: entries => {
      const orig = Storage.prototype.setItem
      Storage.prototype.setItem = () => {} // กันเกมเขียน state เก่าทับตอน reload
      for (const [k, v] of Object.entries(entries)) orig.call(localStorage, k, v)
      location.reload()
    }
  })
  window.close()
}

$('save').onclick = () => {
  let v = $('raw').checked || !obj ? $('text').value : JSON.stringify(obj)
  try { v = JSON.stringify(JSON.parse(v)) } catch {}
  write({ [$('key').value]: v })
}

$('export').onclick = () => {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const a = h('a', {
    href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })),
    download: `${host}-localStorage-${stamp}.json`
  })
  a.click()
  msg(`Exported ${Object.keys(data).length} keys`)
}

$('import').onclick = () => $('file').click()

$('file').onchange = async e => {
  try {
    const entries = JSON.parse(await e.target.files[0].text())
    const ok = entries && typeof entries === 'object' && !Array.isArray(entries) && Object.values(entries).every(v => typeof v === 'string')
    if (!ok) throw new Error('not a localStorage export')
    write(entries)
  } catch (err) {
    msg(`Import failed: ${err.message}`)
  }
}

let host
;(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  tabId = tab.id
  host = new URL(tab.url).hostname
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => Object.fromEntries(Object.entries(localStorage))
  })
  data = result
  $('key').replaceChildren(...Object.keys(data).map(k => h('option', { textContent: k })))
  const last = localStorage.getItem(`key:${host}`)
  if (last in data) $('key').value = last
  load()
})()
