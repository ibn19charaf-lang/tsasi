import express from 'express'
import { pool } from '../db.js'
import { authMiddleware, requireRole } from '../middleware.js'

const router = express.Router()

// Protect all appointment routes with authentication
router.use(authMiddleware)

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM appointments ORDER BY scheduled_at DESC')
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM appointments WHERE id = ?', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Appointment not found' })
    res.json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/', async (req, res) => {
  try {
    // Validate required fields
    const { patient_id, scheduled_at, status, notes } = req.body
    
    if (!patient_id || !scheduled_at) {
      return res.status(400).json({ error: 'patient_id and scheduled_at are required' })
    }

    // Verify patient exists
    const [patientCheck] = await pool.query('SELECT id FROM patients WHERE id = ?', [patient_id])
    if (!patientCheck.length) {
      return res.status(404).json({ error: 'Patient not found' })
    }

    const [[u]] = await pool.query('SELECT UUID() as id')
    const id = u.id
    await pool.query('INSERT INTO appointments (id, patient_id, scheduled_at, status, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, NOW(), ?)', 
      [id, patient_id, scheduled_at, status || 'pending', notes || null, req.user.id])
    const [rows] = await pool.query('SELECT * FROM appointments WHERE id = ?', [id])
    res.status(201).json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put('/:id', async (req, res) => {
  try {
    const { scheduled_at, status, notes } = req.body
    const [existing] = await pool.query('SELECT * FROM appointments WHERE id = ?', [req.params.id])
    if (!existing.length) return res.status(404).json({ error: 'Appointment not found' })
    
    await pool.query('UPDATE appointments SET scheduled_at = ?, status = ?, notes = ?, updated_at = NOW(), updated_by = ? WHERE id = ?', 
      [scheduled_at ?? existing[0].scheduled_at, status ?? existing[0].status, notes ?? existing[0].notes, req.user.id, req.params.id])
    const [rows] = await pool.query('SELECT * FROM appointments WHERE id = ?', [req.params.id])
    res.json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM appointments WHERE id = ?', [req.params.id])
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Appointment not found' })
    res.status(204).send()
  } catch (err) { res.status(500).json({ error: err.message }) }
})

export default router
