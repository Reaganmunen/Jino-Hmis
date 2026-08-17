// Restricts a route to specific roles. Must run AFTER verifyToken (needs req.user).
// Usage: router.post('/inventory', verifyToken, authorizeRoles('admin'), createItem);
//        router.get('/bills', verifyToken, authorizeRoles('admin', 'receptionist'), listBills);
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to perform this action' });
    }

    next();
  };
};

// Allows a patient to access only their own record, OR staff roles to access any.
// Usage: router.get('/patients/:patientId/bills', verifyToken, allowSelfOrRoles('admin', 'receptionist'), getBills);
// Requires the route/controller to resolve req.params.patientId against the logged-in patient.
const allowSelfOrStaff = (staffRoles, getPatientIdFromReq) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (staffRoles.includes(req.user.role)) {
      return next();
    }

    if (req.user.role === 'patient') {
      const requestedPatientId = getPatientIdFromReq(req);
      if (req.user.patient_id && req.user.patient_id === requestedPatientId) {
        return next();
      }
    }

    return res.status(403).json({ message: 'You do not have permission to access this resource' });
  };
};

// Same shape as allowSelfOrStaff but for resources owned by a dentist via
// dentist_id, which references User.id directly (dentists don't have a
// separate profile table the way patients do via Patient.id).
// Usage: router.get('/appointments/dentist/:dentistId', verifyToken,
//          allowDentistSelfOrStaff(STAFF, (req) => req.params.dentistId), getDentistAppointments);
const allowDentistSelfOrStaff = (staffRoles, getDentistIdFromReq) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (staffRoles.includes(req.user.role)) {
      return next();
    }

    if (req.user.role === 'dentist') {
      const requestedDentistId = getDentistIdFromReq(req);
      if (requestedDentistId && req.user.id === requestedDentistId) {
        return next();
      }
    }

    return res.status(403).json({ message: 'You do not have permission to access this resource' });
  };
};

module.exports = { authorizeRoles, allowSelfOrStaff, allowDentistSelfOrStaff };