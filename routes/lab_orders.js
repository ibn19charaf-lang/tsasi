import express from 'express'
import { pool } from '../db.js'
import { authMiddleware, requireRole } from '../middleware.js'

const router = express.Router()

// Protect all lab_orders routes with authentication
router.use(authMiddleware)

router.get('/', async (req, res) => {
  try { const [rows] = await pool.query('SELECT * FROM lab_orders ORDER BY ordered_at DESC'); res.json(rows) } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/:id', async (req, res) => {
  try { const [rows] = await pool.query('SELECT * FROM lab_orders WHERE id = ?', [req.params.id]); if (!rows.length) return res.status(404).json({ error: 'Order not found' }); res.json(rows[0]) } catch (err) { res.status(500).json({ error: err.message }) }
})

// order details with items and results
router.get('/:id/details', async (req, res) => {
  try {
    const [[order]] = await pool.query('SELECT * FROM lab_orders WHERE id = ?', [req.params.id])
    if (!order) return res.status(404).json({ error: 'Order not found' })
    const [items] = await pool.query(`
      SELECT oi.*, tc.code AS test_code, tc.name AS test_name, tc.price_cents
      FROM lab_order_items oi
      LEFT JOIN lab_test_catalog tc ON tc.id = oi.test_id
      WHERE oi.order_id = ?
    `, [req.params.id])
    // fetch results for the order items
    let results = []
    if (items.length > 0) {
      const ids = items.map(i => i.id)
      const placeholders = ids.map(() => '?').join(',')
      const [r] = await pool.query(`SELECT * FROM lab_results WHERE order_item_id IN (${placeholders})`, ids)
      results = r
    }
    res.json({ order, items, results })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// search orders
router.get('/search', async (req, res) => {
  try {
    const { patient_id, status, from, to } = req.query
    let query = 'SELECT * FROM lab_orders WHERE 1=1'
    const params = []
    if (patient_id) { query += ' AND patient_id = ?'; params.push(patient_id) }
    if (status) { query += ' AND status = ?'; params.push(status) }
    if (from) { query += ' AND ordered_at >= ?'; params.push(from) }
    if (to) { query += ' AND ordered_at <= ?'; params.push(to) }
    query += ' ORDER BY ordered_at DESC'
    const [rows] = await pool.query(query, params)
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/', async (req, res) => {
  try {
    const { patient_id, ordered_by, status, priority, notes } = req.body
    
    // Validate required fields
    if (!patient_id) {
      return res.status(400).json({ error: 'patient_id is required' })
    }

    // Verify patient exists
    const [patientCheck] = await pool.query('SELECT id FROM patients WHERE id = ?', [patient_id])
    if (!patientCheck.length) {
      return res.status(404).json({ error: 'Patient not found' })
    }

    // Validate status
    const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled']
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` })
    }

    // Validate priority
    const validPriorities = ['normal', 'urgent', 'stat']
    if (priority && !validPriorities.includes(priority)) {
      return res.status(400).json({ error: `priority must be one of: ${validPriorities.join(', ')}` })
    }

    const [[u]] = await pool.query('SELECT UUID() as id')
    const id = u.id
    
    await pool.query(
      'INSERT INTO lab_orders (id, patient_id, ordered_by, status, priority, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)', 
      [id, patient_id, ordered_by || null, status || 'pending', priority || 'normal', notes || null, req.user.id]
    )
    const [rows] = await pool.query('SELECT * FROM lab_orders WHERE id = ?', [id])
    res.status(201).json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put('/:id', async (req, res) => {
  try {
    const { status, priority, notes } = req.body
    
    const [existing] = await pool.query('SELECT * FROM lab_orders WHERE id = ?', [req.params.id])
    if (!existing.length) return res.status(404).json({ error: 'Order not found' })
    
    // Validate status if provided
    const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled']
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` })
    }

    // Validate priority if provided
    const validPriorities = ['normal', 'urgent', 'stat']
    if (priority && !validPriorities.includes(priority)) {
      return res.status(400).json({ error: `priority must be one of: ${validPriorities.join(', ')}` })
    }

    await pool.query(
      'UPDATE lab_orders SET status = ?, priority = ?, notes = ?, updated_at = NOW(), updated_by = ? WHERE id = ?', 
      [status ?? existing[0].status, priority ?? existing[0].priority, notes ?? existing[0].notes, req.user.id, req.params.id]
    )
    const [rows] = await pool.query('SELECT * FROM lab_orders WHERE id = ?', [req.params.id])
    res.json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    // Check if order has related items or results
    const [items] = await pool.query('SELECT COUNT(*) as count FROM lab_order_items WHERE order_id = ?', [req.params.id])
    const [results] = await pool.query('SELECT COUNT(*) as count FROM lab_results WHERE order_id = ?', [req.params.id])
    
    if (items[0].count > 0 || results[0].count > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete order with associated items or results',
        details: {
          items: items[0].count,
          results: results[0].count
        }
      })
    }

    const [result] = await pool.query('DELETE FROM lab_orders WHERE id = ?', [req.params.id]); 
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Order not found' }); 
    res.status(204).send() 
  } catch (err) { res.status(500).json({ error: err.message }) }
})

export default router
