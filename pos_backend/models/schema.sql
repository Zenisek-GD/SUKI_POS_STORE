CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS roles(name text PRIMARY KEY CHECK(name IN ('admin','manager','cashier','inventory')));
INSERT INTO roles VALUES('admin'),('manager'),('cashier'),('inventory') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS stores(id uuid PRIMARY KEY,name text NOT NULL,address text NOT NULL DEFAULT '',contact text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS store_settings(
 store_id uuid PRIMARY KEY REFERENCES stores(id),currency text NOT NULL DEFAULT 'PHP',tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK(tax_rate BETWEEN 0 AND 100),
 tax_inclusive boolean NOT NULL DEFAULT false,logo_url text NOT NULL DEFAULT '',receipt_footer text NOT NULL DEFAULT 'Salamat! Thank you for shopping local.',
 payment_methods jsonb NOT NULL DEFAULT '["Cash","GCash","Maya","Bank transfer"]',low_stock_threshold integer NOT NULL DEFAULT 10 CHECK(low_stock_threshold>=0),
 cashier_discount_limit numeric(5,2) NOT NULL DEFAULT 10 CHECK(cashier_discount_limit BETWEEN 0 AND 100),loyalty_enabled boolean NOT NULL DEFAULT true,timezone text NOT NULL DEFAULT 'Asia/Manila'
);
CREATE TABLE IF NOT EXISTS users(
 id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),name text NOT NULL,email text NOT NULL UNIQUE,password_hash text NOT NULL,role text NOT NULL REFERENCES roles(name),
 active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(store_id,id)
);
CREATE TABLE IF NOT EXISTS sessions(sid text PRIMARY KEY,sess jsonb NOT NULL,expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS categories(id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),name text NOT NULL,color text NOT NULL DEFAULT '#2b7059',UNIQUE(store_id,name),UNIQUE(store_id,id));
CREATE TABLE IF NOT EXISTS suppliers(id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),name text NOT NULL,contact_person text NOT NULL DEFAULT '',phone text NOT NULL DEFAULT '',email text NOT NULL DEFAULT '',address text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(store_id,id));
CREATE TABLE IF NOT EXISTS customers(id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),name text NOT NULL,phone text NOT NULL DEFAULT '',email text NOT NULL DEFAULT '',address text NOT NULL DEFAULT '',loyalty_points integer NOT NULL DEFAULT 0 CHECK(loyalty_points>=0),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(store_id,id));
CREATE TABLE IF NOT EXISTS products(
 id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),name text NOT NULL,sku text NOT NULL,barcode text,category_id uuid,supplier_id uuid,description text NOT NULL DEFAULT '',
 cost_price integer NOT NULL CHECK(cost_price>=0),price integer NOT NULL CHECK(price>=0),stock integer NOT NULL DEFAULT 0 CHECK(stock>=0),min_stock integer CHECK(min_stock>=0),
 unit text NOT NULL DEFAULT 'pcs',image_url text NOT NULL DEFAULT '',emoji text NOT NULL DEFAULT '📦',active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(store_id,sku),UNIQUE(store_id,barcode),UNIQUE(store_id,id),
 FOREIGN KEY(store_id,category_id) REFERENCES categories(store_id,id),FOREIGN KEY(store_id,supplier_id) REFERENCES suppliers(store_id,id)
);
CREATE INDEX IF NOT EXISTS products_store_idx ON products(store_id,active);
CREATE INDEX IF NOT EXISTS products_category_idx ON products(store_id,category_id);
CREATE TABLE IF NOT EXISTS discounts(id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),name text NOT NULL,percent numeric(5,2) NOT NULL CHECK(percent BETWEEN 0 AND 100),active boolean NOT NULL DEFAULT true,UNIQUE(store_id,id));
CREATE TABLE IF NOT EXISTS sales(
 id uuid PRIMARY KEY,store_id uuid NOT NULL REFERENCES stores(id),number text NOT NULL UNIQUE,user_id uuid NOT NULL,customer_id uuid,
 subtotal integer NOT NULL CHECK(subtotal>=0),discount integer NOT NULL DEFAULT 0 CHECK(discount>=0),discount_percent numeric(5,2) NOT NULL DEFAULT 0,tax integer NOT NULL DEFAULT 0 CHECK(tax>=0),
 total integer NOT NULL CHECK(total>=0),cost_total integer NOT NULL CHECK(cost_total>=0),amount_received integer NOT NULL CHECK(amount_received>=0),change integer NOT NULL DEFAULT 0 CHECK(change>=0),
 loyalty_earned integer NOT NULL DEFAULT 0,status text NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','cancelled')),notes text NOT NULL DEFAULT '',cancel_reason text,cancelled_at timestamptz,
 receipt_store jsonb NOT NULL,idempotency_key uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(store_id,id),UNIQUE(store_id,idempotency_key),
 FOREIGN KEY(store_id,user_id) REFERENCES users(store_id,id),FOREIGN KEY(store_id,customer_id) REFERENCES customers(store_id,id)
);
CREATE INDEX IF NOT EXISTS sales_store_date_idx ON sales(store_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sales_cashier_idx ON sales(store_id,user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS sale_items(
 id uuid PRIMARY KEY,store_id uuid NOT NULL,sale_id uuid NOT NULL,product_id uuid NOT NULL,name text NOT NULL,sku text NOT NULL,category_name text NOT NULL,
 quantity integer NOT NULL CHECK(quantity>0),unit_price integer NOT NULL CHECK(unit_price>=0),cost_price integer NOT NULL CHECK(cost_price>=0),total integer NOT NULL CHECK(total>=0),
 FOREIGN KEY(store_id,sale_id) REFERENCES sales(store_id,id),FOREIGN KEY(store_id,product_id) REFERENCES products(store_id,id)
);
CREATE INDEX IF NOT EXISTS sale_items_sale_idx ON sale_items(store_id,sale_id);
CREATE TABLE IF NOT EXISTS payments(id uuid PRIMARY KEY,store_id uuid NOT NULL,sale_id uuid NOT NULL UNIQUE,method text NOT NULL,amount integer NOT NULL CHECK(amount>=0),reference text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(store_id,sale_id) REFERENCES sales(store_id,id));
CREATE TABLE IF NOT EXISTS inventory_transactions(
 id uuid PRIMARY KEY,store_id uuid NOT NULL,product_id uuid NOT NULL,user_id uuid NOT NULL,previous_quantity integer NOT NULL CHECK(previous_quantity>=0),quantity integer NOT NULL,new_quantity integer NOT NULL CHECK(new_quantity>=0),
 type text NOT NULL CHECK(type IN ('opening','sale','stock_in','stock_out','adjustment','damaged','return','purchase','cancellation')),reason text NOT NULL,reference_id uuid,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(previous_quantity+quantity=new_quantity),FOREIGN KEY(store_id,product_id) REFERENCES products(store_id,id),FOREIGN KEY(store_id,user_id) REFERENCES users(store_id,id)
);
CREATE INDEX IF NOT EXISTS inventory_date_idx ON inventory_transactions(store_id,created_at DESC);
CREATE TABLE IF NOT EXISTS purchases(
 id uuid PRIMARY KEY,store_id uuid NOT NULL,number text NOT NULL UNIQUE,supplier_id uuid NOT NULL,user_id uuid NOT NULL,total integer NOT NULL CHECK(total>=0),purchase_date date NOT NULL,
 payment_status text NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('paid','unpaid','partial')),receiving_status text NOT NULL DEFAULT 'pending' CHECK(receiving_status IN ('pending','received')),
 notes text NOT NULL DEFAULT '',received_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(store_id,id),FOREIGN KEY(store_id,supplier_id) REFERENCES suppliers(store_id,id),FOREIGN KEY(store_id,user_id) REFERENCES users(store_id,id)
);
CREATE TABLE IF NOT EXISTS purchase_items(id uuid PRIMARY KEY,store_id uuid NOT NULL,purchase_id uuid NOT NULL,product_id uuid NOT NULL,quantity integer NOT NULL CHECK(quantity>0),cost_price integer NOT NULL CHECK(cost_price>=0),FOREIGN KEY(store_id,purchase_id) REFERENCES purchases(store_id,id),FOREIGN KEY(store_id,product_id) REFERENCES products(store_id,id));
CREATE TABLE IF NOT EXISTS expenses(id uuid PRIMARY KEY,store_id uuid NOT NULL,user_id uuid NOT NULL,description text NOT NULL,category text NOT NULL,amount integer NOT NULL CHECK(amount>0),expense_date date NOT NULL,notes text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(store_id,user_id) REFERENCES users(store_id,id));
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(store_id,expense_date);
CREATE TABLE IF NOT EXISTS audit_logs(id uuid PRIMARY KEY,store_id uuid NOT NULL,user_id uuid NOT NULL,action text NOT NULL,entity_type text NOT NULL,entity_id uuid,summary text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(store_id,user_id) REFERENCES users(store_id,id));
CREATE INDEX IF NOT EXISTS audit_date_idx ON audit_logs(store_id,created_at DESC);
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;

-- Additive migration: retain every original sale and existing stock movement.
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_code text GENERATED ALWAYS AS ('P-' || upper(replace(id::text,'-',''))) STORED;
CREATE UNIQUE INDEX IF NOT EXISTS products_store_code_idx ON products(store_id,product_code);
ALTER TABLE products ADD COLUMN IF NOT EXISTS non_sellable_stock integer NOT NULL DEFAULT 0 CHECK(non_sellable_stock>=0);
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS sequence bigserial;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_sequence_idx ON inventory_transactions(sequence);
CREATE INDEX IF NOT EXISTS inventory_product_sequence_idx ON inventory_transactions(store_id,product_id,sequence,created_at);
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS non_sellable_quantity integer NOT NULL DEFAULT 0 CHECK(non_sellable_quantity>=0);
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS return_conditions jsonb NOT NULL DEFAULT '[{"code":"unused_unopened","label":"Unused, unopened, intact packaging","sellable":true,"enabled":true},{"code":"damaged","label":"Damaged (non-sellable)","sellable":false,"enabled":true},{"code":"defective","label":"Defective (non-sellable)","sellable":false,"enabled":true}]';
CREATE UNIQUE INDEX IF NOT EXISTS sale_items_store_id_idx ON sale_items(store_id,id);
CREATE TABLE IF NOT EXISTS sales_returns(
 id uuid PRIMARY KEY,store_id uuid NOT NULL,sale_id uuid NOT NULL,number text NOT NULL UNIQUE,user_id uuid NOT NULL,
 reason text NOT NULL,total integer NOT NULL CHECK(total>=0),tax integer NOT NULL CHECK(tax>=0),cost_total integer NOT NULL CHECK(cost_total>=0),
 idempotency_key uuid NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(store_id,id),UNIQUE(store_id,idempotency_key),
 FOREIGN KEY(store_id,sale_id) REFERENCES sales(store_id,id),FOREIGN KEY(store_id,user_id) REFERENCES users(store_id,id)
);
CREATE INDEX IF NOT EXISTS sales_returns_store_date_idx ON sales_returns(store_id,created_at);
CREATE INDEX IF NOT EXISTS sales_returns_sale_idx ON sales_returns(store_id,sale_id);
CREATE TABLE IF NOT EXISTS return_items(
 id uuid PRIMARY KEY,store_id uuid NOT NULL,return_id uuid NOT NULL,sale_item_id uuid NOT NULL,product_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity>0),condition text NOT NULL,condition_label text NOT NULL,sellable boolean NOT NULL,
 refund_amount integer NOT NULL CHECK(refund_amount>=0),tax integer NOT NULL CHECK(tax>=0),cost_total integer NOT NULL CHECK(cost_total>=0),
 UNIQUE(return_id,sale_item_id),FOREIGN KEY(store_id,return_id) REFERENCES sales_returns(store_id,id),
 FOREIGN KEY(store_id,sale_item_id) REFERENCES sale_items(store_id,id),FOREIGN KEY(store_id,product_id) REFERENCES products(store_id,id)
);
CREATE INDEX IF NOT EXISTS return_items_sale_item_idx ON return_items(store_id,sale_item_id);
INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING;
