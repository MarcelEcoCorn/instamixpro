import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format } from 'date-fns'
import { pl } from 'date-fns/locale'

const GREEN_DARK  = [15, 110, 86]
const GREEN_MID   = [29, 158, 117]
const GREEN_LIGHT = [225, 245, 238]
const GREY_BG     = [241, 239, 232]
const GREY_LINE   = [211, 209, 199]
const RED_LIGHT   = [252, 235, 235]
const RED_DARK    = [121, 31, 31]
const AMBER_LIGHT = [250, 238, 218]
const WHITE       = [255, 255, 255]

function addHeader(doc, title, subtitle) {
  const W = doc.internal.pageSize.width
  doc.setFillColor(...GREEN_DARK)
  doc.rect(0, 0, W, 18, 'F')
  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('InstantMix Pro', 14, 12)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(title, W / 2, 8, { align: 'center' })
  doc.text(subtitle, W / 2, 14, { align: 'center' })
  doc.text(`Wygenerowano: ${format(new Date(), 'dd.MM.yyyy', { locale: pl })}`, W - 14, 12, { align: 'right' })
  doc.setTextColor(0, 0, 0)
}

function addFooter(doc) {
  const W = doc.internal.pageSize.width
  const H = doc.internal.pageSize.height
  const pages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFillColor(...GREY_BG)
    doc.rect(0, H - 10, W, 10, 'F')
    doc.setFontSize(7)
    doc.setTextColor(95, 94, 90)
    doc.text('Dokument wygenerowany automatycznie przez system InstantMix Pro. Wylacznie do uzytku wewnetrznego.', 14, H - 4)
    doc.text(`Strona ${i} / ${pages}`, W - 14, H - 4, { align: 'right' })
  }
}

// ── Raport produkcji ──────────────────────────────────────────────────────
export function generateProductionReport(batches, items, period) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  addHeader(doc, `Raport produkcji — ${period}`, `Partii: ${batches.length}  |  Lacznie: ${batches.reduce((s, b) => s + Number(b.quantity_kg), 0).toFixed(1)} kg`)

  // Summary table
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GREEN_DARK)
  doc.text('Zestawienie zbiorcze', 14, 26)

  autoTable(doc, {
    startY: 29,
    head: [['Nr partii prod.', 'Kod', 'Nazwa mieszanki', 'Nr partii mix.', 'Data prod.', 'Linia prod.', 'Ilosc (kg)', 'Wersja', 'Status']],
    body: batches.map(b => [
      b.lot_number,
      b.recipe_code,
      b.recipe_name,
      b.lot_number,
      b.production_date,
      b.production_line === 'bezglutenowa' ? 'Bezglutenowa' : 'Zwykla',
      Number(b.quantity_kg).toFixed(1),
      b.recipe_version,
      b.status,
    ]),
    foot: [['RAZEM', '', `${batches.length} partie`, '', '', '', batches.reduce((s, b) => s + Number(b.quantity_kg), 0).toFixed(1), '', '']],
    headStyles: { fillColor: GREEN_DARK, textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
    footStyles: { fillColor: GREEN_LIGHT, textColor: GREEN_DARK, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: GREY_BG },
    styles: { cellPadding: 2.5 },
    columnStyles: { 6: { halign: 'right' }, 7: { halign: 'center' }, 5: { halign: 'center' } },
  })

  // Per-batch details
  doc.addPage()
  addHeader(doc, `Raport produkcji — ${period}`, 'Szczegoly partii — identyfikacja skladnikow (FIFO)')

  let startY = 26
  for (const batch of batches) {
    const batchItems = items.filter(i => i.production_batch_id === batch.id)
    const allergens = [...new Set(batchItems.filter(i => i.has_allergen).map(i => i.allergen_type))].join(', ')

    if (startY > 150) { doc.addPage(); addHeader(doc, `Raport produkcji — ${period}`, 'Szczegoly partii'); startY = 26 }

    // Batch header bar
    doc.setFillColor(...GREEN_DARK)
    doc.rect(14, startY, doc.internal.pageSize.width - 28, 9, 'F')
    doc.setTextColor(...WHITE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(`${batch.lot_number}  |  ${batch.recipe_code} — ${batch.recipe_name}  [${batch.recipe_version}]`, 17, startY + 6)
    doc.text(`${batch.production_date}  |  ${Number(batch.quantity_kg).toFixed(1)} kg  |  ${batch.production_line === 'bezglutenowa' ? 'BEZGLUTENOWA' : 'Zwykla'}`, doc.internal.pageSize.width - 14, startY + 6, { align: 'right' })
    doc.setTextColor(0, 0, 0)
    startY += 10

    autoTable(doc, {
      startY,
      head: [['Kod skl.', 'Nazwa skladnika', 'Lacznie (kg)', 'Partia FIFO-1', 'Kg z p.1', 'Partia FIFO-2', 'Kg z p.2', 'Alergen']],
      body: batchItems.map(i => [
        i.ingredient_code,
        i.ingredient_name,
        Number(i.quantity_used_kg).toFixed(1),
        i.delivery_lot || '—',
        Number(i.quantity_used_kg).toFixed(1),
        i.delivery_lot_2 || '—',
        i.quantity_used_kg_2 ? Number(i.quantity_used_kg_2).toFixed(1) : '—',
        i.allergen_type || '—',
      ]),
      headStyles: { fillColor: GREEN_MID, textColor: WHITE, fontSize: 7 },
      bodyStyles: { fontSize: 7.5 },
      alternateRowStyles: { fillColor: GREY_BG },
      styles: { cellPadding: 2 },
      columnStyles: { 2: { halign: 'right' }, 4: { halign: 'right' }, 6: { halign: 'right' } },
      didParseCell: (data) => {
        if (data.row.raw && data.row.raw[7] && data.row.raw[7] !== '—') {
          data.cell.styles.textColor = RED_DARK
          data.cell.styles.fontStyle = 'bold'
        }
      },
    })

    startY = doc.lastAutoTable.finalY + 2

    // Allergen warning
    if (allergens) {
      doc.setFillColor(...RED_LIGHT)
      doc.rect(14, startY, doc.internal.pageSize.width - 28, 7, 'F')
      doc.setTextColor(...RED_DARK)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.text(`ALERGENY W PARTII: ${allergens}`, 17, startY + 5)
      doc.setTextColor(0, 0, 0)
      startY += 9
    }

    // Personnel
    doc.setFillColor(...GREY_BG)
    doc.rect(14, startY, doc.internal.pageSize.width - 28, 7, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(95, 94, 90)
    doc.text(`Operator: ${batch.operator || '—'}   |   Brygadzista: ${batch.foreman || '—'}   |   Technolog: ${batch.technologist || '—'}`, 17, startY + 5)
    doc.setTextColor(0, 0, 0)
    startY += 10
  }

  // Signature block
  if (startY > 160) { doc.addPage(); addHeader(doc, `Raport produkcji — ${period}`, ''); startY = 26 }
  startY += 6
  doc.setDrawColor(...GREY_LINE)
  doc.line(14, startY, doc.internal.pageSize.width - 14, startY)
  startY += 10
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'normal')
  const W = doc.internal.pageSize.width
  const colW = (W - 28) / 3
  doc.text('Sporzadzil / Technolog:\n\n\n________________________', 14, startY)
  doc.text('Zatwierdzil / Brygadzista:\n\n\n________________________', 14 + colW, startY)
  doc.text('Kontrola jakosci:\n\n\n________________________', 14 + colW * 2, startY)

  addFooter(doc)
  doc.save(`raport_produkcji_${period.replace(' ', '_')}.pdf`)
}

// ── Raport magazynowy ─────────────────────────────────────────────────────
export function generateStockReport(stock) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const today = format(new Date(), 'dd.MM.yyyy', { locale: pl })
  addHeader(doc, 'Raport stanu magazynowego', `Stan na dzien: ${today}`)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GREEN_DARK)
  doc.text('Stan partii skladnikow', 14, 26)

  const expiringSoon = stock.filter(s => {
    if (!s.expiry_date) return false
    const days = (new Date(s.expiry_date) - new Date()) / 86400000
    return days <= 30 && days > 0
  })

  autoTable(doc, {
    startY: 29,
    head: [['Kod skl.', 'Nazwa skladnika', 'Nr partii dostawy', 'Data przyj.', 'Wazny do', 'Stan pocz. (kg)', 'Korekty (kg)', 'Stan akt. (kg)', 'Status']],
    body: stock.map(s => {
      const isExpiring = expiringSoon.find(e => e.id === s.id)
      return [
        s.ingredient_code,
        s.ingredient_name,
        s.delivery_lot,
        s.received_date,
        s.expiry_date || '—',
        Number(s.original_kg).toFixed(1),
        Number(s.corrections_kg || 0).toFixed(1),
        Number(s.current_kg).toFixed(1),
        s.status,
      ]
    }),
    headStyles: { fillColor: GREEN_DARK, textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: GREY_BG },
    styles: { cellPadding: 2.5 },
    columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 7) {
        const row = stock[data.row.index]
        if (row && Number(row.current_kg) < 50) {
          data.cell.styles.textColor = RED_DARK
          data.cell.styles.fontStyle = 'bold'
        }
      }
    },
  })

  if (expiringSoon.length > 0) {
    const y = doc.lastAutoTable.finalY + 6
    doc.setFillColor(...AMBER_LIGHT)
    doc.rect(14, y, doc.internal.pageSize.width - 28, 8, 'F')
    doc.setTextColor(99, 56, 6)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(`UWAGA: ${expiringSoon.length} partie wygasaja w ciagu 30 dni: ${expiringSoon.map(e => e.delivery_lot).join(', ')}`, 17, y + 5.5)
  }

  addFooter(doc)
  doc.save(`raport_magazynowy_${format(new Date(), 'yyyy-MM-dd')}.pdf`)
}

// ── Kalkulator — wydruk dla brygadzisty ───────────────────────────────────
export function generateCalculatorPDF(recipe, massKg, fifoResult) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  addHeader(doc, 'Kalkulator receptur — zlecenie dozowania', `${recipe.code} — ${recipe.name}  [${recipe.version}]`)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GREEN_DARK)
  doc.text(`Masa wsadu: ${Number(massKg).toFixed(1)} kg`, 14, 26)
  doc.text(`Data: ${format(new Date(), 'dd.MM.yyyy', { locale: pl })}`, doc.internal.pageSize.width - 14, 26, { align: 'right' })

  const allergens = [...new Set(fifoResult.filter(r => r.allergen && r.allergen !== '—').map(r => r.allergen))].join(', ')

  autoTable(doc, {
    startY: 32,
    head: [['Kod skl.', 'Nazwa skladnika', 'Potrzeba (kg)', 'Partia FIFO-1', 'Kg z p.1', 'Partia FIFO-2', 'Kg z p.2', 'Alergen']],
    body: fifoResult.map(r => [
      r.code,
      r.name,
      Number(r.totalKg).toFixed(2),
      r.lot1 || '—',
      r.kg1 ? Number(r.kg1).toFixed(2) : '—',
      r.lot2 || '—',
      r.kg2 ? Number(r.kg2).toFixed(2) : '—',
      r.allergen || '—',
    ]),
    foot: [['', 'SUMA WSADU', Number(massKg).toFixed(2), '', '', '', '', '']],
    headStyles: { fillColor: GREEN_MID, textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
    footStyles: { fillColor: GREEN_LIGHT, textColor: GREEN_DARK, fontStyle: 'bold' },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: GREY_BG },
    styles: { cellPadding: 3 },
    columnStyles: { 2: { halign: 'right' }, 4: { halign: 'right' }, 6: { halign: 'right' } },
  })

  const y = doc.lastAutoTable.finalY + 5
  if (allergens) {
    doc.setFillColor(...RED_LIGHT)
    doc.rect(14, y, doc.internal.pageSize.width - 28, 9, 'F')
    doc.setTextColor(...RED_DARK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(`ALERGENY: ${allergens}`, 17, y + 6)
  }

  doc.setFillColor(...GREY_BG)
  doc.rect(14, y + 13, doc.internal.pageSize.width - 28, 8, 'F')
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('Metoda FIFO — skladniki pobierane z najstarszych partii dostaw (wg daty przyjecia).', 17, y + 18)

  // Signature
  const sy = y + 30
  doc.setFontSize(9)
  doc.text('Technolog:\n\n________________________', 14, sy)
  doc.text('Brygadzista:\n\n________________________', 90, sy)
  doc.text('Data i godzina:\n\n________________________', 155, sy)

  addFooter(doc)
  doc.save(`dozowanie_${recipe.code}_${format(new Date(), 'yyyy-MM-dd')}.pdf`)
}
