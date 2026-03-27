import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const STATUS_LABELS = { w_trakcie:'W trakcie', wyprodukowana:'Wyprodukowana', wstrzymana:'Wstrzymana', wydana:'Wydana' }

export default function Produkcja() {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [fDay, setFDay] = useState('')
  const [fMonth, setFMonth] = useState('')
  const [fYear, setFYear] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailItems, setDetailItems] = useState([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('v_production').select('*')
    setBatches(data || [])
    setLoading(false)
  }

  const filtered = batches.filter(b => {
    const q = search.toLowerCase()
    const matchQ = !q || b.lot_number.toLowerCase().includes(q) || b.recipe_name.toLowerCase().includes(q) || b.recipe_code.toLowerCase().includes(q)
    const matchDay = !fDay || b.production_date === fDay
    const matchMonth = !fMonth || b.production_date?.startsWith(fMonth)
    const matchYear = !fYear || b.production_date?.startsWith(fYear)
    return matchQ && matchDay && matchMonth && matchYear
  })

  const stats = {
    count: filtered.length,
    kg: filtered.reduce((s, b) => s + parseFloat(b.quantity_kg), 0).toFixed(1),
    bg: filtered.filter(b => b.production_line === 'bezglutenowa').length,
    blocked: filtered.filter(b => b.status === 'wstrzymana').length
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

  function exportPDF() {
    const doc = new jsPDF('l', 'mm', 'a4')
    doc.setFontSize(14); doc.text(`InstantMix Pro — Raport produkcji`, 14, 14)
    doc.setFontSize(10); doc.text(`Wygenerowano: ${new Date().toLocaleDateString('pl-PL')} | Partii: ${stats.count} | Łącznie: ${stats.kg} kg`, 14, 22)
    autoTable(doc, {
      startY: 28,
      head: [['Nr partii prod.', 'Kod', 'Nazwa mieszanki', 'Nr partii mix.', 'Data prod.', 'Linia prod.', 'Ilość (kg)', 'Wersja', 'Status']],
      body: filtered.map(b => [b.lot_number, b.recipe_code, b.recipe_name, '—', b.production_date, b.production_line, b.quantity_kg, b.recipe_version, b.status]),
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
    doc.text(`Data: ${batch.production_date} | Masa: ${batch.quantity_kg} kg | Linia: ${batch.production_line}`, 14, 31)
    doc.text(`Operator: ${batch.operator || '—'} | Brygadzista: ${batch.foreman || '—'} | Technolog: ${batch.technologist || '—'}`, 14, 38)
    autoTable(doc, {
      startY: 44,
      head: [['Kod skł.', 'Nazwa', 'Partia dostawy', 'Użyto (kg)', 'Kolejność FIFO', 'Alergen']],
      body: (items||[]).map(it => [
        it.ingredients?.code, it.ingredients?.name,
        it.ingredient_batches?.delivery_lot,
        it.quantity_used_kg, it.fifo_order,
        it.ingredients?.has_allergen ? it.ingredients.allergen_type : '—'
      ]),
      styles: { fontSize: 9 }, headStyles: { fillColor: [15, 110, 86] }
    })
    const allergens = [...new Set((items||[]).filter(it => it.ingredients?.has_allergen).map(it => it.ingredients.allergen_type))]
    if (allergens.length) {
      doc.setFontSize(10); doc.setTextColor(150, 0, 0)
      doc.text('ALERGENY: ' + allergens.join(', '), 14, doc.lastAutoTable.finalY + 10)
    }
    doc.save(`partia_${batch.lot_number}.pdf`)
  }

  const months = [
    { v:'', l:'— wszystkie miesiące —' },
    ...Array.from({ length:12 }, (_, i) => {
      const d = new Date(2025, i, 1)
      return { v: `2025-${String(i+1).padStart(2,'0')}`, l: d.toLocaleDateString('pl-PL', { month:'long', year:'numeric' }) }
    })
  ]

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Produkcja / powiązanie partii</div>
          <div className="page-sub">Dostęp: wszyscy użytkownicy</div>
        </div>
        <div className="flex" style={{ flexWrap:'wrap', gap:6 }}>
          <button className="btn btn-sm" onClick={exportPDF}>Drukuj raport ({filtered.length})</button>
        </div>
      </div>

      {/* Filtry */}
      <div className="card" style={{ padding:'12px 16px', marginBottom:10 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 140px 180px 100px auto', gap:10, alignItems:'end' }}>
          <div><label>Szukaj</label>
            <input className="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="nr partii, nazwa, kod..." style={{ width:'100%' }} />
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

      <div className="card-0" style={{ overflowX:'auto' }}>
        <table style={{ minWidth:900 }}>
          <thead><tr>
            <th>Nr partii prod.</th><th>Kod</th><th>Nazwa mieszanki</th>
            <th>Data prod.</th><th>Linia prod.</th>
            <th>Ilość (kg)</th><th>Wersja</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(b => (
              <tr key={b.id}>
                <td><span className="lot">{b.lot_number}</span></td>
                <td><span className="lot">{b.recipe_code}</span></td>
                <td style={{ fontWeight:500 }}>{b.recipe_name}</td>
                <td className="muted">{b.production_date}</td>
                <td><span className={`badge ${b.production_line==='bezglutenowa'?'b-purple':'b-gray'}`}>{b.production_line === 'bezglutenowa' ? 'Bezglutenowa' : 'Zwykła'}</span></td>
                <td style={{ fontWeight:500, textAlign:'right' }}>{b.quantity_kg}</td>
                <td><span className="badge b-info">{b.recipe_version}</span></td>
                <td><span className={`badge ${b.status==='wyprodukowana'?'b-ok':b.status==='wstrzymana'?'b-err':b.status==='wydana'?'b-info':'b-warn'}`}>{STATUS_LABELS[b.status]}</span></td>
                <td>
                  <div className="flex" style={{ gap:4 }}>
                    <button className="btn btn-sm" onClick={() => showDetail(b)}>Szczegóły</button>
                    <button className="btn btn-sm" onClick={() => exportDetailPDF(b)}>PDF</button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak wyników dla wybranych filtrów</td></tr>}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="card" style={{ borderLeft:'3px solid #1D9E75', marginTop:8 }}>
          <div className="flex" style={{ marginBottom:10, flexWrap:'wrap', gap:6 }}>
            <span className="lot">{detail.lot_number}</span>
            <span style={{ fontWeight:500 }}>{detail.recipe_name}</span>
            <span className="badge b-info">{detail.recipe_version}</span>
            <span className={`badge ${detail.production_line==='bezglutenowa'?'b-purple':'b-gray'}`}>{detail.production_line}</span>
            <span className="muted" style={{ marginLeft:'auto' }}>{detail.production_date} | {detail.quantity_kg} kg</span>
            <button className="btn btn-sm" onClick={() => { setDetail(null); setDetailItems([]) }}>Zamknij</button>
          </div>
          <div className="muted" style={{ marginBottom:8 }}>Operator: {detail.operator || '—'} | Brygadzista: {detail.foreman || '—'} | Technolog: {detail.technologist || '—'}</div>
          <div className="card-0">
            <table>
              <thead><tr><th>Kod skł.</th><th>Nazwa składnika</th><th>Partia dostawy</th><th>Użyto (kg)</th><th>FIFO</th><th>Alergen</th></tr></thead>
              <tbody>
                {detailItems.map(it => (
                  <tr key={it.id}>
                    <td><span className="lot">{it.ingredients?.code}</span></td>
                    <td>{it.ingredients?.name}</td>
                    <td><span className="lot">{it.ingredient_batches?.delivery_lot}</span>{it.fifo_order > 1 && <span className="fifo-badge">FIFO {it.fifo_order}</span>}</td>
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
    </div>
  )
}
