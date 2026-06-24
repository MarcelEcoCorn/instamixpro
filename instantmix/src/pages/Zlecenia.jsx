import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const STATUS_LABELS = {
  nowe: 'Nowe',
  w_realizacji: 'W realizacji',
  zrealizowane: 'Zrealizowane',
  wyslane: 'Wydane do klienta',
  anulowane: 'Anulowane'
}
const STATUS_COLORS = {
  nowe: 'b-info',
  w_realizacji: 'b-warn',
  zrealizowane: 'b-ok',
  wyslane: 'b-purple',
  anulowane: 'b-gray'
}

const EMPTY_FORM = {
  client_id:'', client:'', recipe_id:'',
  pallets:'', bags_per_pallet:'', bag_weight_kg:'',
  quantity_kg:'', ship_date:'', status:'nowe', notes:''
}

// Przeliczenie wagi do produkcji: palety × worki/paleta × waga worka
function computeKg(form) {
  const p = parseFloat(form.pallets) || 0
  const b = parseFloat(form.bags_per_pallet) || 0
  const w = parseFloat(form.bag_weight_kg) || 0
  return p * b * w
}

export default function Zlecenia() {
  const { profile } = useAuth()
  const isSprzedaz = profile?.role === 'sprzedaz'
  const canEdit = ['admin','technolog','sprzedaz'].includes(profile?.role)
  const canDelete = ['admin','technolog'].includes(profile?.role)

  const [orders, setOrders] = useState([])
  const [recipes, setRecipes] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('aktywne')

  const [modal, setModal] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(new Date())

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  async function load() {
    setLoading(true)
    const [{ data: o }, { data: r }, { data: c }] = await Promise.all([
      supabase.from('orders').select('*, recipes(code, name, version, production_line), production_batches(lot_number)').order('ship_date', { ascending: true }),
      supabase.from('recipes').select('id,code,name,version,client,client_id').eq('status','dopuszczona').order('client,code'),
      supabase.from('clients').select('id,number,name,status,is_sample').eq('status','aktywny').order('name')
    ])
    setOrders(o || [])
    setRecipes(r || [])
    setClients(c || [])
    setLoading(false)
    setLastUpdated(new Date())
  }

  const filtered = orders.filter(o => {
    const q = search.toLowerCase()
    const matchQ = !q || o.order_number.toLowerCase().includes(q) || (o.client||'').toLowerCase().includes(q) || (o.recipes?.name||'').toLowerCase().includes(q)
    const matchStatus = filterStatus === 'wszystkie' ? true :
      filterStatus === 'aktywne' ? ['nowe','w_realizacji'].includes(o.status) : o.status === filterStatus
    return matchQ && matchStatus
  })

  const stats = {
    nowe: orders.filter(o => o.status==='nowe').length,
    w_realizacji: orders.filter(o => o.status==='w_realizacji').length,
    zrealizowane: orders.filter(o => o.status==='zrealizowane').length,
    pilne: orders.filter(o => ['nowe','w_realizacji'].includes(o.status) && new Date(o.ship_date) <= new Date(Date.now()+7*24*3600*1000)).length
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // wybór klienta z listy → ustaw client_id + nazwę
  function pickClient(id) {
    const c = clients.find(x => x.id === id)
    setForm(p => ({ ...p, client_id: id, client: c ? c.name : '' }))
  }

  function openNew() { setForm(EMPTY_FORM); setEditMode(false); setError(''); setModal(true) }

  function openEdit(order) {
    setForm({
      id:order.id, client_id:order.client_id||'', client:order.client||'', recipe_id:order.recipe_id,
      pallets:order.pallets??'', bags_per_pallet:order.bags_per_pallet??'', bag_weight_kg:order.bag_weight_kg??'',
      quantity_kg:order.quantity_kg, ship_date:order.ship_date, status:order.status, notes:order.notes||''
    })
    setEditMode(true); setError(''); setModal(true)
  }

  async function generateOrderNumber() {
    const year = new Date().getFullYear()
    const { data } = await supabase.from('orders').select('order_number').ilike('order_number', `ZL-${year}-%`).order('order_number', { ascending: false }).limit(1)
    if (data && data.length > 0) {
      const last = parseInt(data[0].order_number.split('-')[2]) || 0
      return `ZL-${year}-${String(last+1).padStart(4,'0')}`
    }
    return `ZL-${year}-0001`
  }

  async function save() {
    if (!form.client) { setError('Wybierz klienta'); return }
    if (!form.recipe_id) { setError('Wybierz recepturę'); return }
    const computed = computeKg(form)
    const finalKg = computed > 0 ? computed : (parseFloat(form.quantity_kg) || 0)
    if (!finalKg || finalKg <= 0) { setError('Podaj sposób pakowania lub ilość ręczną'); return }
    if (!form.ship_date) { setError('Data wysyłki jest wymagana'); return }
    setSaving(true); setError('')

    const payload = {
      client_id: form.client_id || null,
      client: form.client,
      recipe_id: form.recipe_id,
      pallets: form.pallets === '' ? null : parseInt(form.pallets),
      bags_per_pallet: form.bags_per_pallet === '' ? null : parseInt(form.bags_per_pallet),
      bag_weight_kg: form.bag_weight_kg === '' ? null : parseFloat(form.bag_weight_kg),
      quantity_kg: finalKg,
      ship_date: form.ship_date,
      status: form.status,
      notes: form.notes || null
    }

    if (editMode) {
      const { error: err } = await supabase.from('orders').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', form.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const orderNumber = await generateOrderNumber()
      const { error: err } = await supabase.from('orders').insert({ ...payload, order_number: orderNumber, created_by: profile?.id })
      if (err) { setError(err.message); setSaving(false); return }
    }
    setSaving(false); setModal(false); load()
  }

  async function quickStatus(order, newStatus) {
    await supabase.from('orders').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', order.id)
    load()
  }

  async function deleteOrder(order) {
    await supabase.from('orders').delete().eq('id', order.id)
    setConfirmDelete(null); load()
  }

  function daysUntil(dateStr) {
    return Math.ceil((new Date(dateStr) - new Date()) / (1000*60*60*24))
  }

  function shipDateBadge(order) {
    if (['zrealizowane','wyslane','anulowane'].includes(order.status)) return null
    const days = daysUntil(order.ship_date)
    if (days < 0) return <span className="badge b-err" style={{ fontSize:10, marginLeft:6 }}>Przeterminowane</span>
    if (days === 0) return <span className="badge b-err" style={{ fontSize:10, marginLeft:6 }}>Dziś!</span>
    if (days <= 3) return <span className="badge b-err" style={{ fontSize:10, marginLeft:6 }}>{days}d</span>
    if (days <= 7) return <span className="badge b-warn" style={{ fontSize:10, marginLeft:6 }}>{days}d</span>
    return null
  }

  const computedKg = computeKg(form)

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Zlecenia produkcyjne</div><div className="page-sub">Dostęp: Admin, Technolog, Sprzedaż</div></div>
        <div className="flex" style={{ gap:8, alignItems:'center' }}>
          <span style={{ fontSize:11, color:'#085041', background:'#E1F5EE', padding:'2px 8px', borderRadius:999, display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:'#1D9E75', display:'inline-block', animation:'pulse 2s infinite' }} />
            LIVE · {lastUpdated.toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
          </span>
          <input className="search" placeholder="Szukaj zlecenia, klienta..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:220 }} />
          <button className="btn btn-sm" onClick={load}>↻</button>
          {canEdit && <button className="btn btn-primary btn-sm" onClick={openNew}>+ Nowe zlecenie</button>}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Nowe</div><div className="stat-val" style={{ color:'#0C447C' }}>{stats.nowe}</div></div>
        <div className="stat-card"><div className="stat-label">W realizacji</div><div className="stat-val" style={{ color:'#BA7517' }}>{stats.w_realizacji}</div></div>
        <div className="stat-card"><div className="stat-label">Zrealizowane</div><div className="stat-val" style={{ color:'#085041' }}>{stats.zrealizowane}</div></div>
        <div className="stat-card"><div className="stat-label">Pilne (≤7 dni)</div><div className="stat-val" style={{ color:'#A32D2D' }}>{stats.pilne}</div></div>
      </div>

      <div className="flex" style={{ marginBottom:10, gap:6, flexWrap:'wrap' }}>
        {['aktywne','wszystkie','nowe','w_realizacji','zrealizowane','wyslane','anulowane'].map(s => (
          <button key={s} className="btn btn-sm" onClick={() => setFilterStatus(s)}
            style={{ background:filterStatus===s?'#1D9E75':undefined, color:filterStatus===s?'#fff':undefined, borderColor:filterStatus===s?'#1D9E75':undefined }}>
            {s==='aktywne'?'Aktywne':s==='wszystkie'?'Wszystkie':STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div style={{ background:'#fff', border:'0.5px solid #D3D1C7', borderRadius:8, overflowX:'auto', overflowY:'auto', maxHeight:'calc(100vh - 300px)' }}>
        <table style={{ minWidth:860 }}>
          <thead style={{ position:'sticky', top:0, zIndex:10, background:'#fff' }}><tr>
            <th>Nr zlecenia</th><th>Klient</th><th>Receptura</th><th>Ilość (kg)</th>
            <th>Data wysyłki</th><th>Partia prod.</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ textAlign:'center', padding:24, color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(o => (
              <tr key={o.id} style={{ background: daysUntil(o.ship_date) < 0 && ['nowe','w_realizacji'].includes(o.status) ? '#FCEBEB55' : undefined }}>
                <td><span className="lot">{o.order_number}</span></td>
                <td style={{ fontWeight:500 }}>{o.client}</td>
                <td>
                  <div style={{ fontWeight:500, fontSize:13 }}>{o.recipes?.name}</div>
                  <div className="muted" style={{ fontSize:11 }}>{o.recipes?.code} · {o.recipes?.version}</div>
                </td>
                <td style={{ textAlign:'right' }}>
                  <div style={{ fontWeight:500 }}>{parseFloat(o.quantity_kg).toLocaleString('pl-PL')} kg</div>
                  {o.pallets && o.bags_per_pallet && o.bag_weight_kg
                    ? <div className="muted" style={{ fontSize:10 }}>{o.pallets} pal × {o.bags_per_pallet} × {parseFloat(o.bag_weight_kg).toLocaleString('pl-PL')} kg</div>
                    : null}
                </td>
                <td>
                  <span className="muted">{o.ship_date}</span>
                  {shipDateBadge(o)}
                </td>
                <td>
                  {o.production_batches
                    ? <span className="lot">{o.production_batches.lot_number}</span>
                    : <span className="muted">—</span>}
                </td>
                <td>
                  {canEdit && !isSprzedaz ? (
                    <select value={o.status} onChange={e => quickStatus(o, e.target.value)}
                      style={{ fontSize:11, padding:'2px 6px', border:'0.5px solid #D3D1C7', borderRadius:6, cursor:'pointer',
                        background: o.status==='nowe'?'#E6F1FB':o.status==='w_realizacji'?'#FAEEDA':o.status==='zrealizowane'?'#E1F5EE':o.status==='wyslane'?'#EEEDFE':'#F1EFE8',
                        color: o.status==='nowe'?'#0C447C':o.status==='w_realizacji'?'#633806':o.status==='zrealizowane'?'#085041':o.status==='wyslane'?'#3C3489':'#888'
                      }}>
                      {Object.entries(STATUS_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : (
                    <span className={`badge ${STATUS_COLORS[o.status]}`}>{STATUS_LABELS[o.status]}</span>
                  )}
                </td>
                <td>
                  {canEdit && (
                    <div className="flex" style={{ gap:4 }}>
                      <button className="btn btn-sm" onClick={() => openEdit(o)}>Edytuj</button>
                      {canDelete && <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(o)}>Usuń</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!loading && filtered.length===0 && <tr><td colSpan={8} style={{ textAlign:'center', padding:24, color:'#888' }}>Brak zleceń</td></tr>}
          </tbody>
        </table>
      </div>

      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal">
          <div className="modal-title">{editMode?'Edytuj zlecenie':'Nowe zlecenie produkcyjne'}</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div>
              <label>Klient *</label>
              <select value={form.client_id} onChange={e => pickClient(e.target.value)}>
                <option value="">— wybierz klienta —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.number ? c.number + ' — ' : ''}{c.name}</option>)}
                {form.client && !form.client_id &&
                  <option value="" disabled>(obecnie: {form.client})</option>}
              </select>
            </div>
            <div><label>Data wysyłki *</label><input type="date" value={form.ship_date} onChange={e => f('ship_date',e.target.value)} /></div>
          </div>
          <div style={{ marginBottom:10 }}>
            <label>Receptura *</label>
            <select value={form.recipe_id} onChange={e => {
              f('recipe_id', e.target.value)
              const r = recipes.find(x=>x.id===e.target.value)
              if (r && !form.client_id) {
                if (r.client_id && clients.some(c=>c.id===r.client_id)) pickClient(r.client_id)
                else if (r.client) f('client', r.client)
              }
            }}>
              <option value="">— wybierz recepturę —</option>
              {recipes.map(r => <option key={r.id} value={r.id}>{r.client ? r.client + ' › ' : ''}{r.code} › {r.name} ({r.version})</option>)}
            </select>
          </div>

          <div style={{ background:'#F7F6F1', border:'0.5px solid #E3E1D8', borderRadius:8, padding:'10px 12px', marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'#085041', marginBottom:8 }}>Sposób pakowania</div>
            <div className="fr" style={{ marginBottom:0 }}>
              <div><label>Palety</label><input type="number" min="0" step="1" value={form.pallets} onChange={e => f('pallets',e.target.value)} placeholder="np. 4" /></div>
              <div><label>Worków na palecie</label><input type="number" min="0" step="1" value={form.bags_per_pallet} onChange={e => f('bags_per_pallet',e.target.value)} placeholder="np. 40" /></div>
              <div><label>Waga 1 worka (kg)</label><input type="number" min="0" step="0.001" value={form.bag_weight_kg} onChange={e => f('bag_weight_kg',e.target.value)} placeholder="np. 25" /></div>
            </div>
            <div style={{ marginTop:8, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:12, color:'#5b5b53' }}>Waga do wyprodukowania:</span>
              <span style={{ fontSize:16, fontWeight:700, color:'#085041' }}>
                {computedKg > 0 ? computedKg.toLocaleString('pl-PL') + ' kg' : '—'}
              </span>
            </div>
          </div>

          <div className="fr">
            {computedKg <= 0 && (
              <div><label>Ilość ręczna (kg)</label><input type="number" step="0.001" value={form.quantity_kg} onChange={e => f('quantity_kg',e.target.value)} placeholder="gdy bez pakowania" /></div>
            )}
            <div><label>Status</label>
              <select value={form.status} onChange={e => f('status',e.target.value)}>
                {Object.entries(STATUS_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div><label>Uwagi</label><input value={form.notes} onChange={e => f('notes',e.target.value)} placeholder="opcjonalne" /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Zapisywanie...':editMode?'Zapisz zmiany':'Utwórz zlecenie'}</button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${confirmDelete?'open':''}`} onClick={e => e.target===e.currentTarget && setConfirmDelete(null)}>
        <div className="modal" style={{ maxWidth:420 }}>
          <div className="modal-title">Usuń zlecenie</div>
          <div className="warn-box">Czy na pewno chcesz usunąć zlecenie <b>{confirmDelete?.order_number}</b> dla klienta <b>{confirmDelete?.client}</b>?</div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirmDelete(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteOrder(confirmDelete)}>Tak, usuń</button>
          </div>
        </div>
      </div>
    </div>
  )
}
