// Preset paths survive array reordering/deletion: an array index is stored as {by, v} (the element's id/name) when it has one,
// and looked up again at apply time. Plain strings stay plain, so old presets (raw indices) keep working.
const pathStr = p => p.map(s => typeof s === 'object' ? `[${s.v}]` : s).join('.')

function encodePath(obj, path) {
  let cur = obj
  return path.map(k => {
    const el = cur[k]
    const by = Array.isArray(cur) && el && typeof el === 'object' ? ['id', 'name'].find(f => ['string', 'number'].includes(typeof el[f])) : null
    cur = el
    return by ? { by, v: el[by] } : k
  })
}

// -> plain keys, or null when an element with that id/name is gone
function resolvePath(obj, path) {
  let cur = obj
  const out = []
  for (const s of path) {
    let k = s
    if (typeof s === 'object') {
      if (!Array.isArray(cur)) return null
      k = String(cur.findIndex(e => e && e[s.by] === s.v))
      if (k === '-1') return null
    }
    if (cur === null || typeof cur !== 'object' || !(k in cur)) return null
    cur = cur[k]
    out.push(k)
  }
  return out
}

// Saves like {"d":"{...json...}","h":"hash"} keep JSON inside a JSON string. unwrap expands such strings in place and records
// their paths in `set`; ser turns them back into strings. Only strings that re-stringify identically are expanded, so untouched data round-trips byte for byte.
const pkey = p => JSON.stringify(p)
function unwrap(o, set, p = []) {
  if (o === null || typeof o !== 'object') return
  for (const k of Object.keys(o)) {
    const v = o[k]
    if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
      try {
        const x = JSON.parse(v)
        if (x && typeof x === 'object' && JSON.stringify(x) === v) { o[k] = x; set.add(pkey([...p, k])) }
      } catch {}
    }
    unwrap(o[k], set, [...p, k])
  }
}
function ser(v, set, p = []) {
  if (v === null || typeof v !== 'object') return v
  const c = Array.isArray(v) ? v.map((x, i) => ser(x, set, [...p, String(i)])) : Object.fromEntries(Object.keys(v).map(k => [k, ser(v[k], set, [...p, k])]))
  return set.has(pkey(p)) ? JSON.stringify(c) : c
}
