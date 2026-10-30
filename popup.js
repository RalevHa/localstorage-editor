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

// rename the last segment of p in place (keeps key order); p is shared with the row's field closure
function rename(p, name) {
  const parent = get(p.slice(0, -1))
  if (!name || name in parent) return false
  const old = p.at(-1)
  const entries = Object.entries(parent).map(([k, v]) => [k === old ? name : k, v])
  Object.keys(parent).forEach(k => delete parent[k])
  Object.assign(parent, Object.fromEntries(entries))
  p[p.length - 1] = name
  return true
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

function nameInput(p) {
  const isArr = Array.isArray(get(p.slice(0, -1)))
  const i = h('input', { type: 'text', className: 'name', value: p.at(-1), readOnly: isArr, title: p.join('.') })
  i.onchange = () => {
    if (rename(p, i.value.trim())) i.title = p.join('.')
    else i.value = p.at(-1)
  }
  return i
}

// add a new key to the object at parent, typed by the select
function addRow(parent) {
  const k = h('input', { type: 'text', className: 'name', placeholder: 'ชื่อใหม่' })
  const v = h('input', { type: 'text', placeholder: 'ค่า' })
  const t = h('select', {}, ...['string', 'number', 'boolean'].map(x => h('option', { textContent: x })))
  const add = () => {
    const name = k.value.trim(), o = get(parent)
    if (!name) return
    if (name in o) return msg(`"${name}" มีอยู่แล้ว`)
    let val = v.value
    if (t.value === 'number') {
      val = val.trim() === '' ? NaN : Number(val)
      if (Number.isNaN(val)) return msg('ไม่ใช่ตัวเลข')
    } else if (t.value === 'boolean') val = val.trim().toLowerCase() === 'true'
    o[name] = val
    render()
  }
  v.onkeydown = e => { if (e.key === 'Enter') add() }
  return h('div', { className: 'row add' }, k, t, v, h('button', { onclick: add }, '+ Add'))
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
    const d = h('details', { open: !!q || openGroups.has(name), ontoggle: e => { if (!q) e.target.open ? openGroups.add(name) : openGroups.delete(name) } }, // ponytail: ignore toggles from search auto-open
      h('summary', {}, name, h('small', {}, ` (${paths.length})`)))
    const nums = paths.filter(p => typeof get(p) === 'number')
    if (nums.length > 1) {
      const n = h('input', { type: 'number', step: 'any', placeholder: 'ค่า', style: 'width:80px' })
      d.append(h('div', { className: 'row all' }, h('span', {}, `ตั้งทุกตัว (${nums.length})`), n,
        h('button', { onclick: () => { if (n.value !== '') { nums.forEach(p => set(p, Number(n.value))); render() } } }, 'Set all')))
    }
    for (const p of paths) d.append(h('div', { className: 'row' }, nameInput(p), field(p)))
    const parent = paths[0].slice(0, -1)
    if (!Array.isArray(get(parent))) d.append(addRow(parent))
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

// write keys in the page's main world, optionally reload
function write(entries, reload = true) {
  chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [entries, reload],
    func: (entries, reload) => {
      const orig = Storage.prototype.setItem
      if (reload) Storage.prototype.setItem = () => {} // กันเกมเขียน state เก่าทับตอน reload
      for (const [k, v] of Object.entries(entries)) orig.call(localStorage, k, v)
      if (reload) location.reload()
    }
  })
  if (reload) window.close()
}

const save = reload => {
  let v = $('raw').checked || !obj ? $('text').value : JSON.stringify(obj)
  try { v = JSON.stringify(JSON.parse(v)) } catch {}
  write({ [$('key').value]: v }, reload)
  data[$('key').value] = v
  msg('Saved')
}
$('save').onclick = () => save(false)
$('saveReload').onclick = () => save(true)

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
