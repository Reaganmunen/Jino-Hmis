const {
  createInventoryItem, findInventoryItemById, listInventoryItems,
  findLowStockItems, updateInventoryItem, adjustQuantity,
} = require('../models/inventoryItemModel');

const addItem = (req, res, next) => {
  createInventoryItem(req.body, (err, item) => {
    if (err) return next(err);
    res.status(201).json(item);
  });
};

const getItem = (req, res, next) => {
  findInventoryItemById(req.params.id, (err, item) => {
    if (err) return next(err);
    if (!item) return res.status(404).json({ message: 'Inventory item not found' });
    res.json(item);
  });
};

const getAllItems = (req, res, next) => {
  listInventoryItems((err, items) => {
    if (err) return next(err);
    res.json(items);
  });
};

const getLowStock = (req, res, next) => {
  findLowStockItems((err, items) => {
    if (err) return next(err);
    res.json(items);
  });
};

const editItem = (req, res, next) => {
  updateInventoryItem(req.params.id, req.body, (err, item) => {
    if (err) return next(err);
    if (!item) return res.status(404).json({ message: 'Inventory item not found' });
    res.json(item);
  });
};

// Manual stock correction (e.g. restock delivery). For usage tied to an
// appointment, use POST /inventory-usage instead — that keeps stock and
// usage log in sync via a transaction.
const restockItem = (req, res, next) => {
  const { delta } = req.body;
  if (typeof delta !== 'number') return res.status(400).json({ message: 'delta must be a number' });
  adjustQuantity(req.params.id, delta, (err, item) => {
    if (err) return next(err);
    if (!item) return res.status(404).json({ message: 'Inventory item not found' });
    res.json(item);
  });
};

module.exports = { addItem, getItem, getAllItems, getLowStock, editItem, restockItem };