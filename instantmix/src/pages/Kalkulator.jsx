import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export default function Kalkulator() {
  const { profile } = useAuth()
  const canEdit = ['admin','technolog'].includes(profile?.role)
  const [recipes, setRecipes] = useState([])
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [mass, setMass] = useState(250)
  const [fifoResult, setFifoResult] = useState([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [prodForm, setProdForm] = useState({ operator:'', foreman:'', notes:'' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('recipes').select('*, recipe_items(*, ingredients(*))').eq('status','dopuszczona').order('code').then(({ data }) => setRecipes(data || []))
  }, [])

  async function calculate() {
    if (!selectedRecipe || !mass) return
    setLoading(true)
    const result = []
    for (const item of selectedRecipe.recipe_items.sort((a,b) => a.sort_order - b.sort_order)) {
      const needed = parseFloat(((mass * item.percentage) / 100).toFixed(3))
      const { data: stockRows } = await supabase
        .from('v_fifo_stock')
        .select('*')
        .eq('ingredient_id', item.ingredient_id)
        .gt('current_kg', 0)
      let remaining = needed
      const lots = []
      for (const row of (stockRows || [])) {
        if (remaining <= 0) break
        const take = Math.min(remaining, parseFloat(row.current_kg))
        lots.push({ lot: row.delivery_lot, batch_id: row.id, ingredient_batch_id: row.id, kg: parseFloat(take.toFixed(3)), available: parseFloat(row.current_kg) })
        remaining = parseFloat((remaining - take).toFixed(3))
      }
      result.push({ ...item, needed, lots, shortage: remaining > 0 ? remaining : 0, ingredient: item.ingredients })
    }
    setFifoResult(result)
    setLoading(false)
  }

  useEffect(() => { if (selectedRecipe && mass) calculate() }, [selectedRecipe, mass])

  const allergens = [...new Set(fifoResult.filter(r => r.ingredient?.has_allergen).map(r => r.ingredient.allergen_type))]
  const hasShortage = fifoResult.some(r => r.shortage > 0)

  async function createProductionBatch() {
    setSaving(true)
    const { data: pb, error } = await supabase.from('production_batches').insert({
      lot_number: '', recipe_id: selectedRecipe.id,
      quantity_kg: mass, operator: prodForm.operator,
      foreman: prodForm.foreman, notes: prodForm.notes,
      technologist: profile?.full_name, created_by: profile?.id
    }).select().single()
    if (!error) {
      const items = fifoResult.flatMap((r, ri) => r.lots.map((l, li) => ({
        production_batch_id: pb.id, ingredient_batch_id: l.ingredient_batch_id,
        ingredient_id: r.ingredient_id, quantity_used_kg: l.kg, fifo_order: li + 1
      })))
      await supabase.from('production_batch_items').insert(items)
    }
    setSaving(false); setModal(false)
    alert(error ? 'Błąd: ' + error.message : `Partia ${pb.lot_number} utworzona!`)
  }

  function exportPDF() {
    const doc = new jsPDF()
    doc.setFontSize(16); doc.text('InstantMix Pro — Kalkulator receptur', 14, 16)
    doc.setFontSize(11); doc.text(`Receptura: ${selectedRecipe.code} — ${selectedRecipe.name} ${selectedRecipe.version}`, 14, 26)
    doc.text(`Masa wsadu: ${mass} kg | Data: ${new Date().toLocaleDateString('pl-PL')}`, 14, 33)
    autoTable(doc, {
      startY: 40,
      head: [['Kod skł.', 'Nazwa', 'Potrzeba (kg)', 'Partia FIFO', 'Kg z partii', 'Alergen']],
      body: fifoResult.flatMap(r => r.lots.map((l, i) => [
        i === 0 ? r.ingredient?.code : '',
        i === 0 ? r.ingredient?.name : '',
        i === 0 ? r.needed.toFixed(3) : '',
        l.lot, l.kg.toFixed(3),
        i === 0 && r.ingredient?.has_allergen ? r.ingredient.allergen_type : ''
      ])),
      styles: { fontSize: 9 }, headStyles: { fillColor: [15, 110, 86] }
    })
    if (allergens.length) {
      doc.setFontSize(10); doc.setTextColor(150, 0, 0)
      doc.text('ALERGENY: ' + allergens.join(', '), 14, doc.lastAutoTable.finalY + 10)
    }
    doc.save(`kalkulator_${selectedRecipe.code}_${mass}kg.pdf`)
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Kalkulator receptur</div>
          <div className="page-sub">Dostęp: Technolog (edycja), Brygadzista (odczyt)</div>
        </div>
        {fifoResult.length > 0 && <button className="btn btn-sm" onClick={exportPDF}>Drukuj / eksport PDF</button>}
      </div>

      <div className="card">
        <div className="fr">
          <div><label>Receptura</label>
            <select value={selectedRecipe?.id || ''} onChange={e => setSelectedRecipe(recipes.find(r => r.id === e.target.value) || null)} disabled={!canEdit}>
              <option value="">— wybierz recepturę —</option>
              {recipes.map(r => <option key={r.id} value={r.id}>{r.code} — {r.name} ({r.version})</option>)}
            </select>
          </div>
          <div><label>Masa wsadu do wyprodukowania (kg)</label>
            <input type="number" min="1" step="1" value={mass} onChange={e => setMass(parseFloat(e.target.value))} disabled={!canEdit} />
          </div>
        </div>

        {loading && <div style={{ textAlign:'center', padding:24 }}><span className="spinner" /> Obliczam FIFO...</div>}

        {!loading && fifoResult.length > 0 && (
          <>
            <div className="divider" />
            <div className="info-box">FIFO aktywne — składniki dozowane z najstarszych partii (wg daty przyjęcia)</div>
            {hasShortage && <div className="warn-box">Niedobór magazynowy — brak wystarczającej ilości niektórych składników. Uzupełnij stan magazynowy przed produkcją.</div>}
            {allergens.length > 0 && <div className="err-box">Alergeny w partii: {allergens.join(', ')}</div>}

            <div className="card-0" style={{ marginBottom:12 }}>
              <table>
                <thead><tr>
                  <th>Kod skł.</th><th>Nazwa</th><th>Potrzeba (kg)</th>
                  <th>Partia FIFO</th><th>Kg z partii</th><th>Alergen</th>
                </tr></thead>
                <tbody>
                  {fifoResult.map(r => r.lots.length > 0 ? r.lots.map((l, i) => (
                    <tr key={`${r.id}-${i}`} style={{ background: r.lots.length > 1 && i === 0 ? '#E6F1FB33' : undefined }}>
                      <td>{i === 0 && <span className="lot">{r.ingredient?.code}</span>}</td>
                      <td>{i === 0 && r.ingredient?.name}</td>
                      <td style={{ fontWeight: i===0?500:undefined, textAlign:'right' }}>{i === 0 ? r.needed.toFixed(3) : ''}</td>
                      <td><span className="lot">{l.lot}</span>{r.lots.length > 1 && <span className="fifo-badge">FIFO {i+1}</span>}</td>
                      <td style={{ textAlign:'right' }}>{l.kg.toFixed(3)}</td>
                      <td>{i === 0 && r.ingredient?.has_allergen ? <span className="badge b-err">{r.ingredient.allergen_type}</span> : ''}</td>
                    </tr>
                  )) : (
                    <tr key={r.id}>
                      <td><span className="lot">{r.ingredient?.code}</span></td>
                      <td>{r.ingredient?.name}</td>
                      <td style={{ fontWeight:500, textAlign:'right' }}>{r.needed.toFixed(3)}</td>
                      <td colSpan={2}><span className="badge b-err">BRAK W MAGAZYNIE</span></td>
                      <td>{r.ingredient?.has_allergen ? <span className="badge b-err">{r.ingredient.allergen_type}</span> : ''}</td>
                    </tr>
                  ))}
                  <tr style={{ background:'#E1F5EE' }}>
                    <td colSpan={2} style={{ fontWeight:500, textAlign:'right' }}>SUMA wsadu</td>
                    <td style={{ fontWeight:500, textAlign:'right' }}>{fifoResult.reduce((s,r) => s + r.needed, 0).toFixed(3)} kg</td>
                    <td colSpan={3}></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {canEdit && !hasShortage && (
              <button className="btn btn-primary btn-sm" onClick={() => setModal(true)}>Zatwierdź i utwórz partię produkcji</button>
            )}
          </>
        )}

        {!loading && !selectedRecipe && (
          <div style={{ textAlign:'center', padding:24, color:'#888' }}>Wybierz recepturę i podaj masę, aby zobaczyć dozowanie FIFO.</div>
        )}
      </div>

      <div className={`modal-overlay ${modal?'open':''}`} onClick={e => e.target===e.currentTarget && setModal(false)}>
        <div className="modal">
          <div className="modal-title">Zatwierdzenie partii produkcji</div>
          <div style={{ background:'#F1EFE8', borderRadius:8, padding:10, marginBottom:12, fontSize:13 }}>
            Receptura: <b>{selectedRecipe?.code} — {selectedRecipe?.name} {selectedRecipe?.version}</b><br/>
            Masa wsadu: <b>{mass} kg</b><br/>
            Technolog: <b>{profile?.full_name}</b>
          </div>
          <div className="fr">
            <div><label>Operator (imię, nazwisko)</label><input value={prodForm.operator} onChange={e => setProdForm(p=>({...p,operator:e.target.value}))} /></div>
            <div><label>Brygadzista</label><input value={prodForm.foreman} onChange={e => setProdForm(p=>({...p,foreman:e.target.value}))} /></div>
          </div>
          <div><label>Uwagi</label><input value={prodForm.notes} onChange={e => setProdForm(p=>({...p,notes:e.target.value}))} placeholder="opcjonalne" /></div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setModal(false)}>Anuluj</button>
            <button className="btn btn-primary" onClick={createProductionBatch} disabled={saving}>{saving?'Tworzenie...':'Zatwierdź i zapisz'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
