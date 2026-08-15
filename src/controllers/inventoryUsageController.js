const pool = require('../config/db');
const { recordInventoryUsageWithClient } = require('../models/inventoryUsageModel');
const { adjustQuantityWithClient, findInventoryItemById } = require('../models/inventoryItemModel');
const { findUsageByAppointment, findUsageByItem } = require('../models/inventoryUsageModel');

// Logs usage AND decrements stock in a single transaction — either both happen
// or neither does, so the usage log can never drift from actual stock levels.
const recordUsage = (req, res, next) => {
  const { inventory_item_id, appointment_id, quantity_used } = req.body;
  if (!inventory_item_id || !quantity_used) {
    return res.status(400).json({ message: 'inventory_item_id and quantity_used are required' });
  }

  pool.connect((connectErr, client, release) => {
    if (connectErr) return next(connectErr);

    const rollback = (err) => {
      client.query('ROLLBACK', () => {
        release();
        next(err);
      });
    };

    client.query('BEGIN', (beginErr) => {
      if (beginErr) return rollback(beginErr);

      recordInventoryUsageWithClient(
        client,
        { inventory_item_id, appointment_id, quantity_used, recorded_by: req.user.id },
        (usageErr, usage) => {
          if (usageErr) return rollback(usageErr);

          adjustQuantityWithClient(client, inventory_item_id, -quantity_used, (adjustErr, item) => {
            if (adjustErr) return rollback(adjustErr);
            if (!item) return rollback(new Error('Inventory item not found'));
            if (Number(item.quantity) < 0) {
              return rollback(Object.assign(new Error('Not enough stock available'), { statusCode: 400 }));
            }

            client.query('COMMIT', (commitErr) => {
              release();
              if (commitErr) return next(commitErr);
              res.status(201).json({ usage, item });
            });
          });
        }
      );
    });
  });
};

const getUsageByAppointment = (req, res, next) => {
  findUsageByAppointment(req.params.appointmentId, (err, usage) => {
    if (err) return next(err);
    res.json(usage);
  });
};

const getUsageByItem = (req, res, next) => {
  findUsageByItem(req.params.itemId, (err, usage) => {
    if (err) return next(err);
    res.json(usage);
  });
};

module.exports = { recordUsage, getUsageByAppointment, getUsageByItem };