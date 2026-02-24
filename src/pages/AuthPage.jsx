import React from 'react'
import { Container, Row, Col } from 'react-bootstrap'
import AuthForm from '../components/AuthForm'

export default function AuthPage() {
  return (
    <Container className="py-5">
      <Row>
        <Col md={6} className="mx-auto">
          <AuthForm />
        </Col>
      </Row>
    </Container>
  )
}
