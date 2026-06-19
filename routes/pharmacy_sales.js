import express from 'express'
import { pool } from '../db.js'
import { authMiddleware, requireRole } from '../middleware.js'

const router = express.Router()

// Protect all pharmacy_sales routes with authentication
router.use(authMiddleware)

router.get('/', async (req, res) => {
  try { const [rows] = await pool.query('SELECT * FROM pharmacy_sales ORDER BY created_at DESC'); res.json(rows) } catch (err) { res.status(500).json({ error: err.message }) }
})

// Search/filter sales by patient, date range, status (must be before '/:id' route)
router.get('/search', async (req, res) => {
  try {
    const { patient_id, status, from, to } = req.query
    let query = 'SELECT ps.*, p.first_name, p.last_name FROM pharmacy_sales ps LEFT JOIN patients p ON p.id = ps.patient_id WHERE 1=1'
    const params = []
    if (patient_id) { query += ' AND ps.patient_id = ?'; params.push(patient_id) }
    if (status) { query += ' AND ps.status = ?'; params.push(status) }
    if (from) { query += ' AND ps.created_at >= ?'; params.push(from) }
    if (to) { query += ' AND ps.created_at <= ?'; params.push(to) }
    query += ' ORDER BY ps.created_at DESC'
    const [rows] = await pool.query(query, params)
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// sale details with lines
router.get('/:id/details', async (req, res) => {
  try {
    const [[sale]] = await pool.query('SELECT * FROM pharmacy_sales WHERE id = ?', [req.params.id])
    if (!sale) return res.status(404).json({ error: 'Sale not found' })
    const [lines] = await pool.query(`
      SELECT l.*, m.name AS medication_name, m.sku
      FROM pharmacy_sale_lines l
      LEFT JOIN medications m ON m.id = l.medication_id
      WHERE l.sale_id = ?
    `, [req.params.id])
    res.json({ ...sale, lines })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/', async (req, res) => {
  try {
    const { patient_id, user_id, invoice_id, total_cents, status, notes } = req.body
    
    // Validate required fields
    if (!patient_id || !user_id) {
      return res.status(400).json({ error: 'patient_id and user_id are required' })
    }

    // Verify patient exists
    const [patientCheck] = await pool.query('SELECT id FROM patients WHERE id = ?', [patient_id])
    if (!patientCheck.length) {
      return res.status(404).json({ error: 'Patient not found' })
    }

    // Verify user exists
    const [userCheck] = await pool.query('SELECT id FROM users WHERE id = ?', [user_id])
    if (!userCheck.length) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Verify invoice exists if provided
    if (invoice_id) {
      const [invoiceCheck] = await pool.query('SELECT id FROM invoices WHERE id = ?', [invoice_id])
      if (!invoiceCheck.length) {
        return res.status(404).json({ error: 'Invoice not found' })
      }
    }

    // Validate numeric fields
    if (total_cents !== undefined && (typeof total_cents !== 'number' || total_cents < 0)) {
      return res.status(400).json({ error: 'total_cents must be a non-negative number' })
    }

    // Validate status
    const validStatuses = ['pending', 'completed', 'cancelled']
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` })
    }

    const [[u]] = await pool.query('SELECT UUID() as id')
    const id = u.id
    
    await pool.query(
      'INSERT INTO pharmacy_sales (id, patient_id, user_id, invoice_id, total_cents, status, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)', 
      [id, patient_id, user_id, invoice_id || null, total_cents || 0, status || 'completed', notes || null, req.user.id]
    )
    const [rows] = await pool.query('SELECT * FROM pharmacy_sales WHERE id = ?', [id])
    res.status(201).json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put('/:id', async (req, res) => {
  try {
    const { status, notes } = req.body
    
    const [existing] = await pool.query('SELECT * FROM pharmacy_sales WHERE id = ?', [req.params.id])
    if (!existing.length) return res.status(404).json({ error: 'Sale not found' })
    
    // Validate status if provided
    const validStatuses = ['pending', 'completed', 'cancelled']
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` })
    }

    await pool.query(
      'UPDATE pharmacy_sales SET status = ?, notes = ?, updated_at = NOW(), updated_by = ? WHERE id = ?', 
      [status ?? existing[0].status, notes ?? existing[0].notes, req.user.id, req.params.id]
    )
    const [rows] = await pool.query('SELECT * FROM pharmacy_sales WHERE id = ?', [req.params.id])
    res.json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    // Check if sale has related lines
    const [lines] = await pool.query('SELECT COUNT(*) as count FROM pharmacy_sale_lines WHERE sale_id = ?', [req.params.id])
    
    if (lines[0].count > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete sale with associated lines',
        details: {
          lines: lines[0].count
        }
      })
    }

    const [result] = await pool.query('DELETE FROM pharmacy_sales WHERE id = ?', [req.params.id])
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Sale not found' })
    res.status(204).send()
  } catch (err) { res.status(500).json({ error: err.message }) }
})

export default router
