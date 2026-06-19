import express from 'express'
import { pool } from '../db.js'
import { authMiddleware, requireRole } from '../middleware.js'

const router = express.Router()

// Protect all invoice routes with authentication
router.use(authMiddleware)

router.get('/', async (req, res) => {
  try { const [rows] = await pool.query('SELECT * FROM invoices ORDER BY created_at DESC'); res.json(rows) } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/:id', async (req, res) => {
  try { 
    const [rows] = await pool.query('SELECT * FROM invoices WHERE id = ?', [req.params.id]); 
    if (!rows.length) return res.status(404).json({ error: 'Invoice not found' }); 
    res.json(rows[0]) 
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/', async (req, res) => {
  try {
    const { number, patient_id, status, subtotal_cents, tax_cents, total_cents, issued_at, due_at } = req.body
    
    // Validate required fields
    if (!number) {
      return res.status(400).json({ error: 'number is required' })
    }

    // Validate numeric fields
    if (subtotal_cents !== undefined && (typeof subtotal_cents !== 'number' || subtotal_cents < 0)) {
      return res.status(400).json({ error: 'subtotal_cents must be a non-negative number' })
    }

    if (tax_cents !== undefined && (typeof tax_cents !== 'number' || tax_cents < 0)) {
      return res.status(400).json({ error: 'tax_cents must be a non-negative number' })
    }

    if (total_cents !== undefined && (typeof total_cents !== 'number' || total_cents < 0)) {
      return res.status(400).json({ error: 'total_cents must be a non-negative number' })
    }

    // Validate dates if provided
    if (issued_at && isNaN(Date.parse(issued_at))) {
      return res.status(400).json({ error: 'issued_at must be a valid date' })
    }

    if (due_at && isNaN(Date.parse(due_at))) {
      return res.status(400).json({ error: 'due_at must be a valid date' })
    }

    // Verify patient exists if provided
    if (patient_id) {
      const [patientCheck] = await pool.query('SELECT id FROM patients WHERE id = ?', [patient_id])
      if (!patientCheck.length) {
        return res.status(404).json({ error: 'Patient not found' })
      }
    }

    // Validate status
    const validStatuses = ['draft', 'issued', 'paid', 'overdue', 'cancelled']
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` })
    }

    const [[u]] = await pool.query('SELECT UUID() as id')
    const id = u.id
    
    await pool.query(
      'INSERT INTO invoices (id, number, patient_id, status, subtotal_cents, tax_cents, total_cents, issued_at, due_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)', 
      [id, number, patient_id || null, status || 'draft', subtotal_cents || 0, tax_cents || 0, total_cents || 0, issued_at || null, due_at || null, req.user.id]
    )
    const [rows] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id])
    res.status(201).json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put('/:id', async (req, res) => {
  try {
    const { status, due_at } = req.body
    
    const [existing] = await pool.query('SELECT * FROM invoices WHERE id = ?', [req.params.id])
    if (!existing.length) return res.status(404).json({ error: 'Invoice not found' })
    
    // Validate status if provided
    const validStatuses = ['draft', 'issued', 'paid', 'overdue', 'cancelled']
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` })
    }

    // Validate due_at if provided
    if (due_at && isNaN(Date.parse(due_at))) {
      return res.status(400).json({ error: 'due_at must be a valid date' })
    }

    await pool.query(
      'UPDATE invoices SET status = ?, due_at = ?, updated_at = NOW(), updated_by = ? WHERE id = ?', 
      [status ?? existing[0].status, due_at ?? existing[0].due_at, req.user.id, req.params.id]
    )
    const [rows] = await pool.query('SELECT * FROM invoices WHERE id = ?', [req.params.id])
    res.json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try { 
    // Check if invoice has related payments
    const [payments] = await pool.query('SELECT COUNT(*) as count FROM payments WHERE invoice_id = ?', [req.params.id])
    
    if (payments[0].count > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete invoice with associated payments',
        details: {
          payments: payments[0].count
        }
      })
    }

    const [result] = await pool.query('DELETE FROM invoices WHERE id = ?', [req.params.id]); 
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Invoice not found' }); 
    res.status(204).send() 
  } catch (err) { res.status(500).json({ error: err.message }) }
})

export default router
