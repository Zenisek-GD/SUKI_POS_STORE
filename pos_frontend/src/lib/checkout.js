const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

export function productMatches(product, query) {
  const text = normalize(query);
  return [product.name, product.sku, product.product_code, product.barcode].some((value) =>
    normalize(value).includes(text),
  );
}

export function findScannedProduct(products, query) {
  const code = normalize(query);
  if (!code) return null;
  const matches = products.filter(
    (product) =>
      product.active &&
      [product.barcode, product.product_code, product.sku].some(
        (value) => normalize(value) === code,
      ),
  );
  if (matches.length > 1)
    throw new Error('More than one product uses this code. Use Find Product to select it.');
  return matches[0] || null;
}

export function wholeQuantity(value) {
  const text = String(value).trim();
  const quantity = Number(text);
  if (
    !/^\d+$/.test(text) ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 1_000_000
  )
    throw new Error('Enter a positive whole-number quantity between 1 and 1,000,000.');
  return quantity;
}

export function cartAfterAdding(cart, product, enteredQuantity) {
  const quantity = wholeQuantity(enteredQuantity);
  if (!product?.active) throw new Error('This product is no longer available for sale.');
  const existing = cart.find((item) => item.product_id === product.id);
  const nextQuantity = (existing?.quantity || 0) + quantity;
  if (nextQuantity > product.stock)
    throw new Error(
      `Only ${product.stock} ${product.unit} available for ${product.name}. ` +
        `${existing?.quantity || 0} already in the order; you can add ${Math.max(0, product.stock - (existing?.quantity || 0))} more.`,
    );
  wholeQuantity(nextQuantity);
  return existing
    ? cart.map((item) =>
        item.product_id === product.id ? { ...item, quantity: nextQuantity } : item,
      )
    : [...cart, { product_id: product.id, quantity }];
}
