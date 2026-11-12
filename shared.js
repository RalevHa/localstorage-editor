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
