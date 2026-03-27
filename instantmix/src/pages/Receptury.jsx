import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const EMPTY_FORM = {
  code: '', name: '', version: 'v1', status: 'w_przegladzie',
  production_line: 'zwykla', approved_at: '', notes: '', clients: ''
}

export default function Receptury() {
  const { profile } = useAuth()
  const role = profile?.role
  const canEdit = ['admin', 'technolog'].includes(role)

  const [recipes, setRecipes] = useState([])
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)
  const [modal, setModal] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [items, setItems] = useState([{ ingredient_id: '', percentage: '' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: r }, { data: i }] = await Promise.all([
      supabase.from('recipes').select('*, recipe_items(*, ingredients(*))').order('code'),
      supabase.from('ingredients').select('id,code,name,has_allergen,allergen_type').eq('status', 'aktywny').order('code')
    ])
    setRecipes(r || [])
    setIngredients(i || [])
    setLoading(false)
  }

  const filtered = recipes.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.code.toLowerCase().includes(search.toLowerCase()) ||
    (r.clients || '').toLowerCase().includes(search.toLowerCase())
  )

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  function openNew() {
    setEditMode(false)
    setForm(EMPTY_FORM)
    setItems([{ ingredient_id: '', percentage: '' }])
    setError('')
    setModal(true)
  }

  function openEdit(recipe) {
    setEditMode(true)
    setForm({
      id: recipe.id,
      code: recipe.code,
      name: recipe.name,
      version: recipe.version,
      status: recipe.status,
      production_line: recipe.production_line,
      approved_at: recipe.approved_at || '',
      notes: recipe.notes || '',
      clients: recipe.clients || ''
    })
    const sorted = (recipe.recipe_items || []).sort((a, b) => a.sort_order - b.sort_order)
    setItems(sorted.length > 0
      ? sorted.map(it => ({ id: it.id, ingredient_id: it.ingredient_id, percentage: it.percentage }))
      : [{ ingredient_id: '', percentage: '' }]
    )
    setError('')
    setModal(true)
  }

  function addItem() { setItems(p => [...p, { ingredient_id: '', percentage: '' }]) }
  function removeItem(i) { setItems(p => p.filter((_, idx) => idx !== i)) }
  function updateItem(i, k, v) { setItems(p => p.map((it, idx) => idx === i ? { ...it, [k]: v } : it)) }

  const totalPct = items.reduce((s, it) => s + (parseFloat(it.percentage) || 0), 0)
  const pctOk = Math.abs(totalPct - 100) < 0.01

  async function save() {
    if (!form.code || !form.name) { setError('Kod i nazwa są wymagane'); return }
    if (!pctOk) { setError(`Suma udziałów musi wynosić 100% (aktualnie: ${totalPct.toFixed(3)}%)`); return }
    const validItems = items.filter(it => it.ingredient_id && it.percentage)
    if (validItems.length === 0) { setError('Dodaj co najmniej jeden składnik'); return }
    setSaving(true); setError('')

    const payload = {
      code: form.code, name: form.name, version: form.version,
      status: form.status, production_line: form.production_line,
      approved_at: form.approved_at || null, notes: form.notes || null,
      clients: form.clients || null,
      approved_by: profile?.id, updated_at: new Date().toISOString()
    }

    let recipeId = form.id
    if (editMode) {
      const { error: err } = await supabase.from('recipes').update(payload).eq('id', form.id)
      if (err) { setError(err.message); setSaving(false); return }
      // Usuń stare pozycje i wstaw nowe
      await supabase.from('recipe_items').delete().eq('recipe_id', form.id)
    } else {
      const { data: rec, error: err } = await supabase.from('recipes').insert(payload).select().single()
      if (err) { setError(err.message); setSaving(false); return }
      recipeId = rec.id
    }

    const { error: itemsErr } = await supabase.from('recipe_items').insert(
      validItems.map((it, idx) => ({
        recipe_id: recipeId,
        ingredient_id: it.ingredient_id,
        percentage: parseFloat(it.percentage),
        sort_order: idx
      }))
    )
    if (itemsErr) { setError(itemsErr.message); setSaving(false); return }

    setSaving(false)
    setModal(false)
    setDetail(null)
    load()
  }

  async function quickStatusChange(recipe, newStatus) {
    await supabase.from('recipes').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', recipe.id)
    load()
    if (detail?.id === recipe.id) setDetail(p => ({ ...p, status: newStatus }))
  }

  async function deleteRecipe(recipe) {
    // recipe_items usuną się kaskadowo (on delete cascade)
    await supabase.from('recipes').delete().eq('id', recipe.id)
    setConfirmDelete(null)
    setDetail(null)
    load()
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Receptury</div>
          <div className="page-sub">Dostęp: Admin, Technolog</div>
        </div>
        <div className="flex">
          <input className="search" placeholder="Szukaj receptury lub klienta..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} />
          {canEdit && <button className="btn btn-primary btn-sm" onClick={openNew}>+ Nowa receptura</button>}
        </div>
      </div>

      <div className="card-0">
        <table>
          <thead><tr>
            <th>Kod</th><th>Nazwa mieszanki</th><th>Wersja</th><th>Linia</th>
            <th>Klienci</th><th>Skł.</th><th>Status</th><th>Data zatw.</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 24, color: '#888' }}>Ładowanie...</td></tr>}
            {!loading && filtered.map(r => (
              <tr key={r.id}>
                <td><span className="lot">{r.code}</span></td>
                <td style={{ fontWeight: 500 }}>{r.name}</td>
                <td><span className="badge b-info">{r.version}</span></td>
                <td><span className={`badge ${r.production_line === 'bezglutenowa' ? 'b-purple' : 'b-gray'}`}>{r.production_line}</span></td>
                <td style={{ fontSize: 12, color: '#5F5E5A', maxWidth: 160 }}>
                  {r.clients
                    ? r.clients.split(',').map(c => c.trim()).filter(Boolean).map(c => (
                        <span key={c} style={{ display: 'inline-block', background: '#E6F1FB', color: '#0C447C', padding: '1px 6px', borderRadius: 999, fontSize: 11, marginRight: 3, marginBottom: 2 }}>{c}</span>
                      ))
                    : <span className="muted">—</span>
                  }
                </td>
                <td>{r.recipe_items?.length || 0}</td>
                <td>
                  {canEdit ? (
                    <select
                      value={r.status}
                      onChange={e => quickStatusChange(r, e.target.value)}
                      style={{ fontSize: 11, padding: '2px 6px', border: '0.5px solid #D3D1C7', borderRadius: 6, background: r.status === 'dopuszczona' ? '#E1F5EE' : r.status === 'w_przegladzie' ? '#FAEEDA' : '#F1EFE8', color: r.status === 'dopuszczona' ? '#085041' : r.status === 'w_przegladzie' ? '#633806' : '#444441', cursor: 'pointer' }}
                    >
                      <option value="dopuszczona">Dopuszczona</option>
                      <option value="w_przegladzie">W przeglądzie</option>
                      <option value="zarchiwizowana">Zarchiwizowana</option>
                    </select>
                  ) : (
                    <span className={`badge ${r.status === 'dopuszczona' ? 'b-ok' : r.status === 'w_przegladzie' ? 'b-warn' : 'b-gray'}`}>{r.status}</span>
                  )}
                </td>
                <td className="muted">{r.approved_at || '—'}</td>
                <td>
                  <div className="flex" style={{ gap: 4 }}>
                    <button className="btn btn-sm" onClick={() => setDetail(detail?.id === r.id ? null : r)}>Szczegóły</button>
                    {canEdit && <button className="btn btn-sm" onClick={() => openEdit(r)}>Edytuj</button>}
                    {canEdit && <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(r)}>Usuń</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 24, color: '#888' }}>Brak wyników</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Szczegół receptury */}
      {detail && (
        <div className="card" style={{ borderLeft: '3px solid #1D9E75' }}>
          <div className="flex" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
            <span className="lot">{detail.code}</span>
            <span style={{ fontWeight: 500, fontSize: 15 }}>{detail.name}</span>
            <span className="badge b-info">{detail.version}</span>
            <span className={`badge ${detail.production_line === 'bezglutenowa' ? 'b-purple' : 'b-gray'}`}>{detail.production_line}</span>
            <span className={`badge ${detail.status === 'dopuszczona' ? 'b-ok' : detail.status === 'w_przegladzie' ? 'b-warn' : 'b-gray'}`}>{detail.status}</span>
            {canEdit && (
              <>
                <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => openEdit(detail)}>Edytuj recepturę</button>
                <button className="btn btn-sm" onClick={() => setDetail(null)}>Zamknij</button>
              </>
            )}
            {!canEdit && <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setDetail(null)}>Zamknij</button>}
          </div>

          {detail.clients && (
            <div style={{ marginBottom: 10 }}>
              <span className="muted" style={{ marginRight: 8 }}>Klienci:</span>
              {detail.clients.split(',').map(c => c.trim()).filter(Boolean).map(c => (
                <span key={c} style={{ display: 'inline-block', background: '#E6F1FB', color: '#0C447C', padding: '2px 8px', borderRadius: 999, fontSize: 12, marginRight: 4 }}>{c}</span>
              ))}
            </div>
          )}
          {detail.notes && <div className="muted" style={{ marginBottom: 10 }}>Uwagi: {detail.notes}</div>}

          <div className="card-0">
            <table>
              <thead><tr><th>Kod skł.</th><th>Nazwa składnika</th><th>Udział %</th><th>Na 100 kg</th><th>Alergen</th></tr></thead>
              <tbody>
                {(detail.recipe_items || []).sort((a, b) => a.sort_order - b.sort_order).map(it => (
                  <tr key={it.id}>
                    <td><span className="lot">{it.ingredients?.code}</span></td>
                    <td>{it.ingredients?.name}</td>
                    <td style={{ fontWeight: 500 }}>{parseFloat(it.percentage).toFixed(3)}%</td>
                    <td>{parseFloat(it.percentage).toFixed(3)} kg</td>
                    <td>{it.ingredients?.has_allergen ? <span className="badge b-err">{it.ingredients.allergen_type}</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
                <tr style={{ background: '#E1F5EE' }}>
                  <td colSpan={2} style={{ fontWeight: 500, textAlign: 'right' }}>SUMA</td>
                  <td style={{ fontWeight: 500 }}>{(detail.recipe_items || []).reduce((s, it) => s + parseFloat(it.percentage), 0).toFixed(3)}%</td>
                  <td style={{ fontWeight: 500 }}>100.000 kg</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal dodaj / edytuj */}
      <div className={`modal-overlay ${modal ? 'open' : ''}`} onClick={e => e.target === e.currentTarget && setModal(false)}>
        <div className="modal" style={{ maxWidth: 600 }}>
          <div className="modal-title">{editMode ? 'Edytuj recepturę' : 'Nowa receptura'}</div>
          {error && <div className="err-box">{error}</div>}

          <div className="fr">
            <div><label>Kod mieszanki</label><input value={form.code} onChange={e => f('code', e.target.value)} placeholder="MIX-XXX" /></div>
            <div><label>Nazwa mieszanki</label><input value={form.name} onChange={e => f('name', e.target.value)} /></div>
          </div>
          <div className="fr3">
            <div><label>Wersja</label><input value={form.version} onChange={e => f('version', e.target.value)} placeholder="v1" /></div>
            <div><label>Linia produkcyjna</label>
              <select value={form.production_line} onChange={e => f('production_line', e.target.value)}>
                <option value="zwykla">Zwykła</option>
                <option value="bezglutenowa">Bezglutenowa</option>
              </select>
            </div>
            <div><label>Status</label>
              <select value={form.status} onChange={e => f('status', e.target.value)}>
                <option value="w_przegladzie">W przeglądzie</option>
                <option value="dopuszczona">Dopuszczona</option>
                <option value="zarchiwizowana">Zarchiwizowana</option>
              </select>
            </div>
          </div>
          <div className="fr">
            <div><label>Data zatwierdzenia</label><input type="date" value={form.approved_at} onChange={e => f('approved_at', e.target.value)} /></div>
            <div><label>Uwagi</label><input value={form.notes} onChange={e => f('notes', e.target.value)} /></div>
          </div>

          {/* Klienci */}
          <div style={{ marginBottom: 10 }}>
            <label>Klienci (oddziel przecinkiem)</label>
            <input
              value={form.clients}
              onChange={e => f('clients', e.target.value)}
              placeholder="np. Firma ABC, Sklep XYZ, Hurtownia 123"
            />
            {form.clients && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {form.clients.split(',').map(c => c.trim()).filter(Boolean).map(c => (
                  <span key={c} style={{ background: '#E6F1FB', color: '#0C447C', padding: '2px 8px', borderRadius: 999, fontSize: 12 }}>{c}</span>
                ))}
              </div>
            )}
          </div>

          <div className="divider" />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 500, fontSize: 13 }}>Składniki receptury</span>
            <span style={{ fontSize: 12, color: pctOk ? '#085041' : '#A32D2D', fontWeight: 500 }}>
              Suma: {totalPct.toFixed(3)}% {pctOk ? '✓' : `(brakuje ${(100 - totalPct).toFixed(3)}%)`}
            </span>
          </div>

          {items.map((it, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 32px', gap: 8, marginBottom: 8, alignItems: 'end' }}>
              <div>
                {idx === 0 && <label>Składnik</label>}
                <select value={it.ingredient_id} onChange={e => updateItem(idx, 'ingredient_id', e.target.value)}>
                  <option value="">— wybierz —</option>
                  {ingredients.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
                </select>
              </div>
              <div>
                {idx === 0 && <label>Udział %</label>}
                <input type="number" step="0.001" min="0" max="100" value={it.percentage} onChange={e => updateItem(idx, 'percentage', e.target.value)} placeholder="0.000" />
              </div>
              <button className="btn btn-sm btn-danger" onClick={() => removeItem(idx)} style={{ height: 34 }}>✕</button>
            </div>
          ))}
          <button className="btn btn-sm" onClick={addItem} style={{ marginBottom: 4 }}>+ Dodaj składnik</button>

          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Zapisywanie...' : editMode ? 'Zapisz zmiany' : 'Zapisz recepturę'}
            </button>
          </div>
        </div>
      </div>

      {/* Modal potwierdzenie usunięcia */}
      <div className={`modal-overlay ${confirmDelete ? 'open' : ''}`} onClick={e => e.target === e.currentTarget && setConfirmDelete(null)}>
        <div className="modal" style={{ maxWidth: 420 }}>
          <div className="modal-title">Usuń recepturę</div>
          <div className="warn-box">
            Czy na pewno chcesz usunąć recepturę <b>{confirmDelete?.code} — {confirmDelete?.name}</b>?<br />
            Ta operacja jest nieodwracalna. Receptura zostanie usunięta razem ze wszystkimi składnikami.
          </div>
          <div style={{ fontSize: 13, color: '#5F5E5A', marginBottom: 4 }}>
            Jeśli receptura była używana w produkcji — historia produkcji pozostanie nienaruszona.
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirmDelete(null)}>Anuluj</button>
            <button className="btn btn-danger" onClick={() => deleteRecipe(confirmDelete)}>Tak, usuń recepturę</button>
          </div>
        </div>
      </div>
    </div>
  )
}
