import express from 'express'
import { pool } from '../db.js'
import { authMiddleware, requireRole } from '../middleware.js'

const router = express.Router()

// Protect all prescription routes with authentication
router.use(authMiddleware)

router.get('/', async (req, res) => {
  try { const [rows] = await pool.query('SELECT * FROM prescriptions ORDER BY created_at DESC'); res.json(rows) } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/:id', async (req, res) => {
  try { 
    const [rows] = await pool.query('SELECT * FROM prescriptions WHERE id = ?', [req.params.id]); 
    if (!rows.length) return res.status(404).json({ error: 'Prescription not found' }); 
    res.json(rows[0]) 
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/', async (req, res) => {
  try {
    const { patient_id, medication_id, dose } = req.body
    
    // Validate required fields
    if (!patient_id || !medication_id || !dose) {
      return res.status(400).json({ error: 'patient_id, medication_id, and dose are required' })
    }

    // Verify patient exists
    const [patientCheck] = await pool.query('SELECT id FROM patients WHERE id = ?', [patient_id])
    if (!patientCheck.length) {
      return res.status(404).json({ error: 'Patient not found' })
    }

    // Verify medication exists
    const [medicationCheck] = await pool.query('SELECT id FROM medications WHERE id = ?', [medication_id])
    if (!medicationCheck.length) {
      return res.status(404).json({ error: 'Medication not found' })
    }

    // Validate dose format
    if (typeof dose !== 'string' || dose.trim().length === 0) {
      return res.status(400).json({ error: 'dose must be a non-empty string' })
    }

    const [[u]] = await pool.query('SELECT UUID() as id')
    const id = u.id
    
    await pool.query(
      'INSERT INTO prescriptions (id, patient_id, medication_id, dose, created_at, created_by) VALUES (?, ?, ?, ?, NOW(), ?)', 
      [id, patient_id, medication_id, dose.trim(), req.user.id]
    )
    const [rows] = await pool.query('SELECT * FROM prescriptions WHERE id = ?', [id])
    res.status(201).json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put('/:id', async (req, res) => {
  try {
    const { dose } = req.body
    
    const [existing] = await pool.query('SELECT * FROM prescriptions WHERE id = ?', [req.params.id])
    if (!existing.length) return res.status(404).json({ error: 'Prescription not found' })
    
    // Validate dose if provided
    if (dose && (typeof dose !== 'string' || dose.trim().length === 0)) {
      return res.status(400).json({ error: 'dose must be a non-empty string' })
    }

    await pool.query(
      'UPDATE prescriptions SET dose = ?, updated_at = NOW(), updated_by = ? WHERE id = ?', 
      [dose ? dose.trim() : existing[0].dose, req.user.id, req.params.id]
    )
    const [rows] = await pool.query('SELECT * FROM prescriptions WHERE id = ?', [req.params.id])
    res.json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try { 
    const [result] = await pool.query('DELETE FROM prescriptions WHERE id = ?', [req.params.id]); 
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Prescription not found' }); 
    res.status(204).send() 
  } catch (err) { res.status(500).json({ error: err.message }) }
})

export default router
