import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const NAV = [
  { id: 'receptury',  label: 'Receptury',              roles: ['admin','technolog'] },
  { id: 'skladniki',  label: 'Składniki',               roles: ['admin'] },
  { id: 'partie',     label: 'Przyjęcie składników',    roles: ['admin','technolog'] },
  { id: 'magazyn',    label: 'Magazyn składników',      roles: ['admin','technolog','brygadzista','sprzedaz'] },
  { id: 'zlecenia',   label: 'Zlecenia',                roles: ['admin','technolog','sprzedaz'] },
  { id: 'kalkulator', label: 'Kalkulator',              roles: ['admin','technolog','brygadzista'] },
  { id: 'produkcja',  label: 'Produkcja',               roles: ['admin','technolog','brygadzista','sprzedaz'] },
  { id: 'dashboard',  label: 'Dashboard',               roles: ['admin','technolog','brygadzista','sprzedaz'] },
  { id: 'magazynwg',  label: 'Magazyn WG',              roles: ['admin','technolog','sprzedaz'] },
  { id: 'klienci',    label: 'Kartoteka klientów',      roles: ['admin'] },
  { id: 'eksport',    label: 'Eksport / kopia',         roles: ['admin','technolog'] },
]

const ROLE_LABELS = {
  admin: 'Admin', technolog: 'Technolog',
  brygadzista: 'Brygadzista', sprzedaz: 'Sprzedaż'
}

function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const date = now.toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.3 }}>
      <span style={{ fontSize: 15, fontWeight: 500, fontFamily: 'monospace', color: '#1a1a18', letterSpacing: 1 }}>{time}</span>
      <span style={{ fontSize: 11, color: '#5F5E5A' }}>{date}</span>
    </div>
  )
}

export default function Layout({ page, setPage, children }) {
  const { profile } = useAuth()
  const role = profile?.role || 'brygadzista'
  const visibleNav = NAV.filter(n => n.roles.includes(role))

  async function logout() { await supabase.auth.signOut() }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#fff', borderBottom: '0.5px solid #D3D1C7', padding: '0 16px', display: 'flex', alignItems: 'center', height: '52px', gap: '12px', position: 'sticky', top: 0, zIndex: 200 }}>
        <div style={{ fontSize: '15px', fontWeight: '500' }}>Instant<span style={{ color: '#1D9E75' }}>Mix</span> Pro</div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <LiveClock />
          <div style={{ width: '0.5px', height: 28, background: '#D3D1C7' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#CECBF6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, color: '#3C3489' }}>
              {profile?.full_name?.slice(0, 2).toUpperCase() || 'U'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
              <span style={{ fontSize: 13, color: '#1a1a18' }}>{profile?.full_name || 'Użytkownik'}</span>
              <span style={{ fontSize: 10, color: '#5F5E5A' }}>{ROLE_LABELS[role]}</span>
            </div>
            <button className="btn btn-sm" onClick={logout}>Wyloguj</button>
          </div>
        </div>
      </div>

      <div style={{ background: '#fff', borderBottom: '0.5px solid #D3D1C7', display: 'flex', padding: '0 16px', overflowX: 'auto', position: 'sticky', top: '52px', zIndex: 199 }}>
        {visibleNav.map(n => (
          <button key={n.id} onClick={() => setPage(n.id)} style={{
            padding: '12px 14px', fontSize: '13px', border: 'none', background: 'none', cursor: 'pointer',
            borderBottom: page === n.id ? '2px solid #1D9E75' : '2px solid transparent',
            color: page === n.id ? '#0F6E56' : '#5F5E5A',
            fontWeight: page === n.id ? '500' : '400',
            whiteSpace: 'nowrap', transition: 'all .15s', flexShrink: 0,
          }}>{n.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, padding: '16px', maxWidth: '1140px', width: '100%', margin: '0 auto' }}>
        {children}
      </div>
    </div>
  )
}
