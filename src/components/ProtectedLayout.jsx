import React, { useEffect, useState } from 'react'
import { Outlet, useNavigate, Link } from 'react-router-dom'
import { Navbar, Container, Nav, Button, Dropdown, Image, Form, Offcanvas } from 'react-bootstrap'
import { supabase } from '../supabase/client'
import { resolveAvatarDisplayUrl } from '../lib/avatarStorage'

export default function ProtectedLayout() {
  const THEME_STORAGE_KEY = 'ui-theme'
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [avatarUrl, setAvatarUrl] = useState('')
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const navigate = useNavigate()

  useEffect(() => {
    let mounted = true
    async function check() {
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      if (!data?.session) {
        navigate('/auth')
      } else {
        setUser(data.session.user || null)
        setLoading(false)
      }
    }
    check()
    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) {
        setUser(null)
        navigate('/auth')
      } else {
        setUser(session.user || null)
      }
    })
    return () => {
      mounted = false
      listener?.subscription?.unsubscribe()
    }
  }, [navigate])

  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', theme)
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    let mounted = true
    async function syncAvatarUrl() {
      const metadata = user?.user_metadata || {}
      const resolved = await resolveAvatarDisplayUrl({ supabase, metadata })
      if (!mounted) return
      setAvatarUrl(resolved.url || '')
    }
    syncAvatarUrl()
    return () => { mounted = false }
  }, [user?.id, user?.user_metadata?.avatar_url, user?.user_metadata?.avatar_path])

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/auth')
  }

  if (loading) return <div className="p-4">Loading...</div>
  const initials = (user?.email || 'U').charAt(0).toUpperCase()

  return (
    <>
      <Navbar bg={theme === 'dark' ? 'dark' : 'light'} data-bs-theme={theme} expand="lg" className="mb-3" collapseOnSelect>
        <Container>
          <Navbar.Brand as={Link} to="/dashboard" className="app-brand">
            <img src="/brand-icon.svg" alt="AI Content" className="app-brand-icon" />
            <span className="app-brand-text">AI Content</span>
          </Navbar.Brand>
          <Navbar.Toggle aria-controls="main-navbar-offcanvas" />
          <Navbar.Offcanvas
            id="main-navbar-offcanvas"
            aria-labelledby="main-navbar-offcanvas-label"
            placement="end"
          >
            <Offcanvas.Header closeButton>
              <Offcanvas.Title id="main-navbar-offcanvas-label">Menu</Offcanvas.Title>
            </Offcanvas.Header>
            <Offcanvas.Body>
              <Nav className="me-auto">
                <Nav.Link as={Link} to="/dashboard">Dashboard</Nav.Link>
                <Nav.Link as={Link} to="/generate">Generate</Nav.Link>
                <Nav.Link as={Link} to="/history">History</Nav.Link>
                <Nav.Link as={Link} to="/templates">Templates</Nav.Link>
              </Nav>
              <Dropdown align="end">
                <Dropdown.Toggle as={Button} variant="light" className="p-0 border-0 bg-transparent nav-avatar-toggle">
                  {avatarUrl ? (
                    <Image src={avatarUrl} roundedCircle className="nav-avatar-image" />
                  ) : (
                    <span className="nav-avatar-fallback">{initials}</span>
                  )}
                </Dropdown.Toggle>
                <Dropdown.Menu>
                  <Dropdown.Item as={Link} to="/profile">Profile</Dropdown.Item>
                  <Dropdown.Item as={Link} to="/settings">Settings</Dropdown.Item>
                  <Dropdown.Divider />
                  <Dropdown.ItemText className="nav-theme-item">
                    <span>{theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</span>
                    <Form.Check
                      type="switch"
                      id="theme-switch"
                      className="m-0 nav-theme-switch"
                      checked={theme === 'dark'}
                      onChange={(e) => setTheme(e.target.checked ? 'dark' : 'light')}
                      aria-label="Toggle light and dark mode"
                    />
                  </Dropdown.ItemText>
                  <Dropdown.Divider />
                  <Dropdown.Item className="text-danger" onClick={handleLogout}>Logout</Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
            </Offcanvas.Body>
          </Navbar.Offcanvas>
        </Container>
      </Navbar>
      <Container>
        <Outlet />
      </Container>
    </>
  )
}
