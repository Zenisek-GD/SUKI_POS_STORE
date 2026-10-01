import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cartAfterAdding,
  findScannedProduct,
  productMatches,
  wholeQuantity,
} from '../pos_frontend/src/lib/checkout.js';

const sardines = {
  id: 'sardines',
  name: 'Sardines',
  sku: 'SAR-001',
  product_code: 'P-0001',
  barcode: '4800000123456',
  active: true,
  stock: 12,
  unit: 'can',
};
const flour = {
  id: 'flour',
  name: 'Flour pack',
  sku: 'FLR-001',
  product_code: 'P-0002',
  barcode: null,
  active: true,
  stock: 8,
  unit: 'pack',
};

test('one scan with quantity 5 adds exactly 5 units and merges further additions', () => {
  const product = findScannedProduct([sardines, flour], sardines.barcode);
  const cart = cartAfterAdding([], product, '5');
  assert.deepEqual(cart, [{ product_id: 'sardines', quantity: 5 }]);
  assert.deepEqual(cartAfterAdding(cart, product, '3'), [{ product_id: 'sardines', quantity: 8 }]);
  assert.deepEqual(cart, [{ product_id: 'sardines', quantity: 5 }], 'original cart is immutable');
});

test('manual selection and scanning enforce total stock including units already in order', () => {
  const cart = cartAfterAdding([], flour, '5');
  assert.throws(
    () => cartAfterAdding(cart, flour, '4'),
    /5 already in the order; you can add 3 more/,
  );
  assert.deepEqual(cartAfterAdding(cart, flour, '3'), [{ product_id: 'flour', quantity: 8 }]);
  assert.throws(() => cartAfterAdding([], { ...flour, active: false }, 1), /no longer available/);
});

test('unknown and partial scans never select a single filtered product or product name', () => {
  assert.equal(findScannedProduct([sardines], '4800000'), null);
  assert.equal(findScannedProduct([sardines], 'Sardines'), null);
  assert.equal(findScannedProduct([flour], ''), null);
  assert.equal(findScannedProduct([{ ...sardines, active: false }], sardines.barcode), null);
  assert.equal(findScannedProduct([sardines, flour], ' p-0002 '), flour);
  assert.equal(findScannedProduct([sardines, flour], 'flr-001'), flour);
  assert.throws(
    () => findScannedProduct([sardines, { ...flour, sku: sardines.barcode }], sardines.barcode),
    /More than one product/,
  );
});

test('manual product search covers name, SKU, internal code, and barcode', () => {
  for (const query of ['sard', 'SAR-001', 'P-0001', '123456'])
    assert.equal(productMatches(sardines, query), true);
  assert.equal(productMatches(sardines, 'not-here'), false);
});

test('piece quantities reject blank, zero, negative, decimal, and exponential input', () => {
  for (const value of ['', ' ', 0, -1, '1.5', '1e2', 'Infinity', NaN, 1_000_001])
    assert.throws(() => wholeQuantity(value), /positive whole-number/);
  assert.equal(wholeQuantity('5'), 5);
  assert.equal(wholeQuantity('01'), 1);
});
