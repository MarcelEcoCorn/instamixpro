import { useState, useEffect, createContext, useContext } from 'react'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Layout from './components/Layout'
import Receptury from './pages/Receptury'
import Skladniki from './pages/Skladniki'
import Partie from './pages/Partie'
import Kalkulator from './pages/Kalkulator'
import Produkcja from './pages/Produkcja'
import Dashboard from './pages/Dashboard'
import Eksport from './pages/Eksport'
import Magazyn from './pages/Magazyn'
import Zlecenia from './pages/Zlecenia'
import MagazynWG from './pages/MagazynWG'
import Klienci from './pages/Klienci'
import './index.css'

export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState('produkcja')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data)
    setLoading(false)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#5F5E5A' }}>
      Ładowanie...
    </div>
  )

  if (!session) return <Login />

  const pages = {
    receptury: Receptury, skladniki: Skladniki, partie: Partie,
    zlecenia: Zlecenia, kalkulator: Kalkulator, magazynwg: MagazynWG,
    produkcja: Produkcja, dashboard: Dashboard,
    eksport: Eksport, magazyn: Magazyn, klienci: Klienci
  }
  const PageComponent = pages[page] || Produkcja

  return (
    <AuthContext.Provider value={{ session, profile }}>
      <Layout page={page} setPage={setPage}>
        <PageComponent />
      </Layout>
    </AuthContext.Provider>
  )
}
