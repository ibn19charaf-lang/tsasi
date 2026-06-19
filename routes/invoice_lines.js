import express from 'express'
import { pool } from '../db.js'
import { authMiddleware, requireRole } from '../middleware.js'

const router = express.Router()

// Protect all invoice_lines routes with authentication
router.use(authMiddleware)

router.get('/', async (req, res) => {
  try { const [rows] = await pool.query('SELECT * FROM invoice_lines ORDER BY created_at DESC'); res.json(rows) } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/', async (req, res) => {
  try {
    const { invoice_id, medication_id, description, quantity, unit_cents, tax_percent, line_total_cents } = req.body
    
    // Validate required fields
    if (!invoice_id || !description) {
      return res.status(400).json({ error: 'invoice_id and description are required' })
    }

    // Verify invoice exists
    const [invoiceCheck] = await pool.query('SELECT id FROM invoices WHERE id = ?', [invoice_id])
    if (!invoiceCheck.length) {
      return res.status(404).json({ error: 'Invoice not found' })
    }

    // Verify medication exists if provided
    if (medication_id) {
      const [medCheck] = await pool.query('SELECT id FROM medications WHERE id = ?', [medication_id])
      if (!medCheck.length) {
        return res.status(404).json({ error: 'Medication not found' })
      }
    }

    // Validate numeric fields
    if (quantity !== undefined && (typeof quantity !== 'number' || quantity <= 0)) {
      return res.status(400).json({ error: 'quantity must be a positive number' })
    }

    if (unit_cents !== undefined && (typeof unit_cents !== 'number' || unit_cents < 0)) {
      return res.status(400).json({ error: 'unit_cents must be a non-negative number' })
    }

    if (tax_percent !== undefined && (typeof tax_percent !== 'number' || tax_percent < 0 || tax_percent > 100)) {
      return res.status(400).json({ error: 'tax_percent must be between 0 and 100' })
    }

    if (line_total_cents !== undefined && (typeof line_total_cents !== 'number' || line_total_cents < 0)) {
      return res.status(400).json({ error: 'line_total_cents must be a non-negative number' })
    }

    // Validate description
    if (typeof description !== 'string' || description.trim().length === 0) {
      return res.status(400).json({ error: 'description must be a non-empty string' })
    }

    const [[u]] = await pool.query('SELECT UUID() as id')
    const id = u.id
    
    await pool.query(
      'INSERT INTO invoice_lines (id, invoice_id, medication_id, description, quantity, unit_cents, tax_percent, line_total_cents, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)', 
      [id, invoice_id, medication_id || null, description.trim(), quantity || 1, unit_cents || 0, tax_percent || null, line_total_cents || 0, req.user.id]
    )
    const [rows] = await pool.query('SELECT * FROM invoice_lines WHERE id = ?', [id])
    res.status(201).json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try { 
    const [result] = await pool.query('DELETE FROM invoice_lines WHERE id = ?', [req.params.id]); 
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Line not found' }); 
    res.status(204).send() 
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put('/:id', async (req, res) => {
  try {
    const { description, quantity, unit_cents, tax_percent, line_total_cents } = req.body
    
    const [existing] = await pool.query('SELECT * FROM invoice_lines WHERE id = ?', [req.params.id])
    if (!existing.length) return res.status(404).json({ error: 'Line not found' })
    
    // Validate numeric fields if provided
    if (quantity !== undefined && (typeof quantity !== 'number' || quantity <= 0)) {
      return res.status(400).json({ error: 'quantity must be a positive number' })
    }

    if (unit_cents !== undefined && (typeof unit_cents !== 'number' || unit_cents < 0)) {
      return res.status(400).json({ error: 'unit_cents must be a non-negative number' })
    }

    if (tax_percent !== undefined && (typeof tax_percent !== 'number' || tax_percent < 0 || tax_percent > 100)) {
      return res.status(400).json({ error: 'tax_percent must be between 0 and 100' })
    }

    if (line_total_cents !== undefined && (typeof line_total_cents !== 'number' || line_total_cents < 0)) {
      return res.status(400).json({ error: 'line_total_cents must be a non-negative number' })
    }

    // Validate description if provided
    if (description && (typeof description !== 'string' || description.trim().length === 0)) {
      return res.status(400).json({ error: 'description must be a non-empty string' })
    }

    await pool.query(
      'UPDATE invoice_lines SET description = ?, quantity = ?, unit_cents = ?, tax_percent = ?, line_total_cents = ?, updated_at = NOW(), updated_by = ? WHERE id = ?', 
      [
        description ? description.trim() : existing[0].description, 
        quantity ?? existing[0].quantity, 
        unit_cents ?? existing[0].unit_cents, 
        tax_percent ?? existing[0].tax_percent, 
        line_total_cents ?? existing[0].line_total_cents, 
        req.user.id,
        req.params.id
      ]
    )
    const [rows] = await pool.query('SELECT * FROM invoice_lines WHERE id = ?', [req.params.id])
    res.json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

export default router
