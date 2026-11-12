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
const filters = [] // [{key, value, pat, any}] shows objects matching every key; several values of one key are OR
let facets = new Map() // picker label -> categorical leaf field {pat, key, vals: Map(value -> count)}
let fvals = new Map() // value picker label -> value
const flabel = f => `${f.pat ? f.pat + '.' : ''}${f.key} (${f.vals.size})`

const get = p => p.reduce((o, k) => o[k], obj)
const set = (p, v) => { get(p.slice(0, -1))[p.at(-1)] = v }

// parent path -> "heroes.*.eq" (array indices become *), so filters can target one place only
const pat = p => p.map(k => /^\d+$/.test(k) ? '*' : k).join('.')
const matches = (f, p) => p.at(-1) === f.key && String(get(p)) === f.value && (f.any || pat(p.slice(0, -1)) === f.pat)
const addFilter = f => {
  if (!filters.some(x => x.key === f.key && x.value === f.value && x.pat === f.pat)) filters.push(f)
  render()
}

// ponytail: only fields with 2+ leaves and <=30 distinct values (star, cls, slot...) are offered; ids/names/stats stay out
function buildFacets() {
  const m = new Map()
  for (const p of obj ? leaves(obj) : []) {
    const parent = p.slice(0, -1)
    if (Array.isArray(get(parent))) continue
    const key = pat(parent) + '\0' + p.at(-1)
    if (!m.has(key)) m.set(key, { pat: pat(parent), key: p.at(-1), n: 0, vals: new Map() })
    const f = m.get(key), v = String(get(p))
    f.n++
    f.vals.set(v, (f.vals.get(v) || 0) + 1)
  }
  const list = [...m.values()].filter(f => f.n > 1 && f.vals.size <= 30).sort((a, b) => (a.pat + a.key).localeCompare(b.pat + b.key))
  facets = new Map(list.map(f => [flabel(f), f]))
  $('fkl').replaceChildren(...list.map(f => h('option', { value: flabel(f) })))
  $('fk').value = ''
  $('fv').value = ''
  $('fv').classList.add('hide')
}

// label from the nearest ancestor object that has a name, so "heroes.9.caps" shows whose caps
function label(path) {
  for (let i = path.length; i >= 0; i--) {
    const o = get(path.slice(0, i))
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const t = o.name ?? o.title ?? o.id
      if (typeof t === 'string') return t.length > 40 ? t.slice(0, 40) + '…' : t
    }
  }
  return ''
}

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
  const all = leaves(obj)
  // filters of one key are OR, different keys AND; each -> object paths ("3", "heroes.7") a group must sit inside
  const byKey = Map.groupBy(filters, f => f.key)
  const hits = [...byKey.values()].map(fs => new Set(all.filter(p => fs.some(f => matches(f, p))).map(p => p.slice(0, -1).join('.'))))
  $('chips').replaceChildren(...filters.map((f, i) => h('span', { className: 'chip' },
    h('button', {
      title: 'สลับ: เฉพาะตำแหน่งนี้ / ทุกที่', textContent: `${f.any || !f.pat ? '' : f.pat + '.'}${f.key}: ${f.value}`,
      onclick: () => { f.any = !f.any; render() }
    }),
    h('button', { title: 'เอาออก', textContent: '✕', onclick: () => { filters.splice(i, 1); render() } }))))
  const inside = (g, s) => [...s].some(p => p === '' || g === p || g.startsWith(p + '.'))
  const groups = new Map()
  for (const path of all) {
    if (q && !path.join('.').toLowerCase().includes(q) && !String(get(path)).toLowerCase().includes(q)) continue
    const g = path.slice(0, -1).join('.')
    if (!hits.every(s => inside(g, s))) continue
    const name = g || '(root)'
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(path)
  }
  for (const [name, paths] of groups) {
    const auto = !!q || hits.some(s => s.has(name)) // ponytail: auto-open on search/filter hit
    const parent = paths[0].slice(0, -1)
    const lbl = label(parent)
    const d = h('details', { open: auto || openGroups.has(name) },
      h('summary', {}, name, lbl && h('em', {}, lbl), h('small', {}, ` (${paths.length})`)))
    // rows are built on first open: a group like jobGen can hold 1000+ inputs
    let built = false
    const fill = () => {
      if (built) return
      built = true
      const nums = paths.filter(p => typeof get(p) === 'number')
      if (nums.length > 1) {
        const n = h('input', { type: 'number', step: 'any', placeholder: 'ค่า', style: 'width:80px' })
        d.append(h('div', { className: 'row all' }, h('span', {}, `ตั้งทุกตัว (${nums.length})`), n,
          h('button', { onclick: () => { if (n.value !== '') { nums.forEach(p => set(p, Number(n.value))); render() } } }, 'Set all')))
      }
      for (const p of paths) {
        const row = h('div', { className: 'row' }, nameInput(p), field(p))
        if (!Array.isArray(get(p.slice(0, -1)))) {
          const f = { key: p.at(-1), value: String(get(p)), pat: pat(p.slice(0, -1)), any: false }
          row.append(h('button', { className: 'flt', title: `แสดงเฉพาะ ${f.key} = ${f.value}`, textContent: '⌕', onclick: () => addFilter(f) }))
        }
        if (typeof get(p) === 'number') row.append(h('button', { className: 'flt', title: 'บันทึกเป็น preset', textContent: '★', onclick: () => openPresetEditor([...p]) }))
        d.append(row)
      }
      if (!Array.isArray(get(parent))) d.append(addRow(parent))
    }
    d.addEventListener('toggle', () => {
      if (d.open) fill()
      if (!auto) d.open ? openGroups.add(name) : openGroups.delete(name) // ponytail: ignore toggles from auto-open
    })
    if (d.open) fill()
    body.append(d)
  }
}

function setMode(raw) {
  $('raw').checked = raw
  $('body').classList.toggle('hide', raw)
  $('fbar').classList.toggle('hide', raw)
  $('pbar').classList.toggle('hide', raw)
  $('text').classList.toggle('hide', !raw)
}

function load() {
  const s = data[$('key').value] ?? ''
  filters.length = 0
  pending = null
  $('pedit').classList.add('hide')
  renderPresets()
  try { obj = JSON.parse(s) } catch { obj = null }
  const form = obj !== null && typeof obj === 'object'
  if (!form) obj = null
  $('text').value = form ? JSON.stringify(obj, null, 2) : s
  $('raw').disabled = !form
  setMode(!form)
  buildFacets()
  render()
}

$('raw').onchange = e => {
  if (e.target.checked) $('text').value = JSON.stringify(obj, null, 2)
  else {
    try { obj = JSON.parse($('text').value) } catch { return setMode(true) }
    buildFacets()
    render()
  }
  setMode(e.target.checked)
}

$('key').onchange = () => {
  localStorage.setItem(`key:${host}`, $('key').value)
  load()
}
$('q').oninput = render

// native <input list>: type to search, pick from the dropdown
$('fk').onchange = () => {
  const f = facets.get($('fk').value)
  $('fv').value = ''
  $('fv').classList.toggle('hide', !f)
  if (!f) return
  const vals = [...f.vals].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  fvals = new Map(vals.map(([v, n]) => [`${v} (${n})`, v]))
  $('fvl').replaceChildren(...[...fvals.keys()].map(k => h('option', { value: k })))
  $('fv').focus()
}
$('fv').onchange = () => {
  const f = facets.get($('fk').value), v = fvals.get($('fv').value)
  if (!f || v === undefined) return
  $('fk').value = ''
  $('fv').value = ''
  $('fv').classList.add('hide')
  addFilter({ key: f.key, value: v, pat: f.pat, any: false })
}

const msg = text => { $('msg').textContent = text }

// presets: one-click "stones.pf +20", saved per host in the popup's own localStorage
let presets = []
let pending = null // path being turned into a preset
const loadPresets = () => { try { presets = JSON.parse(localStorage.getItem(`presets:${host}`)) || [] } catch { presets = [] } }
const savePresets = () => localStorage.setItem(`presets:${host}`, JSON.stringify(presets))
const plabel = p => `${p.path.join('.')} ${p.op === 'add' ? (p.n >= 0 ? '+' : '') + p.n : '= ' + p.n}`

function renderPresets() {
  const mine = presets.filter(p => p.key === $('key').value)
  $('plist').replaceChildren(...mine.map(p => h('span', { className: 'chip' },
    h('button', { title: 'ใช้ preset (ยังต้องกด Save)', textContent: plabel(p), onclick: () => applyPreset(p) }),
    h('button', { title: 'ลบ', textContent: '✕', onclick: () => { presets.splice(presets.indexOf(p), 1); savePresets(); renderPresets() } }))))
}

function applyPreset(p) {
  try {
    const cur = get(p.path)
    if (typeof cur !== 'number') throw 0
    set(p.path, p.op === 'add' ? cur + p.n : p.n)
  } catch { return msg(`ไม่พบ ${p.path.join('.')}`) }
  render()
  msg(`${plabel(p)} → กด Save`)
}

function openPresetEditor(path) {
  pending = path
  $('ppath').textContent = path.join('.')
  $('pn').value = ''
  $('pedit').classList.remove('hide')
  $('pn').focus()
}

$('psave').onclick = () => {
  const n = $('pn').value.trim() === '' ? NaN : Number($('pn').value)
  if (!pending || Number.isNaN(n)) return msg('ไม่ใช่ตัวเลข')
  const p = { key: $('key').value, path: pending, op: $('pop').value, n }
  if (!presets.some(x => plabel(x) === plabel(p) && x.key === p.key)) presets.push(p)
  savePresets()
  pending = null
  $('pedit').classList.add('hide')
  renderPresets()
}
$('pn').onkeydown = e => { if (e.key === 'Enter') $('psave').click() }

// separate tab: current values + one-click buttons. It needs host access that outlives this popup, hence the request.
$('popen').onclick = async () => {
  if (!(await chrome.permissions.request({ origins: [`${origin}/*`] }))) return msg('ต้องอนุญาตสิทธิ์เว็บนี้ก่อน')
  chrome.tabs.create({ url: `presets.html?${new URLSearchParams({ tab: tabId, host, key: $('key').value })}` })
}

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

let host, origin
;(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  tabId = tab.id
  // tab.url is undefined/empty on chrome://, new-tab, web store pages (no host permission)
  if (!/^(https?|file):/.test(tab.url || '')) return msg('Open a regular web page (not chrome:// or a new tab).')
  host = new URL(tab.url).hostname
  origin = new URL(tab.url).origin
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => Object.fromEntries(Object.entries(localStorage))
  })
  data = result
  $('key').replaceChildren(...Object.keys(data).map(k => h('option', { textContent: k })))
  const last = localStorage.getItem(`key:${host}`)
  if (last in data) $('key').value = last
  loadPresets()
  load()
})()
