import { useState, useEffect } from 'react'
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
  const [editModal, setEditModal] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [recalcId, setRecalcId] = useState(null)
  const [recalcMsg, setRecalcMsg] = useState('')

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
    if (detail?.id === batch.id) { setDetail(null); setDetailItems([]); return }
    const { data } = await supabase
      .from('production_batch_items')
      .select('*, ingredient_batches(delivery_lot, received_date), ingredients(code, name, has_allergen, allergen_type)')
      .eq('production_batch_id', batch.id)
      .order('fifo_order')
    setDetail(batch); setDetailItems(data || [])
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

  // Przelicz FIFO na nowo
  async function recalcFIFO(batch) {
    setRecalcId(batch.id); setRecalcMsg('Pobieram recepturę...')
    try {
      // 1. Pobierz recepturę z pozycjami
      const { data: recipe } = await supabase
        .from('recipes')
        .select('*, recipe_items(*, ingredients(id,code,name,has_allergen,allergen_type))')
        .eq('id', batch.recipe_id)
        .single()
      if (!recipe) throw new Error('Nie znaleziono receptury')

      setRecalcMsg('Obliczam FIFO...')
      const mass = parseFloat(batch.quantity_kg)
      const newItems = []

      for (const item of (recipe.recipe_items||[]).sort((a,b) => a.sort_order-b.sort_order)) {
        const needed = parseFloat(((mass * item.percentage) / 100).toFixed(3))
        const { data: stockRows } = await supabase
          .from('v_fifo_stock')
          .select('*')
          .eq('ingredient_id', item.ingredient_id)
          .gt('current_kg', 0)

        let remaining = needed
        let fifoOrder = 1
        for (const row of (stockRows||[])) {
          if (remaining <= 0) break
          const take = Math.min(remaining, parseFloat(row.current_kg))
          newItems.push({
            production_batch_id: batch.id,
            ingredient_batch_id: row.id,
            ingredient_id: item.ingredient_id,
            quantity_used_kg: parseFloat(take.toFixed(3)),
            fifo_order: fifoOrder++
          })
          remaining = parseFloat((remaining - take).toFixed(3))
        }
      }

      setRecalcMsg('Zapisuję nowe powiązania...')
      // 2. Usuń stare powiązania
      await supabase.from('production_batch_items').delete().eq('production_batch_id', batch.id)
      // 3. Zapisz nowe
      if (newItems.length > 0) {
        await supabase.from('production_batch_items').insert(newItems)
      }

      setRecalcMsg('Gotowe!')
      setTimeout(() => { setRecalcId(null); setRecalcMsg('') }, 1500)
      if (detail?.id === batch.id) {
        const { data } = await supabase
          .from('production_batch_items')
          .select('*, ingredient_batches(delivery_lot, received_date), ingredients(code, name, has_allergen, allergen_type)')
          .eq('production_batch_id', batch.id)
          .order('fifo_order')
        setDetailItems(data || [])
      }
    } catch (err) {
      setRecalcMsg('Błąd: ' + err.message)
      setTimeout(() => { setRecalcId(null); setRecalcMsg('') }, 3000)
    }
  }

  async function exportPDF() {
    const doc = new jsPDF('l', 'mm', 'a4')
    doc.setFontSize(14); doc.text(`InstantMix Pro — Raport produkcji`, 14, 14)
    doc.setFontSize(10); doc.text(`Wygenerowano: ${new Date().toLocaleDateString('pl-PL')} | Partii: ${stats.count} | Lacznie: ${stats.kg} kg`, 14, 22)
    autoTable(doc, {
      startY: 28,
      head: [['Nr partii prod.', 'Kod', 'Nazwa mieszanki', 'Klient', 'Data prod.', 'Linia', 'Ilosc (kg)', 'Wersja', 'Status']],
      body: filtered.map(b => [b.lot_number, b.recipe_code, b.recipe_name, b.client||'—', b.production_date, b.production_line, b.quantity_kg, b.recipe_version, b.status]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [15, 110, 86] }
    })
    doc.save(`raport_produkcji_${new Date().toISOString().slice(0,10)}.pdf`)
  }

  async function exportDetailPDF(batch) {
    const { data: items } = await supabase
      .from('production_batch_items')
      .select('*, ingredient_batches(delivery_lot), ingredients(code, name, has_allergen, allergen_type)')
      .eq('production_batch_id', batch.id)
      .order('fifo_order')
    const doc = new jsPDF()
    doc.setFontSize(14); doc.text(`Raport partii: ${batch.lot_number}`, 14, 16)
    doc.setFontSize(10)
    doc.text(`${batch.recipe_code} — ${batch.recipe_name} (${batch.recipe_version})`, 14, 24)
    doc.text(`Klient: ${batch.client||'—'}`, 14, 31)
    doc.text(`Data: ${batch.production_date} | Masa: ${batch.quantity_kg} kg | Linia: ${batch.production_line}`, 14, 38)
    doc.text(`Operator: ${batch.operator||'—'} | Brygadzista: ${batch.foreman||'—'} | Technolog: ${batch.technologist||'—'}`, 14, 45)
    autoTable(doc, {
      startY: 52,
      head: [['Kod skl.', 'Nazwa', 'Partia dostawy', 'Uzyto (kg)', 'FIFO', 'Alergen']],
      body: (items||[]).map(it => [it.ingredients?.code, it.ingredients?.name, it.ingredient_batches?.delivery_lot, it.quantity_used_kg, it.fifo_order, it.ingredients?.has_allergen ? it.ingredients.allergen_type : '—']),
      styles: { fontSize: 9 }, headStyles: { fillColor: [15, 110, 86] }
    })
    const allergens = [...new Set((items||[]).filter(it => it.ingredients?.has_allergen).map(it => it.ingredients.allergen_type))]
    if (allergens.length) { doc.setFontSize(10); doc.setTextColor(150,0,0); doc.text('ALERGENY: ' + allergens.join(', '), 14, doc.lastAutoTable.finalY + 10) }
    doc.save(`partia_${batch.lot_number}.pdf`)
  }

  const months = [
    { v:'', l:'— wszystkie miesiące —' },
    ...Array.from({ length:12 }, (_, i) => {
      const d = new Date(2025, i, 1)
      return { v:`2025-${String(i+1).padStart(2,'0')}`, l:d.toLocaleDateString('pl-PL',{month:'long',year:'numeric'}) }
    })
  ]

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
              <option value="">—</option><option value="2025">2025</option><option value="2024">2024</option>
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

      {recalcId && (
        <div className="info-box" style={{ marginBottom:10 }}>
          <span className="spinner" style={{ marginRight:8 }} />{recalcMsg}
        </div>
      )}

      <div className="card-0" style={{ overflowX:'auto' }}>
        <table style={{ minWidth:980 }}>
          <thead><tr>
            <th>Nr partii prod.</th><th>Kod</th><th>Nazwa mieszanki</th>
            <th>Klient</th><th>Data prod.</th><th>Linia prod.</th>
            <th>Ilość (kg)</th><th>Wersja</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(b => (
              <tr key={b.id}>
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
                    <button className="btn btn-sm" onClick={() => showDetail(b)}>Szczegóły</button>
                    <button className="btn btn-sm" onClick={() => exportDetailPDF(b)}>PDF</button>
                    {isAdmin && <button className="btn btn-sm" style={{ background:'#E6F1FB', color:'#0C447C', border:'0.5px solid #B5D4F4' }} onClick={() => openEdit(b)}>Edytuj</button>}
                    {isAdmin && (
                      <button
                        className="btn btn-sm"
                        style={{ background:'#EEEDFE', color:'#3C3489', border:'0.5px solid #AFA9EC' }}
                        onClick={() => recalcFIFO(b)}
                        disabled={recalcId === b.id}
                        title="Przelicz ponownie FIFO według aktualnego stanu magazynu"
                      >
                        {recalcId === b.id ? '...' : '↻ FIFO'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filtered.length===0 && <tr><td colSpan={10} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak wyników</td></tr>}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="card" style={{ borderLeft:'3px solid #1D9E75', marginTop:8 }}>
          <div className="flex" style={{ marginBottom:8, flexWrap:'wrap', gap:6 }}>
            <span className="lot">{detail.lot_number}</span>
            <span style={{ fontWeight:500 }}>{detail.recipe_name}</span>
            <span className="badge b-info">{detail.recipe_version}</span>
            <span className={`badge ${detail.production_line==='bezglutenowa'?'b-purple':'b-gray'}`}>{detail.production_line}</span>
            {detail.client && <span style={{ background:'#E6F1FB', color:'#0C447C', padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:500 }}>{detail.client}</span>}
            <span className="muted" style={{ marginLeft:'auto' }}>{detail.production_date} | {detail.quantity_kg} kg</span>
            <button className="btn btn-sm" onClick={() => { setDetail(null); setDetailItems([]) }}>Zamknij</button>
          </div>
          <div className="muted" style={{ marginBottom:8 }}>
            Operator: {detail.operator||'—'} &nbsp;|&nbsp; Brygadzista: {detail.foreman||'—'} &nbsp;|&nbsp; Technolog: {detail.technologist||'—'}
            {detail.notes && <span> &nbsp;|&nbsp; Uwagi: {detail.notes}</span>}
          </div>
          <div className="card-0">
            <table>
              <thead><tr><th>Kod skł.</th><th>Nazwa składnika</th><th>Partia dostawy</th><th>Użyto (kg)</th><th>FIFO</th><th>Alergen</th></tr></thead>
              <tbody>
                {detailItems.map(it => (
                  <tr key={it.id}>
                    <td><span className="lot">{it.ingredients?.code}</span></td>
                    <td>{it.ingredients?.name}</td>
                    <td><span className="lot">{it.ingredient_batches?.delivery_lot}</span>{it.fifo_order>1 && <span className="fifo-badge">FIFO {it.fifo_order}</span>}</td>
                    <td style={{ textAlign:'right', fontWeight:500 }}>{it.quantity_used_kg}</td>
                    <td><span className="badge b-info" style={{ fontSize:10 }}>#{it.fifo_order}</span></td>
                    <td>{it.ingredients?.has_allergen ? <span className="badge b-err">{it.ingredients.allergen_type}</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
            <div><label>Operator</label><input value={editForm.operator||''} onChange={e => ef('operator',e.target.value)} placeholder="Imię, nazwisko" /></div>
            <div><label>Brygadzista</label><input value={editForm.foreman||''} onChange={e => ef('foreman',e.target.value)} placeholder="Imię, nazwisko" /></div>
          </div>
          <div className="fr">
            <div><label>Technolog</label><input value={editForm.technologist||''} onChange={e => ef('technologist',e.target.value)} placeholder="Imię, nazwisko" /></div>
            <div><label>Status</label>
              <select value={editForm.status||'wyprodukowana'} onChange={e => ef('status',e.target.value)}>
                <option value="w_trakcie">W trakcie</option>
                <option value="wyprodukowana">Wyprodukowana</option>
                <option value="wstrzymana">Wstrzymana</option>
                <option value="wydana">Wydana</option>
              </select>
            </div>
          </div>
          <div><label>Uwagi</label><input value={editForm.notes||''} onChange={e => ef('notes',e.target.value)} placeholder="opcjonalne" /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setEditModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>{saving?'Zapisywanie...':'Zapisz zmiany'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
