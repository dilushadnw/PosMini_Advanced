// Database Configuration using Dexie.js
// This file initializes the IndexedDB database for Sillara-POS

// Initialize Dexie database
const db = new Dexie("SillaraDB");

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function computeChecksum(payload) {
  const source = stableStringify(payload);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `fnv32:${(hash >>> 0).toString(16)}`;
}

// Define database schema
// Define database schema
db.version(11).stores({
  products: "++id, name, barcode, category, type, price, buyingPrice, stock, minStock",
  sales: "++id, date, totalAmount, items",
  purchases: "++id, date, supplier, totalCost, items",
  expenses: "++id, date, description, amount, category",
  returns: "++id, type, date, barcode, productId, productName, quantity, amount",
  stock_batches: "++id, productId, barcode, expDate, createdAt",
  users: "++id, &username, role, active",
  day_closings: "++id, date, closedBy, createdAt",
  customers: "++id, &code, name, phone, active, creditLimit",
  customer_ledger: "++id, customerId, date, type, amount, dueDate",
  suppliers: "++id, &code, name, phone, active, creditLimit, paymentTerms",
  supplier_ledger: "++id, supplierId, purchaseId, date, type, amount, dueDate",
  shop_settings: "id, name, phone, address, info",
  categories: "++id, &name" // Uniqueness constraint on category name
});

// Database helper functions
const DB = {
  // Category operations
  categories: {
    async getAll() {
      return await db.categories.toArray();
    },
    async add(name) {
      try {
        return await db.categories.add({ name });
      } catch (e) {
        // Ignore unique constraint errors
        return null;
      }
    },
    async delete(id) {
      return await db.categories.delete(id);
    },
    async update(id, name) {
      return await db.categories.update(id, { name });
    }
  },
  // Product operations
  products: {
    async getAll() {
      return await db.products.toArray();
    },

    async getById(id) {
      return await db.products.get(id);
    },
    
    async getByBarcode(barcode) {
      if (!barcode) return null;
      const items = await db.products.where('barcode').equals(barcode).toArray();
      // FIFO: Pick oldest ID that has stock, otherwise pick oldest ID
      return items.find(p => p.stock > 0) || items[0];
    },

    async getByBarcodeAndPrice(barcode, price) {
      return await db.products.where({ barcode, price }).first();
    },

    async add(product) {
      return await db.products.add(product);
    },

    async update(id, changes) {
      return await db.products.update(id, changes);
    },

    async delete(id) {
      return await db.products.delete(id);
    },

    async search(query) {
      const products = await db.products.toArray();
      const lowerQuery = query.toLowerCase();
      return products.filter(
        (p) =>
          p.name.toLowerCase().includes(lowerQuery) ||
          p.category.toLowerCase().includes(lowerQuery) ||
          (p.barcode && p.barcode.toLowerCase().includes(lowerQuery))
      );
    },

    async filterByCategory(category) {
      if (category === "all") {
        return await db.products.toArray();
      }
      return await db.products.where("category").equals(category).toArray();
    },

    async getLowStock() {
      const products = await db.products.toArray();
      return products.filter((p) => p.stock <= (p.minStock || 5));
    },

    async count() {
      return await db.products.count();
    },
  },

  // Sales operations
  sales: {
    async getAll() {
      return await db.sales.toArray();
    },

    async getById(id) {
      return await db.sales.get(id);
    },

    async add(sale) {
      sale.date = new Date();
      return await db.sales.add(sale);
    },

    async getToday() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const sales = await db.sales.toArray();
      return sales.filter((s) => {
        const saleDate = new Date(s.date);
        return saleDate >= today && saleDate < tomorrow;
      });
    },

    async getTodayTotal() {
      const todaySales = await this.getToday();
      return todaySales.reduce((sum, sale) => sum + sale.totalAmount, 0);
    },

    async getTodayCount() {
      const todaySales = await this.getToday();
      return todaySales.length;
    },

    async getByDateRange(fromDate, toDate) {
      const sales = await db.sales.toArray();
      const from = new Date(fromDate);
      from.setHours(0, 0, 0, 0);
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);

      return sales.filter((s) => {
        const saleDate = new Date(s.date);
        return saleDate >= from && saleDate <= to;
      });
    },

    async count() {
      return await db.sales.count();
    },
  },

  // Purchases operations
  purchases: {
    async add(purchase) {
      if (!purchase.date) purchase.date = new Date();
      return await db.purchases.add(purchase);
    },
    async getAll() {
      return await db.purchases.toArray();
    },
    async getByDateRange(fromDate, toDate) {
      const all = await db.purchases.toArray();
      const from = new Date(fromDate);
      from.setHours(0, 0, 0, 0);
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);

      return all.filter((p) => {
        const d = new Date(p.date);
        return d >= from && d <= to;
      });
    }
  },

  // Expenses operations
  expenses: {
      async add(expense) {
        if (!expense.date) expense.date = new Date();
        return await db.expenses.add(expense);
      },
      async getById(id) {
        return await db.expenses.get(id);
      },
      async delete(id) {
        return await db.expenses.delete(id);
      },
      async getAll() {
        return await db.expenses.toArray();
      },
      async getByDateRange(fromDate, toDate) {
        const all = await db.expenses.toArray();
        const from = new Date(fromDate);
        from.setHours(0, 0, 0, 0);
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
  
        return all.filter((e) => {
          const d = new Date(e.date);
          return d >= from && d <= to;
        });
      }
  },

  // Returns operations
  returns: {
    async add(returnEntry) {
      if (!returnEntry.date) returnEntry.date = new Date();
      return await db.returns.add(returnEntry);
    },
    async getById(id) {
      return await db.returns.get(id);
    },
    async update(id, changes) {
      return await db.returns.update(id, changes);
    },
    async delete(id) {
      return await db.returns.delete(id);
    },
    async getAll() {
      return await db.returns.toArray();
    },
    async getByDateRange(fromDate, toDate) {
      const all = await db.returns.toArray();
      const from = new Date(fromDate);
      from.setHours(0, 0, 0, 0);
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);

      return all.filter((r) => {
        const d = new Date(r.date);
        return d >= from && d <= to;
      });
    },
    async getByTypeAndDateRange(type, fromDate, toDate) {
      const rows = await this.getByDateRange(fromDate, toDate);
      return rows.filter(r => r.type === type);
    }
  },

  // Stock batch operations
  stock_batches: {
    async add(batch) {
      if (!batch.createdAt) batch.createdAt = new Date();
      return await db.stock_batches.add(batch);
    },
    async getAll() {
      return await db.stock_batches.toArray();
    },
    async getByProduct(productId) {
      return await db.stock_batches.where('productId').equals(productId).toArray();
    },
    async getExpiringWithin(days = 30) {
      const all = await db.stock_batches.toArray();
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setDate(end.getDate() + Number(days || 30));
      return all.filter((b) => {
        if (!b.expDate) return false;
        const d = new Date(b.expDate);
        if (isNaN(d.getTime())) return false;
        return d >= now && d <= end;
      });
    }
  },

  // Users and auth
  users: {
    async getAll() {
      return await db.users.toArray();
    },
    async getByUsername(username) {
      if (!username) return null;
      return await db.users.where('username').equals(username).first();
    },
    async verify(username, password) {
      const user = await this.getByUsername((username || '').trim());
      if (!user || !user.active) return null;
      return user.password === password ? user : null;
    },
    async add(user) {
      return await db.users.add(user);
    },
    async ensureDefaults() {
      const count = await db.users.count();
      if (count > 0) return;
      await db.users.bulkAdd([
        { username: 'admin', password: '1234', role: 'owner', active: true },
        { username: 'manager', password: '1234', role: 'manager', active: true },
        { username: 'cashier', password: '1234', role: 'cashier', active: true }
      ]);
    }
  },

  day_closings: {
    async add(row) {
      if (!row.createdAt) row.createdAt = new Date();
      return await db.day_closings.add(row);
    },
    async getAll() {
      return await db.day_closings.toArray();
    },
    async getByDate(dateKey) {
      const rows = await db.day_closings.toArray();
      return rows.find(r => r.date === dateKey) || null;
    }
  },

  customers: {
    async getAll() {
      return await db.customers.toArray();
    },
    async add(customer) {
      return await db.customers.add(customer);
    },
    async update(id, changes) {
      return await db.customers.update(id, changes);
    },
    async getByCode(code) {
      const normalized = String(code || '').trim();
      if (!normalized) return null;
      return await db.customers.where('code').equals(normalized).first();
    },
    async generateNextCode() {
      const all = await db.customers.toArray();
      const nums = all
        .map((c) => Number(String(c.code || '').replace(/\D/g, '')))
        .filter((n) => Number.isFinite(n) && n > 0);
      const next = (nums.length ? Math.max(...nums) : 0) + 1;
      return String(next);
    },
    async getOrCreateByName(name, phone = '') {
      const normalized = (name || '').trim();
      if (!normalized) return null;
      const all = await db.customers.toArray();
      const existing = all.find(c => (c.name || '').toLowerCase() === normalized.toLowerCase());
      if (existing) return existing;
      const code = await this.generateNextCode();
      const id = await db.customers.add({ code, name: normalized, phone: (phone || '').trim(), active: true, creditLimit: 0 });
      return await db.customers.get(id);
    },
    async getOrCreateByCode(code, name = '', phone = '') {
      const normalizedCode = String(code || '').trim();
      if (!normalizedCode) return null;
      const existing = await this.getByCode(normalizedCode);
      if (existing) {
        const changes = {};
        if (name && !existing.name) changes.name = String(name).trim();
        if (phone && !existing.phone) changes.phone = String(phone).trim();
        if (Object.keys(changes).length) {
          await db.customers.update(existing.id, changes);
          return await db.customers.get(existing.id);
        }
        return existing;
      }
      const normalizedName = String(name || '').trim().toLowerCase();
      if (normalizedName) {
        const all = await db.customers.toArray();
        const byName = all.find((c) => String(c.name || '').trim().toLowerCase() === normalizedName);
        if (byName && !byName.code) {
          await db.customers.update(byName.id, { code: normalizedCode, phone: String(phone || byName.phone || '').trim() });
          return await db.customers.get(byName.id);
        }
      }
      const fallbackName = String(name || '').trim() || `Customer ${normalizedCode}`;
      const id = await db.customers.add({
        code: normalizedCode,
        name: fallbackName,
        phone: String(phone || '').trim(),
        active: true,
        creditLimit: 0
      });
      return await db.customers.get(id);
    }
  },

  customer_ledger: {
    async add(entry) {
      if (!entry.date) entry.date = new Date();
      return await db.customer_ledger.add(entry);
    },
    async getAll() {
      return await db.customer_ledger.toArray();
    },
    async update(id, changes) {
      return await db.customer_ledger.update(id, changes);
    },
    async delete(id) {
      return await db.customer_ledger.delete(id);
    }
  },

  suppliers: {
    async getAll() {
      return await db.suppliers.toArray();
    },
    async add(supplier) {
      return await db.suppliers.add(supplier);
    },
    async update(id, changes) {
      return await db.suppliers.update(id, changes);
    },
    async getByCode(code) {
      const normalized = String(code || '').trim();
      if (!normalized) return null;
      return await db.suppliers.where('code').equals(normalized).first();
    },
    async generateNextCode() {
      const all = await db.suppliers.toArray();
      const nums = all
        .map((s) => Number(String(s.code || '').replace(/\D/g, '')))
        .filter((n) => Number.isFinite(n) && n > 0);
      const next = (nums.length ? Math.max(...nums) : 0) + 1;
      return String(next);
    },
    async getOrCreateByName(name) {
      const normalized = (name || '').trim() || 'Unknown';
      const all = await db.suppliers.toArray();
      const existing = all.find(s => (s.name || '').toLowerCase() === normalized.toLowerCase());
      if (existing) return existing;
      const code = await this.generateNextCode();
      const id = await db.suppliers.add({ code, name: normalized, phone: '', active: true, creditLimit: 0, paymentTerms: 'Net 30' });
      return await db.suppliers.get(id);
    },
    async getOrCreateByCode(code, name = '', phone = '') {
      const normalizedCode = String(code || '').trim();
      if (!normalizedCode) return null;
      const existing = await this.getByCode(normalizedCode);
      if (existing) {
        const changes = {};
        if (name && !existing.name) changes.name = String(name).trim();
        if (phone && !existing.phone) changes.phone = String(phone).trim();
        if (Object.keys(changes).length) {
          await db.suppliers.update(existing.id, changes);
          return await db.suppliers.get(existing.id);
        }
        return existing;
      }
      const normalizedName = String(name || '').trim().toLowerCase();
      if (normalizedName) {
        const all = await db.suppliers.toArray();
        const byName = all.find((s) => String(s.name || '').trim().toLowerCase() === normalizedName);
        if (byName && !byName.code) {
          await db.suppliers.update(byName.id, { code: normalizedCode, phone: String(phone || byName.phone || '').trim() });
          return await db.suppliers.get(byName.id);
        }
      }
      const fallbackName = String(name || '').trim() || `Supplier ${normalizedCode}`;
      const id = await db.suppliers.add({
        code: normalizedCode,
        name: fallbackName,
        phone: String(phone || '').trim(),
        active: true,
        creditLimit: 0,
        paymentTerms: 'Net 30'
      });
      return await db.suppliers.get(id);
    }
  },

  supplier_ledger: {
    async add(entry) {
      if (!entry.date) entry.date = new Date();
      return await db.supplier_ledger.add(entry);
    },
    async getAll() {
      return await db.supplier_ledger.toArray();
    },
    async update(id, changes) {
      return await db.supplier_ledger.update(id, changes);
    },
    async delete(id) {
      return await db.supplier_ledger.delete(id);
    },
    async getByPurchaseId(purchaseId) {
      if (!purchaseId) return [];
      return await db.supplier_ledger.where('purchaseId').equals(purchaseId).toArray();
    }
  },

  // Shop Settings operations
  shop_settings: {
    async get() {
      // Shop settings uses a single record with id = 1
      const settings = await db.shop_settings.get(1);
      return settings || {
        id: 1,
        name: "Sillara Badu Kadaya",
        phone: "",
        address: "",
        info: ""
      };
    },
    
    async save(settings) {
      settings.id = 1; // Always use id 1 for shop settings
      await db.shop_settings.put(settings);
      return settings;
    }
  },

  // Purchase Payment Tracking
  async getPurchasePaymentStatus(purchaseId) {
    if (!purchaseId) return null;
    const purchase = await db.purchases.get(purchaseId);
    if (!purchase) return null;

    const ledgerEntries = await db.supplier_ledger.where('purchaseId').equals(purchaseId).toArray();
    
    let totalPaid = 0;
    ledgerEntries.forEach(entry => {
      const type = (entry?.type || '').toLowerCase();
      const amount = Number(entry?.amount) || 0;
      if (type === 'payment') totalPaid += amount;
    });

    const outstanding = purchase.totalCost - totalPaid;
    const isPaid = outstanding <= 0;
    const isPartiallyPaid = totalPaid > 0 && totalPaid < purchase.totalCost;

    return {
      purchaseId,
      purchase,
      totalCost: purchase.totalCost,
      totalPaid,
      outstanding: Math.max(0, outstanding),
      isPaid,
      isPartiallyPaid,
      paymentPercentage: Math.round((totalPaid / purchase.totalCost) * 100)
    };
  },

  async getUnpaidPurchases() {
    const purchases = await db.purchases.toArray();
    const results = [];

    for (const purchase of purchases) {
      const status = await this.getPurchasePaymentStatus(purchase.id);
      if (status && !status.isPaid) {
        results.push(status);
      }
    }

    return results.sort((a, b) => new Date(b.purchase.date) - new Date(a.purchase.date));
  },

  async getSupplierUnpaidPurchases(supplierId) {
    const purchases = await db.purchases.toArray();
    const supplierPurchases = purchases.filter(p => {
      const supplier = p.supplier || 'Unknown';
      return supplier.toLowerCase().includes((supplierId || '').toLowerCase());
    });

    const results = [];
    for (const purchase of supplierPurchases) {
      const status = await this.getPurchasePaymentStatus(purchase.id);
      if (status && !status.isPaid) {
        results.push(status);
      }
    }

    return results.sort((a, b) => new Date(b.purchase.date) - new Date(a.purchase.date));
  },

  // Customer Payment Tracking with aging
  async getCustomerPaymentStatus(customerId) {
    if (!customerId) return null;
    const customer = await db.customers.get(customerId);
    if (!customer) return null;

    const ledgerEntries = await db.customer_ledger.where('customerId').equals(customerId).toArray();
    
    let totalOutstanding = 0;
    let overdueAmount = 0;
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    ledgerEntries.forEach(entry => {
      const type = (entry?.type || '').toLowerCase();
      const amount = Number(entry?.amount) || 0;
      const impact = type === 'sale' || type === 'adjustment' ? amount : (type === 'payment' ? -amount : 0);
      totalOutstanding += impact;

      // Check if overdue
      if (impact > 0 && entry.dueDate) {
        const dueDate = new Date(entry.dueDate);
        if (dueDate < now) {
          overdueAmount += impact;
        }
      }
    });

    const creditLimit = Number(customer.creditLimit) || 0;
    const creditUsed = Math.max(0, totalOutstanding);
    const availableCredit = Math.max(0, creditLimit - creditUsed);
    const isOverLimit = creditUsed > creditLimit && creditLimit > 0;

    return {
      customerId,
      customer,
      totalOutstanding: Math.max(0, totalOutstanding),
      overdueAmount,
      creditLimit,
      creditUsed,
      availableCredit,
      isOverLimit,
      creditUtilization: creditLimit > 0 ? Math.round((creditUsed / creditLimit) * 100) : 0
    };
  },

  async getCustomersByOutstandingAmount() {
    const customers = await db.customers.toArray();
    const results = [];

    for (const customer of customers) {
      const status = await this.getCustomerPaymentStatus(customer.id);
      if (status && status.totalOutstanding > 0) {
        results.push(status);
      }
    }

    return results.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  },

  // Supplier Payment Tracking with aging
  async getSupplierPaymentStatus(supplierId) {
    if (!supplierId) return null;
    const supplier = await db.suppliers.get(supplierId);
    if (!supplier) return null;

    const ledgerEntries = await db.supplier_ledger.where('supplierId').equals(supplierId).toArray();
    
    let totalOutstanding = 0;
    let overdueAmount = 0;
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    ledgerEntries.forEach(entry => {
      const type = (entry?.type || '').toLowerCase();
      const amount = Number(entry?.amount) || 0;
      const impact = type === 'purchase' || type === 'adjustment' ? amount : (type === 'payment' ? -amount : 0);
      totalOutstanding += impact;

      // Check if overdue
      if (impact > 0 && entry.dueDate) {
        const dueDate = new Date(entry.dueDate);
        if (dueDate < now) {
          overdueAmount += impact;
        }
      }
    });

    const creditLimit = Number(supplier.creditLimit) || 0;
    const creditUsed = Math.max(0, totalOutstanding);
    const paymentTerms = (supplier.paymentTerms || 'Net 30').toString();

    return {
      supplierId,
      supplier,
      totalOutstanding: Math.max(0, totalOutstanding),
      overdueAmount,
      creditLimit,
      creditUsed,
      paymentTerms
    };
  },

  async getSuppliersByOutstandingAmount() {
    const suppliers = await db.suppliers.toArray();
    const results = [];

    for (const supplier of suppliers) {
      const status = await this.getSupplierPaymentStatus(supplier.id);
      if (status && status.totalOutstanding > 0) {
        results.push(status);
      }
    }

    return results.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  },

  // Utility operations
  async exportAll() {
    const products = await db.products.toArray();
    const sales = await db.sales.toArray();
    const purchases = await db.purchases.toArray();
    const expenses = await db.expenses.toArray();
    const returns = await db.returns.toArray();
    const stockBatches = await db.stock_batches.toArray();
    const users = await db.users.toArray();
    const dayClosings = await db.day_closings.toArray();
    const customers = await db.customers.toArray();
    const customerLedger = await db.customer_ledger.toArray();
    const suppliers = await db.suppliers.toArray();
    const supplierLedger = await db.supplier_ledger.toArray();
    const categories = await db.categories.toArray();
    const shopSettings = await db.shop_settings.get(1);

    const payload = {
      products,
      sales,
      purchases,
      expenses,
      returns,
      stockBatches,
      users,
      dayClosings,
      customers,
      customerLedger,
      suppliers,
      supplierLedger,
      categories,
      shopSettings,
      exportDate: new Date().toISOString(),
      version: 11,
    };

    const checksum = computeChecksum(payload);
    return { ...payload, checksum };
  },

  async importAll(data) {
    try {
      if (data && data.checksum) {
        const { checksum, ...rest } = data;
        const actualChecksum = computeChecksum(rest);
        if (actualChecksum !== checksum) {
          throw new Error('Backup checksum validation failed. File may be corrupted or modified.');
        }
      }

      await db.transaction(
        "rw",
        db.products,
        db.sales,
        db.purchases,
        db.expenses,
        db.returns,
        db.stock_batches,
        db.users,
        db.day_closings,
        db.customers,
        db.customer_ledger,
        db.suppliers,
        db.supplier_ledger,
        db.categories,
        db.shop_settings,
        async () => {
          await db.products.clear();
          await db.sales.clear();
          await db.purchases.clear();
          await db.expenses.clear();
          await db.returns.clear();
          await db.stock_batches.clear();
          await db.users.clear();
          await db.day_closings.clear();
          await db.customers.clear();
          await db.customer_ledger.clear();
          await db.suppliers.clear();
          await db.supplier_ledger.clear();
          await db.categories.clear();
          await db.shop_settings.clear();

          if (data.products) await db.products.bulkAdd(data.products);
          if (data.sales) await db.sales.bulkAdd(data.sales);
          if (data.purchases) await db.purchases.bulkAdd(data.purchases);
          if (data.expenses) await db.expenses.bulkAdd(data.expenses);
          if (data.returns) await db.returns.bulkAdd(data.returns);
          if (data.stockBatches) await db.stock_batches.bulkAdd(data.stockBatches);
          if (data.users) await db.users.bulkAdd(data.users);
          if (data.dayClosings) await db.day_closings.bulkAdd(data.dayClosings);
          if (data.customers) await db.customers.bulkAdd(data.customers);
          if (data.customerLedger) await db.customer_ledger.bulkAdd(data.customerLedger);
          if (data.suppliers) await db.suppliers.bulkAdd(data.suppliers);
          if (data.supplierLedger) await db.supplier_ledger.bulkAdd(data.supplierLedger);
          if (data.categories) await db.categories.bulkAdd(data.categories);
          if (data.shopSettings) await db.shop_settings.put(data.shopSettings);

          if (!data.users || data.users.length === 0) {
            await DB.users.ensureDefaults();
          }
        }
      );
      return true;
    } catch (error) {
      console.error("Import error:", error);
      throw error;
    }
  },

  async clearAll() {
    await db.products.clear();
    await db.sales.clear();
    await db.purchases.clear();
    await db.expenses.clear();
    await db.returns.clear();
    await db.stock_batches.clear();
    await db.day_closings.clear();
    await db.customers.clear();
    await db.customer_ledger.clear();
    await db.suppliers.clear();
    await db.supplier_ledger.clear();
    await db.categories.clear();
    // Don't clear shop settings when clearing data
  },

  async loadSampleData() {
    await db.transaction("rw", db.products, db.sales, db.purchases, db.expenses, db.returns, db.stock_batches, db.day_closings, db.customers, db.customer_ledger, db.suppliers, db.supplier_ledger, db.categories, async () => {
      await db.products.clear();
      await db.sales.clear();
      await db.purchases.clear();
      await db.expenses.clear();
      await db.returns.clear();
      await db.stock_batches.clear();
      await db.day_closings.clear();
      await db.customers.clear();
      await db.customer_ledger.clear();
      await db.suppliers.clear();
      await db.supplier_ledger.clear();
      await db.categories.clear();
    });

    const sampleCategories = [
      { name: "Grocery" },
      { name: "Vegetables" },
      { name: "Biscuits" },
      { name: "Household" },
      { name: "Other" }
    ];
    await db.categories.bulkAdd(sampleCategories);

    const sampleProducts = [
      {
        barcode: "100001",
        name: "Rice - සුදු හාල්",
        category: "Grocery",
        type: "weight",
        price: 240,
        buyingPrice: 205,
        stock: 38,
        minStock: 10,
      },
      {
        barcode: "100002",
        name: "Sugar - සීනි",
        category: "Grocery",
        type: "weight",
        price: 265,
        buyingPrice: 225,
        stock: 22,
        minStock: 5,
      },
      {
        barcode: "100003",
        name: "Dhal - පරිප්පු",
        category: "Grocery",
        type: "weight",
        price: 310,
        buyingPrice: 268,
        stock: 17,
        minStock: 5,
      },
      {
        barcode: "200001",
        name: "Tomatoes - තක්කාලි",
        category: "Vegetables",
        type: "weight",
        price: 260,
        buyingPrice: 210,
        stock: 11,
        minStock: 3,
      },
      {
        barcode: "300001",
        name: "Maliban Cream Cracker",
        category: "Biscuits",
        type: "unit",
        price: 230,
        buyingPrice: 188,
        stock: 44,
        minStock: 10,
      },
      {
        barcode: "300002",
        name: "Munchee Lemon Puff",
        category: "Biscuits",
        type: "unit",
        price: 250,
        buyingPrice: 205,
        stock: 36,
        minStock: 10,
      },
      {
        barcode: "400001",
        name: "Sunlight Soap",
        category: "Household",
        type: "unit",
        price: 120,
        buyingPrice: 90,
        stock: 58,
        minStock: 15,
      },
      {
        barcode: "400002",
        name: "Plastic Basin - බේසම",
        category: "Household",
        type: "unit",
        price: 480,
        buyingPrice: 390,
        stock: 16,
        minStock: 5,
      },
    ];

    await db.products.bulkAdd(sampleProducts);

    const makeDate = (daysAgo, hour) => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      d.setHours(hour, 15, 0, 0);
      return d;
    };

    const samplePurchases = [
      {
        supplier: "Lanka Wholesale",
        date: makeDate(6, 9),
        totalCost: 15610,
        items: [
          { barcode: "100001", name: "Rice - සුදු හාල්", quantity: 30, type: "weight", buyingPrice: 205, sellingPrice: 240, total: 6150 },
          { barcode: "100002", name: "Sugar - සීනි", quantity: 20, type: "weight", buyingPrice: 225, sellingPrice: 265, total: 4500 },
          { barcode: "300001", name: "Maliban Cream Cracker", quantity: 20, type: "unit", buyingPrice: 188, sellingPrice: 230, total: 3760 },
          { barcode: "400001", name: "Sunlight Soap", quantity: 20, type: "unit", buyingPrice: 90, sellingPrice: 120, total: 1800 },
        ],
      },
      {
        supplier: "City Distributors",
        date: makeDate(2, 11),
        totalCost: 9830,
        items: [
          { barcode: "100003", name: "Dhal - පරිප්පු", quantity: 15, type: "weight", buyingPrice: 268, sellingPrice: 310, total: 4020 },
          { barcode: "200001", name: "Tomatoes - තක්කාලි", quantity: 12, type: "weight", buyingPrice: 210, sellingPrice: 260, total: 2520 },
          { barcode: "300002", name: "Munchee Lemon Puff", quantity: 18, type: "unit", buyingPrice: 205, sellingPrice: 250, total: 3690 },
        ],
      },
    ];

    await db.purchases.bulkAdd(samplePurchases);

    const sampleSales = [
      {
        date: makeDate(5, 13),
        totalAmount: 1690,
        items: [
          { barcode: "100001", name: "Rice - සුදු හාල්", quantity: 3, price: 240, buyingPrice: 205, total: 720 },
          { barcode: "300001", name: "Maliban Cream Cracker", quantity: 2, price: 230, buyingPrice: 188, total: 460 },
          { barcode: "400001", name: "Sunlight Soap", quantity: 3, price: 120, buyingPrice: 90, total: 360 },
          { barcode: "200001", name: "Tomatoes - තක්කාලි", quantity: 0.5, price: 260, buyingPrice: 210, total: 130 },
        ],
      },
      {
        date: makeDate(3, 16),
        totalAmount: 1995,
        items: [
          { barcode: "100002", name: "Sugar - සීනි", quantity: 2, price: 265, buyingPrice: 225, total: 530 },
          { barcode: "100003", name: "Dhal - පරිප්පු", quantity: 1.5, price: 310, buyingPrice: 268, total: 465 },
          { barcode: "300002", name: "Munchee Lemon Puff", quantity: 3, price: 250, buyingPrice: 205, total: 750 },
          { barcode: "400001", name: "Sunlight Soap", quantity: 2, price: 120, buyingPrice: 90, total: 240 },
        ],
      },
      {
        date: makeDate(1, 19),
        totalAmount: 2159,
        items: [
          { barcode: "100001", name: "Rice - සුදු හාල්", quantity: 2.5, price: 240, buyingPrice: 205, total: 600 },
          { barcode: "300001", name: "Maliban Cream Cracker", quantity: 4, price: 230, buyingPrice: 188, total: 920 },
          { barcode: "400002", name: "Plastic Basin - බේසම", quantity: 1, price: 480, buyingPrice: 390, total: 480 },
          { barcode: "100002", name: "Sugar - සීනි", quantity: 0.6, price: 265, buyingPrice: 225, total: 159 },
        ],
      },
    ];

    await db.sales.bulkAdd(sampleSales);

      // Create suppliers with credit limits and payment terms
      await db.suppliers.bulkAdd([
        { id: 1, name: 'Lanka Wholesale', phone: '0711234567', active: true, creditLimit: 100000, paymentTerms: 'Net 30' },
        { id: 2, name: 'City Distributors', phone: '0712345678', active: true, creditLimit: 50000, paymentTerms: 'Net 15' }
      ]);

      // Create sample customers with credit limits
      await db.customers.bulkAdd([
        { id: 1, name: 'Kamal Silva', phone: '0771234567', active: true, creditLimit: 25000 },
        { id: 2, name: 'Jayani Perera', phone: '0772345678', active: true, creditLimit: 15000 },
        { id: 3, name: 'Ravi Kumar', phone: '0773456789', active: true, creditLimit: 30000 }
      ]);

      // Add purchase ledger entries for suppliers
      await db.supplier_ledger.bulkAdd([
        { id: 1, supplierId: 1, purchaseId: 1, date: makeDate(6, 9), type: 'purchase', amount: 15610, ref: 'purchase' },
        { id: 2, supplierId: 1, purchaseId: 1, date: makeDate(4, 14), type: 'payment', amount: 8000, ref: 'supplier-payment' },
        { id: 3, supplierId: 2, purchaseId: 2, date: makeDate(2, 11), type: 'purchase', amount: 9830, ref: 'purchase' }
      ]);

      // Add sample customer credit sales
      await db.customer_ledger.bulkAdd([
        { id: 1, customerId: 1, date: makeDate(5, 14), type: 'sale', amount: 8500, ref: 'credit-sale', dueDate: new Date(new Date().setDate(new Date().getDate() + 30)) },
        { id: 2, customerId: 2, date: makeDate(3, 15), type: 'sale', amount: 5000, ref: 'credit-sale', dueDate: new Date(new Date().setDate(new Date().getDate() - 5)) },
        { id: 3, customerId: 2, date: makeDate(1, 10), type: 'payment', amount: 2000, ref: 'customer-payment' },
        { id: 4, customerId: 3, date: makeDate(4, 16), type: 'sale', amount: 12000, ref: 'credit-sale', dueDate: new Date(new Date().setDate(new Date().getDate() + 15)) }
      ]);
  },
};

// Initialize database
db.open()
  .then(() => {
    console.log("Sillara-POS Database initialized successfully!");
  })
  .catch((err) => {
    console.error("Failed to open database:", err);
  });

// Export for use in other files
window.DB = DB;
