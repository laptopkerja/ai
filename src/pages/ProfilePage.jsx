import React, { useEffect, useState } from 'react'
import { supabase } from '../supabase/client'
import { Card, Row, Col, ListGroup, Button, Badge, Modal, Form, Image, Alert } from 'react-bootstrap'
import { AVATAR_BUCKET, extractAvatarPathFromStorageUrl, resolveAvatarDisplayUrl, resolveAvatarPathFromMetadata } from '../lib/avatarStorage'

export default function ProfilePage() {
  const ICONIFY_ICON_NAMES = [
    
    'emojione-v1:grinning-cat-face',
    'emojione-monotone:fox',
    'emojione-v1:girl',
    'emojione-v1:monkey-face',
    'ic:baseline-account-circle',
    'emojione-v1:boy',
    'emojione-v1:bear-face',
    'arcticons:pokemon-masters-ex',
    'meteocons:pollen-flower',
    'meteocons:rainbow-clear-fill',
    'meteocons:dust-day-fill',
    'ri:user-smile-line',
    'meteocons:clear-day-fill',
    'svg-spinners:pulse-3',
    'gravity-ui:person',
    'fxemoji:foxcrying',
    'streamline-plump-color:memes-comment-reply',

    'streamline-stickies-color:baby',
    'emojione:baby-angel',
    'logos:panda',
    'openmoji:panda',
    'noto-v1:panda',
    'arcticons:emoji-panda-face',
    'material-symbols:face-outline',
    'mdi:face-man-outline',
    'mdi:face-woman-outline',
    'tabler:mood-smile',
    'fluent:emoji-smile-slight-24-regular',
    'ph:smiley',
    'solar:smile-circle-outline',
    'iconoir:emoji-satisfied',
    'fluent-emoji-flat:woman-white-hair-medium',
    'mdi:robot-outline',
    'emojione:bride-with-veil-light-skin-tone',
    'emojione:flag-for-indonesia',
    'emojione:cat',
    'emojione:girl-light-skin-tone',
    'emojione:boy-light-skin-tone',
    'fluent-emoji-flat:clown-face',
    'noto:boy',
    'noto:child-light-skin-tone',
    'noto:face-with-tongue',
    'noto:bear',
    'noto:grinning-cat-with-smiling-eyes',
    'noto:woman-with-headscarf',
    'noto:woman-with-headscarf-light-skin-tone',
    'noto:woman-wearing-turban',
  ]
  const ICONIFY_AVATAR_PALETTES = [
    { fg: '005aff', bg: 'eaf1ff' },
    { fg: '0a7f39', bg: 'e8f8ee' },
    { fg: '6b21a8', bg: 'f3e8ff' },
    { fg: 'c2410c', bg: 'fff0e5' },
    { fg: '0369a1', bg: 'e6f6ff' },
    { fg: 'b91c1c', bg: 'ffeaea' }
  ]
  const MAX_AVATAR_MB = 2
  const [user, setUser] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [avatarInput, setAvatarInput] = useState('')
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('')
  const [displayNameInput, setDisplayNameInput] = useState('')
  const [phoneInput, setPhoneInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [file, setFile] = useState(null)
  const [notice, setNotice] = useState(null)

  function validateAvatarFile(f) {
    if (!f) return null
    if (!String(f.type || '').startsWith('image/')) return 'File avatar harus berupa gambar'
    if (f.size > MAX_AVATAR_MB * 1024 * 1024) return `Ukuran avatar maksimal ${MAX_AVATAR_MB}MB`
    return null
  }

  function validatePhoneInput(value) {
    const raw = String(value || '').trim()
    if (!raw) return null
    if (!/^\+?[0-9][0-9\s-]{6,19}$/.test(raw)) return 'Format phone tidak valid'
    return null
  }

  function mapStorageUploadError(error) {
    const message = String(error?.message || '').toLowerCase()
    const status = Number(error?.statusCode || error?.status || 0)
    if (status === 400 && message.includes('row-level security')) {
      return 'Upload avatar ditolak policy Supabase Storage (RLS). Pastikan bucket avatars punya policy INSERT/UPDATE untuk user login pada path folder user masing-masing.'
    }
    if (message.includes('bucket') && message.includes('not found')) {
      return `Bucket "${AVATAR_BUCKET}" belum ada di Supabase Storage.`
    }
    return error?.message || 'Gagal upload avatar'
  }

  function mergeUserMetadataLocally(baseUser, mergedMetadata) {
    if (!baseUser || typeof baseUser !== 'object') return baseUser
    return {
      ...baseUser,
      user_metadata: {
        ...(baseUser.user_metadata || {}),
        ...(mergedMetadata || {})
      }
    }
  }

  function buildIconifyAvatarUrl(iconName, fgHex = '005aff', bgHex = 'eaf1ff') {
    const icon = encodeURIComponent(String(iconName || '').trim())
    const fg = encodeURIComponent(`#${String(fgHex || '').replace('#', '')}`)
    const bg = encodeURIComponent(`#${String(bgHex || '').replace('#', '')}`)
    return `https://api.iconify.design/${icon}.svg?color=${fg}&background=${bg}&width=96&height=96`
  }

  function applyAvatarUrl(url) {
    setAvatarInput(String(url || '').trim())
    setFile(null)
  }

  useEffect(() => {
    async function load() {
      const { data } = await supabase.auth.getUser()
      setUser(data?.user)
    }
    load()
  }, [])

  // Sync form field + preview avatar URL when user metadata changes.
  useEffect(() => {
    let mounted = true
    async function syncProfileFields() {
      const metadata = user?.user_metadata || {}
      const currentAvatarInput = String(metadata.avatar_url || '').trim()
      const currentDisplayName = metadata.display_name || ''
      const currentPhone = user?.phone || metadata.phone || ''
      if (!mounted) return
      setAvatarInput(currentAvatarInput)
      setDisplayNameInput(currentDisplayName)
      setPhoneInput(currentPhone)
      const resolved = await resolveAvatarDisplayUrl({ supabase, metadata, bucket: AVATAR_BUCKET })
      if (!mounted) return
      setAvatarPreviewUrl(resolved.url || '')
    }
    syncProfileFields()
    return () => { mounted = false }
  }, [user?.id, user?.phone, user?.user_metadata?.avatar_url, user?.user_metadata?.avatar_path, user?.user_metadata?.display_name, user?.user_metadata?.phone])

  if (!user) return <div className="p-4">Loading profile...</div>

  const metadata = user.user_metadata || {}
  const appmeta = user.app_metadata || {}
  const initials = (user.email || 'U').charAt(0).toUpperCase()
  const currentAvatar = avatarPreviewUrl || null
  const currentDisplayName = metadata.display_name || '-'
  const currentPhone = user.phone || metadata.phone || '-'

  const SAMPLE_AVATARS = [
    `https://api.dicebear.com/6.x/identicon/svg?seed=${encodeURIComponent(user.email+'-a')}`,
    `https://api.dicebear.com/6.x/avataaars/svg?seed=${encodeURIComponent(user.email+'-b')}`,
    `https://api.dicebear.com/6.x/micah/svg?seed=${encodeURIComponent(user.email+'-c')}`,
    `https://api.dicebear.com/6.x/pixel-art/svg?seed=${encodeURIComponent(user.email+'-d')}`,
    `https://api.dicebear.com/6.x/croodles/svg?seed=${encodeURIComponent(user.email+'-e')}`,
    `https://api.dicebear.com/6.x/identicon/svg?seed=${encodeURIComponent(user.email+'-f')}&background=%23f3f4f6`
  ]

  return (
    <>
    <Card>
      <Card.Body>
        {notice && <Alert variant={notice.variant} className="mb-3">{notice.message}</Alert>}
        <Row>
          <Col md={3} className="d-flex justify-content-center">
            {currentAvatar ? (
              <Image src={currentAvatar} roundedCircle style={{ width: 110, height: 110, objectFit: 'cover' }} />
            ) : (
              <div style={{
                width: 96,
                height: 96,
                borderRadius: '50%',
                background: '#f1f3f5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 32,
                color: '#495057'
              }}>{initials}</div>
            )}
          </Col>
          <Col md={9}>
            <h5 className="mb-1">{currentDisplayName}</h5>
            <div className="text-muted small mb-1">{user.email}</div>
            <div className="mb-2">
              <Badge bg="secondary" className="me-1">ID: {user.id}</Badge>
              {appmeta.provider && <Badge bg="info" className="me-1">{appmeta.provider}</Badge>}
            </div>

            <ListGroup variant="flush">
              <ListGroup.Item><strong>Display name:</strong> {currentDisplayName}</ListGroup.Item>
              <ListGroup.Item><strong>Created:</strong> {new Date(user.created_at).toLocaleString()}</ListGroup.Item>
              <ListGroup.Item><strong>Phone:</strong> {currentPhone}</ListGroup.Item>
              <ListGroup.Item><strong>Role/App meta:</strong> {JSON.stringify(appmeta)}</ListGroup.Item>
              <ListGroup.Item><strong>User meta:</strong> {Object.keys(metadata).length ? JSON.stringify(metadata) : '-'}</ListGroup.Item>
            </ListGroup>

            <div className="mt-3">
              <Button size="sm" variant="outline-primary" className="me-2" onClick={() => navigator.clipboard.writeText(user.id)}>Copy ID</Button>
              <Button size="sm" variant="outline-secondary" className="me-2" onClick={() => navigator.clipboard.writeText(user.email)}>Copy Email</Button>
              <Button size="sm" variant="outline-success" onClick={() => setShowModal(true)}>Edit Profile</Button>
            </div>
          </Col>
        </Row>
      </Card.Body>
    </Card>
    
    <Modal show={showModal} onHide={() => setShowModal(false)} contentClassName="modal-desk">
      <Modal.Header closeButton>
        <Modal.Title>Edit Profile</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <Form.Group className="mb-3">
            <Form.Label>Display name</Form.Label>
            <Form.Control value={displayNameInput} onChange={(e) => setDisplayNameInput(e.target.value)} placeholder="Nama tampilan" />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Phone</Form.Label>
            <Form.Control value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} placeholder="+628..." />
            <Form.Text className="text-muted">Disimpan ke Supabase auth metadata.</Form.Text>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Avatar image URL</Form.Label>
            <Form.Control value={avatarInput} onChange={(e) => applyAvatarUrl(e.target.value)} placeholder="https://..." />
            <Form.Text className="text-muted">You can paste an image URL, upload a file, or use a generated avatar below.</Form.Text>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Or upload image</Form.Label>
            <Form.Control
              type="file"
              accept="image/*"
              onChange={(e) => {
                const selected = e.target.files?.[0] || null
                const fileErr = validateAvatarFile(selected)
                if (fileErr) {
                  setNotice({ variant: 'warning', message: fileErr })
                  setFile(null)
                  e.target.value = null
                  return
                }
                setFile(selected)
              }}
            />
          </Form.Group>

          <div className="mb-3">
            <Form.Label>Generated avatars</Form.Label>
            <div className="d-flex gap-2">
              {[1,2,3].map(i => {
                const url = `https://api.dicebear.com/6.x/identicon/svg?seed=${encodeURIComponent(user.email+'-'+i)}`
                return (
                  <Image key={i} src={url} style={{ width:48, height:48, cursor:'pointer' }} onClick={() => applyAvatarUrl(url)} rounded />
                )
              })}
            </div>
          </div>

          <div className="mb-3">
            <Form.Label>Sample Avatars</Form.Label>
            <div className="d-flex gap-2 flex-wrap">
              {SAMPLE_AVATARS.map((u, idx) => (
                <Image key={idx} src={u} style={{ width:48, height:48, cursor:'pointer' }} onClick={() => applyAvatarUrl(u)} rounded />
              ))}
            </div>
          </div>

          <div className="mb-3">
            <Form.Label>Iconify Avatars</Form.Label>
            <div className="d-flex gap-2 flex-wrap">
              {ICONIFY_ICON_NAMES.map((iconName, idx) => {
                const palette = ICONIFY_AVATAR_PALETTES[idx % ICONIFY_AVATAR_PALETTES.length]
                const url = buildIconifyAvatarUrl(iconName, palette.fg, palette.bg)
                return (
                  <Image
                    key={iconName}
                    src={url}
                    style={{ width: 48, height: 48, cursor: 'pointer', objectFit: 'cover' }}
                    onClick={() => applyAvatarUrl(url)}
                    roundedCircle
                    title={iconName}
                  />
                )
              })}
            </div>
            <Form.Text className="text-muted">Avatar icon from Iconify API.</Form.Text>
          </div>

          {avatarInput && (
            <div className="text-center mb-2">
              <Image src={avatarInput} style={{ width:80, height:80, objectFit:'cover' }} />
            </div>
          )}
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setShowModal(false)} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={async () => {
          setSaving(true)
          setNotice(null)
          try {
            const normalizedPhone = String(phoneInput || '').trim()
            const phoneErr = validatePhoneInput(normalizedPhone)
            if (phoneErr) throw new Error(phoneErr)
            const normalizedDisplayName = String(displayNameInput || '').trim()
            const existingMetadata = user.user_metadata || {}
            const existingAvatarUrl = String(existingMetadata.avatar_url || '').trim()
            const existingAvatarPath = resolveAvatarPathFromMetadata(existingMetadata, AVATAR_BUCKET)
            let nextAvatarUrl = existingAvatarUrl || null
            let nextAvatarPath = existingAvatarPath || null
            const normalizedAvatarInput = String(avatarInput || '').trim()

            // If user selected a file, upload to Supabase Storage bucket 'avatars'
            if (file) {
              const fileErr = validateAvatarFile(file)
              if (fileErr) throw new Error(fileErr)
              // ensure file name safe
              const extRaw = file.name.includes('.') ? file.name.split('.').pop() : (file.type.split('/')[1] || 'png')
              const ext = String(extRaw || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
              // Use per-user folder path to match common Supabase Storage RLS policy patterns.
              const filePath = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
              const { error: uploadErr } = await supabase.storage.from(AVATAR_BUCKET).upload(filePath, file, { upsert: false })
              if (uploadErr) throw new Error(mapStorageUploadError(uploadErr))
              nextAvatarPath = filePath
              nextAvatarUrl = null
            } else {
              const avatarUrlChanged = normalizedAvatarInput !== existingAvatarUrl
              if (avatarUrlChanged) {
                if (!normalizedAvatarInput) {
                  nextAvatarUrl = null
                  nextAvatarPath = null
                } else {
                  const pastedStoragePath = extractAvatarPathFromStorageUrl(normalizedAvatarInput, AVATAR_BUCKET)
                  if (pastedStoragePath) {
                    nextAvatarPath = pastedStoragePath
                    nextAvatarUrl = null
                  } else {
                    nextAvatarUrl = normalizedAvatarInput
                    nextAvatarPath = null
                  }
                }
              }
            }

            const mergedMetadata = {
              ...(user.user_metadata || {}),
              avatar_url: nextAvatarUrl,
              avatar_path: nextAvatarPath,
              display_name: normalizedDisplayName || null,
              phone: normalizedPhone || null
            }
            const { data: updatedAuthData, error: authErr } = await supabase.auth.updateUser({ data: mergedMetadata })
            if (authErr) throw authErr

            setNotice({ variant: 'success', message: 'Profil berhasil disimpan ke Supabase.' })
            // Use updateUser result first so avatar/display name changes immediately in UI.
            const nextUser = updatedAuthData?.user || mergeUserMetadataLocally(user, mergedMetadata)
            setUser(nextUser)
            setAvatarInput(nextAvatarUrl || '')
            setDisplayNameInput(normalizedDisplayName || '')
            setPhoneInput(normalizedPhone || '')
            setShowModal(false)
          } catch (err) {
            console.error('Failed to update profile', err)
            setNotice({ variant: 'danger', message: err?.message || 'Gagal menyimpan profil' })
          } finally {
            setSaving(false)
            setFile(null)
          }
        }} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
      </Modal.Footer>
    </Modal>
    </>
  )
}
