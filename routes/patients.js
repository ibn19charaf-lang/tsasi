import express from 'express'
import { pool } from '../db.js'
import { authMiddleware, requireRole } from '../middleware.js'

const router = express.Router()

// Protect all patient routes with authentication
router.use(authMiddleware)

// GET list
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM patients ORDER BY last_name, first_name')
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET by id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM patients WHERE id = ?', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Patient not found' })
    res.json(rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST create
router.post('/', async (req, res) => {
  try {
    const { first_name, last_name, dob, gender, identifier, medical_record } = req.body
    
    // Validate required fields
    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'first_name and last_name are required' })
    }

    // Validate data types and formats
    if (typeof first_name !== 'string' || first_name.trim().length === 0) {
      return res.status(400).json({ error: 'first_name must be a non-empty string' })
    }

    if (typeof last_name !== 'string' || last_name.trim().length === 0) {
      return res.status(400).json({ error: 'last_name must be a non-empty string' })
    }

    if (gender && !['M', 'F', 'O'].includes(gender)) {
      return res.status(400).json({ error: 'gender must be M, F, or O' })
    }

    // Validate date format if provided
    if (dob && isNaN(Date.parse(dob))) {
      return res.status(400).json({ error: 'dob must be a valid date' })
    }

    const [[uid]] = await pool.query('SELECT UUID() as id')
    const id = uid.id
    
    await pool.query(
      'INSERT INTO patients (id, first_name, last_name, dob, gender, identifier, medical_record, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)',
      [id, first_name.trim(), last_name.trim(), dob || null, gender || null, identifier || null, medical_record || null, req.user.id]
    )
    const [rows] = await pool.query('SELECT * FROM patients WHERE id = ?', [id])
    res.status(201).json(rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT update
router.put('/:id', async (req, res) => {
  try {
    const { first_name, last_name, dob, gender, identifier, medical_record } = req.body
    
    const [existing] = await pool.query('SELECT * FROM patients WHERE id = ?', [req.params.id])
    if (existing.length === 0) return res.status(404).json({ error: 'Patient not found' })
    
    // Validate data types if provided
    if (first_name && typeof first_name !== 'string') {
      return res.status(400).json({ error: 'first_name must be a string' })
    }

    if (last_name && typeof last_name !== 'string') {
      return res.status(400).json({ error: 'last_name must be a string' })
    }

    if (gender && !['M', 'F', 'O'].includes(gender)) {
      return res.status(400).json({ error: 'gender must be M, F, or O' })
    }

    if (dob && isNaN(Date.parse(dob))) {
      return res.status(400).json({ error: 'dob must be a valid date' })
    }

    await pool.query(
      'UPDATE patients SET first_name = ?, last_name = ?, dob = ?, gender = ?, identifier = ?, medical_record = ?, updated_at = NOW(), updated_by = ? WHERE id = ?',
      [
        first_name ? first_name.trim() : existing[0].first_name, 
        last_name ? last_name.trim() : existing[0].last_name, 
        dob ?? existing[0].dob, 
        gender ?? existing[0].gender, 
        identifier ?? existing[0].identifier, 
        medical_record ?? existing[0].medical_record, 
        req.user.id,
        req.params.id
      ]
    )
    const [rows] = await pool.query('SELECT * FROM patients WHERE id = ?', [req.params.id])
    res.json(rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE - Admin only (soft delete recommended)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    // Soft delete - check if patient has related records
    const [appointments] = await pool.query('SELECT COUNT(*) as count FROM appointments WHERE patient_id = ?', [req.params.id])
    const [invoices] = await pool.query('SELECT COUNT(*) as count FROM invoices WHERE patient_id = ?', [req.params.id])
    
    if (appointments[0].count > 0 || invoices[0].count > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete patient with related appointments or invoices',
        details: {
          appointments: appointments[0].count,
          invoices: invoices[0].count
        }
      })
    }

    const [result] = await pool.query('DELETE FROM patients WHERE id = ?', [req.params.id])
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Patient not found' })
    res.status(204).send()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
