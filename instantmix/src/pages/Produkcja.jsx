import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const STATUS_LABELS = { w_trakcie:'W trakcie', wyprodukowana:'Wyprodukowana', wstrzymana:'Wstrzymana', wydana:'Wydana' }

export default function Produkcja() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [fDay, setFDay] = useState('')
  const [fMonth, setFMonth] = useState('')
  const [fYear, setFYear] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailItems, setDetailItems] = useState([])
  const [detailPrices, setDetailPrices] = useState({}) // batch_id -> unit_price
  const [editModal, setEditModal] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [recalcId, setRecalcId] = useState(null)
  const [recalcMsg, setRecalcMsg] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [editItemsModal, setEditItemsModal] = useState(false)
  const [editItemsBatch, setEditItemsBatch] = useState(null)
  const [editItemsList, setEditItemsList] = useState([])
  const [allIngBatches, setAllIngBatches] = useState([])
  const [allIngredients, setAllIngredients] = useState([])
  const [savingItems, setSavingItems] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('v_production').select('*')
    setBatches(data || [])
    setLoading(false)
  }

  const filtered = batches.filter(b => {
    const q = search.toLowerCase()
    const matchQ = !q || b.lot_number.toLowerCase().includes(q) || b.recipe_name.toLowerCase().includes(q) || b.recipe_code.toLowerCase().includes(q) || (b.client||'').toLowerCase().includes(q)
    const matchDay = !fDay || b.production_date === fDay
    const matchMonth = !fMonth || b.production_date?.startsWith(fMonth)
    const matchYear = !fYear || b.production_date?.startsWith(fYear)
    return matchQ && matchDay && matchMonth && matchYear
  })

  const stats = {
    count: filtered.length,
    kg: filtered.reduce((s,b) => s+parseFloat(b.quantity_kg), 0).toFixed(1),
    bg: filtered.filter(b => b.production_line==='bezglutenowa').length,
    blocked: filtered.filter(b => b.status==='wstrzymana').length
  }

  async function showDetail(batch) {
    if (detail?.id === batch.id) { setDetail(null); setDetailItems([]); setDetailPrices({}); return }
    const { data } = await supabase
      .from('production_batch_items')
      .select('*, ingredient_batches(delivery_lot, received_date, unit_price_pln), ingredients(code, name, has_allergen, allergen_type)')
      .eq('production_batch_id', batch.id)
      .order('fifo_order')
    setDetail(batch)
    setDetailItems(data || [])
    // Build price map
    const prices = {}
    for (const it of (data||[])) {
      prices[it.id] = parseFloat(it.ingredient_batches?.unit_price_pln || 0)
    }
    setDetailPrices(prices)
  }

  function batchTotalValue() {
    return detailItems.reduce((s, it) => {
      const price = parseFloat(it.ingredient_batches?.unit_price_pln || 0)
      return price > 0 ? s + parseFloat(it.quantity_used_kg) * price : s
    }, 0)
  }

  function openEdit(batch) {
    setEditForm({ id:batch.id, production_date:batch.production_date||'', quantity_kg:batch.quantity_kg||'', client:batch.client||'', operator:batch.operator||'', foreman:batch.foreman||'', technologist:batch.technologist||'', status:batch.status||'wyprodukowana', notes:batch.notes||'' })
    setEditError(''); setEditModal(true)
  }

  async function saveEdit() {
    if (!editForm.production_date) { setEditError('Data produkcji jest wymagana'); return }
    if (!editForm.quantity_kg) { setEditError('Ilość jest wymagana'); return }
    setSaving(true); setEditError('')
    const { error } = await supabase.from('production_batches').update({
      production_date:editForm.production_date, quantity_kg:parseFloat(editForm.quantity_kg),
      client:editForm.client||null, operator:editForm.operator||null, foreman:editForm.foreman||null,
      technologist:editForm.technologist||null, status:editForm.status, notes:editForm.notes||null,
      updated_at:new Date().toISOString()
    }).eq('id', editForm.id)
    setSaving(false)
    if (error) { setEditError(error.message); return }
    setEditModal(false)
    if (detail?.id === editForm.id) setDetail(null)
    load()
  }

  const ef = (k, v) => setEditForm(p => ({ ...p, [k]: v }))

  async function recalcFIFO(batch) {
    setRecalcId(batch.id); setRecalcMsg('Pobieram recepturę...')
    try {
      const { data: pb } = await supabase.from('production_batches').select('recipe_id, quantity_kg').eq('id', batch.id).single()
      if (!pb?.recipe_id) throw new Error('Nie znaleziono receptury dla tej partii')
      const { data: recipe } = await supabase.from('recipes').select('*, recipe_items(*, ingredients(id,code,name))').eq('id', pb.recipe_id).single()
      if (!recipe) throw new Error('Nie znaleziono receptury')
      setRecalcMsg('Pobieram stan magazynu...')
      const { data: allBatches } = await supabase.from('production_batches').select('id, lot_number, production_date').order('lot_number', { ascending: true })
      const thisBatch = allBatches?.find(b => b.id === batch.id)
      const thisLot = thisBatch?.lot_number || ''
      const priorityIds = (allBatches||[]).filter(b => b.id !== batch.id && b.lot_number < thisLot).map(b => b.id)
      const usedMap = {}
      if (priorityIds.length > 0) {
        const { data: otherUsed } = await supabase.from('production_batch_items').select('ingredient_batch_id, quantity_used_kg').in('production_batch_id', priorityIds)
        for (const u of (otherUsed||[])) usedMap[u.ingredient_batch_id] = (usedMap[u.ingredient_batch_id]||0) + parseFloat(u.quantity_used_kg)
      }
      const { data: stockAll } = await supabase.from('v_stock').select('*').eq('status', 'dopuszczona').order('received_date', { ascending: true })
      const availableMap = {}
      for (const s of (stockAll||[])) {
        const used = usedMap[s.id]||0
        const avail = parseFloat(s.current_kg) - used
        if (avail > 0.001) {
          if (!availableMap[s.ingredient_id]) availableMap[s.ingredient_id] = []
          availableMap[s.ingredient_id].push({ ...s, available: parseFloat(avail.toFixed(3)) })
        }
      }
      setRecalcMsg('Obliczam FIFO...')
      const mass = parseFloat(pb.quantity_kg)
      const newItems = []
      for (const item of (recipe.recipe_items||[]).sort((a,b) => a.sort_order-b.sort_order)) {
        const needed = parseFloat(((mass * item.percentage) / 100).toFixed(3))
        const rows = availableMap[item.ingredient_id] || []
        let remaining = needed; let fifoOrder = 1
        for (const row of rows) {
          if (remaining <= 0.001) break
          const take = Math.min(remaining, row.available)
          if (take > 0.001) {
            newItems.push({ production_batch_id: batch.id, ingredient_batch_id: row.id, ingredient_id: item.ingredient_id, quantity_used_kg: parseFloat(take.toFixed(3)), fifo_order: fifoOrder++ })
            remaining = parseFloat((remaining - take).toFixed(3))
          }
        }
      }
      setRecalcMsg('Zapisuję nowe powiązania...')
      await supabase.from('production_batch_items').delete().eq('production_batch_id', batch.id)
      if (newItems.length > 0) await supabase.from('production_batch_items').insert(newItems)
      setRecalcMsg('Gotowe!')
      setTimeout(() => { setRecalcId(null); setRecalcMsg('') }, 1500)
      if (detail?.id === batch.id) showDetail(batch)
    } catch (err) {
      setRecalcMsg('Błąd: ' + err.message)
      setTimeout(() => { setRecalcId(null); setRecalcMsg('') }, 3000)
    }
  }

  async function deleteBatch(batch) {
    const { data: fg } = await supabase.from('finished_goods').select('id').eq('production_batch_id', batch.id)
    if (fg && fg.length > 0) {
      const fgIds = fg.map(f => f.id)
      await supabase.from('wz_documents').delete().in('finished_good_id', fgIds)
      await supabase.from('finished_goods').delete().eq('production_batch_id', batch.id)
    }
    await supabase.from('orders').update({ production_batch_id: null, status: 'nowe', updated_at: new Date().toISOString() }).eq('production_batch_id', batch.id)
    await supabase.from('production_batch_items').delete().eq('production_batch_id', batch.id)
    await supabase.from('production_batches').delete().eq('id', batch.id)
    setDeleteConfirm(null)
    if (detail?.id === batch.id) { setDetail(null); setDetailItems([]); setDetailPrices({}) }
    load()
  }

  async function openEditItems(batch) {
    setEditItemsBatch(batch)
    const { data: items } = await supabase.from('production_batch_items').select('*, ingredient_batches(delivery_lot, received_date, quantity_kg), ingredients(code, name)').eq('production_batch_id', batch.id).order('fifo_order')
    const { data: ingBatches } = await supabase.from('v_stock').select('*').eq('status', 'dopuszczona').order('ingredient_id, received_date')
    const { data: ings } = await supabase.from('ingredients').select('id,code,name').eq('status','aktywny').order('code')
    setEditItemsList((items||[]).map(it => ({ id: it.id, ingredient_id: it.ingredient_id, ingredient_batch_id: it.ingredient_batch_id, quantity_used_kg: it.quantity_used_kg, fifo_order: it.fifo_order })))
    setAllIngBatches(ingBatches||[])
    setAllIngredients(ings||[])
    setEditItemsModal(true)
  }

  async function saveEditItems() {
    setSavingItems(true)
    await supabase.from('production_batch_items').delete().eq('production_batch_id', editItemsBatch.id)
    const toInsert = editItemsList.filter(it => it.ingredient_id && it.ingredient_batch_id && it.quantity_used_kg).map((it, idx) => ({ production_batch_id: editItemsBatch.id, ingredient_id: it.ingredient_id, ingredient_batch_id: it.ingredient_batch_id, quantity_used_kg: parseFloat(it.quantity_used_kg), fifo_order: idx + 1 }))
    if (toInsert.length > 0) await supabase.from('production_batch_items').insert(toInsert)
    setSavingItems(false)
    setEditItemsModal(false)
    if (detail?.id === editItemsBatch.id) showDetail(detail)
  }

  function updateEditItem(idx, key, val) { setEditItemsList(p => p.map((it, i) => i === idx ? {...it, [key]: val} : it)) }
  function addEditItem() { setEditItemsList(p => [...p, { ingredient_id:'', ingredient_batch_id:'', quantity_used_kg:'', fifo_order: p.length+1 }]) }
  function removeEditItem(idx) { setEditItemsList(p => p.filter((_, i) => i !== idx)) }

  async function exportPDF() {
    const doc = new jsPDF('l', 'mm', 'a4')
    const plg = s => (s||'').replace(/ą/g,'a').replace(/ć/g,'c').replace(/ę/g,'e').replace(/ł/g,'l').replace(/ń/g,'n').replace(/ó/g,'o').replace(/ś/g,'s').replace(/ź/g,'z').replace(/ż/g,'z').replace(/Ą/g,'A').replace(/Ć/g,'C').replace(/Ę/g,'E').replace(/Ł/g,'L').replace(/Ń/g,'N').replace(/Ó/g,'O').replace(/Ś/g,'S').replace(/Ź/g,'Z').replace(/Ż/g,'Z')
    doc.setFontSize(14); doc.text(`InstantMix Pro - Raport produkcji`, 14, 14)
    doc.setFontSize(10); doc.text(`Wygenerowano: ${new Date().toLocaleDateString('pl-PL')} | Partii: ${stats.count} | Lacznie: ${stats.kg} kg`, 14, 22)
    autoTable(doc, {
      startY: 28,
      head: [['Nr partii prod.', 'Kod', 'Nazwa mieszanki', 'Klient', 'Data prod.', 'Linia', 'Ilosc (kg)', 'Wersja', 'Status']],
      body: filtered.map(b => [plg(b.lot_number), plg(b.recipe_code), plg(b.recipe_name), plg(b.client)||'-', b.production_date, plg(b.production_line), b.quantity_kg, plg(b.recipe_version), plg(b.status)]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [15, 110, 86] }
    })
    doc.save(`raport_produkcji_${new Date().toISOString().slice(0,10)}.pdf`)
  }

  async function exportDetailPDF(batch) {
    const { data: items } = await supabase.from('production_batch_items').select('*, ingredient_batches(delivery_lot), ingredients(code, name, has_allergen, allergen_type)').eq('production_batch_id', batch.id).order('fifo_order')
    const doc = new jsPDF()
    const pl = s => (s||'').replace(/ą/g,'a').replace(/ć/g,'c').replace(/ę/g,'e').replace(/ł/g,'l').replace(/ń/g,'n').replace(/ó/g,'o').replace(/ś/g,'s').replace(/ź/g,'z').replace(/ż/g,'z').replace(/Ą/g,'A').replace(/Ć/g,'C').replace(/Ę/g,'E').replace(/Ł/g,'L').replace(/Ń/g,'N').replace(/Ó/g,'O').replace(/Ś/g,'S').replace(/Ź/g,'Z').replace(/Ż/g,'Z')
    doc.setFontSize(14); doc.text(`Raport partii: ${pl(batch.lot_number)}`, 14, 16)
    doc.setFontSize(10)
    doc.text(`${pl(batch.recipe_code)} - ${pl(batch.recipe_name)} (${pl(batch.recipe_version)})`, 14, 24)
    doc.text(`Klient: ${pl(batch.client)||'-'}`, 14, 31)
    doc.text(`Data: ${batch.production_date} | Masa: ${batch.quantity_kg} kg | Linia: ${pl(batch.production_line)}`, 14, 38)
    doc.text(`Operator: ${pl(batch.operator)||'-'} | Brygadzista: ${pl(batch.foreman)||'-'} | Technolog: ${pl(batch.technologist)||'-'}`, 14, 45)
    autoTable(doc, {
      startY: 52,
      head: [['Kod skl.', 'Nazwa skladnika', 'Partia dostawy', 'Uzyto (kg)', 'FIFO', 'Alergen']],
      body: (items||[]).map(it => [pl(it.ingredients?.code), pl(it.ingredients?.name), pl(it.ingredient_batches?.delivery_lot), it.quantity_used_kg, it.fifo_order, it.ingredients?.has_allergen ? pl(it.ingredients.allergen_type) : '-']),
      styles: { fontSize: 9 }, headStyles: { fillColor: [15, 110, 86] }
    })
    const allergens = [...new Set((items||[]).filter(it => it.ingredients?.has_allergen).map(it => it.ingredients.allergen_type))]
    if (allergens.length) { doc.setFontSize(10); doc.setTextColor(150,0,0); doc.text('ALERGENY: ' + allergens.map(pl).join(', '), 14, doc.lastAutoTable.finalY + 10) }
    doc.save(`partia_${batch.lot_number}.pdf`)
  }

  const months = [
    { v:'', l:'— wszystkie miesiące —' },
    ...Array.from({ length:12 }, (_, i) => {
      const d = new Date(2025, i, 1)
      return { v:`2025-${String(i+1).padStart(2,'0')}`, l:d.toLocaleDateString('pl-PL',{month:'long',year:'numeric'}) }
    })
  ]

  const totalVal = batchTotalValue()
  const hasValues = detailItems.some(it => parseFloat(it.ingredient_batches?.unit_price_pln||0) > 0)

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Produkcja / powiązanie partii</div><div className="page-sub">Dostęp: wszyscy użytkownicy</div></div>
        <button className="btn btn-sm" onClick={exportPDF}>Drukuj raport ({filtered.length})</button>
      </div>

      <div className="card" style={{ padding:'12px 16px', marginBottom:10 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 140px 180px 100px auto', gap:10, alignItems:'end' }}>
          <div><label>Szukaj (nr partii, nazwa, klient)</label>
            <input className="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="nr partii, nazwa, kod, klient..." style={{ width:'100%' }} />
          </div>
          <div><label>Dzień</label><input type="date" value={fDay} onChange={e => setFDay(e.target.value)} /></div>
          <div><label>Miesiąc</label>
            <select value={fMonth} onChange={e => setFMonth(e.target.value)}>
              {months.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </div>
          <div><label>Rok</label>
            <select value={fYear} onChange={e => setFYear(e.target.value)}>
              <option value="">—</option><option value="2026">2026</option><option value="2025">2025</option><option value="2024">2024</option>
            </select>
          </div>
          <div><button className="btn btn-sm" onClick={() => { setSearch(''); setFDay(''); setFMonth(''); setFYear('') }}>Wyczyść</button></div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Partii (filtr)</div><div className="stat-val">{stats.count}</div></div>
        <div className="stat-card"><div className="stat-label">Łącznie (kg)</div><div className="stat-val">{parseFloat(stats.kg).toLocaleString('pl-PL')}</div></div>
        <div className="stat-card"><div className="stat-label">Bezglutenowe</div><div className="stat-val">{stats.bg}</div></div>
        <div className="stat-card"><div className="stat-label">Wstrzymane</div><div className="stat-val" style={{ color:'#A32D2D' }}>{stats.blocked}</div></div>
      </div>

      {recalcId && <div className="info-box" style={{ marginBottom:10 }}><span className="spinner" style={{ marginRight:8 }} />{recalcMsg}</div>}

      <div className="card-0" style={{ overflowX:'auto' }}>
        <table style={{ minWidth:980 }}>
          <thead><tr>
            <th style={{ width:32 }}></th>
            <th>Nr partii prod.</th><th>Kod</th><th>Nazwa mieszanki</th>
            <th>Klient</th><th>Data prod.</th><th>Linia prod.</th>
            <th>Ilość (kg)</th><th>Wersja</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(b => (
              <React.Fragment key={b.id}>
                <tr>
                  <td style={{ textAlign:'center' }}>
                    <button onClick={() => showDetail(b)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#5F5E5A', padding:'2px 4px' }}>
                      {detail?.id === b.id ? '▲' : '▼'}
                    </button>
                  </td>
                  <td><span className="lot">{b.lot_number}</span></td>
                  <td><span className="lot">{b.recipe_code}</span></td>
                  <td style={{ fontWeight:500 }}>{b.recipe_name}</td>
                  <td>{b.client ? <span style={{ background:'#E6F1FB', color:'#0C447C', padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:500 }}>{b.client}</span> : <span className="muted">—</span>}</td>
                  <td className="muted">{b.production_date}</td>
                  <td><span className={`badge ${b.production_line==='bezglutenowa'?'b-purple':'b-gray'}`}>{b.production_line==='bezglutenowa'?'Bezglutenowa':'Zwykła'}</span></td>
                  <td style={{ fontWeight:500, textAlign:'right' }}>{b.quantity_kg}</td>
                  <td><span className="badge b-info">{b.recipe_version}</span></td>
                  <td><span className={`badge ${b.status==='wyprodukowana'?'b-ok':b.status==='wstrzymana'?'b-err':b.status==='wydana'?'b-info':'b-warn'}`}>{STATUS_LABELS[b.status]}</span></td>
                  <td>
                    <div className="flex" style={{ gap:4 }}>
                      <button className="btn btn-sm" onClick={() => exportDetailPDF(b)}>PDF</button>
                      {isAdmin && <button className="btn btn-sm" style={{ background:'#E6F1FB', color:'#0C447C', border:'0.5px solid #B5D4F4' }} onClick={() => openEdit(b)}>Edytuj</button>}
                      {isAdmin && <button className="btn btn-sm" style={{ background:'#FFF3E0', color:'#E65100', border:'0.5px solid #FFCC80' }} onClick={() => openEditItems(b)} title="Edytuj partie składników">Skł.</button>}
                      {isAdmin && <button className="btn btn-sm" style={{ background:'#EEEDFE', color:'#3C3489', border:'0.5px solid #AFA9EC' }} onClick={() => recalcFIFO(b)} disabled={recalcId === b.id} title="Przelicz ponownie FIFO">{recalcId === b.id ? '...' : '↻ FIFO'}</button>}
                      {isAdmin && <button className="btn btn-sm btn-danger" onClick={() => setDeleteConfirm(b)} title="Usuń partię">Usuń</button>}
                    </div>
                  </td>
                </tr>
                {detail?.id === b.id && (
                  <tr>
                    <td colSpan={11} style={{ padding:0, background:'#F9F8F5' }}>
                      <div style={{ padding:'10px 16px 12px 40px' }}>
                        <div className="flex" style={{ marginBottom:8, flexWrap:'wrap', gap:6, alignItems:'center' }}>
                          <span style={{ fontWeight:500, color:'#0F6E56', fontSize:12 }}>{b.recipe_name} — {b.lot_number}</span>
                          {b.client && <span style={{ background:'#E6F1FB', color:'#0C447C', padding:'2px 8px', borderRadius:999, fontSize:11 }}>{b.client}</span>}
                          <span className="muted" style={{ fontSize:12 }}>{b.production_date} | {b.quantity_kg} kg</span>
                          {isAdmin && hasValues && totalVal > 0 && (
                            <span style={{ background:'#EEEDFE', color:'#3C3489', padding:'2px 10px', borderRadius:999, fontSize:12, fontWeight:600 }}>
                              Wartość surowców: {totalVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})} zł
                            </span>
                          )}
                        </div>
                        <div className="muted" style={{ marginBottom:8, fontSize:12 }}>
                          Operator: {b.operator||'—'} &nbsp;|&nbsp; Brygadzista: {b.foreman||'—'} &nbsp;|&nbsp; Technolog: {b.technologist||'—'}
                          {b.notes && <span> &nbsp;|&nbsp; Uwagi: {b.notes}</span>}
                        </div>
                        <table style={{ width:'auto', minWidth:600 }}>
                          <thead><tr>
                            <th>Kod skł.</th><th>Nazwa składnika</th><th>Partia dostawy</th>
                            <th style={{textAlign:'right'}}>Użyto (kg)</th><th>FIFO</th>
                            {isAdmin && <th style={{textAlign:'right'}}>Wartość (zł)</th>}
                            <th>Alergen</th>
                          </tr></thead>
                          <tbody>
                            {detailItems.map(it => {
                              const price = parseFloat(it.ingredient_batches?.unit_price_pln || 0)
                              const val = price > 0 ? parseFloat(it.quantity_used_kg) * price : null
                              return (
                                <tr key={it.id}>
                                  <td><span className="lot">{it.ingredients?.code}</span></td>
                                  <td>{it.ingredients?.name}</td>
                                  <td><span className="lot">{it.ingredient_batches?.delivery_lot}</span>{it.fifo_order>1 && <span className="fifo-badge">FIFO {it.fifo_order}</span>}</td>
                                  <td style={{ textAlign:'right', fontWeight:500 }}>{it.quantity_used_kg}</td>
                                  <td><span className="badge b-info" style={{ fontSize:10 }}>#{it.fifo_order}</span></td>
                                  {isAdmin && <td style={{ textAlign:'right', fontSize:12, color: val ? '#3C3489' : '#888' }}>{val ? val.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł' : '—'}</td>}
                                  <td>{it.ingredients?.has_allergen ? <span className="badge b-err">{it.ingredients.allergen_type}</span> : <span className="muted">—</span>}</td>
                                </tr>
                              )
                            })}
                            {isAdmin && hasValues && totalVal > 0 && (
                              <tr style={{ background:'#EEEDFE' }}>
                                <td colSpan={isAdmin ? 5 : 4} style={{ textAlign:'right', fontWeight:600, color:'#3C3489' }}>SUMA wartości surowców:</td>
                                <td style={{ textAlign:'right', fontWeight:700, color:'#3C3489' }}>{totalVal.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})} zł</td>
                                <td></td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {!loading && filtered.length===0 && <tr><td colSpan={11} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak wyników</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Modal potwierdzenie usunięcia */}
      <div className={`modal-overlay ${deleteConfirm?'open':''}`} onClick={e => e.target===e.currentTarget && setDeleteConfirm(null)}>
        <div className="modal" style={{ maxWidth:440 }}>
          <div className="modal-title">Usuń partię produkcyjną</div>
          <div className="warn-box">Czy na pewno chcesz usunąć partię <b>{deleteConfirm?.lot_number}</b>?<br/><br/>Zostaną automatycznie usunięte:<br/>• Powiązania z partiami składników (FIFO)<br/>• Przyjęcia na Magazyn WG<br/>• Dokumenty WZ wystawione dla tej partii<br/>• Powiązane zlecenie wróci do statusu "Nowe"<br/><br/>Operacja jest nieodwracalna.</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setDeleteConfirm(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteBatch(deleteConfirm)}>Tak, usuń</button>
          </div>
        </div>
      </div>

      {/* Modal edycja partii składników */}
      <div className={`modal-overlay ${editItemsModal?'open':''}`} onClick={e => e.target===e.currentTarget && setEditItemsModal(false)}>
        <div className="modal" style={{ maxWidth:700 }}>
          <div className="modal-title">Edycja składników partii — {editItemsBatch?.lot_number}</div>
          <div className="warn-box" style={{ marginBottom:10 }}>Ręczna edycja składników — uwaga: zmiana może być niezgodna z zasadami FIFO.</div>
          <div style={{ overflowX:'auto', marginBottom:10 }}>
            <table style={{ minWidth:580 }}>
              <thead><tr><th>Składnik</th><th>Partia dostawy</th><th>Użyto (kg)</th><th style={{width:32}}></th></tr></thead>
              <tbody>
                {editItemsList.map((it, idx) => (
                  <tr key={idx}>
                    <td>
                      <select value={it.ingredient_id} onChange={e => { updateEditItem(idx, 'ingredient_id', e.target.value); updateEditItem(idx, 'ingredient_batch_id', '') }} style={{ fontSize:12, width:'100%' }}>
                        <option value="">— wybierz składnik —</option>
                        {allIngredients.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={it.ingredient_batch_id} onChange={e => updateEditItem(idx, 'ingredient_batch_id', e.target.value)} style={{ fontSize:12, width:'100%' }} disabled={!it.ingredient_id}>
                        <option value="">— wybierz partię —</option>
                        {allIngBatches.filter(b => b.ingredient_id === it.ingredient_id).map(b => (
                          <option key={b.id} value={b.id}>{b.delivery_lot} ({parseFloat(b.current_kg).toFixed(3)} kg)</option>
                        ))}
                      </select>
                    </td>
                    <td><input type="number" step="0.001" value={it.quantity_used_kg} onChange={e => updateEditItem(idx, 'quantity_used_kg', e.target.value)} style={{ width:90, fontSize:12 }} /></td>
                    <td><button className="btn btn-sm btn-danger" style={{ padding:'2px 6px' }} onClick={() => removeEditItem(idx)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-sm" onClick={addEditItem}>+ Dodaj wiersz</button>
          <div className="modal-footer">
            <button className="btn" onClick={() => setEditItemsModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveEditItems} disabled={savingItems}>{savingItems?'Zapisywanie...':'Zapisz zmiany'}</button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${editModal?'open':''}`} onClick={e => e.target===e.currentTarget && setEditModal(false)}>
        <div className="modal">
          <div className="modal-title">Edycja partii produkcyjnej</div>
          <div className="info-box" style={{ marginBottom:10 }}>Edycja dostępna tylko dla Admina.</div>
          {editError && <div className="err-box">{editError}</div>}
          <div className="fr">
            <div><label>Data produkcji *</label><input type="date" value={editForm.production_date||''} onChange={e => ef('production_date',e.target.value)} /></div>
            <div><label>Ilość (kg) *</label><input type="number" step="0.001" value={editForm.quantity_kg||''} onChange={e => ef('quantity_kg',e.target.value)} /></div>
          </div>
          <div style={{ marginBottom:10 }}>
            <label>Klient (przeznaczenie partii)</label>
            <input value={editForm.client||''} onChange={e => ef('client',e.target.value)} placeholder="np. Firma ABC" />
          </div>
          <div className="fr">
            <div><label>Operator</label><input value={editForm.operator||''} onChange={e => ef('operator',e.target.value)} /></div>
            <div><label>Brygadzista</label><input value={editForm.foreman||''} onChange={e => ef('foreman',e.target.value)} /></div>
          </div>
          <div className="fr">
            <div><label>Technolog</label><input value={editForm.technologist||''} onChange={e => ef('technologist',e.target.value)} /></div>
            <div><label>Status</label>
              <select value={editForm.status||'wyprodukowana'} onChange={e => ef('status',e.target.value)}>
                <option value="w_trakcie">W trakcie</option>
                <option value="wyprodukowana">Wyprodukowana</option>
                <option value="wstrzymana">Wstrzymana</option>
                <option value="wydana">Wydana</option>
              </select>
            </div>
          </div>
          <div><label>Uwagi</label><input value={editForm.notes||''} onChange={e => ef('notes',e.target.value)} /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setEditModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>{saving?'Zapisywanie...':'Zapisz zmiany'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
