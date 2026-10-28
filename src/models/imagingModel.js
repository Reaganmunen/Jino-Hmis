const pool = require('../config/db');

// Metadata only — never selects the image bytes, so list calls stay light.
const META = `
  s.id, s.patient_id, s.image_type, s.tooth_numbers,
  to_char(s.captured_at, 'YYYY-MM-DD') AS captured_at,
  s.notes, s.findings, s.mime_type, s.size_bytes,
  (s.thumb_data IS NOT NULL) AS has_thumb,
  s.created_at, s.updated_at, s.uploaded_by,
  u.first_name AS uploader_first_name, u.last_name AS uploader_last_name
`;
const FROM = `FROM "ImagingStudy" s JOIN "User" u ON u.id = s.uploaded_by`;

const createStudy = (d, callback) => {
  const query = `
    INSERT INTO "ImagingStudy"
      (patient_id, uploaded_by, image_type, tooth_numbers, captured_at, notes, findings,
       mime_type, size_bytes, image_data)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING id
  `;
  const values = [
    d.patient_id, d.uploaded_by, d.image_type, d.tooth_numbers, d.captured_at, d.notes, d.findings,
    d.mime_type, d.image_data.length, d.image_data,
  ];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    findStudyById(result.rows[0].id, callback);
  });
};

const findStudiesByPatient = (patient_id, { tooth, image_type } = {}, callback) => {
  const params = [patient_id];
  let where = 's.patient_id = $1 AND s.deleted_at IS NULL';
  if (tooth) { params.push(tooth); where += ` AND $${params.length} = ANY(s.tooth_numbers)`; }
  if (image_type) { params.push(image_type); where += ` AND s.image_type = $${params.length}`; }
  const query = `SELECT ${META} ${FROM} WHERE ${where}
    ORDER BY s.captured_at DESC, s.created_at DESC LIMIT 500`;
  pool.query(query, params, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const findStudyById = (id, callback) => {
  const query = `SELECT ${META} ${FROM} WHERE s.id = $1 AND s.deleted_at IS NULL`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

// kind: 'image' | 'thumb'. Thumb falls back to the full image if none was stored.
const findStudyBytes = (id, kind, callback) => {
  const query = `
    SELECT mime_type,
           ${kind === 'thumb' ? 'COALESCE(thumb_data, image_data)' : 'image_data'} AS data,
           (${kind === 'thumb' ? 'thumb_data IS NOT NULL' : 'true'}) AS is_own_type
    FROM "ImagingStudy" WHERE id = $1 AND deleted_at IS NULL
  `;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const setThumb = (id, thumb, callback) => {
  pool.query(
    `UPDATE "ImagingStudy" SET thumb_data = $2 WHERE id = $1 AND deleted_at IS NULL`,
    [id, thumb],
    (err, result) => (err ? callback(err) : callback(null, result.rowCount)),
  );
};

const updateStudyMeta = (id, d, callback) => {
  const query = `
    UPDATE "ImagingStudy"
    SET image_type = $2, tooth_numbers = $3, captured_at = $4, notes = $5, findings = $6,
        updated_at = now()
    WHERE id = $1 AND deleted_at IS NULL
  `;
  pool.query(query, [id, d.image_type, d.tooth_numbers, d.captured_at, d.notes, d.findings], (err, result) => {
    if (err) return callback(err);
    if (!result.rowCount) return callback(null, null);
    findStudyById(id, callback);
  });
};

const softDeleteStudy = (id, user_id, callback) => {
  pool.query(
    `UPDATE "ImagingStudy" SET deleted_at = now(), deleted_by = $2 WHERE id = $1 AND deleted_at IS NULL`,
    [id, user_id],
    (err, result) => (err ? callback(err) : callback(null, result.rowCount)),
  );
};

module.exports = {
  createStudy, findStudiesByPatient, findStudyById, findStudyBytes,
  setThumb, updateStudyMeta, softDeleteStudy,
};
