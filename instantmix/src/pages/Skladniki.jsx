import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const EMPTY = { code:'', name:'', producer:'', supplier:'', country_of_origin:'', has_allergen:false, allergen_type:'', gmo:false, spec_number:'', spec_approved_at:'', status:'aktywny' }

export default function Skladniki() {
  const { profile } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('ingredients').select('*').order('code')
    setRows(data || [])
    setLoading(false)
  }

  const filtered = rows.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.code.toLowerCase().includes(search.toLowerCase())
  )

  function openNew() { setForm(EMPTY); setError(''); setModal(true) }
  function openEdit(r) { setForm({ ...r, spec_approved_at: r.spec_approved_at || '' }); setError(''); setModal(true) }

  async function save() {
    if (!form.code || !form.name) { setError('Kod i nazwa są wymagane'); return }
    setSaving(true); setError('')
    const payload = { ...form, updated_at: new Date().toISOString() }
    let err
    if (form.id) {
      ;({ error: err } = await supabase.from('ingredients').update(payload).eq('id', form.id))
    } else {
      ;({ error: err } = await supabase.from('ingredients').insert({ ...payload, created_by: profile?.id }))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    setModal(false); load()
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Składniki</div>
          <div className="page-sub">Dostęp: Admin</div>
        </div>
        <div className="flex">
          <input className="search" placeholder="Szukaj składnika..." value={search} onChange={e => setSearch(e.target.value)} style={{ width:220 }} />
          <button className="btn btn-primary btn-sm" onClick={openNew}>+ Nowy składnik</button>
        </div>
      </div>

      <div className="card-0">
        <table>
          <thead><tr>
            <th>Kod</th><th>Nazwa</th><th>Producent</th><th>Kraj</th>
            <th>Alergen</th><th>GMO</th><th>Nr spec.</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ textAlign:'center', padding:'24px', color:'#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(r => (
              <tr key={r.id}>
                <td><span className="lot">{r.code}</span></td>
                <td style={{ fontWeight:500 }}>{r.name}</td>
                <td className="muted">{r.producer || '—'}</td>
                <td className="muted">{r.country_of_origin || '—'}</td>
                <td>{r.has_allergen ? <span className="badge b-err">{r.allergen_type}</span> : <span className="badge b-ok">Brak</span>}</td>
                <td>{r.gmo ? <span className="badge b-warn">TAK</span> : <span className="badge b-ok">NIE</span>}</td>
                <td className="muted">{r.spec_number || '—'}</td>
                <td><span className={`badge ${r.status==='aktywny'?'b-ok':r.status==='wstrzymany'?'b-err':'b-gray'}`}>{r.status}</span></td>
                <td><button className="btn btn-sm" onClick={() => openEdit(r)}>Edytuj</button></td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign:'center', padding:'24px', color:'#888' }}>Brak wyników</td></tr>}
          </tbody>
        </table>
      </div>

      <div className={`modal-overlay ${modal ? 'open' : ''}`} onClick={e => e.target === e.currentTarget && setModal(false)}>
        <div className="modal">
          <div className="modal-title">{form.id ? 'Edytuj składnik' : 'Nowy składnik'}</div>
          {error && <div className="err-box">{error}</div>}
          <div className="fr">
            <div><label>Kod składnika</label><input value={form.code} onChange={e => f('code', e.target.value)} placeholder="SKL-XXX" /></div>
            <div><label>Nazwa składnika</label><input value={form.name} onChange={e => f('name', e.target.value)} placeholder="np. Marchew w proszku" /></div>
          </div>
          <div className="fr">
            <div><label>Producent</label><input value={form.producer} onChange={e => f('producer', e.target.value)} /></div>
            <div><label>Dostawca</label><input value={form.supplier} onChange={e => f('supplier', e.target.value)} /></div>
          </div>
          <div className="fr3">
            <div><label>Kraj pochodzenia</label><input value={form.country_of_origin} onChange={e => f('country_of_origin', e.target.value)} placeholder="PL" /></div>
            <div><label>Alergen</label>
              <select value={form.has_allergen ? 'tak' : 'nie'} onChange={e => f('has_allergen', e.target.value === 'tak')}>
                <option value="nie">NIE</option><option value="tak">TAK</option>
              </select>
            </div>
            <div><label>GMO</label>
              <select value={form.gmo ? 'tak' : 'nie'} onChange={e => f('gmo', e.target.value === 'tak')}>
                <option value="nie">NIE</option><option value="tak">TAK</option>
              </select>
            </div>
          </div>
          {form.has_allergen && (
            <div style={{ marginBottom:10 }}><label>Typ alergenu</label><input value={form.allergen_type} onChange={e => f('allergen_type', e.target.value)} placeholder="np. Gluten, Mleko, Orzechy" /></div>
          )}
          <div className="fr">
            <div><label>Nr specyfikacji</label><input value={form.spec_number} onChange={e => f('spec_number', e.target.value)} placeholder="SPEC-2025-XXX" /></div>
            <div><label>Data zatwierdzenia spec.</label><input type="date" value={form.spec_approved_at} onChange={e => f('spec_approved_at', e.target.value)} /></div>
          </div>
          <div><label>Status</label>
            <select value={form.status} onChange={e => f('status', e.target.value)}>
              <option value="aktywny">Aktywny</option>
              <option value="wstrzymany">Wstrzymany</option>
              <option value="zarchiwizowany">Zarchiwizowany</option>
            </select>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Zapisywanie...' : 'Zapisz'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
