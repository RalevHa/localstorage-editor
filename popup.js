const $ = id => document.getElementById(id)
const h = (tag, props, ...kids) => {
  const el = Object.assign(document.createElement(tag), props)
  el.append(...kids)
  return el
}

// popup.html?tab=ID = same editor in a full tab, bound to that source tab (a popup closes when you switch tabs)
const inTab = new URLSearchParams(location.search).has('tab')
if (inTab) document.body.classList.add('tab')
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

// undo: snapshot obj before every change (focusing a field counts, so typing is undoable per field); Undo pops the last differing one
const undo = []
function snap() {
  if (!obj) return
  const s = JSON.stringify(obj)
  if (undo.at(-1) !== s) { undo.push(s); if (undo.length > 50) undo.shift() }
}
$('body').addEventListener('focusin', snap)
$('undo').onclick = () => {
  if ($('raw').checked) return msg('ใน JSON mode ใช้ Ctrl+Z')
  const cur = JSON.stringify(obj)
  let s
  while (undo.length && (s = undo.pop()) === cur) s = undefined
  if (s === undefined) return msg('ไม่มีอะไรให้ย้อน')
  obj = JSON.parse(s)
  buildFacets()
  render()
  msg('ย้อนแล้ว')
}

// remove the key/object at p; arrays splice so no holes. Edits obj only, Save writes it.
function del(p) {
  snap()
  const parent = get(p.slice(0, -1)), k = p.at(-1)
  if (Array.isArray(parent)) parent.splice(Number(k), 1)
  else delete parent[k]
  buildFacets()
  render()
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
    snap()
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
      h('summary', {}, name, lbl && h('em', {}, lbl), h('small', {}, ` (${paths.length})`),
        ...(parent.length ? [h('button', { // root can't be deleted
          className: 'flt', title: 'ลบ object นี้ทั้งก้อน', textContent: '🗑',
          onclick: e => { e.preventDefault(); if (confirm(`ลบ ${name} ทั้งก้อน?`)) del(parent) }
        })] : [])))
    // rows are built on first open: a group like jobGen can hold 1000+ inputs
    let built = false
    const fill = () => {
      if (built) return
      built = true
      const nums = paths.filter(p => typeof get(p) === 'number')
      if (nums.length > 1) {
        const n = h('input', { type: 'number', step: 'any', placeholder: 'ค่า', style: 'width:80px' })
        d.append(h('div', { className: 'row all' }, h('span', {}, `ตั้งทุกตัว (${nums.length})`), n,
          h('button', { onclick: () => { if (n.value !== '') { snap(); nums.forEach(p => set(p, Number(n.value))); render() } } }, 'Set all')))
      }
      for (const p of paths) {
        const row = h('div', { className: 'row' }, nameInput(p), field(p))
        if (!Array.isArray(get(p.slice(0, -1)))) {
          const f = { key: p.at(-1), value: String(get(p)), pat: pat(p.slice(0, -1)), any: false }
          row.append(h('button', { className: 'flt', title: `แสดงเฉพาะ ${f.key} = ${f.value}`, textContent: '⌕', onclick: () => addFilter(f) }))
        }
        if (typeof get(p) === 'number') row.append(h('button', { className: 'flt', title: 'บันทึกเป็น preset', textContent: '★', onclick: () => openPresetEditor([...p]) }))
        row.append(h('button', { className: 'flt', title: 'ลบ', textContent: '🗑', onclick: () => del(p) }))
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
  $('tw').classList.toggle('hide', !raw)
  $('fnav').classList.toggle('hide', !raw)
  $('q').placeholder = raw ? 'ค้นหาใน JSON (Enter = ถัดไป)' : 'ค้นหา เช่น pace, coins'
  hilite()
}

// paint every match in #hl (needs the textarea visible to measure its width); capped so a 1-char query on a huge value stays cheap
function hilite() {
  const t = $('text'), hl = $('hl'), q = $('raw').checked ? $('q').value.toLowerCase() : ''
  hl.style.width = t.clientWidth + 'px'
  hl.style.height = t.clientHeight + 'px'
  const s = t.value, low = s.toLowerCase(), parts = []
  let at = 0, i
  while (q && parts.length < 5000 && (i = low.indexOf(q, at)) >= 0) {
    parts.push(s.slice(at, i), h('mark', {}, s.slice(i, i + q.length)))
    at = i + q.length
  }
  hl.replaceChildren(...parts, s.slice(at) + '\n')
  hl.scrollTop = t.scrollTop
}
$('text').onscroll = () => { $('hl').scrollTop = $('text').scrollTop }
$('text').oninput = hilite

function load() {
  const s = data[$('key').value] ?? ''
  filters.length = 0
  undo.length = 0
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
// JSON mode: the same search box finds text in the textarea (Enter = next, Shift+Enter = prev, Ctrl+F focuses it).
// Browser Ctrl+F doesn't work inside extension popups. Focus bounces textarea -> box so the browser scrolls to the match.
function findText(back, fromStart) {
  const q = $('q').value.toLowerCase(), t = $('text'), s = t.value.toLowerCase()
  if (!q) return msg('')
  const n = s.split(q).length - 1
  let i = back ? s.lastIndexOf(q, t.selectionStart - 1) : s.indexOf(q, fromStart ? t.selectionStart : t.selectionEnd)
  if (i < 0) i = back ? s.lastIndexOf(q) : s.indexOf(q) // wrap
  if (i < 0) return msg('ไม่พบ')
  const nth = s.slice(0, i).split(q).length // matches before i, +1
  t.focus()
  t.setSelectionRange(i, i + q.length)
  $('q').focus()
  // setSelectionRange doesn't scroll, so measure the match's y in a hidden twin (same font/width/wrap) and scroll there
  const cs = getComputedStyle(t)
  const m = h('div', { textContent: t.value.slice(0, i) + 'x' })
  m.style.cssText = `position:absolute;visibility:hidden;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:break-word;width:${t.clientWidth}px;font:${cs.font};padding:${cs.padding}`
  document.body.append(m)
  const y = m.offsetHeight - parseFloat(cs.paddingBottom) - parseFloat(cs.lineHeight)
  m.remove()
  t.scrollTop = y - t.clientHeight / 2
  msg(`${nth}/${n}`)
}
$('fprev').onclick = () => findText(true)
$('fnext').onclick = () => findText(false)
$('q').oninput = () => { if ($('raw').checked) { hilite(); findText(false, true) } else render() }
$('q').onkeydown = e => { if (e.key === 'Enter' && $('raw').checked) findText(e.shiftKey) }
document.onkeydown = e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); $('q').focus(); $('q').select() }
}

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
const plabel = p => `${pathStr(p.path)} ${p.op === 'add' ? (p.n >= 0 ? '+' : '') + p.n : '= ' + p.n}`

function renderPresets() {
  const mine = presets.filter(p => p.key === $('key').value)
  $('plist').replaceChildren(...mine.map(p => h('span', { className: 'chip' },
    h('button', { title: 'ใช้ preset (ยังต้องกด Save)', textContent: plabel(p), onclick: () => applyPreset(p) }),
    h('button', { title: 'ลบ', textContent: '✕', onclick: () => { presets.splice(presets.indexOf(p), 1); savePresets(); renderPresets() } }))))
}

function applyPreset(p) {
  const rp = resolvePath(obj, p.path)
  const cur = rp && get(rp)
  if (typeof cur !== 'number') return msg(`ไม่พบ ${pathStr(p.path)}`)
  snap()
  set(rp, p.op === 'add' ? cur + p.n : p.n)
  render()
  msg(`${plabel(p)} → กด Save`)
}

function openPresetEditor(path) {
  pending = encodePath(obj, path)
  $('ppath').textContent = pathStr(pending)
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

// same host-access request as Presets: the tab keeps working after the popup (and its activeTab grant) is gone
$('topen').onclick = async () => {
  if (!(await chrome.permissions.request({ origins: [`${origin}/*`] }))) return msg('ต้องอนุญาตสิทธิ์เว็บนี้ก่อน')
  chrome.tabs.create({ url: `popup.html?tab=${tabId}` })
}
if (inTab) $('topen').classList.add('hide')

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
  if (reload && !inTab) window.close()
}

// Diff: leaf-by-leaf, last loaded/saved value vs what's in the editor now
const pj = s => { try { return JSON.parse(s) } catch { return s } }
const flat = (v, p = [], m = new Map()) => {
  if (v !== null && typeof v === 'object' && Object.keys(v).length) Object.keys(v).forEach(k => flat(v[k], [...p, k], m))
  else m.set(p.join('.') || '(root)', JSON.stringify(v))
  return m
}
$('dbtn').onclick = () => {
  const box = $('diff')
  if (box.classList.toggle('hide')) return
  const a = flat(pj(data[$('key').value] ?? '')), b = flat(pj($('raw').checked || !obj ? $('text').value : JSON.stringify(obj)))
  const lines = []
  for (const [k, v] of a) {
    if (!b.has(k)) lines.push(['neg', `− ${k} = ${v}`])
    else if (b.get(k) !== v) lines.push(['', `${k}: ${v} → ${b.get(k)}`])
  }
  for (const [k, v] of b) if (!a.has(k)) lines.push(['pos', `+ ${k} = ${v}`])
  const more = lines.length - 200 // ponytail: cap at 200 lines so a "set all" on 1000 fields doesn't flood the panel
  box.replaceChildren(...(lines.length ? lines.slice(0, 200).map(([c, t]) => h('div', { className: c, textContent: t })) : [h('div', { textContent: 'ไม่มีการเปลี่ยนแปลง' })]),
    ...(more > 0 ? [h('div', { textContent: `… อีก ${more} รายการ` })] : []))
}

// the value before each Save is kept (one per host+key) so a bad save can be pulled back with Backup, then saved again
$('restore').onclick = () => {
  const b = localStorage.getItem(`backup:${host}:${$('key').value}`)
  if (b === null) return msg('ยังไม่มี backup')
  if ($('raw').checked || !obj) { $('text').value = b; hilite() }
  else {
    snap()
    obj = pj(b)
    buildFacets()
    render()
  }
  msg('โหลด backup แล้ว → กด Save')
}

const norm = s => { try { return JSON.stringify(JSON.parse(s)) } catch { return s } }
const editorValue = () => norm($('raw').checked || !obj ? $('text').value : JSON.stringify(obj))

// re-read the page's localStorage (it may have changed since open); asks first if the editor holds unsaved edits
async function pull() {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => Object.fromEntries(Object.entries(localStorage))
  })
  data = result
  const keep = $('key').value
  $('key').replaceChildren(...Object.keys(data).map(k => h('option', { textContent: k })))
  const last = keep in data ? keep : localStorage.getItem(`key:${host}`)
  if (last in data) $('key').value = last
}
$('reload').onclick = async () => {
  const k = $('key').value
  if (k in data && editorValue() !== norm(data[k]) && !confirm('มีการแก้ที่ยังไม่ Save — โหลดใหม่จะทิ้งการแก้เหล่านั้น')) return
  try { await pull() } catch { return msg('อ่านหน้าเว็บไม่ได้ (tab ปิด/ไม่มีสิทธิ์)') }
  load()
  msg('โหลดค่าล่าสุดแล้ว')
}

const save = reload => {
  const k = $('key').value
  const v = editorValue()
  if (k in data && data[k] !== v) try { localStorage.setItem(`backup:${host}:${k}`, data[k]) } catch {}
  write({ [k]: v }, reload)
  data[k] = v
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
  let tab
  if (inTab) {
    try { tab = await chrome.tabs.get(Number(new URLSearchParams(location.search).get('tab'))) } catch { return msg('แท็บต้นทางปิดไปแล้ว — เปิดใหม่จาก popup') }
  } else [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  tabId = tab.id
  // tab.url is undefined/empty on chrome://, new-tab, web store pages (no host permission)
  if (!/^(https?|file):/.test(tab.url || '')) return msg('Open a regular web page (not chrome:// or a new tab).')
  host = new URL(tab.url).hostname
  origin = new URL(tab.url).origin
  await pull()
  loadPresets()
  load()
})()
