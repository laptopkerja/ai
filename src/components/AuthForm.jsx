import React, { useState, useEffect } from 'react'
import { Form, Button, Card, Alert, Spinner } from 'react-bootstrap'
import { useForm } from 'react-hook-form'
import { supabase } from '../supabase/client'
import { useNavigate } from 'react-router-dom'
import { apiAxios } from '../lib/apiRuntime'

export default function AuthForm() {
  const { register, handleSubmit } = useForm()
  const [isSigningUp, setIsSigningUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [cooldown, setCooldown] = useState(0)
  const [signupPolicy, setSignupPolicy] = useState(null)
  const navigate = useNavigate()
  const publicSignupEnabled = !!signupPolicy?.publicSignupEnabled

  useEffect(() => {
    let t
    if (cooldown > 0) {
      t = setInterval(() => setCooldown(c => c - 1), 1000)
    }
    return () => clearInterval(t)
  }, [cooldown])

  useEffect(() => {
    let mounted = true
    async function loadSignupPolicy() {
      try {
        const resp = await apiAxios({ method: 'get', url: '/api/public/signup-policy' })
        if (!mounted) return
        if (resp.data?.ok) setSignupPolicy(resp.data.data)
      } catch (e) {
        if (mounted) setSignupPolicy(null)
      }
    }
    loadSignupPolicy()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (signupPolicy && !publicSignupEnabled && isSigningUp) {
      setIsSigningUp(false)
    }
  }, [signupPolicy, publicSignupEnabled, isSigningUp])

  async function onSubmit(data) {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      if (isSigningUp) {
        const resp = await apiAxios({
          method: 'post',
          url: '/api/public/sign-up',
          data: {
            email: data.email,
            password: data.password
          }
        })
        if (!resp.data?.ok) throw new Error('Failed to create account')
        setSuccess('Akun berhasil dibuat. Silakan cek email untuk verifikasi lalu login.')
        setIsSigningUp(false)
        try {
          const p = await apiAxios({ method: 'get', url: '/api/public/signup-policy' })
          if (p.data?.ok) setSignupPolicy(p.data.data)
        } catch (e) {}
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: data.email,
          password: data.password
        })
        if (error) throw error
        const { data: sessionData } = await supabase.auth.getSession()
        const accessToken = sessionData?.session?.access_token
        if (!accessToken) throw new Error('Sesi login tidak ditemukan')
        try {
          await apiAxios({
            method: 'get',
            url: '/api/session-access',
            headers: { Authorization: `Bearer ${accessToken}` }
          })
        } catch (accessErr) {
          await supabase.auth.signOut()
          throw accessErr
        }
        navigate('/dashboard')
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('Auth error', err)
      }
      // Handle Supabase rate limit (429) explicitly and show cooldown
      const status = err?.response?.status || err?.status
      const apiError = err?.response?.data?.error
      const message = apiError?.message || err?.message || (err?.error_description ?? null) || JSON.stringify(err)
      const normalizedMessage = String(message || '').trim()
      if (status === 429 || /too many requests/i.test(message)) {
        setError('Too many requests. Please wait 30 seconds before trying again.')
        setCooldown(30)
      } else if (status === 403) {
        if ((apiError?.code || '') === 'EMAIL_NOT_ALLOWED') {
          setError('Akun ini tidak masuk allowlist internal. Hubungi pemilik aplikasi.')
        } else if ((apiError?.code || '') === 'SIGNUP_DISABLED') {
          setError('Pendaftaran akun dinonaktifkan. Hubungi owner untuk dibuatkan akun.')
        } else {
          setError(normalizedMessage || 'Akses ditolak.')
        }
      } else if (status === 400) {
        // Handle specific Supabase auth errors (e.g. email not confirmed)
        if (/email_not_confirmed|Email not confirmed/i.test(normalizedMessage)) {
          setError('Email belum dikonfirmasi. Periksa email Anda untuk link verifikasi atau minta admin mengkonfirmasi akun dari Supabase Dashboard.')
        } else if (/invalid login credentials/i.test(normalizedMessage)) {
          setError('Email/password salah, atau akun belum ada di project Supabase yang sedang aktif.')
        } else {
          const detail = err?.response?.data ?? err?.response ?? null
          setError(`Login gagal: ${normalizedMessage}${detail ? ' - ' + JSON.stringify(detail) : ''}`)
        }
      } else if (status === 409) {
        setError(normalizedMessage)
      } else {
        setError(typeof normalizedMessage === 'string' ? normalizedMessage : JSON.stringify(normalizedMessage))
      }
    } finally {
      setLoading(false)
    }
  }

  // Google OAuth disabled per requirement - using email/password only

  return (
    <Card className="mx-auto" style={{ maxWidth: 480 }}>
      <Card.Body>
        <h3 className="mb-3">{isSigningUp ? 'Sign up' : 'Sign in'}</h3>
        {error && <Alert variant="danger">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}
        {signupPolicy && !publicSignupEnabled && (
          <Alert variant="info">
            Pendaftaran akun publik dinonaktifkan. Akun baru dibuat manual oleh owner.
          </Alert>
        )}
        {isSigningUp && signupPolicy && (
          <Alert variant={signupPolicy.signupOpen ? 'info' : 'warning'}>
            Slot pendaftaran: {signupPolicy.currentUsers}/{signupPolicy.maxUsers}
          </Alert>
        )}
        <Form onSubmit={handleSubmit(onSubmit)}>
          <Form.Group className="mb-2" controlId="email">
            <Form.Label>Email</Form.Label>
            <Form.Control type="email" placeholder="you@example.com" {...register('email', { required: true })} />
          </Form.Group>
          <Form.Group className="mb-3" controlId="password">
            <Form.Label>Password</Form.Label>
            <Form.Control type="password" {...register('password', { required: true })} />
          </Form.Group>
          <div className="d-grid gap-2">
            <Button variant="primary" type="submit" disabled={loading}>
              {loading ? <Spinner animation="border" size="sm" /> : (isSigningUp ? 'Create account' : 'Sign in')}
            </Button>
            {publicSignupEnabled && (
              <Button variant="outline-secondary" onClick={() => setIsSigningUp(v => !v)}>
                {isSigningUp ? 'Have an account? Sign in' : "Don't have account? Sign up"}
              </Button>
            )}
            {/* OAuth disabled: email/password only */}
          </div>
        </Form>
      </Card.Body>
    </Card>
  )
}
