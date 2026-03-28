import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

export default function Magazyn() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const canEdit = ['admin', 'technolog'].includes(profile?.role)

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterAlert, setFilterAlert] = useState('wszystkie')
  const [editingMin, setEditingMin] = useState({})
  const [savingMin, setSavingMin] = useState({})
  const [inventoryDate, setInventoryDate] = useState(new Date().toISOString().slice(0, 10))

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)

    // 1. Pobierz wszystkie składniki
    const { data: ingredients } = await supabase
      .from('ingredients')
      .select('id, code, name, has_allergen, allergen_type, minimum_stock_kg')
      .eq('status', 'aktywny')
      .order('code')

    // 2. Pobierz aktualny stan magazynowy (partie + korekty)
    const { data: stock } = await supabase
      .from('v_stock')
      .select('*')

    // 3. Pobierz zużycie produkcyjne
    const { data: used } = await supabase
      .from('production_batch_items')
      .select('ingredient_id, quantity_used_kg')

    // 4. Policz dla każdego składnika
    const stockMap = {}
    for (const s of (stock || [])) {
      if (!stockMap[s.ingredient_id]) stockMap[s.ingredient_id] = { total: 0, batches: [] }
      if (s.status === 'dopuszczona') {
        stockMap[s.ingredient_id].total += parseFloat(s.current_kg || 0)
        stockMap[s.ingredient_id].batches.push(s)
      }
    }

    const usedMap = {}
    for (const u of (used || [])) {
      usedMap[u.ingredient_id] = (usedMap[u.ingredient_id] || 0) + parseFloat(u.quantity_used_kg || 0)
    }

    const result = (ingredients || []).map(ing => {
      const inStock = stockMap[ing.id]?.total || 0
      const usedTotal = usedMap[ing.id] || 0
      const current = Math.max(0, inStock - usedTotal)
      const minimum = parseFloat(ing.minimum_stock_kg || 0)
      const batchCount = stockMap[ing.id]?.batches?.length || 0

      let alertLevel = 'ok'
      if (minimum > 0) {
        if (current === 0) alertLevel = 'empty'
        else if (current <= minimum) alertLevel = 'critical'
        else if (current <= minimum * 1.5) alertLevel = 'warning'
      }
      if (current === 0 && minimum === 0) alertLevel = 'empty'

      return {
        id: ing.id,
        code: ing.code,
        name: ing.name,
        has_allergen: ing.has_allergen,
        allergen_type: ing.allergen_type,
        in_stock: parseFloat(inStock.toFixed(3)),
        used_total: parseFloat(usedTotal.toFixed(3)),
        current: parseFloat(current.toFixed(3)),
        minimum: minimum,
        batch_count: batchCount,
        alert: alertLevel,
      }
    })

    setRows(result)
    setLoading(false)
  }

  const filtered = rows.filter(r => {
    const matchQ = !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.code.toLowerCase().includes(search.toLowerCase())
    const matchAlert =
      filterAlert === 'wszystkie' ? true :
      filterAlert === 'alerty' ? ['critical', 'warning', 'empty'].includes(r.alert) :
      filterAlert === 'krytyczne' ? ['critical', 'empty'].includes(r.alert) :
      filterAlert === 'ok' ? r.alert === 'ok' : true
    return matchQ && matchAlert
  })

  const stats = {
    total: rows.length,
    critical: rows.filter(r => ['critical', 'empty'].includes(r.alert) && r.minimum > 0).length,
    warning: rows.filter(r => r.alert === 'warning').length,
    empty: rows.filter(r => r.current === 0).length,
  }

  async function saveMinimum(ingredientId, value) {
    setSavingMin(p => ({ ...p, [ingredientId]: true }))
    await supabase.from('ingredients').update({ minimum_stock_kg: parseFloat(value) || 0 }).eq('id', ingredientId)
    setSavingMin(p => ({ ...p, [ingredientId]: false }))
    setEditingMin(p => ({ ...p, [ingredientId]: undefined }))
    load()
  }

  function alertBadge(r) {
    if (r.alert === 'empty') return <span className="badge b-err">Brak</span>
    if (r.alert === 'critical') return <span className="badge b-err">Krytyczny</span>
    if (r.alert === 'warning') return <span className="badge b-warn">Niski</span>
    return <span className="badge b-ok">OK</span>
  }

  function alertRowStyle(r) {
    if (r.alert === 'empty' || r.alert === 'critical') return { background: '#FCEBEB55' }
    if (r.alert === 'warning') return { background: '#FAEEDA33' }
    return {}
  }

  function stockBar(r) {
    if (r.minimum === 0) return null
    const pct = Math.min(100, Math.round((r.current / (r.minimum * 2)) * 100))
    const color = r.alert === 'critical' || r.alert === 'empty' ? '#E24B4A' : r.alert === 'warning' ? '#EF9F27' : '#1D9E75'
    return (
      <div style={{ height: 6, background: '#F1EFE8', borderRadius: 999, marginTop: 3, width: 80 }}>
        <div style={{ height: 6, width: `${pct}%`, background: color, borderRadius: 999, transition: 'width .4s' }} />
      </div>
    )
  }

  function printInventory() {
    const now = new Date()
    const printDate = new Date(inventoryDate).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const genDate = now.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const genTime = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })

    const tableRows = filtered.map((r, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="code">${r.code}</td>
        <td class="name">${r.name}</td>
        <td class="kg">${r.in_stock.toFixed(3)}</td>
        <td class="kg">${r.used_total.toFixed(3)}</td>
        <td class="kg"><strong>${r.current.toFixed(3)}</strong></td>
        <td class="kg">${r.minimum > 0 ? r.minimum.toFixed(3) : '—'}</td>
        <td class="status">${
          r.alert === 'empty' ? '<span class="tag-err">Brak</span>' :
          r.alert === 'critical' ? '<span class="tag-err">Krytyczny</span>' :
          r.alert === 'warning' ? '<span class="tag-warn">Niski</span>' :
          '<span class="tag-ok">OK</span>'
        }</td>
        <td class="batches">${r.batch_count}</td>
        <td class="note"></td>
      </tr>`).join('')

    const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<title>Inwentura magazynowa - ${printDate}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #000; padding: 14px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; border-bottom: 2px solid #0F6E56; padding-bottom: 8px; }
  .company { font-size: 15px; font-weight: bold; color: #0F6E56; }
  .doc-title { font-size: 12px; font-weight: bold; margin-top: 3px; }
  .doc-date { font-size: 14px; font-weight: bold; color: #0F6E56; margin-top: 2px; }
  .header-right { text-align: right; font-size: 9px; color: #555; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; }
  .sum-box { border: 1px solid #D3D1C7; border-radius: 4px; padding: 5px 8px; }
  .sum-label { font-size: 8px; color: #888; text-transform: uppercase; }
  .sum-val { font-size: 13px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th { background: #0F6E56; color: #fff; font-size: 8px; font-weight: bold; text-transform: uppercase; padding: 5px 5px; border: 1px solid #085041; text-align: left; }
  td { padding: 4px 5px; border: 1px solid #D3D1C7; vertical-align: middle; }
  tr:nth-child(even) td { background: #FAFAF8; }
  tr.alert-row td { background: #FCEBEB55; }
  tr.warn-row td { background: #FAEEDA33; }
  .num { width: 22px; text-align: center; color: #888; }
  .code { width: 60px; font-family: monospace; font-size: 9px; }
  .name { }
  .kg { width: 70px; text-align: right; }
  .status { width: 60px; }
  .batches { width: 40px; text-align: center; }
  .note { width: 100px; }
  .tag-ok { background: #E1F5EE; color: #085041; padding: 1px 5px; border-radius: 3px; font-size: 8px; font-weight: bold; }
  .tag-warn { background: #FAEEDA; color: #633806; padding: 1px 5px; border-radius: 3px; font-size: 8px; font-weight: bold; }
  .tag-err { background: #FCEBEB; color: #791F1F; padding: 1px 5px; border-radius: 3px; font-size: 8px; font-weight: bold; }
  .signature-section { margin-top: 14px; border: 1px solid #D3D1C7; border-radius: 4px; padding: 10px; }
  .signature-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-top: 8px; }
  .sig-label { font-size: 8px; color: #888; text-transform: uppercase; margin-bottom: 20px; }
  .sig-line { border-bottom: 1px solid #333; margin-bottom: 3px; }
  .sig-name { font-size: 8px; color: #888; }
  .footer { margin-top: 8px; font-size: 8px; color: #888; text-align: center; border-top: 1px solid #D3D1C7; padding-top: 5px; }
  @media print { body { padding: 6px; } @page { margin: 8mm; size: A4; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="company">InstantMix Pro</div>
    <div class="doc-title">Raport inwentury magazynowej</div>
    <div class="doc-date">Stan na dzień: ${printDate}</div>
  </div>
  <div class="header-right">
    <div>Wygenerowano: <strong>${genDate} ${genTime}</strong></div>
    <div>Wydrukował: <strong>${profile?.full_name || '—'}</strong></div>
    <div style="margin-top:4px">Liczba pozycji: <strong>${filtered.length}</strong></div>
  </div>
</div>

<div class="summary">
  <div class="sum-box"><div class="sum-label">Składników</div><div class="sum-val">${filtered.length}</div></div>
  <div class="sum-box"><div class="sum-label">Stan krytyczny</div><div class="sum-val" style="color:#A32D2D">${stats.critical}</div></div>
  <div class="sum-box"><div class="sum-label">Stan niski</div><div class="sum-val" style="color:#BA7517">${stats.warning}</div></div>
  <div class="sum-box"><div class="sum-label">Brak na stanie</div><div class="sum-val" style="color:#A32D2D">${stats.empty}</div></div>
</div>

<table>
  <thead>
    <tr>
      <th class="num">Lp.</th>
      <th class="code">Kod</th>
      <th class="name">Nazwa składnika</th>
      <th class="kg">Przyjęto (kg)</th>
      <th class="kg">Zużyto (kg)</th>
      <th class="kg">Stan (kg)</th>
      <th class="kg">Minimum (kg)</th>
      <th class="status">Status</th>
      <th class="batches">Partie</th>
      <th class="note">Uwagi / korekta</th>
    </tr>
  </thead>
  <tbody>
    ${tableRows}
    <tr style="background:#E1F5EE">
      <td colspan="3" style="text-align:right;font-weight:bold">SUMA:</td>
      <td style="text-align:right;font-weight:bold">${filtered.reduce((s,r)=>s+r.in_stock,0).toFixed(3)}</td>
      <td style="text-align:right;font-weight:bold">${filtered.reduce((s,r)=>s+r.used_total,0).toFixed(3)}</td>
      <td style="text-align:right;font-weight:bold">${filtered.reduce((s,r)=>s+r.current,0).toFixed(3)}</td>
      <td colspan="4"></td>
    </tr>
  </tbody>
</table>

<div class="signature-section">
  <div style="font-weight:bold;font-size:10px;border-bottom:1px solid #D3D1C7;padding-bottom:5px;margin-bottom:0">Potwierdzenie inwentury</div>
  <div class="signature-grid">
    <div><div class="sig-label">Przeprowadził inwenturę</div><div class="sig-line"></div><div class="sig-name">Imię, nazwisko i podpis</div><div style="margin-top:6px;font-size:8px;color:#888">Data: _______________</div></div>
    <div><div class="sig-label">Zatwierdził (Brygadzista)</div><div class="sig-line"></div><div class="sig-name">Imię, nazwisko i podpis</div><div style="margin-top:6px;font-size:8px;color:#888">Data: _______________</div></div>
    <div><div class="sig-label">Zatwierdził (Kierownik)</div><div class="sig-line"></div><div class="sig-name">Imię, nazwisko i podpis</div><div style="margin-top:6px;font-size:8px;color:#888">Data: _______________</div></div>
  </div>
</div>

<div class="footer">InstantMix Pro &nbsp;|&nbsp; Raport inwentury magazynowej &nbsp;|&nbsp; Stan na: ${printDate} &nbsp;|&nbsp; Wygenerowano: ${genDate} ${genTime} &nbsp;|&nbsp; ${profile?.full_name || '—'}</div>
<script>window.onload = function() { window.print(); }</script>
</body>
</html>`

    const win = window.open('', '_blank')
    win.document.write(html)
    win.document.close()
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Magazyn składników</div>
          <div className="page-sub">Stan aktualny = przyjęte partie + korekty − zużycie produkcyjne</div>
        </div>
        <div className="flex" style={{ flexWrap: 'wrap', gap: 6 }}>
          <input
            type="date"
            value={inventoryDate}
            onChange={e => setInventoryDate(e.target.value)}
            style={{ width: 150, fontSize: 13 }}
          />
          <button className="btn btn-sm btn-primary" onClick={printInventory}>
            Drukuj inwenturę
          </button>
          <button className="btn btn-sm" onClick={load}>Odśwież</button>
        </div>
      </div>

      {/* Statystyki */}
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Składników aktywnych</div><div className="stat-val">{stats.total}</div></div>
        <div className="stat-card"><div className="stat-label">Stan krytyczny / brak</div><div className="stat-val" style={{ color: '#A32D2D' }}>{stats.critical}</div></div>
        <div className="stat-card"><div className="stat-label">Stan niski</div><div className="stat-val" style={{ color: '#BA7517' }}>{stats.warning}</div></div>
        <div className="stat-card"><div className="stat-label">Brak na stanie</div><div className="stat-val" style={{ color: '#A32D2D' }}>{stats.empty}</div></div>
      </div>

      {/* Filtry */}
      <div className="flex" style={{ marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <input
          className="search"
          placeholder="Szukaj składnika..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 220 }}
        />
        {['wszystkie', 'alerty', 'krytyczne', 'ok'].map(f => (
          <button
            key={f}
            className="btn btn-sm"
            onClick={() => setFilterAlert(f)}
            style={{
              background: filterAlert === f ? '#1D9E75' : undefined,
              color: filterAlert === f ? '#fff' : undefined,
              borderColor: filterAlert === f ? '#1D9E75' : undefined,
            }}
          >
            {f === 'wszystkie' ? 'Wszystkie' : f === 'alerty' ? 'Wszystkie alerty' : f === 'krytyczne' ? 'Krytyczne' : 'OK'}
          </button>
        ))}
      </div>

      {/* Legenda minimum */}
      {isAdmin && (
        <div className="info-box" style={{ marginBottom: 10, fontSize: 12 }}>
          Jako Admin możesz edytować minimalne stany magazynowe bezpośrednio w tabeli — kliknij wartość w kolumnie "Minimum (kg)".
        </div>
      )}

      {/* Tabela */}
      <div className="card-0" style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 860 }}>
          <thead><tr>
            <th>Kod</th>
            <th>Nazwa składnika</th>
            <th style={{ textAlign: 'right' }}>Przyjęto (kg)</th>
            <th style={{ textAlign: 'right' }}>Zużyto (kg)</th>
            <th style={{ textAlign: 'right' }}>Stan aktualny (kg)</th>
            <th style={{ textAlign: 'right' }}>Minimum (kg)</th>
            <th>Status</th>
            <th style={{ textAlign: 'center' }}>Partie</th>
            <th>Alergen</th>
          </tr></thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#888' }}>
                <span className="spinner" /> Obliczam stany magazynowe...
              </td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 24, color: '#888' }}>Brak wyników</td></tr>
            )}
            {!loading && filtered.map(r => (
              <tr key={r.id} style={alertRowStyle(r)}>
                <td><span className="lot">{r.code}</span></td>
                <td style={{ fontWeight: 500 }}>{r.name}</td>
                <td style={{ textAlign: 'right', color: '#085041' }}>{r.in_stock.toFixed(3)}</td>
                <td style={{ textAlign: 'right', color: '#633806' }}>{r.used_total.toFixed(3)}</td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{r.current.toFixed(3)}</div>
                  {stockBar(r)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {isAdmin ? (
                    editingMin[r.id] !== undefined ? (
                      <div className="flex" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          defaultValue={editingMin[r.id]}
                          id={`min-${r.id}`}
                          style={{ width: 80, padding: '3px 6px', fontSize: 12 }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveMinimum(r.id, e.target.value)
                            if (e.key === 'Escape') setEditingMin(p => ({ ...p, [r.id]: undefined }))
                          }}
                        />
                        <button
                          className="btn btn-sm btn-primary"
                          style={{ padding: '3px 8px', fontSize: 11 }}
                          onClick={() => saveMinimum(r.id, document.getElementById(`min-${r.id}`).value)}
                          disabled={savingMin[r.id]}
                        >
                          {savingMin[r.id] ? '...' : 'Zapisz'}
                        </button>
                        <button
                          className="btn btn-sm"
                          style={{ padding: '3px 6px', fontSize: 11 }}
                          onClick={() => setEditingMin(p => ({ ...p, [r.id]: undefined }))}
                        >✕</button>
                      </div>
                    ) : (
                      <span
                        onClick={() => setEditingMin(p => ({ ...p, [r.id]: r.minimum }))}
                        style={{ cursor: 'pointer', borderBottom: '1px dashed #B4B2A9', paddingBottom: 1 }}
                        title="Kliknij aby edytować minimum"
                      >
                        {r.minimum > 0 ? r.minimum.toFixed(3) : <span className="muted">ustaw →</span>}
                      </span>
                    )
                  ) : (
                    <span>{r.minimum > 0 ? r.minimum.toFixed(3) : <span className="muted">—</span>}</span>
                  )}
                </td>
                <td>{alertBadge(r)}</td>
                <td style={{ textAlign: 'center', color: '#5F5E5A' }}>{r.batch_count}</td>
                <td>
                  {r.has_allergen
                    ? <span className="badge b-err">{r.allergen_type}</span>
                    : <span className="muted">—</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && stats.critical > 0 && (
        <div className="err-box" style={{ marginTop: 10 }}>
          Uwaga: {stats.critical} {stats.critical === 1 ? 'składnik wymaga' : 'składniki wymagają'} uzupełnienia — stan poniżej minimum lub brak na stanie.
        </div>
      )}
    </div>
  )
}
