import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const EMPTY_BATCH = { ingredient_id:'', delivery_lot:'', production_date:'', expiry_date:'', received_date: new Date().toISOString().slice(0,10), quantity_kg:'', invoice_number:'', warehouse_location:'', status:'dopuszczona' }
const EMPTY_CORR = { correction_type:'ubytek_uszkodzenie', delta_kg:'', reason:'', event_date: new Date().toISOString().slice(0,10), approved_by_name:'' }

const CORR_LABELS = { ubytek_uszkodzenie:'Ubytek / uszkodzenie', utylizacja_pelna:'Utylizacja (pełna)', korekta_inwentury:'Korekta inwentury', niedowazenie_dostawy:'Niedoważenie dostawy', zwrot_do_dostawcy:'Zwrot do dostawcy' }

export default function Partie() {
  const { profile } = useAuth()
  const [batches, setBatches] = useState([])
  const [ingredients, setIngredients] = useState([])
  const [corrections, setCorrections] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [corrModal, setCorrModal] = useState(false)
  const [selectedBatch, setSelectedBatch] = useState(null)
  const [form, setForm] = useState(EMPTY_BATCH)
  const [corrForm, setCorrForm] = useState(EMPTY_CORR)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: b }, { data: i }, { data: c }] = await Promise.all([
      supabase.from('ingredient_batches').select('*, ingredients(code,name)').order('received_date', { ascending: false }),
      supabase.from('ingredients').select('id,code,name').eq('status','aktywny').order('code'),
      supabase.from('stock_corrections').select('*').order('created_at', { ascending: false })
    ])
    setBatches(b || []); setIngredients(i || []); setCorrections(c || [])
    setLoading(false)
  }

  function effectiveQty(batch) {
    const corrs = corrections.filter(c => c.ingredient_batch_id === batch.id)
    return batch.quantity_kg + corrs.reduce((s, c) => s + parseFloat(c.delta_kg), 0)
  }

  const filtered = batches.filter(b =>
    (b.ingredients?.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.ingredients?.code || '').toLowerCase().includes(search.toLowerCase()) ||
    b.delivery_lot.toLowerCase().includes(search.toLowerCase())
  )

  const stats = {
    total: batches.length,
    expiringSoon: batches.filter(b => { const d = new Date(b.expiry_date); const now = new Date(); return (d - now) < 30*24*3600*1000 && d > now && b.status === 'dopuszczona' }).length,
    blocked: batches.filter(b => b.status === 'wstrzymana').length,
    totalTons: (batches.reduce((s,b) => s + effectiveQty(b), 0) / 1000).toFixed(1)
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const cf = (k, v) => setCorrForm(p => ({ ...p, [k]: v }))

  async function saveBatch() {
    if (!form.ingredient_id || !form.delivery_lot || !form.quantity_kg) { setError('Uzupełnij wymagane pola'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('ingredient_batches').insert({ ...form, quantity_kg: parseFloat(form.quantity_kg), created_by: profile?.id })
    setSaving(false)
    if (err) { setError(err.message); return }
    setModal(false); load()
  }

  async function saveCorrection() {
    if (!corrForm.reason) { setError('Podaj przyczynę korekty'); return }
    setSaving(true); setError('')
    const delta = corrForm.correction_type === 'utylizacja_pelna' ? -effectiveQty(selectedBatch) : parseFloat(corrForm.delta_kg)
    const { error: err } = await supabase.from('stock_corrections').insert({
      ingredient_batch_id: selectedBatch.id, correction_type: corrForm.correction_type,
      delta_kg: delta, reason: corrForm.reason, event_date: corrForm.event_date, approved_by: profile?.id
    })
    if (!err && corrForm.correction_type === 'utylizacja_pelna') {
      await supabase.from('ingredient_batches').update({ status:'wstrzymana' }).eq('id', selectedBatch.id)
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    setCorrModal(false); load()
  }

  function openCorr(batch) { setSelectedBatch(batch); setCorrForm(EMPTY_CORR); setError(''); setCorrModal(true) }

  const batchCorrections = selectedBatch ? corrections.filter(c => c.ingredient_batch_id === selectedBatch.id) : []

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Partie składników</div><div className="page-sub">Dostęp: Admin, Technolog</div></div>
        <div className="flex">
          <input className="search" placeholder="Szukaj partii..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:220 }} />
          <button className="btn btn-primary btn-sm" onClick={() => { setForm(EMPTY_BATCH); setError(''); setModal(true) }}>+ Przyjęcie dostawy</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Partii na stanie</div><div className="stat-val">{stats.total}</div></div>
        <div className="stat-card"><div className="stat-label">Wygasa w 30 dni</div><div className="stat-val" style={{ color:'#BA7517' }}>{stats.expiringSoon}</div></div>
        <div className="stat-card"><div className="stat-label">Wstrzymane</div><div className="stat-val" style={{ color:'#A32D2D' }}>{stats.blocked}</div></div>
        <div className="stat-card"><div className="stat-label">Łącznie (t)</div><div className="stat-val">{stats.totalTons}</div></div>
      </div>

      <div className="card-0" style={{ overflowX:'auto' }}>
        <table style={{ minWidth:900 }}>
          <thead><tr>
            <th>Kod</th><th>Nazwa</th><th>Nr partii dostawy</th>
            <th>Data prod.</th><th>Ważny do</th><th>Data przyj.</th>
            <th>Ilość (kg)</th><th>Faktura</th><th>Status</th><th>Akcja</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} style={{ textAlign:'center', padding:'24px', color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(b => {
              const eff = effectiveQty(b)
              const corrs = corrections.filter(c => c.ingredient_batch_id === b.id)
              const hasCorr = corrs.length > 0
              const isExpiring = b.expiry_date && (new Date(b.expiry_date) - new Date()) < 30*24*3600*1000 && new Date(b.expiry_date) > new Date()
              return (
                <>
                <tr key={b.id} style={{ background: hasCorr ? '#FAEEDA22' : undefined }}>
                  <td><span className="lot">{b.ingredients?.code}</span></td>
                  <td style={{ fontWeight:500 }}>{b.ingredients?.name}</td>
                  <td><span className="lot">{b.delivery_lot}</span>{hasCorr && <span className="badge b-warn" style={{ marginLeft:4, fontSize:10 }}>korekta</span>}</td>
                  <td className="muted">{b.production_date || '—'}</td>
                  <td className="muted" style={{ color: isExpiring ? '#BA7517' : undefined }}>{b.expiry_date || '—'}</td>
                  <td className="muted">{b.received_date}</td>
                  <td style={{ fontWeight:500, textAlign:'right' }}>
                    {hasCorr ? <><span style={{ textDecoration:'line-through', color:'#888', marginRight:4 }}>{b.quantity_kg}</span><b>{eff.toFixed(2)}</b></> : b.quantity_kg}
                  </td>
                  <td className="muted">{b.invoice_number || '—'}</td>
                  <td><span className={`badge ${b.status==='dopuszczona'?'b-ok':b.status==='wstrzymana'?'b-err':'b-warn'}`}>{b.status}</span></td>
                  <td><button className="btn btn-sm btn-warn" onClick={() => openCorr(b)}>Korekta</button></td>
                </tr>
                {corrs.map(c => (
                  <tr key={c.id} style={{ background:'#F9F8F5', fontSize:11 }}>
                    <td colSpan={2} style={{ paddingLeft:24, color:'#888' }}>{CORR_LABELS[c.correction_type]}</td>
                    <td colSpan={4} style={{ color:'#888' }}>{c.reason}</td>
                    <td><span className={`badge ${c.delta_kg < 0 ? 'b-err':'b-ok'}`} style={{ fontSize:10 }}>{c.delta_kg > 0 ? '+':''}{c.delta_kg} kg</span></td>
                    <td className="muted">{c.event_date}</td>
                    <td colSpan={2}></td>
                  </tr>
                ))}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal nowa partia */}
      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal">
          <div className="modal-title">Przyjęcie dostawy — nowa partia</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Składnik</label>
              <select value={form.ingredient_id} onChange={e => f('ingredient_id', e.target.value)}>
                <option value="">— wybierz —</option>
                {ingredients.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
              </select>
            </div>
            <div><label>Nr partii dostawy / atestu</label><input value={form.delivery_lot} onChange={e => f('delivery_lot',e.target.value)} placeholder="AT-2025-XXXX" /></div>
          </div>
          <div className="fr">
            <div><label>Nr faktury</label><input value={form.invoice_number} onChange={e => f('invoice_number',e.target.value)} placeholder="FV/2025/XXXX" /></div>
            <div><label>Lokalizacja magazynowa</label><input value={form.warehouse_location} onChange={e => f('warehouse_location',e.target.value)} placeholder="np. A-12-3" /></div>
          </div>
          <div className="fr3">
            <div><label>Data produkcji</label><input type="date" value={form.production_date} onChange={e => f('production_date',e.target.value)} /></div>
            <div><label>Data ważności</label><input type="date" value={form.expiry_date} onChange={e => f('expiry_date',e.target.value)} /></div>
            <div><label>Data przyjęcia</label><input type="date" value={form.received_date} onChange={e => f('received_date',e.target.value)} /></div>
          </div>
          <div className="fr">
            <div><label>Ilość (kg)</label><input type="number" step="0.001" value={form.quantity_kg} onChange={e => f('quantity_kg',e.target.value)} /></div>
            <div><label>Status partii</label>
              <select value={form.status} onChange={e => f('status',e.target.value)}>
                <option value="dopuszczona">Dopuszczona</option>
                <option value="wstrzymana">Wstrzymana</option>
                <option value="kwarantanna">Kwarantanna</option>
              </select>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={saveBatch} disabled={saving}>{saving?'Zapisywanie...':'Zapisz partię'}</button>
          </div>
        </div>
      </div>

      {/* Modal korekta */}
      <div className={`modal-overlay ${corrModal?'open':''}`} onClick={e => e.target===e.currentTarget && setCorrModal(false)}>
        <div className="modal">
          <div className="modal-title">Korekta stanu magazynowego</div>
          {selectedBatch && (
            <div style={{ background:'#F1EFE8', borderRadius:8, padding:10, marginBottom:12, fontSize:13 }}>
              <b>{selectedBatch.ingredients?.code}</b> — {selectedBatch.ingredients?.name} &nbsp;|&nbsp;
              Partia: <span className="lot">{selectedBatch.delivery_lot}</span> &nbsp;|&nbsp;
              Stan aktualny: <b>{effectiveQty(selectedBatch).toFixed(2)} kg</b>
            </div>
          )}
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Typ korekty</label>
              <select value={corrForm.correction_type} onChange={e => cf('correction_type',e.target.value)}>
                {Object.entries(CORR_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {corrForm.correction_type !== 'utylizacja_pelna' && (
              <div><label>Korekta ilości (kg) — ujemna = ubytek</label>
                <input type="number" step="0.001" value={corrForm.delta_kg} onChange={e => cf('delta_kg',e.target.value)} placeholder="np. -50 lub +20" />
              </div>
            )}
          </div>
          {corrForm.correction_type === 'utylizacja_pelna' && (
            <div className="warn-box">Utylizacja pełna — partia zostanie wstrzymana i wykluczona z FIFO. Zmiana nieodwracalna.</div>
          )}
          <div style={{ marginBottom:10 }}><label>Przyczyna / komentarz (wymagane)</label>
            <input value={corrForm.reason} onChange={e => cf('reason',e.target.value)} placeholder="np. opakowanie uszkodzone podczas rozładunku" />
          </div>
          <div><label>Data zdarzenia</label><input type="date" value={corrForm.event_date} onChange={e => cf('event_date',e.target.value)} /></div>
          {batchCorrections.length > 0 && (
            <div style={{ marginTop:12 }}>
              <div style={{ fontSize:12, fontWeight:500, marginBottom:6 }}>Historia korekt tej partii</div>
              {batchCorrections.map(c => (
                <div key={c.id} style={{ fontSize:12, color:'#5F5E5A', padding:'4px 0', borderBottom:'0.5px solid #D3D1C7' }}>
                  <b>{CORR_LABELS[c.correction_type]}</b>: {c.reason} &nbsp;
                  <span className={`badge ${c.delta_kg<0?'b-err':'b-ok'}`} style={{ fontSize:10 }}>{c.delta_kg>0?'+':''}{c.delta_kg} kg</span>
                  &nbsp;<span className="muted">{c.event_date}</span>
                </div>
              ))}
            </div>
          )}
          <div className="modal-footer">
            <button className="btn" onClick={() => setCorrModal(false)}>Anuluj</button>
            <button className="btn btn-danger" onClick={saveCorrection} disabled={saving}>{saving?'Zapisywanie...':'Zapisz korektę'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
